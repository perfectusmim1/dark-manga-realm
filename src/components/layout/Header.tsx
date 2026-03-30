import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import NotificationDropdown from '@/components/notifications/NotificationDropdown';
import AnnouncementDropdown from '@/components/notifications/AnnouncementDropdown';
import SuperSearch from './SuperSearch';
import InstallAppButton from '@/components/pwa/InstallAppButton';
import {
  Search,
  Menu,
  X,
  Wifi,
  WifiOff,
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
  Dices,
  Users,
  Book,
  Clock3,
  Sparkles,
  Download,
  ChevronDown,
  LifeBuoy,
  type LucideIcon,
} from 'lucide-react';
import { getCharacters, getMangaSummaries } from '@/lib/database';
import { Manga, Character } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useOfflinePreferences } from '@/hooks/useOfflinePreferences';
import { useAdminAccess } from '@/hooks/useAdminAccess';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { useOfflineLibrary } from '@/hooks/useOfflineLibrary';
import { toast } from 'sonner';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useDeviceProfile } from '@/hooks/use-device-profile';

const CHARACTER_MENU_LONG_PRESS_MS = 320;

const characterMenuItems = [
  {
    path: '/characters',
    label: 'Karakterler',
    description: 'Tüm karakter arşivini ve popüler yüzleri keşfet',
  },
  {
    path: '/authors',
    label: 'Yazarlar',
    description: 'Senaryo ve kurgu tarafını keşfet',
  },
  {
    path: '/artists',
    label: 'Çizerler',
    description: 'Çizim ekibi ve görsel kadro',
  },
];

