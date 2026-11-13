import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { idbPersister } from "@/lib/cache/idbPersister";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { initializeMockData } from "@/lib/mockData";
import { useEffectiveOnlineStatus } from "@/hooks/useEffectiveOnlineStatus";
import { checkCurrentAccess, recoverAccessCheckFailure } from "@/lib/security/deviceIdentity";
import { useAuth } from "@/contexts/AuthContext";

// Pages
import ScrollToTop from "./components/layout/ScrollToTop";
import Header from "./components/layout/Header";
import { GlobalHeaderEnabledContext } from "./components/layout/Header";
import { shouldRenderHeaderBootstrap } from "./components/layout/HeaderBootstrapShell";
import PageTransitionShell, { DelayedRouteFallback } from "./components/layout/PageTransitionShell";
import NativeAppChrome from "./components/layout/NativeAppChrome";
import AppErrorBoundary from "./components/common/AppErrorBoundary";
import { initializeOfflineUserSync } from "@/lib/offline/userSync";
import { routeModuleLoaders } from "@/lib/routeModules";
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
    },
  },
});

// Initialize data on app load
const AppInitializer = ({ children }: { children: React.ReactNode }) => {
  useEffect(() => {
    initializeMockData();
    initializeOfflineUserSync();

    // Sitedeki tüm buton ve elemanlarda hover anında çıkan tarayıcı tooltip etiketlerini kaldır
    const handleMouseOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest?.('[title]');
      if (target) {
        const titleVal = target.getAttribute('title');
        if (titleVal) {
          if (!target.getAttribute('aria-label')) {
            target.setAttribute('aria-label', titleVal);
          }
          target.removeAttribute('title');
        }
      }
    };
    document.addEventListener('mouseover', handleMouseOver, { capture: true, passive: true });
    return () => {
      document.removeEventListener('mouseover', handleMouseOver, { capture: true });
    };
  }, []);

  return <>{children}</>;
};

import SecurityWrapper from "@/components/security/SecurityWrapper";
import UserWarningGate from "@/components/security/UserWarningGate";

const getBanTypeLabel = (type?: string | null) => {
  switch (type) {
    case 'timed':
      return 'Süreli Ban';
    case 'hard':
      return 'Hard Ban';
    case 'permanent':
    default:
      return 'Kalıcı Ban';
  }
};

const Index = lazy(routeModuleLoaders.Index);
const TopTen = lazy(routeModuleLoaders.TopTen);
const Browse = lazy(routeModuleLoaders.Browse);
const MangaDetail = lazy(routeModuleLoaders.MangaDetail);
const Reader = lazy(routeModuleLoaders.Reader);
const Auth = lazy(routeModuleLoaders.Auth);
const Favorites = lazy(routeModuleLoaders.Favorites);
const History = lazy(routeModuleLoaders.History);
const LatestChapters = lazy(routeModuleLoaders.LatestChapters);
const Bookmarks = lazy(routeModuleLoaders.Bookmarks);
const Library = lazy(routeModuleLoaders.Library);
const Downloads = lazy(routeModuleLoaders.Downloads);
const Notifications = lazy(routeModuleLoaders.Notifications);
const Announcements = lazy(routeModuleLoaders.Announcements);
const ReadingLists = lazy(routeModuleLoaders.ReadingLists);
const ReadingTime = lazy(routeModuleLoaders.ReadingTime);
const ReadingTimeMangaDetail = lazy(routeModuleLoaders.ReadingTimeMangaDetail);
const ReadingListDetail = lazy(routeModuleLoaders.ReadingListDetail);
const SeriesRequests = lazy(routeModuleLoaders.SeriesRequests);
const Settings = lazy(routeModuleLoaders.Settings);
const Support = lazy(routeModuleLoaders.Support);
const NotFound = lazy(routeModuleLoaders.NotFound);
const Profile = lazy(routeModuleLoaders.Profile);
const Community = lazy(routeModuleLoaders.Community);
const ForumTopicDetail = lazy(routeModuleLoaders.ForumTopicDetail);
const TierLists = lazy(routeModuleLoaders.TierLists);
const TierListEditor = lazy(routeModuleLoaders.TierListEditor);
const TierListView = lazy(routeModuleLoaders.TierListView);
const CharacterDetail = lazy(routeModuleLoaders.CharacterDetail);
const AuthorDetail = lazy(routeModuleLoaders.AuthorDetail);
const ArtistDetail = lazy(routeModuleLoaders.ArtistDetail);
const CharactersBrowse = lazy(routeModuleLoaders.CharactersBrowse);
const AuthorsBrowse = lazy(routeModuleLoaders.AuthorsBrowse);
const ArtistsBrowse = lazy(routeModuleLoaders.ArtistsBrowse);
const AdminLogin = lazy(routeModuleLoaders.AdminLogin);
const AdminLayout = lazy(routeModuleLoaders.AdminLayout);
const AdminDashboard = lazy(routeModuleLoaders.AdminDashboard);
const AdminMangaList = lazy(routeModuleLoaders.AdminMangaList);
const AdminMangaEditor = lazy(routeModuleLoaders.AdminMangaEditor);
const AdminComments = lazy(routeModuleLoaders.AdminComments);
const AdminReviews = lazy(routeModuleLoaders.AdminReviews);
const AdminUsers = lazy(routeModuleLoaders.AdminUsers);
const AdminUserManagement = lazy(routeModuleLoaders.AdminUserManagement);
const AdminScraper = lazy(routeModuleLoaders.AdminScraper);
const AdminMetadataImport = lazy(routeModuleLoaders.AdminMetadataImport);
const AdminChapterScraper = lazy(routeModuleLoaders.AdminChapterScraper);
const AdminAutomation = lazy(routeModuleLoaders.AdminAutomation);
const AdminEntities = lazy(routeModuleLoaders.AdminEntities);
const AdminTags = lazy(routeModuleLoaders.AdminTags);
const AdminAnnouncements = lazy(routeModuleLoaders.AdminAnnouncements);
const AdminReports = lazy(routeModuleLoaders.AdminReports);
const AdminSiteSettings = lazy(routeModuleLoaders.AdminSiteSettings);
const AdminTickets = lazy(routeModuleLoaders.AdminTickets);
const AdminSeriesRequests = lazy(routeModuleLoaders.AdminSeriesRequests);
const LazyDownloadDock = lazy(() => import("@/components/offline/DownloadDock"));
const LazyAdBlockWarning = lazy(() => import("@/components/security/AdBlockWarning"));

