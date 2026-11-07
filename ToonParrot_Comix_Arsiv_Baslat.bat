@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title ToonParrot - Comix.to Limitsiz Arşiv & AniList/MAL/Karakter Motoru
color 0B

cd /d "c:\Users\Cagan\Desktop\Home\Sitelerim\toonparrot"
if errorlevel 1 (
    color 0C
    echo [HATA] Proje klasoru bulunamadi: c:\Users\Cagan\Desktop\Home\Sitelerim\toonparrot
    pause
    exit /b 1
)

echo ===============================================================================
echo    TOONPARROT - COMIX.TO LİMİTSİZ ARŞİV ^& ANILIST / MAL / KARAKTER MOTORU
echo ===============================================================================
echo  Ozellikler:
echo   [*] Limitsiz Tam Arsiv Cekimi (--limit 0 --max-pages 0, Zaman Asimi Yok)
echo   [*] Cift Dilli Konu Kaydi: Hem Turkce (TR) hem Ingilizce (EN) Konu
echo   [*] Otomatik AniList + MyAnimeList (Jikan) Eşleşmesi ^& Karakterler
echo   [*] Kapak, Banner, Yazar, Cizer, +18 ve Tur (Manhwa/Manga/Manhua) Dogrulamasi
echo   [*] Tum Yabanci Diller (TR, EN, ES, PT-BR, RU, FR, ID, AR vb.) + En Iyi Grup
echo   [*] Sifir Duplicate (3 Katmanli Tekillestirme) ^& Sifir Sahte Goruntulenme
echo   [*] R2 Hibrit Depolama (Supabase 500MB Limitini Asla Doldurmaz)
echo   [*] Kesinti Korumasi (--resume ile kaldigi sayfadan otomatik devam eder)
echo ===============================================================================
echo.
echo  [1] TAM OTOMATIK LIMITSIZ MOD (Once Mevcut Serileri Esitle + Sonra Tum Arsivi Cek) [Varsayilan]
echo  [2] SADECE YENI COMIX ARSIVINI LIMITSIZ CEK (Kaldığı Yerden Devam Eder)
echo  [3] SADECE MEVCUT TURKCE SERILERIN YABANCI BOLUMLERINI ^& KARAKTERLERINI ESITLE
echo  [4] SIFIRDAN BASLAT (Onbellek Durumunu Temizle ve bastan cek)
echo.
choice /C 1234 /N /T 5 /D 1 /M "Seciminiz (1-4, 5 sn icinde otomatik [1] baslar): "
set "MODE=%ERRORLEVEL%"

if "%MODE%"=="4" (
    echo.
    echo [BILGI] Resume onbellek dosyalari sifirlaniyor...
    if exist ".cache\comix-r2-harvest-state.json" del /f /q ".cache\comix-r2-harvest-state.json"
    if exist ".cache\comix-foreign-sync-state.json" del /f /q ".cache\comix-foreign-sync-state.json"
    set "MODE=1"
)

if "%MODE%"=="1" goto :RUN_BOTH
if "%MODE%"=="2" goto :RUN_HARVEST_ONLY
if "%MODE%"=="3" goto :RUN_SYNC_ONLY
goto :RUN_BOTH

:RUN_BOTH
echo.
echo ===============================================================================
echo  [ADIM 1/2] Mevcut Turkce Serilerin Yabanci Bolum, Konu (TR+EN) ve Karakterleri Esitleniyor...
echo ===============================================================================
:RETRY_SYNC_BOTH
node scripts/sync-comix-foreign.mjs --limit 0 --concurrency 3 --resume
if errorlevel 1 (
    echo [UYARI] Ag veya baglanti kesintisi algilandi, 5 saniye icinde kaldigi yerden devam ediliyor...
    timeout /t 5 >nul
    goto :RETRY_SYNC_BOTH
)

:RUN_HARVEST_ONLY
echo.
echo ===============================================================================
echo  [ADIM 2/2] Comix.to 80K Arsivi Limitsiz Cekiliyor (R2 Hibrit + AniList/MAL + TR/EN Konu)...
echo ===============================================================================
:RETRY_HARVEST
node scripts/harvest-comix-80k.mjs --limit 0 --max-pages 0 --concurrency 3 --resume
if errorlevel 1 (
    echo [UYARI] Ag veya baglanti kesintisi algilandi, 5 saniye icinde kaldigi sayfadan devam ediliyor...
    timeout /t 5 >nul
    goto :RETRY_HARVEST
)
goto :FINISHED

:RUN_SYNC_ONLY
echo.
echo ===============================================================================
echo  Mevcut Turkce Serilerin Yabanci Bolum, Konu (TR+EN) ve Karakterleri Esitleniyor...
echo ===============================================================================
:RETRY_SYNC_SINGLE
node scripts/sync-comix-foreign.mjs --limit 0 --concurrency 3 --resume
if errorlevel 1 (
    echo [UYARI] Ag veya baglanti kesintisi algilandi, 5 saniye icinde kaldigi yerden devam ediliyor...
    timeout /t 5 >nul
    goto :RETRY_SYNC_SINGLE
)

:FINISHED
echo.
echo ===============================================================================
echo  [TAMAMLANDI] Tum islemler basariyla tamamlandi!
echo ===============================================================================
pause
