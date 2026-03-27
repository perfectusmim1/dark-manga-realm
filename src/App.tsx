import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { initializeMockData } from "@/lib/mockData";
import { useEffectiveOnlineStatus } from "@/hooks/useEffectiveOnlineStatus";
import { checkCurrentAccess } from "@/lib/security/deviceIdentity";
import { useAuth } from "@/contexts/AuthContext";

// Pages
import ScrollToTop from "./components/layout/ScrollToTop";
import { offlineDownloadManager } from "@/lib/offline/downloadManager";
import { initializeOfflineReaderSync } from "@/lib/offline/offlineReaderSync";
import { initializeOfflineUserSync } from "@/lib/offline/userSync";
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

// Initialize data on app load
const AppInitializer = ({ children }: { children: React.ReactNode }) => {
  useEffect(() => {
    initializeMockData();
    void offlineDownloadManager.initialize();
    initializeOfflineReaderSync();
    initializeOfflineUserSync();
  }, []);

  return <>{children}</>;
};

import SecurityWrapper from "@/components/security/SecurityWrapper";

const Index = lazy(() => import("./pages/Index"));
const TopTen = lazy(() => import("./pages/TopTen"));
const Browse = lazy(() => import("./pages/Browse"));
const MangaDetail = lazy(() => import("./pages/MangaDetail"));
const Reader = lazy(() => import("./pages/Reader"));
const Auth = lazy(() => import("./pages/Auth"));
const Favorites = lazy(() => import("./pages/Favorites"));
const History = lazy(() => import("./pages/History"));
const LatestChapters = lazy(() => import("./pages/LatestChapters"));
const Bookmarks = lazy(() => import("./pages/Bookmarks"));
const Library = lazy(() => import("./pages/Library"));
const Downloads = lazy(() => import("./pages/Downloads"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Announcements = lazy(() => import("./pages/Announcements"));
const ReadingLists = lazy(() => import("./pages/ReadingLists"));
const ReadingTime = lazy(() => import("./pages/ReadingTime"));
const ReadingListDetail = lazy(() => import("./pages/ReadingListDetail"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Profile = lazy(() => import("./pages/Profile"));
const Community = lazy(() => import("./pages/Community"));
const TierLists = lazy(() => import("./pages/TierLists"));
const TierListEditor = lazy(() => import("./pages/TierListEditor"));
const TierListView = lazy(() => import("./pages/TierListView"));
const CharacterDetail = lazy(() => import("./pages/CharacterDetail"));
const AuthorDetail = lazy(() => import("./pages/AuthorDetail"));
const ArtistDetail = lazy(() => import("./pages/ArtistDetail"));
const CharactersBrowse = lazy(() => import("./pages/CharactersBrowse"));
const AuthorsBrowse = lazy(() => import("./pages/AuthorsBrowse"));
const ArtistsBrowse = lazy(() => import("./pages/ArtistsBrowse"));
const AdminLogin = lazy(() => import("./pages/admin/AdminLogin"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminMangaList = lazy(() => import("./pages/admin/AdminMangaList"));
const AdminMangaEditor = lazy(() => import("./pages/admin/AdminMangaEditor"));
const AdminComments = lazy(() => import("./pages/admin/AdminComments"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers"));
const AdminUserManagement = lazy(() => import("./pages/admin/AdminUserManagement"));
const AdminScraper = lazy(() => import("./pages/admin/AdminScraper"));
const AdminChapterScraper = lazy(() => import("./pages/admin/AdminChapterScraper"));
const AdminEntities = lazy(() => import("./pages/admin/AdminEntities"));
const AdminTags = lazy(() => import("./pages/admin/AdminTags"));
const AdminAnnouncements = lazy(() => import("./pages/admin/AdminAnnouncements"));
const AdminReports = lazy(() => import("./pages/admin/AdminReports"));
const AdminSiteSettings = lazy(() => import("./pages/admin/AdminSiteSettings"));
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
  const { user, logout } = useAuth();
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
      const access = await checkCurrentAccess().catch((error) => {
        console.error('Access gate check failed:', error);
        return { allowed: true } as const;
      });

      if (!active) {
        return;
      }

      if (!access.allowed) {
        if (user?.id) {
          await logout();
        }

        setBlockedMessage(access.message || 'Bu cihaz veya bağlantı için site erişimi engellendi.');
        return;
      }

      setBlockedMessage(null);
    })();

    return () => {
      active = false;
    };
  }, [isOnline, user?.id, logout]);

  if (blockedMessage || user?.isBanned) {
    const finalMessage = blockedMessage || user?.banReason || 'Hesabınız süresiz olarak dondurulmuştur.';
    
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-destructive/10 via-transparent to-transparent pointer-events-none" />
        
        <div className="relative w-full max-w-lg">
          <div className="absolute -inset-1 bg-gradient-to-r from-destructive/50 to-orange-500/50 rounded-2xl blur opacity-25" />
          
          <div className="relative bg-[#111] border border-white/10 rounded-2xl p-8 md:p-12 shadow-2xl backdrop-blur-xl text-center">
            <div className="mb-8 flex justify-center">
              <div className="w-20 h-20 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center animate-pulse">
                <svg className="w-10 h-10 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>
            
            <h1 className="text-4xl font-black tracking-tight mb-4 bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent">
              Erişim Engellendi
            </h1>
            
            <div className="space-y-4">
              <p className="text-zinc-400 text-lg leading-relaxed">
                {finalMessage}
              </p>
              
              <div className="pt-8 border-t border-white/5">
                <p className="text-zinc-500 text-sm">
                  Bir hata olduğunu düşünüyorsanız lütfen destek ekibiyle iletişime geçin.
                </p>
                <p className="mt-2 text-zinc-600 font-mono text-xs uppercase tracking-widest">
                  ID: {user?.id?.slice(0, 8) || 'GUEST'}
                </p>
              </div>
            </div>
            
            {user?.id && (
              <button 
                onClick={() => logout()}
                className="mt-8 px-6 py-2 rounded-full bg-white/5 border border-white/10 text-white/60 text-sm hover:bg-white/10 hover:text-white transition-all"
              >
                Oturumu Kapat
              </button>
            )}
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

  useEffect(() => {
    if (isLoading || !mfaState.needsVerification || location.pathname === '/auth') {
      return;
    }

    navigate('/auth?step=mfa', { replace: true });
  }, [isLoading, location.pathname, mfaState.needsVerification, navigate]);

  if (!isLoading && mfaState.needsVerification && location.pathname !== '/auth') {
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

const RouteFallback = () => (
  <div className="min-h-screen bg-background text-foreground">
    <div className="container flex min-h-screen items-center justify-center py-12">
      <div className="h-12 w-12 animate-pulse rounded-full border border-primary/20 bg-primary/10" />
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <SecurityWrapper>
          <AppInitializer>
            <Toaster />
            <Sonner />
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <AccessGate>
                <MfaGate>
                  <OfflineStartupRedirect />
                  <ScrollToTop />
                  <Suspense fallback={null}>
                    <LazyAdBlockWarning />
                  </Suspense>
                  <Suspense fallback={<RouteFallback />}>
                    <Routes>
                    {/* Public Routes */}
                    <Route path="/" element={<Index />} />
                    <Route path="/top-ten" element={<TopTen />} />
                    <Route path="/community" element={<Community />} />
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
                    <Route path="/bookmarks" element={<Bookmarks />} />
                    <Route path="/notifications" element={<Notifications />} />
                    <Route path="/announcements" element={<Announcements />} />
                    <Route path="/reading-lists" element={<ReadingLists />} />
                    <Route path="/tier-lists" element={<TierLists />} />
                    <Route path="/tier-lists/create" element={<TierListEditor />} />
                    <Route path="/tier-lists/:id" element={<TierListView />} />
                    <Route path="/tier-lists/:id/edit" element={<TierListEditor />} />
                    <Route path="/reading-lists/:listId" element={<ReadingListDetail />} />
                    <Route path="/settings" element={<Settings />} />
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
                      <Route path="mangas" element={<AdminMangaList />} />
                      <Route path="mangas/new" element={<AdminMangaEditor />} />
                      <Route path="mangas/:mangaId" element={<AdminMangaEditor />} />
                      <Route path="comments" element={<AdminComments />} />
                      <Route path="scraper" element={<AdminScraper />} />
                      <Route path="chapter-scraper" element={<AdminChapterScraper />} />
                      <Route path="users" element={<AdminUsers />} />
                      <Route path="user-management" element={<AdminUserManagement />} />
                      <Route path="entities" element={<AdminEntities />} />
                      <Route path="tags" element={<AdminTags />} />
                      <Route path="announcements" element={<AdminAnnouncements />} />
                      <Route path="reports" element={<AdminReports />} />
                      <Route path="site-settings" element={<AdminSiteSettings />} />
                    </Route>

                    <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                  <Suspense fallback={null}>
                    <LazyDownloadDock />
                  </Suspense>
                </MfaGate>
              </AccessGate>
            </BrowserRouter>
          </AppInitializer>
        </SecurityWrapper>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
