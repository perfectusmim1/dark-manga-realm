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
}

const registerServiceWorkerWhenIdle = () => {
  const run = () => {
    registerSW({
      immediate: true,
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
