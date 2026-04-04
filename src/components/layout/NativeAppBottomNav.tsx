import { BookOpenText, Compass, House, Library, LogIn, UserRound, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

const HIDDEN_NATIVE_APP_NAV_PATTERN = /^\/(?:auth|admin(?:\/|$)|manga\/[^/]+\/chapter\/[^/]+$)/;

export const NATIVE_APP_BOTTOM_OFFSET = 'calc(5.5rem + env(safe-area-inset-bottom))';

export const shouldRenderNativeAppBottomNav = (pathname: string) => !HIDDEN_NATIVE_APP_NAV_PATTERN.test(pathname);

interface NativeNavItem {
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
  label: string;
  path: string;
}

const isBrowsePath = (pathname: string) => (
  pathname === '/browse'
  || pathname === '/top-ten'
  || pathname === '/community'
  || pathname === '/characters'
  || pathname === '/authors'
  || pathname === '/artists'
  || pathname.startsWith('/manga/')
  || pathname.startsWith('/character/')
  || pathname.startsWith('/author/')
  || pathname.startsWith('/artist/')
);

const isLibraryPath = (pathname: string) => (
  pathname === '/library'
  || pathname === '/favorites'
  || pathname === '/history'
  || pathname === '/bookmarks'
  || pathname === '/downloads'
  || pathname === '/reading-lists'
  || pathname === '/reading-time'
  || pathname.startsWith('/reading-lists/')
  || pathname.startsWith('/reading-time/')
  || pathname.startsWith('/tier-lists')
);

const isProfilePath = (pathname: string) => (
  pathname.startsWith('/profile/')
  || pathname === '/notifications'
  || pathname === '/announcements'
  || pathname === '/settings'
  || pathname === '/support'
  || pathname === '/auth'
);

const NativeAppBottomNav = () => {
  const location = useLocation();
  const { user } = useAuth();
  const profilePath = user ? `/profile/${user.id}` : '/auth';

  const navItems: NativeNavItem[] = [
    {
      path: '/',
      label: 'Ana Sayfa',
      icon: House,
      isActive: (pathname) => pathname === '/',
    },
    {
      path: '/browse',
      label: 'Keşfet',
      icon: Compass,
      isActive: isBrowsePath,
    },
    {
      path: '/latest-chapters',
      label: 'Bölümler',
      icon: BookOpenText,
      isActive: (pathname) => pathname === '/latest-chapters',
    },
    {
      path: '/library',
      label: 'Kütüphane',
      icon: Library,
      isActive: isLibraryPath,
    },
    {
      path: profilePath,
      label: user ? 'Profil' : 'Giriş',
      icon: user ? UserRound : LogIn,
      isActive: isProfilePath,
    },
  ];

  if (!shouldRenderNativeAppBottomNav(location.pathname)) {
    return null;
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[linear-gradient(180deg,rgba(6,10,18,0.9),rgba(4,8,16,0.98))] px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur-2xl"
      aria-label="Mobil uygulama gezinmesi"
    >
      <div className="mx-auto grid max-w-2xl grid-cols-5 gap-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.isActive(location.pathname);

          return (
            <Link
              key={item.label}
              to={item.path}
              className={cn(
                'flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2.5 text-[11px] font-semibold transition-all duration-200',
                isActive
                  ? 'bg-primary/14 text-primary shadow-[0_12px_28px_-18px_rgba(59,130,246,0.7)]'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
              )}
            >
              <Icon className={cn('h-4 w-4', isActive && 'scale-105')} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default NativeAppBottomNav;
