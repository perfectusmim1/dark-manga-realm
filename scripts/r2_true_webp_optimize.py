import argparse
import concurrent.futures
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path.cwd()
OUTPUT_DIR = ROOT / "tmp" / "r2-true-webp-optimize"
COMPLETED_KEYS_PATH = OUTPUT_DIR / "completed_keys.txt"
ERRORS_PATH = OUTPUT_DIR / "errors.jsonl"
REPORT_PATH = OUTPUT_DIR / "report.json"
DEFAULT_LIST_PAGE_SIZE = 500
DEFAULT_WEBP_QUALITY = 90
DEFAULT_CONCURRENCY = 10
WEBP_MAX_DIMENSION = 16383
JPEG_FALLBACK_QUALITY = 95
IMAGE_KEY_PATTERN = re.compile(r"\.(?:png|jpe?g|webp|avif)$", re.IGNORECASE)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)


def load_env_file(file_path: Path) -> dict[str, str]:
    if not file_path.exists():
        return {}

    entries: dict[str, str] = {}
    for raw_line in file_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        entries[key.strip()] = value.strip()

    return entries


ENV_FROM_FILES = {
    **load_env_file(ROOT / ".env"),
    **load_env_file(ROOT / ".env.local"),
}


def get_env(*keys: str) -> str:
    for key in keys:
        value = os.environ.get(key) or ENV_FROM_FILES.get(key) or ""
        value = value.strip()
        if value:
            return value
    return ""


def normalize_text(value: str | None) -> str:
    return (value or "").strip()


def format_number(value: int | float) -> str:
    return f"{value:,}".replace(",", ".")


def format_size(num_bytes: int | float) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(max(0, num_bytes))
    unit_index = 0

    while value >= 1024 and unit_index < len(units) - 1:
        value /= 1024
        unit_index += 1

    if unit_index == 0:
        return f"{int(value)} {units[unit_index]}"

    return f"{value:.2f} {units[unit_index]}"


def format_percent(ratio: float) -> str:
    return f"{max(0.0, min(1.0, ratio)) * 100:.1f}%"


def render_progress_bar(current: int, total: int, width: int = 24) -> str:
    safe_total = max(1, int(total or 0))
    safe_current = max(0, min(safe_total, int(current or 0)))
    ratio = safe_current / safe_total
    filled = max(0, min(width, round(ratio * width)))
    return f"[{'#' * filled}{'-' * (width - filled)}] {format_percent(ratio)}"


def truncate_text(value: str, max_length: int = 72) -> str:
    normalized = normalize_text(value)
    if len(normalized) <= max_length:
        return normalized
    return f"{normalized[: max(0, max_length - 3)].rstrip()}..."


def ensure_output_dir() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def log_line(message: str = "") -> None:
    print(message, flush=True)


def get_content_type_for_format(image_format: str) -> str:
    normalized = normalize_text(image_format).upper()
    if normalized in {"JPG", "JPEG", "MPO"}:
        return "image/jpeg"
    if normalized == "PNG":
        return "image/png"
    if normalized == "WEBP":
        return "image/webp"
    if normalized == "AVIF":
        return "image/avif"
    return "application/octet-stream"


def is_webp_limit_error(error: Exception) -> bool:
    message = normalize_text(str(error)).lower()
    return "webp limit of 16383 pixels" in message or "exceeds webp limit" in message


def load_completed_keys(reset_state: bool) -> set[str]:
    if reset_state and COMPLETED_KEYS_PATH.exists():
        COMPLETED_KEYS_PATH.unlink()
    if reset_state and ERRORS_PATH.exists():
        ERRORS_PATH.unlink()

    if not COMPLETED_KEYS_PATH.exists():
        return set()

    return {
        line.strip()
        for line in COMPLETED_KEYS_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    }


def append_completed_key(key: str) -> None:
    with COMPLETED_KEYS_PATH.open("a", encoding="utf-8") as handle:
        handle.write(f"{key}\n")


