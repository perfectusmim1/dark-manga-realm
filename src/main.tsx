import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerSW } from "virtual:pwa-register";
import { isNativeApp } from "@/lib/appRuntime";

const registerServiceWorkerWhenIdle = () => {
  const run = () => {
    registerSW();
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 2000 });
    return;
  }

  window.setTimeout(run, 1200);
};

if (typeof window !== "undefined" && !isNativeApp()) {
  if (document.readyState === "complete") {
    registerServiceWorkerWhenIdle();
  } else {
    window.addEventListener("load", registerServiceWorkerWhenIdle, { once: true });
  }
}

createRoot(document.getElementById("root")!).render(<App />);
