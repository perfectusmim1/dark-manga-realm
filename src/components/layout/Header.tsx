import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import NotificationDropdown from '@/components/notifications/NotificationDropdown';
import {
  Search,
  Menu,
  X,
  User,
  Heart,
  History,
  BookMarked,
  LogOut,
  Library,
  Shield,
  List,
  Settings,
  Star,
  BookOpen
} from 'lucide-react';
import { getAllMangas } from '@/lib/database';
import { Manga } from '@/lib/types';


import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { getAdminSession } from '../../lib/storage';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

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
  const [quickResults, setQuickResults] = useState<Manga[]>([]);
  const [allMangas, setAllMangas] = useState<Manga[]>([]);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const adminSession = getAdminSession();

  // Load all mangas for quick search once
  useEffect(() => {
    const loadAllMangas = async () => {
      try {
        const data = await getAllMangas();
        setAllMangas(data);
      } catch (err) {
        console.error('Quick search data load failed:', err);
      }
    };
    loadAllMangas();
  }, []);

  // Filter for quick results
  useEffect(() => {
    if (searchQuery.trim().length > 1) {
      const query = searchQuery.toLocaleLowerCase('tr-TR');
      const filtered = allMangas
        .filter(m =>
          m.title.toLocaleLowerCase('tr-TR').includes(query) ||
          m.author.toLocaleLowerCase('tr-TR').includes(query) ||
          m.alternativeTitles?.some(t => t.toLocaleLowerCase('tr-TR').includes(query))
        )
        .slice(0, 3);
      setQuickResults(filtered);
    } else {
      setQuickResults([]);
    }
  }, [searchQuery, allMangas]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/browse?search=${encodeURIComponent(searchQuery)}`);
      setSearchQuery('');
      setQuickResults([]);
      setIsSearchFocused(false);
    }
  };

  const handleResultClick = (id: string) => {
    navigate(`/manga/${id}`);
    setSearchQuery('');
    setQuickResults([]);
    setIsSearchFocused(false);
  };

  const isActive = (path: string) => location.pathname === path;

  const navLinks: { path: string; label: string }[] = [];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between gap-4">
        {/* Logo */}
        <Link
          to="/"
          className="flex items-center gap-2"
        >
          <img src="/logo.png" alt="Logo" className="h-12 w-auto object-contain" />
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden items-center gap-6 lg:flex">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={`text-sm font-medium transition-colors ${location.pathname + location.search === link.path
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              {link.label}
            </Link>
          ))}
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
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
              className="w-full pl-10"
            />
            {/* Quick Search Dropdown */}
            {isSearchFocused && quickResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 overflow-hidden rounded-xl border border-border bg-background/95 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
                <div className="p-2">
                  <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Seriler</p>
                  <div className="mt-1 space-y-1">
                    {quickResults.map((manga) => (
                      <button
                        key={manga.id}
                        onClick={() => handleResultClick(manga.id)}
                        className="flex w-full items-center gap-3 rounded-lg p-2 transition-colors hover:bg-secondary/80 text-left group"
                      >
                        <img
                          src={manga.cover}
                          alt={manga.title}
                          className="h-12 w-9 rounded object-cover shadow-sm group-hover:scale-105 transition-transform"
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{manga.title}</h4>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-muted-foreground capitalize">{manga.type}</span>
                            <span className="h-1 w-1 rounded-full bg-border" />
                            <div className="flex items-center gap-1 text-[10px] text-primary font-medium">
                              <Star className="h-2.5 w-2.5 fill-current" />
                              {(manga as any).averageRating || '0.0'}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 border-t border-border pt-1">
                    <button
                      onClick={handleSearch}
                      className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-primary transition-colors"
                    >
                      <span>"{searchQuery}" için tüm sonuçlar</span>
                      <Search className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </form>

        {/* User Actions */}
        <div className="flex items-center gap-2">
          {/* Admin Link */}
          {adminSession && (
            <Button asChild variant="ghost" size="sm" className="hidden md:flex">
              <Link to="/admin">
                <Shield className="mr-2 h-4 w-4" />
                Admin
              </Link>
            </Button>
          )}

          {/* Notifications */}
          {user && <NotificationDropdown />}

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 p-0 rounded-full hover:bg-secondary/80">
                  <Avatar className="h-8 w-8 border border-border/50">
                    <AvatarImage src={user.avatar} />
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {user.username[0].toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Button>

              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{user.username}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/library" className="flex items-center gap-2">
                    <Library className="h-4 w-4" />
                    Kütüphanem
                  </Link>
                </DropdownMenuItem>
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
                <DropdownMenuItem asChild>
                  <Link to="/reading-lists" className="flex items-center gap-2">
                    <List className="h-4 w-4" />
                    Okuma Listelerim
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings" className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Ayarlar
                  </Link>
                </DropdownMenuItem>


                {adminSession && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to="/admin" className="flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        Admin Paneli
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
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
            className="lg:hidden"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="animate-fade-in border-t border-border bg-background p-4 lg:hidden">
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
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                onClick={() => setIsMenuOpen(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
              >
                {link.label}
              </Link>
            ))}
            {user && (
              <>
                <Link
                  to="/library"
                  onClick={() => setIsMenuOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
                >
                  Kütüphanem
                </Link>
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
            {adminSession && (
              <Link
                to="/admin"
                onClick={() => setIsMenuOpen(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-secondary"
              >
                Admin Paneli
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
};

export default Header;
