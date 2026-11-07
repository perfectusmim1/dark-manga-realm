import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/mangaupdates-proxy": {
        target: "https://www.mangaupdates.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/mangaupdates-proxy/, ""),
      },
      "/comix-api-proxy": {
        target: "https://comix.to",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/comix-api-proxy/, "/api/v1"),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.ico", "logo.webp", "logo-192.png", "logo-512.png", "robots.txt"],
      manifest: {
        name: "ToonParrot",
        short_name: "ToonParrot",
        description: "ToonParrot - Binlerce manga ve manhwa'yı çevrimdışı da oku.",
        theme_color: "#0a0a0b",
        background_color: "#0a0a0b",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/logo-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/logo-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ["**/*.{js,css,html,ico,png,webp,svg,woff2}"],
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        runtimeCaching: [
          // 0. Yerel OCR modelleri ve WASM çalışma zamanı (büyük, değişmeyen dosyalar):
          //    ilk indirmeden sonra her çeviride ağa gitmeden önbellekten yüklenir.
          {
            urlPattern: ({ url, sameOrigin }: any) =>
              sameOrigin && /^\/(?:ocr|ort)\//.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "toonparrot-ocr-models-v1",
              cacheableResponse: {
                statuses: [200],
              },
              expiration: {
                maxEntries: 12,
                maxAgeSeconds: 60 * 60 * 24 * 90,
              },
            },
          },
          // 1. Yalnızca gerçek görseller: R2 medyası, harici CDN görselleri ve
          //    <img> (destination=image) üzerinden gelen proxied görseller.
          //    ÖNEMLİ: Supabase REST/auth yanıtları ve worker JSON API'leri ASLA
          //    cache'lenmez (eski kural tüm supabase.co/workers.dev isteklerini
          //    30 gün cache'liyordu; bayat veri/hata tekrarına yol açıyordu).
          {
            urlPattern: ({ request, url }: any) => {
              if (request.destination === "image") {
                return true;
              }
              const pathname = url.pathname.toLowerCase();
              return (
                /\.(?:png|jpe?g|webp|avif|svg|gif)$/i.test(pathname) ||
                url.hostname.includes("r2.dev")
              );
            },
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "toonparrot-media-v2",
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 3000,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 gün kalıcı önbellek
                purgeOnQuotaError: true,
              },
            },
          },
          // 2. Google Fonts & Web Fontları
          {
            urlPattern: ({ url }: any) => {
              return (
                url.origin === "https://fonts.googleapis.com" ||
                url.origin === "https://fonts.gstatic.com"
              );
            },
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 yıl
              },
            },
          },
        ],
      },
    }),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");

          if (!normalizedId.includes("node_modules")) {
            return;
          }

          if (normalizedId.includes("@supabase")) {
            return "supabase";
          }

          if (normalizedId.includes("framer-motion")) {
            return "motion";
          }

          if (normalizedId.includes("@tanstack/react-query")) {
            return "query";
          }

          if (normalizedId.includes("react-router") || normalizedId.includes("@remix-run/router")) {
            return "router";
          }

          if (normalizedId.includes("@radix-ui") || normalizedId.includes("vaul") || normalizedId.includes("cmdk")) {
            return "radix";
          }

          if (
            normalizedId.includes("react-hook-form")
            || normalizedId.includes("@hookform/resolvers")
            || normalizedId.includes("zod")
            || normalizedId.includes("input-otp")
          ) {
            return "forms";
          }

          if (normalizedId.includes("lucide-react")) {
            return "icons";
          }

          if (normalizedId.includes("recharts")) {
            return "charts";
          }

          if (normalizedId.includes("react-day-picker") || normalizedId.includes("date-fns")) {
            return "calendar";
          }

          if (normalizedId.includes("@google/genai")) {
            return "gemini-sdk";
          }

          if (normalizedId.includes("onnxruntime-web")) {
            return "onnx-runtime";
          }

          if (normalizedId.includes("@capacitor")) {
            return "capacitor";
          }

          if (normalizedId.includes("idb")) {
            return "offline-storage";
          }

          return "vendor";
        },
      },
    },
  },
}));
