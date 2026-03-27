# ToonParrot Scraper Proxy

Bu Worker, admin scraper ekranlarinin Hayalistic ve benzeri kaynaklardan HTML cekebilmesi icin kullanilir.

## Desteklenen istekler

- `POST /` with `text/plain`
  Body: hedef URL
- `POST /` with `application/json`
  Body: `{ "url": "https://..." }`
- `GET /?url=https://...`
- `GET /`
  Saglik kontrolu icin JSON bilgi cevabi doner

## CORS

Worker sadece `ALLOWED_ORIGINS` icindeki origin'lere `Access-Control-Allow-Origin` verir.

Varsayilanlar:

- `https://toonparrot.vercel.app`
- `https://*.vercel.app`
- `http://localhost:*`
- `http://127.0.0.1:*`

## Deploy

`cloudflare/scraper-proxy` klasorunde:

```bash
wrangler deploy
```

Istersen ekstra koruma icin token da ekleyebilirsin:

```bash
wrangler secret put PROXY_TOKEN
```

## Frontend env

Deploy sonrasi Vercel veya local `.env` icine:

```env
VITE_SCRAPER_PROXY_URL=https://toonparrot-scraper-proxy.<subdomain>.workers.dev
```

Admin tarafinda `Cloudflare` seciliyse seri cekme ve bolum cekme bu Worker'i kullanir.