const OfflineStartupRedirect = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const hasCheckedInitialRoute = useRef(false);
  const { isOnline } = useEffectiveOnlineStatus();

  useEffect(() => {
    if (hasCheckedInitialRoute.current) {
      return;
    }

    hasCheckedInitialRoute.current = true;

    if (typeof window === 'undefined' || isOnline) {
      return;
    }

    const path = location.pathname;
    const isRestrictedRoute = path.startsWith('/admin');

    if (isRestrictedRoute) {
      navigate('/downloads', { replace: true });
    }
  }, [isOnline, location.pathname, navigate]);

  return null;
};

const AccessGate = ({ children }: { children: React.ReactNode }) => {
  const { isOnline } = useEffectiveOnlineStatus();
  const location = useLocation();
  const { user, accessState, logout } = useAuth();
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!isOnline) {
      setBlockedMessage(null);
      return () => {
        active = false;
      };
    }

    void (async () => {
      const access = await checkCurrentAccess(`${location.pathname}${location.search}`).catch((error) => {
        return recoverAccessCheckFailure(error, 'Access gate check failed:');
      });

      if (!active) {
        return;
      }

      if (!access.allowed && access.reason !== 'access_check_failed') {
        setBlockedMessage(access.message || 'Bu cihaz veya bağlantı için site erişimi engellendi.');
        return;
      }

      setBlockedMessage(null);
    })();

    return () => {
      active = false;
    };
  }, [isOnline, location.pathname]);

  const isSupportPath = location.pathname === '/support' || location.pathname.startsWith('/support/');
  const isAuthPath = location.pathname === '/auth';
  const hasUserBan = Boolean(user?.isBanned || accessState.ban.active);
  const banType = user?.activeBanType || accessState.ban.type || null;
  const finalMessage = blockedMessage || user?.banReason || accessState.ban.reason || 'Hesabınız süresiz olarak dondurulmuştur.';
  const timedBanUntil = user?.banExpiresAt || accessState.ban.expiresAt;
  const bannedAt = user?.bannedAt || accessState.ban.bannedAt;
  const screenTitle = hasUserBan ? 'Hesabınız Banlandı' : 'Erişim Engellendi';
  const supportingText = hasUserBan
    ? 'Bu yüzden hesap verileri ve içerik şu anda yüklenmiyor. Aşağıdaki gerekçeyi kontrol edip gerekirse destek talebi açın.'
    : 'Bu cihaz veya bağlantı için erişim kısıtlandı. Ayrıntılar aşağıda yer alıyor.';

  if (blockedMessage || (hasUserBan && !isSupportPath && !isAuthPath)) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-destructive/10 via-transparent to-transparent pointer-events-none" />
        
        <div className="relative w-full max-w-2xl">
          <div className="absolute -inset-1 bg-gradient-to-r from-destructive/50 to-orange-500/50 rounded-2xl blur opacity-25" />
          
          <div className="relative bg-[#111] border border-white/10 rounded-2xl p-6 shadow-2xl backdrop-blur-xl md:p-10">
            <div className="mb-8 flex justify-center">
              <div className="w-20 h-20 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center animate-pulse">
                <svg className="w-10 h-10 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>
            
            <h1 className="text-center text-3xl font-black tracking-tight mb-3 bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent md:text-4xl">
              {screenTitle}
            </h1>
            
            <div className="space-y-5 text-center">
              <p className="mx-auto max-w-xl text-zinc-400 text-base leading-relaxed md:text-lg">
                {supportingText}
              </p>

              <div className="flex flex-wrap items-center justify-center gap-2">
                {hasUserBan ? (
                  <span className="rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-destructive/90">
                    {getBanTypeLabel(banType)}
                  </span>
                ) : null}
                {timedBanUntil ? (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">
                    Bitiş {new Date(timedBanUntil).toLocaleString('tr-TR')}
                  </span>
                ) : null}
                {bannedAt ? (
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-300">
                    Başlangıç {new Date(bannedAt).toLocaleString('tr-TR')}
                  </span>
                ) : null}
              </div>

              <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-left">
                <p className="text-[11px] uppercase tracking-[0.24em] text-destructive/70">Gerekçe</p>
                <p className="mt-3 text-sm leading-7 text-zinc-100 md:text-base">
                  {finalMessage}
                </p>
              </div>
              
              <div className="pt-8 border-t border-white/5">
                <p className="text-zinc-500 text-sm leading-6">
                  Banlandığınıza dair bu ekran, verilerin neden yüklenmediğini açıklamak için gösterilir. Bir hata olduğunu düşünüyorsanız destek ekibiyle iletişime geçin.
                </p>
                <p className="mt-2 text-zinc-600 font-mono text-xs uppercase tracking-widest">
                  ID: {user?.id?.slice(0, 8) || 'GUEST'}
                </p>
              </div>
            </div>
            
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href="/support"
                className="px-6 py-2 rounded-full bg-primary/20 border border-primary/30 text-primary text-sm hover:bg-primary/25 transition-all"
              >
                Destek / İtiraz
              </a>
              {user?.id && (
                <button 
                  onClick={() => {
                    void logout();
                  }}
                  className="px-6 py-2 rounded-full bg-white/5 border border-white/10 text-white/60 text-sm hover:bg-white/10 hover:text-white transition-all"
                >
                  Oturumu Kapat
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const MfaGate = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isLoading, mfaState } = useAuth();
  const shouldRedirectToMfa = (
    !isLoading
    && !mfaState.isLoading
    && mfaState.needsVerification
    && location.pathname !== '/auth'
  );

  useEffect(() => {
    if (!shouldRedirectToMfa) {
      return;
    }

    navigate('/auth?step=mfa', { replace: true });
  }, [navigate, shouldRedirectToMfa]);

  if (shouldRedirectToMfa) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="container flex min-h-screen max-w-2xl items-center justify-center py-12">
          <div className="w-full rounded-2xl border border-primary/20 bg-card/60 p-8 text-center shadow-xl backdrop-blur-sm">
            <h1 className="text-3xl font-black">Ek Doğrulama Gerekli</h1>
            <p className="mt-4 text-muted-foreground">
              Hesabınız için Google Authenticator doğrulaması zorunlu. Girişinizi tamamlamak için doğrulama ekranına yönlendiriliyorsunuz.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const PersistentHeader = () => {
  const location = useLocation();

  if (!shouldRenderHeaderBootstrap(location.pathname)) {
    return null;
  }

  return <Header persistent />;
};

const persistOptions = {
  persister: idbPersister,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { state: { status: string } }) => {
      return query.state.status === 'success';
    },
  },
};

