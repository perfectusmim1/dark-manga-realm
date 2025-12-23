import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { useEffect } from "react";
import { initializeMockData } from "@/lib/mockData";

// Pages
import Index from "./pages/Index";
import Browse from "./pages/Browse";
import MangaDetail from "./pages/MangaDetail";
import Reader from "./pages/Reader";
import Auth from "./pages/Auth";
import Favorites from "./pages/Favorites";
import History from "./pages/History";
import Bookmarks from "./pages/Bookmarks";
import Library from "./pages/Library";
import Notifications from "./pages/Notifications";
import NotFound from "./pages/NotFound";

// Admin Pages
import AdminLogin from "./pages/admin/AdminLogin";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminMangaList from "./pages/admin/AdminMangaList";
import AdminMangaEditor from "./pages/admin/AdminMangaEditor";
import AdminComments from "./pages/admin/AdminComments";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminUserManagement from "./pages/admin/AdminUserManagement";

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
  }, []);

  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <AppInitializer>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              {/* Public Routes */}
              <Route path="/" element={<Index />} />
              <Route path="/browse" element={<Browse />} />
              <Route path="/manga/:mangaId" element={<MangaDetail />} />
              <Route path="/manga/:mangaId/chapter/:chapterId" element={<Reader />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/favorites" element={<Favorites />} />
              <Route path="/library" element={<Library />} />
              <Route path="/history" element={<History />} />
              <Route path="/bookmarks" element={<Bookmarks />} />
              <Route path="/notifications" element={<Notifications />} />

              {/* Admin Routes */}
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminDashboard />} />
                <Route path="mangas" element={<AdminMangaList />} />
                <Route path="mangas/new" element={<AdminMangaEditor />} />
                <Route path="mangas/:mangaId" element={<AdminMangaEditor />} />
                <Route path="comments" element={<AdminComments />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="user-management" element={<AdminUserManagement />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </AppInitializer>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
