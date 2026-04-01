import { Bell, Megaphone, Menu, Search, Shield, Star, Users, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useHeaderShellSnapshot } from '@/hooks/useHeaderShellSnapshot';

const HEADERLESS_ROUTE_PATTERN = /^\/(?:auth|admin(?:\/|$)|manga\/[^/]+\/chapter\/[^/]+$)/;

const navLinks = [
  { path: '/top-ten', label: 'Top 10', icon: Star, featured: true },
  { path: '/browse', label: 'Keşfet' },
  { path: '/latest-chapters', label: 'Son Bölümler' },
  { path: '/characters', label: 'Karakterler' },
  { path: '/community', label: 'Topluluk', icon: Users },
];

const HeaderIndicatorShell = ({
  count,
  colorClassName,
  icon: Icon,
}: {
  count: number;
  colorClassName?: string;
  icon: LucideIcon;
}) => (
  <div className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground">
    <Icon className={`h-5 w-5 ${colorClassName || ''}`.trim()} />
    {count > 0 ? (
      <Badge
        variant="destructive"
        className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center p-0 text-[10px] font-bold"
      >
        {count > 99 ? '99+' : count}
      </Badge>
    ) : null}
  </div>
);

export const shouldRenderHeaderBootstrap = (pathname: string) => !HEADERLESS_ROUTE_PATTERN.test(pathname);

const HeaderBootstrapShell = () => {
  const location = useLocation();
  const headerShellSnapshot = useHeaderShellSnapshot();
  const headerUser = headerShellSnapshot?.user || null;
  const isAdmin = headerUser?.role === 'admin';
  const showHeaderSearch = headerUser?.preferences?.appearance?.show_header_search_bar ?? true;

  if (!shouldRenderHeaderBootstrap(location.pathname)) {
    return null;
  }

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-border/50 bg-background/90 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link to="/" className="-ml-2 flex items-center gap-2 md:-ml-3">
          <img src="/logo.webp" alt="Logo" className="h-12 w-auto object-contain" decoding="async" />
        </Link>

        <nav className="hidden items-center gap-6 lg:flex">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive = link.path === '/characters'
              ? (
                location.pathname === '/characters'
                || location.pathname === '/authors'
                || location.pathname === '/artists'
                || location.pathname.startsWith('/character/')
                || location.pathname.startsWith('/author/')
                || location.pathname.startsWith('/artist/')
              )
              : location.pathname === link.path;

            return (
              <Link
                key={link.path}
                to={link.path}
                className={
                  link.featured
                    ? `inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors ${
                      isActive
                        ? 'border-primary/40 bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                        : 'border-primary/20 bg-primary/10 text-primary hover:border-primary/40 hover:bg-primary/15'
                    }`
                    : `flex items-center gap-1.5 text-sm font-medium transition-colors ${
                      isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                    }`
                }
              >
                {Icon ? <Icon className="h-4 w-4" /> : null}
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden max-w-md flex-1 items-center gap-2 md:flex">
          <div className="relative flex-1">
            <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 pl-10 text-sm text-muted-foreground">
              Manga, karakter, yazar veya çizer ara...
            </div>
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin ? (
            <div className="hidden items-center rounded-md px-3 py-2 text-sm font-medium text-foreground/80 md:flex">
              <Shield className="mr-2 h-4 w-4" />
              Admin
            </div>
          ) : null}

          <div className="flex items-center gap-1">
            {showHeaderSearch ? (
              <div className="hidden md:block">
                <div className="flex h-9 items-center rounded-full border border-border/60 bg-background/70 px-3 text-sm text-muted-foreground">
                  <Search className="mr-2 h-4 w-4" />
                  <span className="max-w-[15rem] truncate">Manga, karakter, yazar veya çizer ara...</span>
                </div>
              </div>
            ) : null}

            <Button variant="ghost" size="icon" className="h-9 w-9 md:hidden" aria-label="Gezinti menüsü">
              <Menu className="h-5 w-5" />
            </Button>

            <HeaderIndicatorShell
              count={headerShellSnapshot?.unreadAnnouncementCount || 0}
              colorClassName="text-amber-500"
              icon={Megaphone}
            />
            <HeaderIndicatorShell
              count={headerShellSnapshot?.unreadNotificationCount || 0}
              icon={Bell}
            />
          </div>

          <div className="flex h-9 w-9 items-center justify-center rounded-full">
            {headerUser ? (
              <Avatar className="h-8 w-8 border border-border/50">
                <AvatarImage src={headerUser.avatar} />
                <AvatarFallback className="bg-primary/10 text-xs text-primary">
                  {headerUser.username[0]?.toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
            ) : (
              <div className="h-9 w-9 rounded-full bg-secondary/80" />
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default HeaderBootstrapShell;
