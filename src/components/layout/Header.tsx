import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import InstallAppButton from '@/components/pwa/InstallAppButton';
import OptimizedImage from '@/components/media/OptimizedImage';
import {
  Search,
  Bell,
  Menu,
  Megaphone,
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
  Send,
  type LucideIcon,
} from 'lucide-react';
import { Artist, Author, Character, Manga } from '@/lib/types';
import { resolveDisplayImageUrl } from '@/lib/imageProxy';
import { Badge } from '@/components/ui/badge';
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
import { cn } from '@/lib/utils';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import { getMangaTypeLabel } from '@/lib/mangaType';
import {
  rankTopMangaMatches,
  takeTopEntityMatches,
} from '@/lib/searchMatching';
import { useHeaderShellSnapshot } from '@/hooks/useHeaderShellSnapshot';
import { useBootstrappedAppearancePreferences } from '@/hooks/useBootstrappedAppearancePreferences';
import { shouldRenderHeaderBootstrap } from '@/components/layout/HeaderBootstrapShell';
import { prefetchRouteForPathname } from '@/lib/routeModules';

const CHARACTER_MENU_LONG_PRESS_MS = 320;
const QUICK_SEARCH_DEBOUNCE_MS = 120;
const LIVE_SEARCH_CACHE_TTL_MS = 60_000;
const NotificationDropdown = lazy(() => import('@/components/notifications/NotificationDropdown'));
const AnnouncementDropdown = lazy(() => import('@/components/notifications/AnnouncementDropdown'));

type SearchDataModule = {
  getMangaSummaries: () => Promise<Manga[]>;
  getRandomMangaCandidates: (limit?: number) => Promise<Manga[]>;
  getCharacters: () => Promise<Character[]>;
  getAuthors: () => Promise<Author[]>;
  getArtists: () => Promise<Artist[]>;
  searchMangas: (query: string) => Promise<Manga[]>;
  subscribeMangaSummariesUpdated: (listener: (summaries: Manga[]) => void) => () => void;
};

let searchDataModulePromise: Promise<SearchDataModule> | null = null;

const loadSearchDataModule = () => {
  if (!searchDataModulePromise) {
    searchDataModulePromise = import('@/lib/database').then((module) => ({
      getMangaSummaries: module.getMangaSummaries,
      getRandomMangaCandidates: module.getRandomMangaCandidates,
      getCharacters: module.getCharacters,
      getAuthors: module.getAuthors,
      getArtists: module.getArtists,
      searchMangas: module.searchMangas,
      subscribeMangaSummariesUpdated: module.subscribeMangaSummariesUpdated,
    }));
  }

  return searchDataModulePromise;
};

const mergeMangasById = (existing: Manga[], incoming: Manga[]): Manga[] => {
  if (incoming.length === 0) {
    return existing;
  }

  const byId = new Map<string, Manga>();
  for (const item of existing) {
    if (item?.id) {
      byId.set(item.id, item);
    }
  }

  let changed = false;
  for (const item of incoming) {
    if (item?.id && !byId.has(item.id)) {
      byId.set(item.id, item);
      changed = true;
    }
  }

  return changed ? Array.from(byId.values()) : existing;
};

interface HeaderQuickSearchProps {
  isOnline: boolean;
  blurAdultArtworkEnabled: boolean;
  navigationKey: string;
}

