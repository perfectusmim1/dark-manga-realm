import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import NotificationDropdown from '@/components/notifications/NotificationDropdown';
import AnnouncementDropdown from '@/components/notifications/AnnouncementDropdown';
import SuperSearch from './SuperSearch';
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
  BookOpen,
  User as UserIcon,
  Trophy,
  Dices,
  Users,
  Book,
  Clock3,
  Sparkles,
} from 'lucide-react';
import { getAllMangas, getCharacters } from '@/lib/database';
import { Manga, Character } from '@/lib/types';


import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
  const isAdmin = user?.role === 'admin' || user?.role === 'moderator';
  const [allCharacters, setAllCharacters] = useState<Character[]>([]);
  const [quickCharacterResults, setQuickCharacterResults] = useState<Character[]>([]);
  const [isRandomDialogOpen, setIsRandomDialogOpen] = useState(false);
  const [isRandomRolling, setIsRandomRolling] = useState(false);
  const [randomQueue, setRandomQueue] = useState<Manga[]>([]);
  const [randomSpinIndex, setRandomSpinIndex] = useState(0);
  const [randomTransitionMs, setRandomTransitionMs] = useState(120);

  // Load all mangas for quick search once
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [mangaData, charData] = await Promise.all([
          getAllMangas(),
          getCharacters()
        ]);
        setAllMangas(mangaData);
        setAllCharacters(charData);
      } catch (err) {
        console.error('Quick search data load failed:', err);
      }
    };
    loadInitialData();
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

      const filteredChars = allCharacters
        .filter(c => c.name.toLocaleLowerCase('tr-TR').includes(query))
        .slice(0, 3);
      setQuickCharacterResults(filteredChars);
    } else {
      setQuickResults([]);
      setQuickCharacterResults([]);
    }
  }, [searchQuery, allMangas, allCharacters]);

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

  const navLinks: { path: string; label: string; icon?: any }[] = [
    { path: '/browse', label: 'Keşfet' },
    { path: '/latest-chapters', label: 'Son Bölümler' },
    { path: '/characters', label: 'Karakterler' },
    { path: '/community', label: 'Topluluk', icon: Users },
  ];

  useEffect(() => {
    if (!isRandomRolling || randomQueue.length === 0) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | undefined;
    let navigateTimeoutId: number | undefined;
    const lastIndex = randomQueue.length - 1;

    const advance = (step: number) => {
      if (cancelled) {
        return;
      }

      const progress = step / lastIndex;
      const transitionMs = progress < 0.55 ? 85 : progress < 0.8 ? 140 : 220;
      const nextDelay = progress < 0.55 ? 95 : progress < 0.8 ? 170 : 280;

      setRandomTransitionMs(transitionMs);
      setRandomSpinIndex(step);

      if (step >= lastIndex) {
        navigateTimeoutId = window.setTimeout(() => {
          if (cancelled) {
            return;
          }

          const selectedManga = randomQueue[lastIndex];
          setIsRandomRolling(false);
          setIsRandomDialogOpen(false);
          navigate(`/manga/${selectedManga.id}`);
        }, 700);
        return;
      }

      timeoutId = window.setTimeout(() => advance(step + 1), nextDelay);
    };

    timeoutId = window.setTimeout(() => advance(1), 120);

    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      if (navigateTimeoutId) {
        window.clearTimeout(navigateTimeoutId);
      }
    };
  }, [isRandomRolling, navigate, randomQueue]);

  const buildRandomQueue = (mangas: Manga[]) => {
    const shuffled = [...mangas].sort(() => Math.random() - 0.5);
    const selectedManga = shuffled[Math.floor(Math.random() * shuffled.length)];
    const fillerPool = shuffled.filter((manga) => manga.id !== selectedManga.id);
    const fillers = Array.from({ length: 10 }).map((_, index) => fillerPool[index % fillerPool.length] || selectedManga);

    return [...fillers, selectedManga];
  };

  const handleRandomManga = async () => {
    try {
      if (isRandomRolling) {
        return;
      }

      const mangas = allMangas.length > 0 ? allMangas : await getAllMangas();
      if (mangas && mangas.length > 0) {
        const queue = buildRandomQueue(mangas);
        setRandomQueue(queue);
        setRandomSpinIndex(0);
        setRandomTransitionMs(90);
        setIsRandomDialogOpen(true);
        setIsRandomRolling(true);
      }
    } catch(err) {}
  };

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
          {navLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.path}
                to={link.path}
                className={`text-sm font-medium transition-colors flex items-center gap-1.5 ${location.pathname + location.search === link.path
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                {Icon && <Icon className="w-4 h-4" />}
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Search Bar & Dice Button */}
        <div className="flex-1 flex items-center gap-2 max-w-md hidden md:flex">
          <Button 
            variant="outline" 
            size="icon" 
            className="shrink-0 h-9 w-9 group transition-all hover:bg-primary/20 hover:border-primary/50" 
            onClick={handleRandomManga}
            title="Rastgele Manga"
          >
            <Dices className="h-4 w-4 text-primary group-hover:rotate-12 transition-transform" />
          </Button>

          <form onSubmit={handleSearch} className="flex-1">
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

                  {quickCharacterResults.length > 0 && (
                    <div className="mt-3">
                      <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-t border-border pt-2">Karakterler</p>
                      <div className="mt-1 space-y-1">
                        {quickCharacterResults.map(char => (
                          <button
                            key={char.id}
                            onClick={() => {
                              navigate(`/character/${char.id}`);
                              setSearchQuery('');
                              setQuickCharacterResults([]);
                              setQuickResults([]);
                              setIsSearchFocused(false);
                            }}
                            className="flex w-full items-center gap-3 rounded-lg p-2 transition-colors hover:bg-secondary/80 text-left group"
                          >
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={char.imageUrl} />
                              <AvatarFallback className="text-[10px]">{char.name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{char.name}</h4>
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <Heart className="h-2 w-2 fill-primary text-primary" /> {char.likesCount} Beğeni
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

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
        </div>

        {/* User Actions */}
        <div className="flex items-center gap-2">
          {/* Admin Link */}
          {isAdmin && (
            <Button asChild variant="ghost" size="sm" className="hidden md:flex">
              <Link to="/admin">
                <Shield className="mr-2 h-4 w-4" />
                Admin
              </Link>
            </Button>
          )}

          {/* Notifications & Search */}
          <div className="flex items-center gap-1">
            <SuperSearch />
            {user && (
              <>
                <AnnouncementDropdown />
                <NotificationDropdown />
              </>
            )}
          </div>

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
                  <Link to={`/profile/${user.id}`} className="flex items-center gap-2">
                    <UserIcon className="h-4 w-4" />
                    Profilim
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to={`/profile/${user.id}?tab=achievements`} className="flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-yellow-500" />
                    Başarımlarım
                  </Link>
                </DropdownMenuItem>
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
                  <Link to="/reading-time" className="flex items-center gap-2">
                    <Clock3 className="h-4 w-4" />
                    Süre
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
                  <Link to="/tier-lists" className="flex items-center gap-2">
                    <Book className="h-4 w-4" />
                    Tier Listelerim
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings" className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Ayarlar
                  </Link>
                </DropdownMenuItem>


                {isAdmin && (
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
                <Link
                  to="/reading-time"
                  onClick={() => setIsMenuOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
                >
                  Süre
                </Link>
              </>
            )}
            {isAdmin && (
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

      <Dialog
        open={isRandomDialogOpen}
        onOpenChange={(open) => {
          if (isRandomRolling) {
            return;
          }
          setIsRandomDialogOpen(open);
        }}
      >
        <DialogContent className="max-w-md overflow-hidden border-primary/20 bg-card/95 p-0 backdrop-blur-xl">
          <DialogHeader className="border-b border-border/60 px-6 py-5">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-[0.24em] text-primary/80">Rastgele Seri</span>
            </div>
            <DialogTitle className="pt-2 text-2xl font-black tracking-tight">
              Şansın Kimi Seçecek?
            </DialogTitle>
            <DialogDescription>
              Seri kartları slot gibi akıyor, seçilen manganın üstünde durunca sayfaya geçeceksin.
            </DialogDescription>
          </DialogHeader>

          <div className="relative px-6 py-6">
            <div className="pointer-events-none absolute inset-x-6 top-6 h-16 rounded-t-3xl bg-gradient-to-b from-card via-card/80 to-transparent z-20" />
            <div className="pointer-events-none absolute inset-x-6 bottom-6 h-16 rounded-b-3xl bg-gradient-to-t from-card via-card/80 to-transparent z-20" />
            <div className="pointer-events-none absolute inset-x-7 top-[calc(50%-20px)] z-20 h-[96px] -translate-y-1/2 rounded-[26px] border border-primary/30 bg-primary/10 shadow-[0_0_40px_rgba(59,130,246,0.18)]" />

            <div className="h-[312px] overflow-hidden rounded-[28px] border border-border/60 bg-background/70">
              <div
                className="px-4 py-[108px]"
                style={{
                  transform: `translateY(-${randomSpinIndex * 96}px)`,
                  transitionProperty: 'transform',
                  transitionDuration: `${randomTransitionMs}ms`,
                  transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              >
                <div className="space-y-3">
                  {randomQueue.map((manga, index) => {
                    const isActive = index === randomSpinIndex;

                    return (
                      <div
                        key={`${manga.id}-${index}`}
                        className={`flex h-[84px] items-center gap-4 rounded-2xl border px-3 transition-all ${isActive ? 'border-primary/50 bg-primary/10 shadow-[0_0_24px_rgba(59,130,246,0.12)]' : 'border-border/50 bg-card/50 opacity-70'}`}
                      >
                        <img
                          src={manga.cover}
                          alt={manga.title}
                          className="h-16 w-12 rounded-xl object-cover shadow-md"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{manga.title}</p>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="uppercase">{manga.type}</span>
                            <span className="h-1 w-1 rounded-full bg-border" />
                            <span>{manga.author}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <p className="pt-4 text-center text-xs text-muted-foreground">
              {isRandomRolling ? 'Karıştırılıyor...' : 'Seçim tamamlandı, seri açılıyor...'}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
};

export default Header;