const Header: React.FC = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [quickResults, setQuickResults] = useState<Manga[]>([]);
  const [allMangas, setAllMangas] = useState<Manga[]>([]);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const { user, logout, isLoading: authLoading } = useAuth();
  const { access } = useAdminAccess();
  const { preferences: offlinePreferences, updatePreferences: updateOfflinePreferences } = useOfflinePreferences();
  const { isOnline } = useEffectiveOnlineStatus();
  const { snapshot } = useOfflineLibrary();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = access.canAccessAdminPanel;
  const showSecondaryHeaderSearch = user?.preferences?.appearance?.show_header_search_bar ?? true;
  const showHeaderOfflineToggle = user?.preferences?.appearance?.show_header_offline_toggle ?? true;
  const [allCharacters, setAllCharacters] = useState<Character[]>([]);
  const [quickCharacterResults, setQuickCharacterResults] = useState<Character[]>([]);
  const { disableHeavyEffects } = useDeviceProfile();
  const [isRandomDialogOpen, setIsRandomDialogOpen] = useState(false);
  const [isRandomRolling, setIsRandomRolling] = useState(false);
  const [randomQueue, setRandomQueue] = useState<Manga[]>([]);
  const [randomSpinIndex, setRandomSpinIndex] = useState(0);
  const [randomTransitionMs, setRandomTransitionMs] = useState(120);
  const [isCharactersDesktopMenuOpen, setIsCharactersDesktopMenuOpen] = useState(false);
  const [isCharactersMobileMenuOpen, setIsCharactersMobileMenuOpen] = useState(false);
  const desktopCharactersCloseTimeoutRef = useRef<number | null>(null);
  const mobileCharactersLongPressTimeoutRef = useRef<number | null>(null);
  const mobileCharactersLongPressTriggeredRef = useRef(false);
  const mobileCharactersMenuRef = useRef<HTMLDivElement | null>(null);
  const mangaSearchLoadPromiseRef = useRef<Promise<Manga[]> | null>(null);
  const characterSearchLoadPromiseRef = useRef<Promise<Character[]> | null>(null);

  const ensureMangasLoaded = async () => {
    if (!isOnline) {
      return allMangas;
    }

    if (allMangas.length > 0) {
      return allMangas;
    }

    if (!mangaSearchLoadPromiseRef.current) {
      mangaSearchLoadPromiseRef.current = getMangaSummaries()
        .then((data) => {
          setAllMangas((current) => (current.length > 0 ? current : data));
          return data;
        })
        .catch((err) => {
          console.error('Quick search manga load failed:', err);
          return [];
        })
        .finally(() => {
          mangaSearchLoadPromiseRef.current = null;
        });
    }

    return mangaSearchLoadPromiseRef.current;
  };

  const ensureCharactersLoaded = async () => {
    if (!isOnline) {
      return allCharacters;
    }

    if (allCharacters.length > 0) {
      return allCharacters;
    }

    if (!characterSearchLoadPromiseRef.current) {
      characterSearchLoadPromiseRef.current = getCharacters()
        .then((data) => {
          setAllCharacters((current) => (current.length > 0 ? current : data));
          return data;
        })
        .catch((err) => {
          console.error('Quick search character load failed:', err);
          return [];
        })
        .finally(() => {
          characterSearchLoadPromiseRef.current = null;
        });
    }

    return characterSearchLoadPromiseRef.current;
  };

  const ensureQuickSearchData = async () => {
    await Promise.all([ensureMangasLoaded(), ensureCharactersLoaded()]);
  };

  // Filter for quick results
  useEffect(() => {
    if (searchQuery.trim().length > 1) {
      if (allMangas.length === 0 || allCharacters.length === 0) {
        void ensureQuickSearchData();
      }

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
      setQuickCharacterResults([]);
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
  const isCharactersSectionActive = (
    location.pathname === '/characters'
    || location.pathname === '/authors'
    || location.pathname === '/artists'
    || location.pathname.startsWith('/character/')
    || location.pathname.startsWith('/author/')
    || location.pathname.startsWith('/artist/')
  );

  const navLinks: { path: string; label: string; icon?: LucideIcon; featured?: boolean }[] = [
    { path: '/top-ten', label: 'Top 10', icon: Star, featured: true },
    { path: '/browse', label: 'Keşfet' },
    { path: '/latest-chapters', label: 'Son Bölümler' },
    { path: '/characters', label: 'Karakterler' },
    { path: '/community', label: 'Topluluk', icon: Users },
    ...(!authLoading && !user ? [{ path: '/support', label: 'Destek', icon: LifeBuoy }] : []),
  ];

  const clearDesktopCharactersCloseTimeout = () => {
    if (desktopCharactersCloseTimeoutRef.current !== null) {
      window.clearTimeout(desktopCharactersCloseTimeoutRef.current);
      desktopCharactersCloseTimeoutRef.current = null;
    }
  };

  const clearMobileCharactersLongPressTimeout = () => {
    if (mobileCharactersLongPressTimeoutRef.current !== null) {
      window.clearTimeout(mobileCharactersLongPressTimeoutRef.current);
      mobileCharactersLongPressTimeoutRef.current = null;
    }
  };

  const closeCharacterMenus = () => {
    clearDesktopCharactersCloseTimeout();
    clearMobileCharactersLongPressTimeout();
    mobileCharactersLongPressTriggeredRef.current = false;
    setIsCharactersDesktopMenuOpen(false);
    setIsCharactersMobileMenuOpen(false);
  };

  const openDesktopCharactersMenu = () => {
    clearDesktopCharactersCloseTimeout();
    setIsCharactersDesktopMenuOpen(true);
  };

  const scheduleDesktopCharactersMenuClose = () => {
    clearDesktopCharactersCloseTimeout();
    desktopCharactersCloseTimeoutRef.current = window.setTimeout(() => {
      setIsCharactersDesktopMenuOpen(false);
    }, 120);
  };

  const handleMobileCharactersLongPressStart = () => {
    mobileCharactersLongPressTriggeredRef.current = false;
    clearMobileCharactersLongPressTimeout();
    mobileCharactersLongPressTimeoutRef.current = window.setTimeout(() => {
      mobileCharactersLongPressTriggeredRef.current = true;
      setIsCharactersMobileMenuOpen(true);
    }, CHARACTER_MENU_LONG_PRESS_MS);
  };

  const handleMobileCharactersLongPressCancel = () => {
    clearMobileCharactersLongPressTimeout();
  };

  const handleMobileCharactersLinkClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (mobileCharactersLongPressTriggeredRef.current) {
      event.preventDefault();
      mobileCharactersLongPressTriggeredRef.current = false;
      return;
    }

    setIsCharactersMobileMenuOpen(false);
    setIsMenuOpen(false);
  };

  const toggleMobileCharactersMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    clearMobileCharactersLongPressTimeout();
    mobileCharactersLongPressTriggeredRef.current = false;
    setIsCharactersMobileMenuOpen((previous) => !previous);
  };

  const renderCharacterMenuLinks = (onNavigate?: () => void) => (
    <>
      {characterMenuItems.map((item) => {
        const isItemActive = item.path === '/characters'
          ? location.pathname === '/characters' || location.pathname.startsWith('/character/')
          : item.path === '/authors'
            ? location.pathname === '/authors' || location.pathname.startsWith('/author/')
            : location.pathname === '/artists' || location.pathname.startsWith('/artist/');

        return (
          <Link
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            className={`block rounded-xl px-4 py-3 transition-colors ${
              isItemActive
                ? 'bg-primary/12 text-primary'
                : 'text-foreground hover:bg-secondary/80'
            }`}
          >
            <p className="text-sm font-semibold">{item.label}</p>
            <p className={`mt-1 text-xs ${isItemActive ? 'text-primary/80' : 'text-muted-foreground'}`}>
              {item.description}
            </p>
          </Link>
        );
      })}
    </>
  );

  useEffect(() => {
    closeCharacterMenus();
  }, [location.pathname]);

  useEffect(() => {
    if (isMenuOpen) {
      return;
    }

    setIsCharactersMobileMenuOpen(false);
    mobileCharactersLongPressTriggeredRef.current = false;
    clearMobileCharactersLongPressTimeout();
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isCharactersMobileMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (mobileCharactersMenuRef.current && !mobileCharactersMenuRef.current.contains(target)) {
        setIsCharactersMobileMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isCharactersMobileMenuOpen]);

  useEffect(() => () => {
    clearDesktopCharactersCloseTimeout();
    clearMobileCharactersLongPressTimeout();
  }, []);

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

      const mangas = isOnline
        ? (allMangas.length > 0 ? allMangas : await ensureMangasLoaded())
        : snapshot.series.map(({ manga }) => ({
          id: manga.mangaId,
          title: manga.title,
          cover: manga.cover,
          banner: manga.banner,
          author: manga.author,
          artist: manga.artist,
          type: manga.type,
          status: manga.status,
          description: manga.description,
          genres: manga.genres,
          views: 0,
          chapters: [],
          ratings: [],
          lastUpdated: manga.lastUpdated,
          createdAt: manga.createdAt,
        } as Manga));

      if (mangas && mangas.length > 0) {
        const queue = buildRandomQueue(mangas);
        setRandomQueue(queue);
        setRandomSpinIndex(0);
        setRandomTransitionMs(90);
        setIsRandomDialogOpen(true);
        setIsRandomRolling(true);
      } else if (!isOnline) {
        toast.error('Çevrimdışıyken zar at sadece indirilen seriler arasında çalışır');
      }
    } catch (err) {
      console.error('Random manga selection error:', err);
    }
  };

  const handleToggleOfflineMode = () => {
    const nextForceOfflineMode = !offlinePreferences.forceOfflineMode;
    updateOfflinePreferences({ forceOfflineMode: nextForceOfflineMode });
    toast.success(nextForceOfflineMode ? 'Çevrimdışı mod açıldı' : 'Çevrimdışı mod kapatıldı');
  };

  const offlineModeLabel = offlinePreferences.forceOfflineMode ? 'Çevrimdışı Mod Açık' : 'Çevrimdışı Mod';
  const randomMangaLabel = 'Rastgele Manga';

  const renderRandomMangaButton = (extraClassName = '') => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={randomMangaLabel}
          onClick={handleRandomManga}
          className={`shrink-0 h-9 w-9 group transition-all hover:bg-primary/20 hover:border-primary/50 ${extraClassName}`}
        >
          <Dices className="h-4 w-4 text-primary transition-transform group-hover:rotate-12" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {randomMangaLabel}
      </TooltipContent>
    </Tooltip>
  );

  const renderOfflineToggleButton = (extraClassName = '') => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={offlineModeLabel}
          aria-pressed={offlinePreferences.forceOfflineMode}
          onClick={handleToggleOfflineMode}
          className={`shrink-0 h-9 w-9 transition-all ${
            offlinePreferences.forceOfflineMode
              ? 'border-primary/50 bg-primary/12 text-primary hover:bg-primary/18 hover:border-primary/60'
              : 'hover:bg-primary/20 hover:border-primary/50'
          } ${extraClassName}`}
        >
          {offlinePreferences.forceOfflineMode ? (
            <WifiOff className="h-4 w-4" />
          ) : (
            <Wifi className="h-4 w-4 text-primary" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {offlineModeLabel}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <TooltipProvider>
    <header className={`fixed top-0 left-0 right-0 z-50 border-b border-border/50 ${disableHeavyEffects ? 'bg-background/95' : 'bg-background/80 backdrop-blur-xl'}`}>
      <div className="container flex h-16 items-center justify-between gap-4">
        {/* Logo */}
        <Link
          to="/"
          className="-ml-2 flex items-center gap-2 md:-ml-3"
        >
                <img src="/logo.webp" alt="Logo" className="h-12 w-auto object-contain" decoding="async" />
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden items-center gap-6 lg:flex">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActiveLink = link.path === '/characters'
              ? isCharactersSectionActive
              : isActive(link.path);

            if (link.path === '/characters') {
              return (
                <div
                  key={link.path}
                  className="relative -my-3 px-2 py-3"
                  onMouseEnter={openDesktopCharactersMenu}
                  onMouseLeave={scheduleDesktopCharactersMenuClose}
                >
                  <Link
                    to={link.path}
                    className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
                      isCharactersSectionActive
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {link.label}
                    <ChevronDown
                      className={`h-4 w-4 transition-transform duration-200 ${
                        isCharactersDesktopMenuOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </Link>

                  <div
                    className={`absolute left-1/2 top-full z-50 w-[17rem] -translate-x-1/2 pt-2 transition-all duration-150 ${
                      isCharactersDesktopMenuOpen
                        ? 'pointer-events-auto translate-y-0 opacity-100'
                        : 'pointer-events-none -translate-y-1 opacity-0'
                    }`}
                  >
                    <div className="rounded-2xl border border-border/70 bg-background/95 p-2 shadow-2xl backdrop-blur-xl">
                      <div className="px-2 pb-2 pt-1">
                        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                          Karakterler
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        {renderCharacterMenuLinks()}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <Link
                key={link.path}
                to={link.path}
                className={
                  link.featured
                    ? `inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors ${
                        isActiveLink
                          ? 'border-primary/40 bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                          : 'border-primary/20 bg-primary/10 text-primary hover:border-primary/40 hover:bg-primary/15'
                      }`
                    : `flex items-center gap-1.5 text-sm font-medium transition-colors ${
                        isActiveLink
                          ? 'text-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`
                }
              >
                {Icon && <Icon className="w-4 h-4" />}
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Search Bar & Dice Button */}
        <div className="hidden max-w-md flex-1 items-center gap-2 md:flex">
          {renderRandomMangaButton()}
          {showHeaderOfflineToggle && renderOfflineToggleButton()}

          <form onSubmit={handleSearch} className="flex-1">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Manga, manhwa, webtoon veya yazar ara..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => {
                  setIsSearchFocused(true);
                  void ensureQuickSearchData();
                }}
                onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                className="w-full pl-10"
              />
              {/* Quick Search Dropdown */}
              {isSearchFocused && (quickResults.length > 0 || quickCharacterResults.length > 0) && (
                <div className="absolute top-full left-0 right-0 mt-2 overflow-hidden rounded-xl border border-border bg-background/95 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
                  <div className="p-2">
                    {quickResults.length > 0 && (
                      <>
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
                                    {typeof manga.averageRating === 'number' ? manga.averageRating.toFixed(1) : '0.0'}
                                  </div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </>
                    )}

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
            {showSecondaryHeaderSearch && (
              <div className="hidden md:block">
                <SuperSearch />
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 md:hidden"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              aria-expanded={isMenuOpen}
              aria-label="Gezinti menüsü"
            >
              {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <div className="md:hidden">
              {showHeaderOfflineToggle && renderOfflineToggleButton()}
            </div>
            <InstallAppButton
              iconOnly
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              title="Uygulamayı Yükle"
            />
            {!authLoading && user && (
              <>
                <AnnouncementDropdown />
                <NotificationDropdown />
              </>
            )}
          </div>

          {authLoading ? (
            <div className="flex items-center gap-2">
              <Skeleton className="hidden h-9 w-20 rounded-md md:block" />
              <Skeleton className="h-9 w-9 rounded-full" />
            </div>
          ) : user ? (
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
                  <Link to="/downloads" className="flex items-center gap-2">
                    <Download className="h-4 w-4" />
                    İndirilenler
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/reading-time" className="flex items-center gap-2">
                    <Clock3 className="h-4 w-4" />
                    Okuma Süresi
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
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/support" className="flex items-center gap-2">
                    <LifeBuoy className="h-4 w-4" />
                    Destek
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

        </div>
      </div>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="animate-fade-in border-t border-border bg-background p-4 lg:hidden">
          <nav className="flex flex-col gap-2">
            {navLinks.map((link) => {
              const Icon = link.icon;

              if (link.path === '/characters') {
                return (
                  <div
                    key={link.path}
                    ref={mobileCharactersMenuRef}
                    className={`overflow-hidden rounded-xl border transition-colors ${
                      isCharactersMobileMenuOpen
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Link
                        to={link.path}
                        onClick={handleMobileCharactersLinkClick}
                        onTouchStart={handleMobileCharactersLongPressStart}
                        onTouchEnd={handleMobileCharactersLongPressCancel}
                        onTouchCancel={handleMobileCharactersLongPressCancel}
                        onTouchMove={handleMobileCharactersLongPressCancel}
                        onContextMenu={(event) => event.preventDefault()}
                        className={`flex-1 rounded-l-xl px-4 py-3 text-sm font-medium transition-colors ${
                          isCharactersSectionActive
                            ? 'text-primary'
                            : 'hover:bg-secondary'
                        }`}
                      >
                        Karakterler
                      </Link>

                      <button
                        type="button"
                        onClick={toggleMobileCharactersMenu}
                        className={`mr-1 flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                          isCharactersMobileMenuOpen
                            ? 'bg-primary/12 text-primary'
                            : 'text-muted-foreground hover:bg-secondary'
                        }`}
                        aria-expanded={isCharactersMobileMenuOpen}
                        aria-label="Karakter alt menüsü"
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform duration-200 ${
                            isCharactersMobileMenuOpen ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                    </div>

                    {isCharactersMobileMenuOpen && (
                      <div className="space-y-1 border-t border-border/60 px-2 pb-2 pt-2">
                        {renderCharacterMenuLinks(() => {
                          setIsCharactersMobileMenuOpen(false);
                          setIsMenuOpen(false);
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setIsMenuOpen(false)}
                  className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                    link.featured
                      ? 'border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15'
                      : isActive(link.path)
                        ? 'bg-secondary text-foreground'
                        : 'hover:bg-secondary'
                  }`}
                >
                  {Icon && <Icon className="h-4 w-4" />}
                  {link.label}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                void handleRandomManga();
              }}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-left text-sm font-medium transition-colors hover:bg-secondary"
            >
              <Dices className="h-4 w-4 text-primary" />
              Zar At
            </button>
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
        <DialogContent className="w-[calc(100vw-1.25rem)] max-w-[calc(100vw-1.25rem)] overflow-hidden rounded-[2rem] border-primary/20 bg-card/95 p-0 backdrop-blur-xl sm:max-w-md sm:rounded-2xl">
          <DialogHeader className="border-b border-border/60 px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-[0.24em] text-primary/80">Rastgele Seri</span>
            </div>
            <DialogTitle className="pt-2 text-center text-[1.85rem] font-black leading-tight tracking-tight sm:text-left sm:text-2xl">
              Şansın Kimi Seçecek?
            </DialogTitle>
            <DialogDescription className="text-center text-sm leading-relaxed sm:text-left">
              Seri kartları slot gibi akıyor, seçilen manganın üstünde durunca sayfaya geçeceksin.
            </DialogDescription>
          </DialogHeader>

          <div className="relative px-4 py-4 sm:px-6 sm:py-6">
            <div className="pointer-events-none absolute inset-x-4 top-4 z-20 h-12 rounded-t-3xl bg-gradient-to-b from-card via-card/80 to-transparent sm:inset-x-6 sm:top-6 sm:h-16" />
            <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 h-12 rounded-b-3xl bg-gradient-to-t from-card via-card/80 to-transparent sm:inset-x-6 sm:bottom-6 sm:h-16" />
            <div className="pointer-events-none absolute inset-x-5 top-[calc(50%-20px)] z-20 h-[84px] -translate-y-1/2 rounded-[22px] border border-primary/30 bg-primary/10 shadow-[0_0_32px_rgba(59,130,246,0.18)] sm:inset-x-7 sm:h-[96px] sm:rounded-[26px] sm:shadow-[0_0_40px_rgba(59,130,246,0.18)]" />

            <div className="h-[272px] overflow-hidden rounded-[28px] border border-border/60 bg-background/70 sm:h-[312px] sm:rounded-[28px]">
              <div
                className="[--random-card-step:84px] px-3 py-[94px] sm:[--random-card-step:96px] sm:px-4 sm:py-[108px]"
                style={{
                  transform: `translateY(calc(-${randomSpinIndex} * var(--random-card-step)))`,
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
                        className={`flex h-[72px] items-center gap-3 rounded-[1.4rem] border px-3 transition-all sm:h-[84px] sm:gap-4 sm:rounded-2xl ${isActive ? 'border-primary/50 bg-primary/10 shadow-[0_0_24px_rgba(59,130,246,0.12)]' : 'border-border/50 bg-card/50 opacity-70'}`}
                      >
                        <img
                          src={manga.cover}
                          alt={manga.title}
                          className="h-14 w-10 rounded-lg object-cover shadow-md sm:h-16 sm:w-12 sm:rounded-xl"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold sm:text-sm">{manga.title}</p>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground sm:text-[11px]">
                            <span className="uppercase">{manga.type}</span>
                            <span className="h-1 w-1 rounded-full bg-border" />
                            <span className="truncate">{manga.author}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <p className="pt-3 text-center text-[11px] text-muted-foreground sm:pt-4 sm:text-xs">
              {isRandomRolling ? 'Karıştırılıyor...' : 'Seçim tamamlandı, seri açılıyor...'}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </header>
    </TooltipProvider>
  );
};

export default Header;