def append_error_record(record: dict) -> None:
    with ERRORS_PATH.open("a", encoding="utf-8") as handle:
        handle.write(f"{json.dumps(record, ensure_ascii=False)}\n")


def authorized_request(url: str, token: str, method: str = "GET", body: bytes | None = None, headers: dict | None = None):
    request_headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": USER_AGENT,
        **(headers or {}),
    }
    request = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    return urllib.request.urlopen(request, timeout=120)


def json_request(url: str, token: str) -> dict:
    with authorized_request(url, token) as response:
        return json.loads(response.read().decode("utf-8"))


def list_bucket_objects(worker_url: str, token: str, prefix: str, page_size: int, progress_callback=None, max_items: int = 0) -> list[dict]:
    base_url = worker_url.rstrip("/")
    cursor = ""
    items: list[dict] = []
    page_index = 0

    while True:
        params = {
            "prefix": prefix,
            "limit": str(page_size),
        }
        if cursor:
            params["cursor"] = cursor

        request_url = f"{base_url}/admin/list?{urllib.parse.urlencode(params)}"
        payload = json_request(request_url, token)
        batch_items = payload.get("items") or []
        items.extend(batch_items)
        if max_items > 0 and len(items) >= max_items:
            items = items[:max_items]
        page_index += 1
        if progress_callback:
            progress_callback({
                "pageIndex": page_index,
                "batchCount": len(batch_items),
                "totalCount": len(items),
                "truncated": bool(payload.get("truncated")) and not (max_items > 0 and len(items) >= max_items),
            })

        if max_items > 0 and len(items) >= max_items:
            break

        if not payload.get("truncated") or not payload.get("cursor"):
            break

        cursor = str(payload.get("cursor") or "")

    return items


def download_public_object(public_url: str) -> bytes:
    request = urllib.request.Request(public_url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=180) as response:
        return response.read()


def save_webp_bytes(original_image: Image.Image, export_image: Image.Image, quality: int) -> bytes:
    output = BytesIO()
    save_kwargs = {
        "format": "WEBP",
        "quality": quality,
        "method": 6,
    }

    if "A" in export_image.getbands():
        save_kwargs["alpha_quality"] = max(quality, 92)

    icc_profile = original_image.info.get("icc_profile")
    if icc_profile:
        save_kwargs["icc_profile"] = icc_profile

    exif_bytes = original_image.info.get("exif")
    if exif_bytes:
        save_kwargs["exif"] = exif_bytes

    export_image.save(output, **save_kwargs)
    return output.getvalue()


def save_fallback_bytes(original_image: Image.Image, image: Image.Image, source_format: str, quality: int) -> tuple[str, bytes]:
    has_alpha = "A" in image.getbands()
    target_format = "PNG" if has_alpha or source_format == "PNG" else "JPEG"
    output = BytesIO()

    icc_profile = original_image.info.get("icc_profile")
    exif_bytes = original_image.info.get("exif")

    if target_format == "PNG":
        export_image = image.convert("RGBA" if has_alpha else "RGB")
        save_kwargs = {
            "format": "PNG",
            "optimize": True,
            "compress_level": 9,
        }
        if icc_profile:
            save_kwargs["icc_profile"] = icc_profile
        if exif_bytes:
            save_kwargs["exif"] = exif_bytes
        export_image.save(output, **save_kwargs)
        return target_format, output.getvalue()

    export_image = image.convert("RGB")
    save_kwargs = {
        "format": "JPEG",
        "quality": max(int(quality or DEFAULT_WEBP_QUALITY), JPEG_FALLBACK_QUALITY),
        "optimize": True,
        "progressive": True,
        "subsampling": 0,
    }
    if icc_profile:
        save_kwargs["icc_profile"] = icc_profile
    if exif_bytes:
        save_kwargs["exif"] = exif_bytes
    export_image.save(output, **save_kwargs)
    return target_format, output.getvalue()


