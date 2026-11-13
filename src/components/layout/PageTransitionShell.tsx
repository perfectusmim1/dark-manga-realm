import { type ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import { shouldRenderHeaderBootstrap } from '@/components/layout/HeaderBootstrapShell';
import { prefetchPrimaryNavRoutes } from '@/lib/routeModules';

const ROUTE_PREFETCH_DELAY_MS = 1200;
const ROUTE_FALLBACK_DELAY_MS = 140;

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * Rota geçiş animasyonlarını ve açılış sonrası ana gezinme rotalarının boşta önyüklenmesini yönetir.
 */
const PageTransitionShell = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const { disableHeavyEffects, prefersReducedMotion } = useDeviceProfile();

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const idleWindow = window as IdleWindow;
    let idleCallbackId: number | null = null;
    let fallbackIdleTimerId: number | null = null;

    const delayTimerId = window.setTimeout(() => {
      if (typeof idleWindow.requestIdleCallback === 'function') {
        idleCallbackId = idleWindow.requestIdleCallback(
          () => {
            prefetchPrimaryNavRoutes();
          },
          { timeout: 1000 },
        );
        return;
      }

      fallbackIdleTimerId = window.setTimeout(() => {
        prefetchPrimaryNavRoutes();
      }, 250);
    }, ROUTE_PREFETCH_DELAY_MS);

    return () => {
      window.clearTimeout(delayTimerId);
      if (fallbackIdleTimerId !== null) {
        window.clearTimeout(fallbackIdleTimerId);
      }
      if (idleCallbackId !== null && typeof idleWindow.cancelIdleCallback === 'function') {
        idleWindow.cancelIdleCallback(idleCallbackId);
      }
    };
  }, []);

  const isAdminWorkspaceRoute =
    location.pathname === '/admin'
    || (location.pathname.startsWith('/admin/') && location.pathname !== '/admin/login');
  const transitionKey = isAdminWorkspaceRoute ? '/admin' : location.pathname;
  const isReaderRoute = location.pathname.includes('/chapter/');
  const transitionClassName = prefersReducedMotion
    ? undefined
    : isReaderRoute || disableHeavyEffects
      ? 'animate-route-fade'
      : 'animate-route-enter';

  return (
    <div key={transitionKey} className={transitionClassName}>
      {children}
    </div>
  );
};

/**
 * Hızlı chunk yüklemelerinde parlamayı önlemek için 140ms bekleyen sade rota yükleme yer tutucusu.
 */
export const DelayedRouteFallback = () => {
  const location = useLocation();
  const { prefersReducedMotion } = useDeviceProfile();
  const [visible, setVisible] = useState(false);
  const showHeaderShell = shouldRenderHeaderBootstrap(location.pathname);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setVisible(true);
    }, ROUTE_FALLBACK_DELAY_MS);

    return () => {
      window.clearTimeout(timerId);
    };
  }, []);

  const pulseClassName = prefersReducedMotion ? '' : 'animate-pulse';

  return (
    <div
      className={
        visible
          ? 'min-h-screen bg-background text-foreground opacity-100 transition-opacity duration-150'
          : 'pointer-events-none min-h-screen bg-background text-foreground opacity-0'
      }
      aria-hidden={!visible}
      aria-busy={visible}
    >
      {visible ? (
        <>
          <div className="fixed top-0 inset-x-0 z-50 h-0.5 overflow-hidden bg-primary/15">
            <div
              className={
                prefersReducedMotion
                  ? 'h-full w-full bg-primary/60'
                  : 'h-full w-full animate-shimmer bg-[linear-gradient(90deg,transparent,hsl(var(--primary)),transparent)] bg-[length:200%_100%]'
              }
            />
          </div>
          <div
            className={`container mx-auto max-w-5xl px-4 pb-12 ${
              showHeaderShell ? 'pt-24' : 'pt-10'
            }`}
          >
            <div className="space-y-4">
              <div className={`h-7 w-44 rounded-lg bg-muted/60 ${pulseClassName}`} />
              <div className={`h-4 w-72 max-w-full rounded-md bg-muted/45 ${pulseClassName}`} />
              <div className={`h-28 w-full max-w-2xl rounded-2xl bg-muted/35 ${pulseClassName}`} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default PageTransitionShell;
