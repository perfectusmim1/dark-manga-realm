# Görsel Çeviri Özelliği — Tasarım Dokümanı

Tarih: 2026-07-26
Durum: Onaylandı (Faz 1 için)

## Amaç

Okuyucudaki (Reader) manga/webtoon sayfalarındaki Türkçe konuşma balonlarını,
kullanıcının seçtiği hedef dile çevirip sayfanın üzerine overlay olarak basmak.
Kaynak içerik ağırlıklı Türkçe; hedef kitle yabancı okuyucular (varsayılan hedef dil: İngilizce).

## Fazlı Yaklaşım

- **Faz 1 (bu spec'in kapsamı):** Tek model — Gemini `gemini-3.5-flash-lite`
  (thinking: minimal) görseli doğrudan alır; balon tespiti (bounding box),
  okuma (OCR) ve çeviriyi tek çağrıda yapar.
- **Faz 2 (koşullu, kapsam dışı):** Gemini'nin koordinatları gerçek sayfalarda
  yetersiz kalırsa, hassas koordinat için ayrı bir OCR katmanı eklenir
  (aday: PaddleOCR — Türkçe destekli Latin modeli; tarayıcıda onnxruntime-web
  ile veya sunucuda). O durumda AI modeline yalnızca metin gider (görsel değil),
  görsel rate limit yükü ortadan kalkar. `blocks` veri formatı iki fazda da
  aynıdır; yalnızca koordinat üreticisi değişir.

## Kararlar (kullanıcı onaylı)

| Konu | Karar |
|---|---|
| Gösterim | Balon üzerine overlay (orijinal görsel bozulmaz, aç/kapa) |
| Önbellek | Supabase'de ortak önbellek; "Yeniden Çevir" üzerine yazar |
| API anahtarı | Kullanıcı kendi Gemini anahtarını girer; localStorage'da saklanır; istekler doğrudan tarayıcıdan Google'a gider |
| Hedef dil | ~80 dillik aranabilir liste; varsayılan İngilizce |
| Auto-translate | Açıkken sıralı arka plan kuyruğu (eşzamanlılık 2, aktif sayfa öncelikli) |
| Kapalıyken | Her sayfanın sağ üstünde tekil "Çevir" butonu |
| Arayüz dili | Türkçe (sitenin geri kalanıyla tutarlı) |

## Veri Akışı (Faz 1)

```
sayfa görseli (URL) → fetch → base64
  → Gemini generateContent (responseSchema: JSON, thinkingLevel: MINIMAL)
  → [{ box_2d: [ymin, xmin, ymax, xmax] (0-1000 normalize), text: "çeviri" }]
  → doğrulama → Supabase upsert → overlay render
```

### Doğrulama (halüsinasyon koruması)

Şu durumlarda sonuç önbelleğe YAZILMAZ ve kullanıcıya "Çeviri başarısız — tekrar dene" gösterilir:

- JSON parse edilemiyor veya şemaya uymuyor
- Koordinatlar 0-1000 aralığı dışında
- Blok listesi boş

Kötü ama şemaya uyan çeviriler için çözüm: "Yeniden Çevir" (önbelleği atlar, sonucu üzerine yazar).

## Supabase Şeması

Yeni migration (supabase CLI ile):

```sql
create table public.page_translations (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  page_index integer not null,
  lang text not null,               -- BCP-47 kodu, örn. 'en', 'de'
  blocks jsonb not null,            -- [{ box: [ymin,xmin,ymax,xmax], text }]
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chapter_id, page_index, lang)
);
```

RLS: `select` herkese açık; `insert`/`update` yalnızca giriş yapmış kullanıcılara.
"Yeniden Çevir" = aynı tekil anahtara upsert.

Not: `chapters` tablosunun gerçek adı/anahtar tipi implementasyon sırasında
mevcut migration'lardan doğrulanacak.

## Yeni Dosyalar

| Dosya | Sorumluluk |
|---|---|
| `src/lib/translation/geminiTranslator.ts` | Gemini çağrısı (`@google/genai`), prompt + responseSchema, yanıt doğrulama, 429 backoff |
| `src/lib/translation/translationCache.ts` | Supabase oku / upsert |
| `src/lib/translation/languages.ts` | ~80 dillik `{ code, name }` listesi; varsayılan `en` |
| `src/lib/translation/translationSettings.ts` | localStorage: apiKey, targetLang, autoTranslate, overlayVisible |
| `src/hooks/useChapterTranslation.ts` | Bölüm bazlı çeviri durumu; sıralı kuyruk (eşzamanlılık 2, aktif sayfa öncelikli); sayfa başına durum: idle / queued / translating / done / error |
| `src/components/reader/TranslationOverlay.tsx` | Görsel kapsayıcısına absolute, %-konumlu beyaz yarı-saydam kutular + çeviri metni; kutu içinde otomatik font sığdırma; hafif padding ile koordinat kaymalarını tolere eder |
| `src/components/reader/TranslationPanel.tsx` | Çeviri ayar paneli: API key girişi, aranabilir dil seçici, auto-translate switch, çeviriyi göster/gizle |

## Değişecek Mevcut Dosyalar

- `ReaderControls.tsx`: Sağ üstte Settings butonunun yanına `Languages` ikonlu
  buton → TranslationPanel (Popover/Drawer, mevcut ayarlar paternine uygun).
- `VerticalReader.tsx` / `HorizontalReader.tsx`: `ReaderPage` kapsayıcısına
  `TranslationOverlay` + (auto kapalıyken) sağ üst köşede sayfa başına "Çevir"
  butonu; çevrilmiş sayfada "Gizle/Göster + Yeniden Çevir".
- `Reader.tsx`: `useChapterTranslation` hook'unun bağlanması, prop akışı.

## Hata Yönetimi

- **API key yok:** Çevir butonları paneli açar, "Önce API anahtarı girin" uyarısı.
- **429 / kota:** Kuyruk duraklar, artan bekleme (exponential backoff) ile en
  fazla 2 tekrar; kalıcı hata sayfada hata rozeti olarak görünür, tıklayınca yeniden dener.
- **Geçersiz yanıt:** Önbelleğe yazılmaz (bkz. Doğrulama).
- **Offline:** Çeviri butonları devre dışı (yalnızca önbellekte varsa gösterilir).

## Test Planı (manuel)

1. API key gir → tek sayfa çevir → overlay konumları makul mü? (Faz 2 kararı burada verilir)
2. Sayfayı yenile → önbellekten anında gelmeli (Gemini çağrısı olmamalı).
3. "Yeniden Çevir" → yeni sonuç eskisinin üzerine yazılmalı.
4. Auto-translate aç → bölüm sayfaları sırayla çevrilmeli, aktif sayfa öncelikli.
5. Yanlış API key → anlaşılır hata; önbelleğe hiçbir şey yazılmamalı.
6. Zoom değiştir → overlay görselle birlikte ölçeklenmeli (%-tabanlı konum).
7. Dil değiştir → aynı sayfa yeni dil için ayrı önbellek kaydı oluşturmalı.

## Bağımlılıklar

- Yeni: `@google/genai`
- Mevcut: Supabase istemcisi, shadcn/ui bileşenleri (Popover, Drawer, Switch, Command)

## Kapsam Dışı

- Inpainting (yazıyı görselden silme)
- Faz 2 OCR entegrasyonu (ancak Faz 1 testi başarısız olursa ayrı spec ile)
- Admin moderasyon paneli (gerekirse sonra: sayfa önbelleği temizleme butonu)