def optimize_image_bytes(source_bytes: bytes, quality: int, reencode_webp: bool) -> dict:
    with Image.open(BytesIO(source_bytes)) as original_image:
        original_image.load()
        source_format = normalize_text(getattr(original_image, "format", "")).upper() or "UNKNOWN"

        if source_format == "WEBP" and not reencode_webp:
            return {
                "status": "skip",
                "sourceFormat": source_format,
            }

        image = ImageOps.exif_transpose(original_image)
        width, height = image.size
        has_alpha = "A" in image.getbands()
        export_image = image.convert("RGBA" if has_alpha else "RGB")

        fallback_reason = ""
        output_format = "WEBP"

        if max(width, height) > WEBP_MAX_DIMENSION:
            fallback_reason = f"WebP boyut limiti asildi ({width}x{height})"
        else:
            try:
                return {
                    "status": "converted",
                    "sourceFormat": source_format,
                    "targetFormat": "WEBP",
                    "outputBytes": save_webp_bytes(original_image, export_image, quality),
                    "mode": "localhost-webp-optimize",
                }
            except Exception as error:  # noqa: BLE001
                if not is_webp_limit_error(error):
                    raise
                fallback_reason = normalize_text(str(error)) or f"WebP boyut limiti asildi ({width}x{height})"

        output_format, fallback_bytes = save_fallback_bytes(original_image, image, source_format, quality)
        if len(fallback_bytes) >= len(source_bytes):
            return {
                "status": "kept",
                "sourceFormat": source_format,
                "targetFormat": source_format,
                "reason": f"{fallback_reason} | fallback daha kucuk degil",
            }

        return {
            "status": "fallback",
            "sourceFormat": source_format,
            "targetFormat": output_format,
            "outputBytes": fallback_bytes,
            "mode": f"localhost-{output_format.lower()}-fallback",
            "reason": fallback_reason,
        }


def upload_optimized_object(worker_url: str, token: str, object_key: str, payload_bytes: bytes, source_format: str, target_format: str, mode: str) -> dict:
    base_url = worker_url.rstrip("/")
    query = urllib.parse.urlencode({
        "objectKey": object_key,
        "contentType": get_content_type_for_format(target_format),
        "sourceFormat": source_format,
        "mode": mode,
    })
    request_url = f"{base_url}/admin/upload?{query}"
    with authorized_request(
        request_url,
        token,
        method="POST",
        body=payload_bytes,
        headers={
            "Content-Type": get_content_type_for_format(target_format),
        },
    ) as response:
        return json.loads(response.read().decode("utf-8"))