const App = () => (
  <AppErrorBoundary>
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <AuthProvider>
        <TooltipProvider>
          <SecurityWrapper>
            <AppInitializer>
              <Toaster />
              <Sonner />
              <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <GlobalHeaderEnabledContext.Provider value>
                  <AccessGate>
                    <MfaGate>
                      <UserWarningGate />
                      <OfflineStartupRedirect />
                      <ScrollToTop />
                      <PersistentHeader />
                      <Suspense fallback={null}>
                        <LazyAdBlockWarning />
                      </Suspense>
                      <Suspense fallback={<DelayedRouteFallback />}>
                        <AppErrorBoundary>
                          <PageTransitionShell>
                            <Routes>
                              {/* Public Routes */}
                              <Route path="/" element={<Index />} />
                              <Route path="/top-ten" element={<TopTen />} />
                              <Route path="/top-10" element={<Navigate to="/top-ten" replace />} />
                              <Route path="/community" element={<Community />} />
                              <Route path="/community/topic/:topicId" element={<ForumTopicDetail />} />
                    <Route path="/browse" element={<Browse />} />
                    <Route path="/manga/:mangaId" element={<MangaDetail />} />
                    <Route path="/manga/:mangaId/chapter/:chapterId" element={<Reader />} />
                    <Route path="/auth" element={<Auth />} />
                    <Route path="/favorites" element={<Favorites />} />
                    <Route path="/library" element={<Library />} />
                    <Route path="/history" element={<History />} />
                    <Route path="/downloads" element={<Downloads />} />
                    <Route path="/latest-chapters" element={<LatestChapters />} />
                    <Route path="/reading-time" element={<ReadingTime />} />
                    <Route path="/reading-time/manga/:mangaId" element={<ReadingTimeMangaDetail />} />
                    <Route path="/bookmarks" element={<Bookmarks />} />
                    <Route path="/notifications" element={<Notifications />} />
                    <Route path="/announcements" element={<Announcements />} />
                    <Route path="/reading-lists" element={<ReadingLists />} />
                    <Route path="/tier-lists" element={<TierLists />} />
                    <Route path="/tier-lists/create" element={<TierListEditor />} />
                    <Route path="/tier-lists/:id" element={<TierListView />} />
                    <Route path="/tier-lists/:id/edit" element={<TierListEditor />} />
                    <Route path="/reading-lists/:listId" element={<ReadingListDetail />} />
                    <Route path="/series-requests" element={<SeriesRequests />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/support" element={<Support />} />
                    <Route path="/profile/:userId" element={<Profile />} />
                    <Route path="/character/:id" element={<CharacterDetail />} />
                    <Route path="/author/:id" element={<AuthorDetail />} />
                    <Route path="/artist/:id" element={<ArtistDetail />} />
                    <Route path="/characters" element={<CharactersBrowse />} />
                    <Route path="/authors" element={<AuthorsBrowse />} />
                    <Route path="/artists" element={<ArtistsBrowse />} />

                    {/* Admin Routes */}
                    <Route path="/admin/login" element={<AdminLogin />} />
                    <Route path="/admin" element={<AdminLayout />}>
                      <Route index element={<AdminDashboard />} />
                      <Route path="mangas" element={<AdminMangaList section="standard" />} />
                      <Route path="adult-mangas" element={<AdminMangaList section="adult" />} />
                      <Route path="mangas/new" element={<AdminMangaEditor />} />
                      <Route path="mangas/:mangaId" element={<AdminMangaEditor />} />
                      <Route path="comments" element={<AdminComments />} />
                      <Route path="reviews" element={<AdminReviews />} />
                      <Route path="scraper" element={<AdminScraper />} />
                      <Route path="metadata-import" element={<AdminMetadataImport />} />
                      <Route path="chapter-scraper" element={<AdminChapterScraper />} />
                      <Route path="automation" element={<AdminAutomation />} />
                      <Route path="users" element={<AdminUsers />} />
                      <Route path="user-management" element={<AdminUserManagement />} />
                      <Route path="entities" element={<AdminEntities />} />
                      <Route path="tags" element={<AdminTags />} />
                      <Route path="announcements" element={<AdminAnnouncements />} />
                      <Route path="reports" element={<AdminReports />} />
                      <Route path="tickets" element={<AdminTickets />} />
                      <Route path="series-requests" element={<AdminSeriesRequests />} />
                      <Route path="site-settings" element={<AdminSiteSettings />} />
                    </Route>

                              <Route path="*" element={<NotFound />} />
                            </Routes>
                          </PageTransitionShell>
                        </AppErrorBoundary>
                      </Suspense>
                      <NativeAppChrome />
                      <Suspense fallback={null}>
                        <LazyDownloadDock />
                      </Suspense>
                    </MfaGate>
                  </AccessGate>
                </GlobalHeaderEnabledContext.Provider>
              </BrowserRouter>
            </AppInitializer>
          </SecurityWrapper>
        </TooltipProvider>
      </AuthProvider>
    </PersistQueryClientProvider>
  </AppErrorBoundary>
);

export default App;
