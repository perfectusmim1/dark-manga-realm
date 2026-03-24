import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, matchPath, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { useEffect, useRef } from "react";
import { initializeMockData } from "@/lib/mockData";

// Pages
import ScrollToTop from "./components/layout/ScrollToTop";
import Index from "./pages/Index";
import Browse from "./pages/Browse";
import MangaDetail from "./pages/MangaDetail";
import Reader from "./pages/Reader";
import Auth from "./pages/Auth";
import Favorites from "./pages/Favorites";
import History from "./pages/History";
import LatestChapters from "./pages/LatestChapters";
import Bookmarks from "./pages/Bookmarks";
import Library from "./pages/Library";
import Downloads from "./pages/Downloads";
import Notifications from "./pages/Notifications";
import Announcements from "./pages/Announcements";
import ReadingLists from "./pages/ReadingLists";
import ReadingTime from "./pages/ReadingTime";
import ReadingListDetail from "./pages/ReadingListDetail";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import Profile from "./pages/Profile";
import Community from "./pages/Community";
import TierLists from "./pages/TierLists";
import TierListEditor from "./pages/TierListEditor";
import TierListView from "./pages/TierListView";
import CharacterDetail from "./pages/CharacterDetail";
import AuthorDetail from "./pages/AuthorDetail";
import ArtistDetail from "./pages/ArtistDetail";
import CharactersBrowse from "./pages/CharactersBrowse";
import AuthorsBrowse from "./pages/AuthorsBrowse";
import ArtistsBrowse from "./pages/ArtistsBrowse";
// Admin Pages
import AdminLogin from "./pages/admin/AdminLogin";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminMangaList from "./pages/admin/AdminMangaList";
import AdminMangaEditor from "./pages/admin/AdminMangaEditor";
import AdminComments from "./pages/admin/AdminComments";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminUserManagement from "./pages/admin/AdminUserManagement";
import AdminScraper from "./pages/admin/AdminScraper";
import AdminChapterScraper from "./pages/admin/AdminChapterScraper";
import AdminEntities from "./pages/admin/AdminEntities";
import AdminTags from "./pages/admin/AdminTags";
import AdminAnnouncements from "./pages/admin/AdminAnnouncements";
import AdminReports from "./pages/admin/AdminReports";
import { offlineDownloadManager } from "@/lib/offline/downloadManager";
import { initializeOfflineReaderSync } from "@/lib/offline/offlineReaderSync";
import DownloadDock from "@/components/offline/DownloadDock";

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
  }, []);

  return <>{children}</>;
};

import SecurityWrapper from "@/components/security/SecurityWrapper";

const OfflineStartupRedirect = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const hasCheckedInitialRoute = useRef(false);

  useEffect(() => {
    if (hasCheckedInitialRoute.current) {
      return;
    }

    hasCheckedInitialRoute.current = true;

    if (typeof window === 'undefined' || navigator.onLine) {
      return;
    }

    const path = location.pathname;
    const isOfflineReadyRoute =
      path === '/'
      || path === '/downloads'
      || Boolean(matchPath('/manga/:mangaId', path))
      || Boolean(matchPath('/manga/:mangaId/chapter/:chapterId', path));

    if (!isOfflineReadyRoute) {
      navigate('/downloads', { replace: true });
    }
  }, [location.pathname, navigate]);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <SecurityWrapper>
          <AppInitializer>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <OfflineStartupRedirect />
              <ScrollToTop />
              <Routes>
                {/* Public Routes */}
                <Route path="/" element={<Index />} />
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
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
              <DownloadDock />
            </BrowserRouter>
          </AppInitializer>
        </SecurityWrapper>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
