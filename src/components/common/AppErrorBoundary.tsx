import React from 'react';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

const RENDER_RECOVERY_SESSION_KEY = 'toonparrot-render-recovery-at';
const CHUNK_OR_STALE_BUNDLE_PATTERN = /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|Cannot read properties of null/i;

class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('App render boundary caught error:', error, errorInfo);

    if (typeof window === 'undefined' || !navigator.onLine) {
      return;
    }

    const message = String(error?.message || '');
    if (!CHUNK_OR_STALE_BUNDLE_PATTERN.test(message)) {
      return;
    }

    try {
      const lastRecoveryAt = Number(window.sessionStorage.getItem(RENDER_RECOVERY_SESSION_KEY) || 0);
      if (Date.now() - lastRecoveryAt < 15_000) {
        return;
      }
      window.sessionStorage.setItem(RENDER_RECOVERY_SESSION_KEY, String(Date.now()));
    } catch {
      return;
    }

    void this.refreshServiceWorkerAndReload();
  }

  private async refreshServiceWorkerAndReload(): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.update().catch(() => undefined);
      }
    } catch {
      // ignore SW update errors
    }

    window.location.reload();
  }

  private handleManualReload = (): void => {
    void this.refreshServiceWorkerAndReload();
  };

  private handleGoHome = (): void => {
    if (typeof window !== 'undefined') {
      window.location.assign('/');
    }
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0b] px-4 text-zinc-100">
        <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950/90 p-6 text-center shadow-2xl">
          <h1 className="text-xl font-bold tracking-tight">Bir şeyler ters gitti</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Sayfa yüklenirken beklenmedik bir hata oluştu. Yeniden deneyebilir veya ana sayfaya dönebilirsiniz.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={this.handleManualReload}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Sayfayı Yenile
            </button>
            <button
              type="button"
              onClick={this.handleGoHome}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 px-5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              Ana Sayfaya Dön
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