const HeaderQuickSearch: React.FC<HeaderQuickSearchProps> = React.memo(({
  isOnline,
  blurAdultArtworkEnabled,
  navigationKey,
}) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [quickResults, setQuickResults] = useState<Manga[]>([]);
  const [quickCharacterResults, setQuickCharacterResults] = useState<Character[]>([]);
  const [quickAuthorResults, setQuickAuthorResults] = useState<Author[]>([]);
  const [quickArtistResults, setQuickArtistResults] = useState<Artist[]>([]);
  const [catalogRevision, setCatalogRevision] = useState(0);

  const allMangasRef = useRef<Manga[]>([]);
  const allCharactersRef = useRef<Character[]>([]);
  const allAuthorsRef = useRef<Author[]>([]);
  const allArtistsRef = useRef<Artist[]>([]);
  const searchQueryRef = useRef('');
  const mangaLoadPromiseRef = useRef<Promise<Manga[]> | null>(null);
  const secondaryLoadPromiseRef = useRef<Promise<void> | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const blurTimeoutRef = useRef<number | null>(null);
  const liveSearchSeqRef = useRef(0);
  const liveSearchCacheRef = useRef<Map<string, { fetchedAt: number; rows: Manga[] }>>(new Map());

  searchQueryRef.current = searchQuery;

  const shouldBlurAdultArtwork = (manga: Manga) => (
    blurAdultArtworkEnabled && manga.isAdult === true
  );

  const applyCatalogSnapshot = (nextMangas: Manga[]) => {
    if (nextMangas.length === 0) {
      return;
    }
    const prev = allMangasRef.current;
    if (prev !== nextMangas) {
      allMangasRef.current = nextMangas;
      if (searchQueryRef.current.trim().length > 1) {
        setCatalogRevision((rev) => rev + 1);
      }
    }
  };

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void loadSearchDataModule()
      .then((module) => {
        if (!active) return;
        unsubscribe = module.subscribeMangaSummariesUpdated((updated) => {
          if (active) {
            applyCatalogSnapshot(updated);
          }
        });
      })
      .catch(() => undefined);

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const ensureMangasLoaded = async () => {
    if (!isOnline) {
      return allMangasRef.current;
    }

    if (!mangaLoadPromiseRef.current) {
      mangaLoadPromiseRef.current = loadSearchDataModule()
        .then((module) => module.getMangaSummaries())
        .then((data) => {
          applyCatalogSnapshot(data);
          return data;
        })
        .catch((err) => {
          console.error('Quick search manga load failed:', err);
          return allMangasRef.current;
        })
        .finally(() => {
          mangaLoadPromiseRef.current = null;
        });
    }

    return mangaLoadPromiseRef.current;
  };

  const ensureSecondaryEntitiesLoaded = async () => {
    if (!isOnline) {
      return;
    }

    if (
      allCharactersRef.current.length > 0
      && allAuthorsRef.current.length > 0
      && allArtistsRef.current.length > 0
    ) {
      return;
    }

    if (!secondaryLoadPromiseRef.current) {
      secondaryLoadPromiseRef.current = loadSearchDataModule()
        .then(async (module) => {
          const [chars, authors, artists] = await Promise.all([
            allCharactersRef.current.length > 0 ? allCharactersRef.current : module.getCharacters(),
            allAuthorsRef.current.length > 0 ? allAuthorsRef.current : module.getAuthors(),
            allArtistsRef.current.length > 0 ? allArtistsRef.current : module.getArtists(),
          ]);
          allCharactersRef.current = chars;
          allAuthorsRef.current = authors;
          allArtistsRef.current = artists;
          if (searchQueryRef.current.trim().length > 1) {
            setCatalogRevision((rev) => rev + 1);
          }
        })
        .catch((err) => {
          console.error('Quick search secondary entities load failed:', err);
        })
        .finally(() => {
          secondaryLoadPromiseRef.current = null;
        });
    }

    return secondaryLoadPromiseRef.current;
  };

  const clearQuickSearch = () => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setSearchQuery('');
    setQuickResults((prev) => (prev.length === 0 ? prev : []));
    setQuickCharacterResults((prev) => (prev.length === 0 ? prev : []));
    setQuickAuthorResults((prev) => (prev.length === 0 ? prev : []));
    setQuickArtistResults((prev) => (prev.length === 0 ? prev : []));
    setIsSearchFocused(false);
  };

  useEffect(() => {
    clearQuickSearch();
  }, [navigationKey]);

  useEffect(() => () => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    if (blurTimeoutRef.current !== null) {
      window.clearTimeout(blurTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (trimmed.length <= 1) {
      setQuickResults((prev) => (prev.length === 0 ? prev : []));
      setQuickCharacterResults((prev) => (prev.length === 0 ? prev : []));
      setQuickAuthorResults((prev) => (prev.length === 0 ? prev : []));
      setQuickArtistResults((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const runFilter = () => {
      if (allMangasRef.current.length === 0) {
        void ensureMangasLoaded();
      }
      if (
        allCharactersRef.current.length === 0
        || allAuthorsRef.current.length === 0
        || allArtistsRef.current.length === 0
      ) {
        void ensureSecondaryEntitiesLoaded();
      }

      const mangaMatches = rankTopMangaMatches(allMangasRef.current, trimmed, 3);
      setQuickResults(mangaMatches);
      setQuickCharacterResults(takeTopEntityMatches(allCharactersRef.current, trimmed, 3));
      setQuickAuthorResults(takeTopEntityMatches(allAuthorsRef.current, trimmed, 3));
      setQuickArtistResults(takeTopEntityMatches(allArtistsRef.current, trimmed, 3));

      // Önbellek henüz yeni senkronize edilmiş seriyi içermiyorsa canlı aramadan tamamla.
      if (isOnline && mangaMatches.length < 3) {
        const cacheKey = trimmed.toLocaleLowerCase('tr-TR');
        const cachedLive = liveSearchCacheRef.current.get(cacheKey);
        if (cachedLive && Date.now() - cachedLive.fetchedAt < LIVE_SEARCH_CACHE_TTL_MS) {
          const merged = mergeMangasById(allMangasRef.current, cachedLive.rows);
          if (merged !== allMangasRef.current) {
            allMangasRef.current = merged;
            setQuickResults(rankTopMangaMatches(merged, trimmed, 3));
          }
          return;
        }

        const seq = ++liveSearchSeqRef.current;
        void loadSearchDataModule()
          .then((module) => module.searchMangas(trimmed))
          .then((remoteRows) => {
            if (seq !== liveSearchSeqRef.current) {
              return;
            }
            liveSearchCacheRef.current.set(cacheKey, {
              fetchedAt: Date.now(),
              rows: remoteRows,
            });
            const merged = mergeMangasById(allMangasRef.current, remoteRows);
            if (merged !== allMangasRef.current) {
              allMangasRef.current = merged;
            }
            if (searchQueryRef.current.trim() === trimmed) {
              setQuickResults(rankTopMangaMatches(allMangasRef.current, trimmed, 3));
            }
          })
          .catch(() => undefined);
      }
    };

    debounceTimerRef.current = window.setTimeout(runFilter, QUICK_SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [catalogRevision, isOnline, searchQuery]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/browse?search=${encodeURIComponent(searchQuery)}`);
      clearQuickSearch();
    }
  };

  const handleResultClick = (id: string) => {
    navigate(`/manga/${id}`);
    clearQuickSearch();
  };

  const handleEntityResultClick = (path: string) => {
    navigate(path);
    clearQuickSearch();
  };

  return (
    <form onSubmit={handleSearch} className="flex-1">
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Manga, karakter, yazar veya çizer ara..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => {
            if (blurTimeoutRef.current !== null) {
              window.clearTimeout(blurTimeoutRef.current);
              blurTimeoutRef.current = null;
            }
            setIsSearchFocused(true);
            void ensureMangasLoaded();
          }}
          onBlur={() => {
            blurTimeoutRef.current = window.setTimeout(() => setIsSearchFocused(false), 180);
          }}
          className="w-full pl-10"
        />
        {/* Quick Search Dropdown */}
        {isSearchFocused && (
          quickResults.length > 0
          || quickCharacterResults.length > 0
          || quickAuthorResults.length > 0
          || quickArtistResults.length > 0
        ) && (
          <div className="absolute top-full left-0 right-0 mt-2 overflow-hidden rounded-xl border border-border bg-background/95 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-2">
              {quickResults.length > 0 && (
                <>
                  <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Seriler</p>
                  <div className="mt-1 space-y-1">
                    {quickResults.map((manga) => (
                      <button
                        key={manga.id}
                        type="button"
                        onClick={() => handleResultClick(manga.id)}
                        className="flex w-full items-center gap-3 rounded-lg p-2 transition-colors hover:bg-secondary/80 text-left group"
                      >
                        <img
                          src={manga.cover}
                          alt={manga.title}
                          loading="lazy"
                          decoding="async"
                          className={cn(
                            'h-12 w-9 rounded object-cover shadow-sm transition-transform group-hover:scale-105',
                            shouldBlurAdultArtwork(manga) && 'scale-[1.03] blur-sm',
                          )}
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{manga.title}</h4>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-muted-foreground">{getMangaTypeLabel(manga.type)}</span>
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
                        type="button"
                        onClick={() => handleEntityResultClick(`/character/${char.id}`)}
                        className="flex w-full items-center gap-3 rounded-lg p-2 transition-colors hover:bg-secondary/80 text-left group"
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={resolveDisplayImageUrl(char.imageUrl)} />
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

              {quickAuthorResults.length > 0 && (
                <div className="mt-3">
                  <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-t border-border pt-2">Yazarlar</p>
                  <div className="mt-1 space-y-1">
                    {quickAuthorResults.map((author) => (
                      <button
                        key={author.id}
                        type="button"
                        onClick={() => handleEntityResultClick(`/author/${author.id}`)}
                        className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-secondary/80 group"
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={resolveDisplayImageUrl(author.imageUrl)} />
                          <AvatarFallback className="text-[10px]">{author.name[0]}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-sm font-semibold transition-colors group-hover:text-primary">{author.name}</h4>
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Book className="h-2.5 w-2.5 text-primary" />
                            <span>Yazar</span>
                            <span className="h-1 w-1 rounded-full bg-border" />
                            <Heart className="h-2 w-2 fill-primary text-primary" />
                            <span>{author.likesCount} beğeni</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {quickArtistResults.length > 0 && (
                <div className="mt-3">
                  <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-t border-border pt-2">Çizerler</p>
                  <div className="mt-1 space-y-1">
                    {quickArtistResults.map((artist) => (
                      <button
                        key={artist.id}
                        type="button"
                        onClick={() => handleEntityResultClick(`/artist/${artist.id}`)}
                        className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-secondary/80 group"
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={resolveDisplayImageUrl(artist.imageUrl)} />
                          <AvatarFallback className="text-[10px]">{artist.name[0]}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-sm font-semibold transition-colors group-hover:text-primary">{artist.name}</h4>
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Sparkles className="h-2.5 w-2.5 text-primary" />
                            <span>Çizer</span>
                            <span className="h-1 w-1 rounded-full bg-border" />
                            <Heart className="h-2 w-2 fill-primary text-primary" />
                            <span>{artist.likesCount} beğeni</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-2 border-t border-border pt-1">
                <button
                  type="submit"
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
  );
});

HeaderQuickSearch.displayName = 'HeaderQuickSearch';

const HeaderCounterShell = ({
  icon: Icon,
  iconClassName,
  unreadCount,
}: {
  icon: LucideIcon;
  iconClassName?: string;
  unreadCount: number;
}) => (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    className="relative h-9 w-9 rounded-full text-muted-foreground hover:bg-secondary/80"
    aria-hidden
    tabIndex={-1}
  >
    <Icon className={`h-5 w-5 ${iconClassName || ''}`.trim()} />
    {unreadCount > 0 ? (
      <Badge
        variant="destructive"
        className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center p-0 text-[10px] font-bold"
      >
        {unreadCount > 99 ? '99+' : unreadCount}
      </Badge>
    ) : null}
  </Button>
);

export const GlobalHeaderEnabledContext = React.createContext(false);

const characterMenuItems = [
  {
    path: '/characters',
    label: 'Karakterler',
  },
  {
    path: '/authors',
    label: 'Yazarlar',
  },
  {
    path: '/artists',
    label: 'Çizerler',
  },
];

interface HeaderProps {
  persistent?: boolean;
}

const HeaderContent: React.FC = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { user, logout, isLoading: authLoading } = useAuth();
  const { access } = useAdminAccess({
    enabled: Boolean(user && (user.role === 'admin' || user.role === 'moderator')),
  });
  const { preferences: offlinePreferences, updatePreferences: updateOfflinePreferences } = useOfflinePreferences();
  const { isOnline } = useEffectiveOnlineStatus();
  const { snapshot } = useOfflineLibrary();
  const headerShellSnapshot = useHeaderShellSnapshot();
  const navigate = useNavigate();
  const location = useLocation();
  const shellUser = authLoading && !user ? headerShellSnapshot?.user ?? null : null;
  const displayUser = user ?? shellUser;
  const appearancePreferences = useBootstrappedAppearancePreferences({ user, authLoading });
  const blurAdultArtworkEnabled = Boolean(
    appearancePreferences.adult_cover_blur
    && user?.preferences?.content?.adult_mode === true,
  );
  const isAdmin = Boolean(displayUser && access?.canAccessAdminPanel);
  const showHeaderOfflineToggle = appearancePreferences.show_header_offline_toggle;
  const canUseCachedHeaderCounts = Boolean(displayUser && headerShellSnapshot?.user?.id === displayUser.id);
  const cachedAnnouncementCount = canUseCachedHeaderCounts ? headerShellSnapshot?.unreadAnnouncementCount || 0 : 0;
  const cachedNotificationCount = canUseCachedHeaderCounts ? headerShellSnapshot?.unreadNotificationCount || 0 : 0;
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
  const randomLoadInFlightRef = useRef(false);

  const isActive = (path: string) =>
    path === '/community'
      ? location.pathname === '/community' || location.pathname.startsWith('/community/')
      : location.pathname === path;
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
    ...(!authLoading && !displayUser ? [{ path: '/support', label: 'Destek', icon: LifeBuoy }] : []),
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
            className={`block rounded-xl px-4 py-2.5 transition-colors ${
              isItemActive
                ? 'bg-primary/12 text-primary'
                : 'text-foreground hover:bg-secondary/80'
            }`}
          >
            <p className="text-sm font-semibold">{item.label}</p>
          </Link>
        );
      })}
    </>
  );

  useEffect(() => {
    closeCharacterMenus();
    setIsMenuOpen(false);
    setIsRandomDialogOpen(false);
    setIsRandomRolling(false);
  }, [location.pathname, location.search]);

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
    const pool = [...mangas];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const selectedManga = pool[Math.floor(Math.random() * pool.length)];
    const fillerPool = pool.filter((manga) => manga.id !== selectedManga.id);
    const fillers = Array.from({ length: 10 }).map(
      (_, index) => fillerPool[index % Math.max(1, fillerPool.length)] || selectedManga,
    );

    return [...fillers, selectedManga];
  };

  const preloadRandomCovers = (queue: Manga[]) => {
    if (typeof window === 'undefined') {
      return;
    }
    const seen = new Set<string>();
    for (const item of queue) {
      const url = resolveDisplayImageUrl(item.cover);
      if (!url || seen.has(url)) {
        continue;
      }
      seen.add(url);
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
    }
  };

  const handleRandomManga = async () => {
    try {
      if (isRandomRolling || randomLoadInFlightRef.current) {
        return;
      }

      let mangas: Manga[] = [];
      if (!isOnline) {
        mangas = snapshot.series.map(({ manga }) => ({
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
      } else {
        randomLoadInFlightRef.current = true;
        try {
          const module = await loadSearchDataModule();
          mangas = await module.getRandomMangaCandidates(36);
        } finally {
          randomLoadInFlightRef.current = false;
        }
      }

      if (mangas && mangas.length > 0) {
        const queue = buildRandomQueue(mangas);
        preloadRandomCovers(queue);
        setRandomQueue(queue);
        setRandomSpinIndex(0);
        setRandomTransitionMs(85);
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
    <header
      className={`fixed top-0 left-0 right-0 z-50 border-b border-border/50 ${disableHeavyEffects ? 'bg-background/95' : 'bg-background/80 backdrop-blur-xl'}`}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="container flex h-14 items-center justify-between gap-4">
        {/* Logo */}
        <Link
          to="/"
          className="-ml-2 flex items-center gap-2 md:-ml-3"
        >
                <img src="/logo.webp" alt="Logo" className="h-9 sm:h-10 w-auto object-contain" decoding="async" />
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden items-center gap-5 lg:flex">
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
                    onPointerEnter={() => prefetchRouteForPathname(link.path)}
                    onFocus={() => prefetchRouteForPathname(link.path)}
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
                    className={`absolute left-1/2 top-full z-50 w-[14rem] -translate-x-1/2 pt-2 transition-all duration-150 ${
                      isCharactersDesktopMenuOpen
                        ? 'pointer-events-auto translate-y-0 opacity-100'
                        : 'pointer-events-none -translate-y-1 opacity-0'
                    }`}
                  >
                    <div className="rounded-2xl border border-border/70 bg-background/95 p-2 shadow-2xl backdrop-blur-xl">
                      <div className="space-y-1">
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
                onPointerEnter={() => prefetchRouteForPathname(link.path)}
                onFocus={() => prefetchRouteForPathname(link.path)}
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

          <HeaderQuickSearch
            isOnline={isOnline}
            blurAdultArtworkEnabled={blurAdultArtworkEnabled}
            navigationKey={`${location.pathname}${location.search}`}
          />
        </div>

        {/* User Actions */}
        <div className="flex items-center gap-2">
          {/* Admin Link */}
          {isAdmin && displayUser && (
            <Button asChild variant="ghost" size="sm" className="hidden md:flex">
              <Link to="/admin">
                <Shield className="mr-2 h-4 w-4" />
                Admin
              </Link>
            </Button>
          )}

          {/* Notifications */}
          <div className="flex items-center gap-1">
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
            {displayUser ? (
              <Suspense
                fallback={(
                  <>
                    <HeaderCounterShell
                      icon={Megaphone}
                      iconClassName="text-amber-500"
                      unreadCount={cachedAnnouncementCount}
                    />
                    <HeaderCounterShell
                      icon={Bell}
                      unreadCount={cachedNotificationCount}
                    />
                  </>
                )}
              >
                <AnnouncementDropdown userId={displayUser.id} />
                <NotificationDropdown userId={displayUser.id} />
              </Suspense>
            ) : null}
          </div>

          {displayUser ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 p-0 rounded-full hover:bg-secondary/80">
                  <Avatar className="h-8 w-8 border border-border/50">
                    <AvatarImage src={displayUser.avatar} />
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {displayUser.username[0]?.toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                </Button>

              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{displayUser.username}</p>
                  <p className="text-xs text-muted-foreground">{displayUser.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to={`/profile/${displayUser.id}`} className="flex items-center gap-2">
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
                  <Link to="/series-requests" className="flex items-center gap-2">
                    <Send className="h-4 w-4" />
                    Seri İstekleri
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
                {user ? (
                  <DropdownMenuItem onClick={logout} className="text-destructive">
                    <LogOut className="mr-2 h-4 w-4" />
                    Çıkış Yap
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled>
                    <Clock3 className="mr-2 h-4 w-4" />
                    Hesap hazırlanıyor
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : authLoading ? (
            <div className="flex items-center gap-2">
              <Skeleton className="hidden h-9 w-20 rounded-md md:block" />
              <Skeleton className="h-9 w-9 rounded-full" />
            </div>
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
                        onPointerEnter={() => prefetchRouteForPathname(link.path)}
                        onFocus={() => prefetchRouteForPathname(link.path)}
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
                  onPointerEnter={() => prefetchRouteForPathname(link.path)}
                  onFocus={() => prefetchRouteForPathname(link.path)}
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
        <DialogContent className="flex w-[calc(100vw-1.5rem)] max-w-md flex-col gap-0 overflow-hidden rounded-2xl border border-border/70 bg-card p-0 shadow-2xl">
          <DialogHeader className="min-w-0 w-full border-b border-border/60 px-5 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-base font-bold tracking-tight text-foreground">
              <Dices className="h-4 w-4 shrink-0 text-primary" />
              <span>Rastgele Seri</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Rastgele seri seçiliyor
            </DialogDescription>
          </DialogHeader>

          <div className="min-w-0 w-full p-4 sm:p-5">
            <div className="relative h-[264px] w-full overflow-hidden rounded-xl border border-border/60 bg-background/70 sm:h-[300px]">
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-14 bg-gradient-to-b from-background via-background/70 to-transparent sm:h-16" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-14 bg-gradient-to-t from-background via-background/70 to-transparent sm:h-16" />

              <div
                className="w-full min-w-0 [--random-card-step:84px] px-3 py-[95px] sm:[--random-card-step:96px] sm:px-3.5 sm:py-[107px]"
                style={{
                  transform: `translate3d(0, calc(-${randomSpinIndex} * var(--random-card-step)), 0)`,
                  transitionProperty: 'transform',
                  transitionDuration: `${randomTransitionMs}ms`,
                  transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
                  willChange: 'transform',
                }}
              >
                <div className="min-w-0 w-full space-y-3">
                  {randomQueue.map((manga, index) => {
                    const isActive = index === randomSpinIndex;
                    const authorText = manga.author && manga.author.trim() && manga.author.trim().toLowerCase() !== 'bilinmiyor'
                      ? manga.author.trim()
                      : null;

                    return (
                      <div
                        key={`${manga.id}-${index}`}
                        className={cn(
                          'flex h-[72px] w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl border px-2.5 transition-colors duration-150 sm:h-[84px] sm:gap-3.5 sm:px-3',
                          isActive
                            ? 'border-primary/60 bg-primary/10 text-foreground'
                            : 'border-border/40 bg-card/60 opacity-65',
                        )}
                      >
                        <OptimizedImage
                          priority
                          allowProxy
                          src={manga.cover}
                          alt={manga.title}
                          transform={{ width: 96, quality: 75 }}
                          containerClassName="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-secondary sm:h-16 sm:w-12"
                          className="h-full w-full object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold leading-snug sm:text-sm">
                            {manga.title}
                          </p>
                          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="shrink-0 font-medium uppercase tracking-wide">
                              {getMangaTypeLabel(manga.type)}
                            </span>
                            {authorText && (
                              <>
                                <span className="h-1 w-1 shrink-0 rounded-full bg-border" />
                                <span className="truncate">{authorText}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </header>
    </TooltipProvider>
  );
};

const Header: React.FC<HeaderProps> = ({ persistent = false }) => {
  const location = useLocation();
  const globalHeaderEnabled = React.useContext(GlobalHeaderEnabledContext);
  if (!persistent && globalHeaderEnabled && shouldRenderHeaderBootstrap(location.pathname)) {
    return null;
  }

  return <HeaderContent />;
};

export default Header;
