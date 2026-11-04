# ToonParrot - Proje ve Ajan Kuralları

Bu dosya ToonParrot projesinde görev alan tüm AI ajanları (Main Agent) ve alt ajanlar (Subagents) için bağlayıcı ve zorunlu kuralları içerir. Bu kararlar sabittir ve keyfi olarak değiştirilemez.

---

## 1. Görsel Çeviri & OCR Mimarisi (KATI VE DEĞİŞTİRİLEMEZ)

- **Çeviri Modelleri Sabittir:**
  - **Gemini Çeviri Motoru:** Model adı her zaman ve kesinlikle **`gemini-flash-lite-latest`** (Gemini 3.5 Flash-Lite) olarak kalacak ve en yüksek hız için **`ThinkingLevel.MINIMAL`** modunda çalışacaktır.
  - **Google Çeviri Motoru:** Google Translate (`translateBatchWithGoogleFree` / proxy) her zaman aktif varsayılan alternatif olarak kalacaktır. 100% ücretsizdir ve API anahtarı gerektirmez.

- **OCR ve Balon Tespiti Kuralı - Gemini Vision ve Google Vision KESİNLİKLE YASAKTIR:**
  - Sayfa/bölüm görselleri OCR, metin tespiti veya konuşma balonu tespiti için **ASLA Gemini Vision, Google Cloud Vision ya da herhangi bir uzak multimodal/Vision LLM API'sine gönderilemez**.
  - Vision modelleri aşırı pahalı, aşırı yavaş ve kota tüketici olduğu için bu projede kullanımı KESİNLİKLE YASAKTIR.
  - OCR işlemi **HER ZAMAN istemci tarafında (tarayıcıda) yerel çalışan, hızlı, hafif ve uzun webtoon şeritlerine uyumlu yerel bir derin öğrenme OCR motoruyla (PaddleOCR PP-OCRv3 ONNX / `fastOcr.ts` + `ocrWorker.ts`)** yürütülecektir. Varlıklar `public/ocr/` ve `public/ort/` altında yerel olarak barındırılır. Tesseract WASM yalnızca acil durum yedeği olarak tutulur.
  - Gemini Flash-Lite (`gemini-flash-lite-latest`) yalnızca ve yalnızca yerel OCR'ın çıkardığı saf metinlerin çevirisinde (metin -> metin) kullanılır. Modele asla görsel pikselleri (base64 vb.) beslenemez.

---

## 2. Geliştirme Sunucusu (Dev Server) & Git Disiplini

- **Durduk Yere Dev Server Başlatmama:** Kullanıcı açıkça istemedikçe kendi kendine `npm run dev` başlatılmaz.
- **Tip Kontrolü:** Kod yazımı veya düzenleme sonrası her zaman `npx tsc --noEmit` ile kontrol edilir.
- **Git Commit & Push:** Görev tamamlandıktan sonra yapılan değişiklikler anlamlı bir commit mesajıyla commit'lenip GitHub `main` dalına push edilir.
- **Temiz Çalışma Alanı:** Geçici test scriptleri, kontrol listeleri veya dump dosyaları iş bittiğinde hemen silinir.
