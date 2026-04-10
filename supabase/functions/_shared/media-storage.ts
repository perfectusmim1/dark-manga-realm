import { createServiceClient } from "./auth.ts";

const MEDIA_INGEST_URL_SECRET_KEY = "media_ingest_url";
const MEDIA_INGEST_TOKEN_SECRET_KEY = "media_ingest_token";
const MEDIA_BUCKET_URL_SECRET_KEY = "media_bucket_url";
const MEDIA_HOST_PATTERNS = [".r2.dev", "toonparrot-media"];
const MATERIALIZE_WORKER_BATCH_SIZE = 40;
const CHAPTER_PAGE_WEBP_QUALITY = 90;

interface ChapterPageMaterializeItem {
  id: string;
  sourceUrl: string;
  objectKey: string;
  entityType: "chapter";
  entityId: string;
  variant: "page";
  transform: {
    quality: number;
    format: "webp";
  };
}

interface ChapterPageMaterializeWorkerResponseItem {
  id: string;
  status: "stored" | "exists" | "error" | "blocked" | "invalid";
  publicUrl?: string;
  error?: string;
}

const normalizeText = (value?: string | null) => value?.trim() || "";

const toSafeEntityId = (value: string) => normalizeText(value).replace(/[^a-zA-Z0-9_-]/g, "-");

const toPageObjectSegment = (pageIndex: number) => `${Math.max(0, Math.trunc(pageIndex)) + 1}`.padStart(3, "0");

const buildMaterializedChapterPageObjectKey = (
  mangaId: string,
  chapterId: string,
  pageIndex: number,
) => `manga/${toSafeEntityId(mangaId)}/chapters/${toSafeEntityId(chapterId)}/${toPageObjectSegment(pageIndex)}.webp`;

const unwrapProxyUrl = (sourceUrl?: string | null) => {
  const normalized = normalizeText(sourceUrl);
  if (!normalized) {
    return "";
  }

  try {
    const parsed = new URL(normalized);
    return normalizeText(parsed.searchParams.get("url")) || normalized;
  } catch {
    return normalized;
  }
};

const isStoredMediaUrl = (sourceUrl?: string | null, publicBucketUrl?: string | null) => {
  const normalized = normalizeText(sourceUrl);
  if (!normalized) {
    return false;
  }

  const normalizedPublicBucketUrl = normalizeText(publicBucketUrl);
  if (normalizedPublicBucketUrl && normalized.startsWith(normalizedPublicBucketUrl)) {
    return true;
  }

  try {
    const parsed = new URL(normalized);
    return MEDIA_HOST_PATTERNS.some((pattern) => parsed.hostname.includes(pattern));
  } catch {
    return false;
  }
};

const loadMediaWorkerSecrets = async (
  serviceClient: ReturnType<typeof createServiceClient>,
) => {
  const { data, error } = await serviceClient
    .from("internal_worker_secrets")
    .select("key, value")
    .in("key", [MEDIA_INGEST_URL_SECRET_KEY, MEDIA_INGEST_TOKEN_SECRET_KEY, MEDIA_BUCKET_URL_SECRET_KEY]);

  if (error) {
    throw error;
  }

  const values = new Map<string, string>();
  for (const row of data || []) {
    values.set(normalizeText(row.key), normalizeText(row.value));
  }

  return {
    url: values.get(MEDIA_INGEST_URL_SECRET_KEY) || "",
    token: values.get(MEDIA_INGEST_TOKEN_SECRET_KEY) || "",
    publicBucketUrl: values.get(MEDIA_BUCKET_URL_SECRET_KEY) || "",
  };
};

const materializeWorkerItems = async (
  workerUrl: string,
  workerToken: string,
  items: ChapterPageMaterializeItem[],
) => {
  const results = new Map<string, string>();

  for (let index = 0; index < items.length; index += MATERIALIZE_WORKER_BATCH_SIZE) {
    const batch = items.slice(index, index + MATERIALIZE_WORKER_BATCH_SIZE);
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({ items: batch }),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      throw new Error(responseText || `Media ingest worker failed (${response.status})`);
    }

    const data = await response.json().catch(() => null) as { items?: ChapterPageMaterializeWorkerResponseItem[] } | null;
    for (const item of data?.items || []) {
      if ((item.status === "stored" || item.status === "exists") && item.publicUrl) {
        results.set(item.id, item.publicUrl);
      } else if (item.status === "error" || item.status === "blocked" || item.status === "invalid") {
        console.warn("Chapter page materialize skipped", {
          itemId: item.id,
          status: item.status,
          error: item.error || null,
        });
      }
    }
  }

  return results;
};

export const materializeAutomationChapterPages = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  mangaId: string,
  chapters: Array<{ id: string; pages: string[] }>,
) => {
  if (!mangaId || chapters.length === 0) {
    return chapters;
  }

  const { url, token, publicBucketUrl } = await loadMediaWorkerSecrets(serviceClient);
  if (!url || !token) {
    throw new Error("Media ingest worker ayarlari eksik");
  }

  const items = chapters.flatMap((chapter) => (
    chapter.pages.flatMap((pageUrl, pageIndex) => {
      const sourceUrl = unwrapProxyUrl(pageUrl);
      if (!sourceUrl || isStoredMediaUrl(sourceUrl, publicBucketUrl)) {
        return [];
      }

      return [{
        id: `${chapter.id}:${pageIndex}`,
        sourceUrl,
        objectKey: buildMaterializedChapterPageObjectKey(mangaId, chapter.id, pageIndex),
        entityType: "chapter" as const,
        entityId: chapter.id,
        variant: "page" as const,
        transform: {
          quality: CHAPTER_PAGE_WEBP_QUALITY,
          format: "webp" as const,
        },
      }];
    })
  ));

  if (items.length === 0) {
    return chapters.map((chapter) => ({
      ...chapter,
      pages: chapter.pages.map((pageUrl) => {
        const normalizedPageUrl = unwrapProxyUrl(pageUrl);
        return isStoredMediaUrl(normalizedPageUrl, publicBucketUrl) ? normalizedPageUrl : pageUrl;
      }),
    }));
  }

  const materializedUrlByItemId = await materializeWorkerItems(url, token, items);

  return chapters.map((chapter) => ({
    ...chapter,
    pages: chapter.pages.map((pageUrl, pageIndex) => {
      const itemId = `${chapter.id}:${pageIndex}`;
      const normalizedPageUrl = unwrapProxyUrl(pageUrl);
      return materializedUrlByItemId.get(itemId)
        || (isStoredMediaUrl(normalizedPageUrl, publicBucketUrl) ? normalizedPageUrl : pageUrl);
    }),
  }));
};
