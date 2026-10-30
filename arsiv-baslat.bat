@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ToonParrot - Otomatik Manga Arsivleyici ve Senkronizasyon
color 0B

echo ======================================================================
echo       TOONPARROT - ARSIVLEME VE SENKRONIZASYON MOTORU
echo ======================================================================
echo.

node scripts/archive-status.mjs

echo.
echo ======================================================================
echo  [1] Kaldigi Yerden Devam Et (Onerilen)
echo  [2] Sifirdan Baslat (Kuyrugu Yenile)
echo  [3] Sadece Durumu Goruntule ve Cik
echo ======================================================================
echo.
set "SECIM=1"
set /p "SECIM=Seciminiz (1/2/3, Varsayilan: 1): "

if "%SECIM%"=="3" (
    echo.
    echo Cikiliyor...
    timeout /t 2 >nul
    exit /b 0
)

if "%SECIM%"=="2" (
    echo.
    echo [!] Kuyruk sifirlaniyor ve tum kataloglar taranarak baslatiliyor...
    node scripts/build-full-r2-archive.mjs --full
) else (
    echo.
    echo [*] Kaldigi yerden arsivlemeye devam ediliyor...
    node scripts/build-full-r2-archive.mjs --full --resume
)

echo.
echo ======================================================================
echo  Islem tamamlandi veya gunluk Cloudflare Worker kotasina ulasildi.
echo  Kota dolduysa yarin bu dosyayi tekrar acmaniz yeterlidir.
echo ======================================================================
pause
