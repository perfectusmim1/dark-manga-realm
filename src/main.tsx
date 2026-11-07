import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerSW } from "virtual:pwa-register";
import { isNativeApp } from "@/lib/appRuntime";

// Third-party browser extension error suppressor (e.g. 200.js sniffer/downloader M_ID errors)
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    const filename = String(event.filename || "");
    const message = String(event.message || "");
    if (
      filename.includes("200.js") ||
      filename.includes("chrome-extension://") ||
      message.includes("M_ID")
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    const msg = String(event.reason?.message || event.reason || "");
    const stack = String(event.reason?.stack || "");
    if (
      msg.includes("M_ID") ||
      stack.includes("200.js") ||
      stack.includes("chrome-extension://")
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  });

  // Yeni deploy sonrası eski lazy chunk'lar 404 verirse (PWA cache'li kullanıcılarda
  // sayfa/bölüm açılamaması olarak görünür) bir kez sayfayı yenile.
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    const recoveryKey = "toonparrot-preload-recovery-at";
    try {
      const lastRecoveryAt = Number(window.sessionStorage.getItem(recoveryKey) || 0);
      if (Date.now() - lastRecoveryAt < 15_000) {
        return;
      }
      window.sessionStorage.setItem(recoveryKey, String(Date.now()));
    } catch {
      // sessionStorage yoksa yine de devam et
    }
    window.location.reload();
  });
}


const registerServiceWorkerWhenIdle = () => {
  const run = () => {
    registerSW({
      immediate: false,
      onNeedRefresh() {
        // Aktif okuma oturumunu veya sekmeyi kendi kendine asla yenileme
      },
    });
  };

  if ("requestIdleCallback" in globalThis) {
    globalThis.requestIdleCallback(run, { timeout: 2000 });
    return;
  }

  globalThis.setTimeout(run, 1200);
};

if (typeof window !== "undefined" && !isNativeApp()) {
  if (document.readyState === "complete") {
    registerServiceWorkerWhenIdle();
  } else {
    window.addEventListener("load", registerServiceWorkerWhenIdle, { once: true });
  }
}

createRoot(document.getElementById("root")!).render(<App />);
