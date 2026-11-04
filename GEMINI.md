# ToonParrot - Proje ve Ajan Kuralları

Bu dosya ToonParrot projesinde görev alan tüm AI ajanları (Main Agent) ve alt ajanlar (Subagents) için bağlayıcı ve zorunlu kuralları içerir. Bu kararlar sabittir ve keyfi olarak değiştirilemez.

---

## 1. Görsel Çeviri & OCR Mimarisi (KATI VE DEĞİŞTİRİLEMEZ)

- **Çeviri Modelleri Sabittir:**
  - **Gemini Çeviri Motoru:** Model adı her zaman ve kesinlikle **`gemini-flash-latest`** olarak kalacaktır. Model ismi başka bir versiyona, modele veya deneysel ada ASLA değiştirilemez.
  - **Google Çeviri Motoru:** Google Translate (`translateBatchWithGoogleFree` / proxy) her zaman aktif varsayılan alternatif olarak kalacaktır. 100% ücretsizdir ve API anahtarı gerektirmez.

- **OCR ve Balon Tespiti Kuralı - Gemini Vision ve Google Vision KESİNLİKLE YASAKTIR:**
  - Sayfa/bölüm görselleri OCR, metin tespiti veya konuşma balonu tespiti için **ASLA Gemini Vision, Google Cloud Vision ya da herhangi bir uzak multimodal/Vision LLM API'sine gönderilemez**.
  - Vision modelleri aşırı pahalı, aşırı yavaş ve kota tüketici olduğu için bu projede kullanımı KESİNLİKLE YASAKTIR.
  - OCR işlemi **HER ZAMAN istemci tarafında (tarayıcıda) yerel çalışan, hızlı, hafif ve uzun webtoon şeritlerine uyumlu bir yerel OCR motoruyla (Tesseract WASM / `fastOcr.ts`)** yürütülecektir. Varlıklar `public/tesseract/` altında yerel olarak barındırılır.
  - Gemini Flash (`gemini-flash-latest`) yalnızca ve yalnızca yerel OCR'ın çıkardığı saf metinlerin çevirisinde (metin -> metin) kullanılır. Modele asla görsel pikselleri (base64 vb.) beslenemez.
  - Ajanlar kafalarına göre Vision modellerine geri dönemez, model adını değiştiremez veya OCR mimarisini bozamaz.

---

## 2. Geliştirme Sunucusu (Dev Server) & Git Disiplini

- **Durduk Yere Dev Server Başlatmama:** Kullanıcı açıkça istemedikçe kendi kendine `npm run dev` başlatılmaz.
- **Tip Kontrolü:** Kod yazımı veya düzenleme sonrası her zaman `npx tsc --noEmit` ile kontrol edilir.
- **Git Commit & Push:** Görev tamamlandıktan sonra yapılan değişiklikler anlamlı bir commit mesajıyla commit'lenip GitHub `main` dalına push edilir.
- **Temiz Çalışma Alanı:** Geçici test scriptleri, kontrol listeleri veya dump dosyaları iş bittiğinde hemen silinir.
