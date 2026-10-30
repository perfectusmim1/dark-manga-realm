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
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
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
          {
            urlPattern: ({ request, url }: any) => {
              // @ts-ignore: self is available in Service Worker scope
              return request.destination === "image" && url.origin === self.location.origin;
            },
            handler: "CacheFirst",
            options: {
              cacheName: "toonparrot-image-cache",
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 400,
                maxAgeSeconds: 60 * 60 * 24 * 30,
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

          if (normalizedId.includes("idb")) {
            return "offline-storage";
          }

          return "vendor";
        },
      },
    },
  },
}));
