# Cloudflare Offline Image Proxy

This Worker accepts two request shapes:

- `POST /` with `{ "url": "https://target-host/path/to/image.webp" }`
- `POST /` with `text/plain` body containing the full image URL
- optional `Authorization: Bearer <token>` for non-browser/manual calls

It is meant to replace the Supabase `offline-image-proxy` function for offline chapter downloads.

## What it solves

- moves offline image traffic off Supabase egress
- keeps the frontend download flow unchanged
- lets you limit which source hosts and frontend origins are allowed
- avoids CORS preflight for browser downloads by using a simple `text/plain` POST

## What it does not solve

- it is not a rotating proxy service
- blocked hosts may still return `403`
- it cannot bypass upstream anti-bot policies by itself

## Quick setup

1. Install Wrangler:

```bash
npm install -g wrangler
```

2. Log in:

```bash
wrangler login
```

3. Open this folder and copy the example config:

```bash
cd cloudflare/offline-image-proxy
copy wrangler.toml.example wrangler.toml
```

4. Set a token:

```bash
wrangler secret put PROXY_TOKEN
```

The browser app does not need to know this token. It is only used for manual requests that do not come from an allowed frontend origin.

5. Deploy:

```bash
wrangler deploy
```

6. Add this frontend env var to your app deployment:

```env
VITE_OFFLINE_IMAGE_PROXY_URL=https://your-worker-name.your-subdomain.workers.dev
```

If you use Vercel, add the same var in the Vercel project settings and redeploy.

## Manual test

```bash
curl -X POST "https://your-worker-name.your-subdomain.workers.dev" ^
  -H "Authorization: Bearer your-proxy-token" ^
  -H "Content-Type: text/plain" ^
  --data "https://hayalistic.net/wp-content/uploads/2026/01/content.webp"
```

If the Worker is allowed to fetch the target and the target does not block Cloudflare IPs, you should get the image response back.
