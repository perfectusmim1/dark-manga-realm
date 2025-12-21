import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Menu, X, User, Heart, History, BookMarked, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const Header: React.FC = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/browse?search=${encodeURIComponent(searchQuery)}`);
      setSearchQuery('');
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between gap-4">
        {/* Logo */}
        <Link 
          to="/" 
          className="flex items-center gap-2 text-xl font-bold tracking-tight"
        >
          <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
            MangaVerse
          </span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden items-center gap-6 md:flex">
          <Link to="/browse" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Keşfet
          </Link>
          <Link to="/browse?type=manhwa" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Manhwa
          </Link>
          <Link to="/browse?type=manga" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Manga
          </Link>
        </nav>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="hidden flex-1 max-w-md md:flex">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Manga, manhwa veya yazar ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10"
            />
          </div>
        </form>

        {/* User Actions */}
        <div className="flex items-center gap-2">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="icon" size="icon" className="rounded-full">
                  <User className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{user.username}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/favorites" className="flex items-center gap-2">
                    <Heart className="h-4 w-4" />
                    Favorilerim
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/history" className="flex items-center gap-2">
                    <History className="h-4 w-4" />
                    Okuma Geçmişi
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/bookmarks" className="flex items-center gap-2">
                    <BookMarked className="h-4 w-4" />
                    Yer İmleri
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Çıkış Yap
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button asChild variant="glow" size="sm">
              <Link to="/auth">Giriş Yap</Link>
            </Button>
          )}

          {/* Mobile Menu Button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="animate-fade-in border-t border-border bg-background p-4 md:hidden">
          <form onSubmit={handleSearch} className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Ara..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10"
              />
            </div>
          </form>
          <nav className="flex flex-col gap-2">
            <Link 
              to="/browse" 
              onClick={() => setIsMenuOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
            >
              Keşfet
            </Link>
            <Link 
              to="/browse?type=manhwa" 
              onClick={() => setIsMenuOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
            >
              Manhwa
            </Link>
            <Link 
              to="/browse?type=manga" 
              onClick={() => setIsMenuOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
            >
              Manga
            </Link>
            {user && (
              <>
                <Link 
                  to="/favorites" 
                  onClick={() => setIsMenuOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
                >
                  Favorilerim
                </Link>
                <Link 
                  to="/history" 
                  onClick={() => setIsMenuOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
                >
                  Okuma Geçmişi
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
};

export default Header;