def process_object(item: dict, worker_url: str, worker_token: str, quality: int, reencode_webp: bool) -> dict:
    object_key = normalize_text(item.get("key"))
    public_url = normalize_text(item.get("publicUrl"))
    object_size = int(item.get("size") or 0)

    try:
        source_bytes = download_public_object(public_url)
        optimization = optimize_image_bytes(source_bytes, quality, reencode_webp)

        if optimization["status"] == "skip":
            return {
                "status": "skip",
                "key": object_key,
                "publicUrl": public_url,
                "objectSize": object_size,
                "sourceFormat": optimization["sourceFormat"],
            }

        if optimization["status"] == "kept":
            return {
                "status": "kept",
                "key": object_key,
                "publicUrl": public_url,
                "objectSize": object_size,
                "sourceFormat": optimization["sourceFormat"],
                "targetFormat": optimization["targetFormat"],
                "reason": optimization["reason"],
            }

        upload_optimized_object(
            worker_url,
            worker_token,
            object_key,
            optimization["outputBytes"],
            optimization["sourceFormat"],
            optimization["targetFormat"],
            optimization["mode"],
        )
        return {
            "status": optimization["status"],
            "key": object_key,
            "publicUrl": public_url,
            "objectSize": object_size,
            "sourceFormat": optimization["sourceFormat"],
            "targetFormat": optimization["targetFormat"],
            "sourceBytes": len(source_bytes),
            "outputBytes": len(optimization["outputBytes"]),
            "savedBytes": max(0, len(source_bytes) - len(optimization["outputBytes"])),
            "reason": optimization.get("reason"),
        }
    except Exception as error:  # noqa: BLE001
        return {
            "status": "error",
            "key": object_key,
            "publicUrl": public_url,
            "objectSize": object_size,
            "error": str(error),
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Optimize existing R2 objects into true WebP in place.")
    parser.add_argument("--apply", action="store_true", help="Actually upload optimized WebP files back to R2.")
    parser.add_argument("--prefix", default="", help="Only process object keys under this prefix.")
    parser.add_argument("--limit", type=int, default=0, help="Optional maximum object count to process.")
    parser.add_argument("--quality", type=int, default=DEFAULT_WEBP_QUALITY, help="WebP quality (default: 90).")
    parser.add_argument("--page-size", type=int, default=DEFAULT_LIST_PAGE_SIZE, help="R2 list page size (default: 500).")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY, help="Parallel worker count (default: 10).")
    parser.add_argument("--reset-state", action="store_true", help="Clear local completed state before starting.")
    parser.add_argument("--reencode-webp", action="store_true", help="Re-encode existing true WebP files too.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    ensure_output_dir()

    worker_url = get_env("MEDIA_INGEST_URL", "VITE_MEDIA_INGEST_URL")
    worker_token = get_env("MEDIA_INGEST_TOKEN", "VITE_MEDIA_INGEST_TOKEN")

    missing = [name for name, value in [
        ("MEDIA_INGEST_URL", worker_url),
        ("MEDIA_INGEST_TOKEN", worker_token),
    ] if not value]

    if missing:
        print(f"Eksik ortam degiskenleri: {', '.join(missing)}")
        return 1

    completed_keys = load_completed_keys(args.reset_state)
    log_line("Asama 1/3: R2 bucket taraniyor...")
    listed_items = list_bucket_objects(
        worker_url,
        worker_token,
        normalize_text(args.prefix),
        max(1, min(args.page_size, 1000)),
        max_items=max(0, args.limit) if args.limit > 0 else 0,
        progress_callback=lambda progress: log_line(
            f"Listeleme | sayfa {format_number(progress['pageIndex'])} | "
            f"bu parti {format_number(progress['batchCount'])} | "
            f"toplam {format_number(progress['totalCount'])} obje"
            f"{' | devam ediyor' if progress['truncated'] else ' | listeleme tamam'}"
        ),
    )
    log_line("Asama 2/3: Goruntuler filtreleniyor ve state kontrol ediliyor...")
    image_items = [item for item in listed_items if IMAGE_KEY_PATTERN.search(normalize_text(item.get("key")))]

    if args.limit > 0:
        image_items = image_items[: max(0, args.limit)]

    total_objects = len(image_items)
    total_bytes = sum(int(item.get("size") or 0) for item in image_items)
    pending_items = [item for item in image_items if normalize_text(item.get("key")) not in completed_keys]
    pending_total_bytes = sum(int(item.get("size") or 0) for item in pending_items)

    concurrency = max(1, min(16, int(args.concurrency or DEFAULT_CONCURRENCY)))

    log_line(
        f"Basladi: {format_number(total_objects)} obje, {format_size(total_bytes)} | "
        f"pending {format_number(len(pending_items))} | mod true-webp-in-place | "
        f"{'apply' if args.apply else 'plan'} | paralel {format_number(concurrency)}"
    )

    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "mode": "apply" if args.apply else "plan",
        "prefix": normalize_text(args.prefix),
        "totalObjectsListed": total_objects,
        "totalBytesListed": total_bytes,
        "pendingObjects": len(pending_items),
        "completedFromState": len(image_items) - len(pending_items),
        "convertedCount": 0,
        "fallbackOptimizedCount": 0,
        "keptOriginalCount": 0,
        "alreadyWebpCount": 0,
        "errorCount": 0,
        "processedBytes": 0,
        "savedBytesEstimate": 0,
        "items": [],
    }

    if not args.apply:
        log_line("Asama 3/3: Plan raporu yaziliyor...")
        report["items"] = [
            {
                "key": item.get("key"),
                "size": item.get("size"),
                "publicUrl": item.get("publicUrl"),
            }
            for item in pending_items[:200]
        ]
        REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        log_line(f"Plan raporu: {REPORT_PATH}")
        return 0

    log_line("Asama 3/3: Objeler gercek WEBP olarak optimize ediliyor...")
    processed_objects = 0
    processed_bytes = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        future_map = {
            executor.submit(
                process_object,
                item,
                worker_url,
                worker_token,
                args.quality,
                args.reencode_webp,
            ): item
            for item in pending_items
        }

        for future in concurrent.futures.as_completed(future_map):
            result = future.result()
            processed_objects += 1
            processed_bytes += int(result.get("objectSize") or 0)
            report["processedBytes"] = processed_bytes

            progress_bar = render_progress_bar(processed_objects, max(1, len(pending_items)))
            progress_prefix = (
                f"{progress_bar} | {format_number(processed_objects)}/{format_number(len(pending_items))} obje | "
                f"{format_size(processed_bytes)}/{format_size(pending_total_bytes)}"
            )

            if result["status"] == "skip":
                append_completed_key(result["key"])
                completed_keys.add(result["key"])
                report["alreadyWebpCount"] += 1
                log_line(f"{progress_prefix} | skip | {truncate_text(result['key'], 84)}")
                continue

            if result["status"] == "converted":
                append_completed_key(result["key"])
                completed_keys.add(result["key"])
                report["convertedCount"] += 1
                report["savedBytesEstimate"] += int(result.get("savedBytes") or 0)
                log_line(
                    f"{progress_prefix} | webp | {truncate_text(result['key'], 72)} | "
                    f"{result.get('sourceFormat', 'UNKNOWN')} {format_size(int(result.get('sourceBytes') or 0))} -> "
                    f"WEBP {format_size(int(result.get('outputBytes') or 0))}"
                )
                continue

            if result["status"] == "fallback":
                append_completed_key(result["key"])
                completed_keys.add(result["key"])
                report["fallbackOptimizedCount"] += 1
                report["savedBytesEstimate"] += int(result.get("savedBytes") or 0)
                log_line(
                    f"{progress_prefix} | fallback-{normalize_text(result.get('targetFormat')).lower()} | "
                    f"{truncate_text(result['key'], 68)} | "
                    f"{result.get('sourceFormat', 'UNKNOWN')} {format_size(int(result.get('sourceBytes') or 0))} -> "
                    f"{result.get('targetFormat', 'UNKNOWN')} {format_size(int(result.get('outputBytes') or 0))} | "
                    f"{truncate_text(result.get('reason') or '', 56)}"
                )
                continue

            if result["status"] == "kept":
                append_completed_key(result["key"])
                completed_keys.add(result["key"])
                report["keptOriginalCount"] += 1
                log_line(
                    f"{progress_prefix} | orijinal-kaldi | {truncate_text(result['key'], 72)} | "
                    f"{truncate_text(result.get('reason') or '', 80)}"
                )
                continue

            report["errorCount"] += 1
            error_record = {
                "key": result["key"],
                "publicUrl": result.get("publicUrl"),
                "error": result.get("error"),
            }
            append_error_record(error_record)
            log_line(
                f"{progress_prefix} | hata | {truncate_text(result['key'], 84)} | "
                f"{truncate_text(str(result.get('error') or 'Bilinmeyen hata'), 120)}"
            )

    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log_line("")
    log_line(
        f"Tamamlandi: {format_number(report['convertedCount'])} webp, "
        f"{format_number(report['fallbackOptimizedCount'])} fallback optimize, "
        f"{format_number(report['keptOriginalCount'])} orijinal kaldi, "
        f"{format_number(report['alreadyWebpCount'])} zaten webp, "
        f"{format_number(report['errorCount'])} hata."
    )
    log_line(f"Tahmini kazanilan alan: {format_size(report['savedBytesEstimate'])}")
    log_line(f"Rapor: {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
