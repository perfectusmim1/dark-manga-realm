import React from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  ChevronRight,
  Flag,
  Lock,
  MoreHorizontal,
  Pencil,
  Settings,
  ShieldAlert,
  ShieldCheck,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import StaffBadge from '@/components/user/StaffBadge';
import { ACHIEVEMENTS } from '@/lib/achievements';
import type { ProfileFollowerPreview } from '@/lib/profile';
import { getStaffTextClassName } from '@/lib/staffRoles';
import type { User } from '@/lib/types';
import { cn } from '@/lib/utils';

export type ProfileTabKey =
  | 'wall'
  | 'library'
  | 'lists'
  | 'comments'
  | 'reviews'
  | 'forum'
  | 'stats';

export interface ProfileNavItem {
  id: ProfileTabKey;
  label: string;
  count?: number;
  icon: React.ComponentType<{ className?: string }>;
}

interface ProfileSidebarProps {
  profile: {
    id: string;
    username: string;
    avatar?: string | null;
    role?: User['role'];
    created_at: string;
    bio: string;
    bannerUrl: string;
    stats: {
      totalChapters: number;
      followersCount: number;
      followingCount: number;
    };
    relationship: {
      isFollowing: boolean;
      isBlocked: boolean;
    };
  };
  completedSeriesCount: number;
  readingDaysCount: number;
  followerPreviews: ProfileFollowerPreview[];
  achievements: Array<{ achievementId: string; progress: number; unlockedAt: string }>;
  isOwnProfile: boolean;
  canViewReadingStats: boolean;
  followLoading: boolean;
  navItems: ProfileNavItem[];
  activeTab: ProfileTabKey;
  onTabChange: (tab: ProfileTabKey) => void;
  onToggleFollow: () => void;
  onOpenFollowModal: (type: 'followers' | 'following') => void;
  onOpenEditCustomization: () => void;
  onOpenBlockConfirm: () => void;
  onOpenReport: () => void;
}

const getJoinedDaysCount = (createdAt: string): number => {
  const createdMs = new Date(createdAt).getTime();
  if (Number.isNaN(createdMs)) return 1;
  return Math.max(1, Math.floor((Date.now() - createdMs) / 86_400_000));
};

/**
 * Sticky editorial profile sidebar with banner/bio, action controls, follower stack,
 * compact reading summary, and section navigation.
 */
const ProfileSidebar: React.FC<ProfileSidebarProps> = ({
  profile,
  completedSeriesCount,
  readingDaysCount,
  followerPreviews,
  achievements,
  isOwnProfile,
  canViewReadingStats,
  followLoading,
  navItems,
  activeTab,
  onTabChange,
  onToggleFollow,
  onOpenFollowModal,
  onOpenEditCustomization,
  onOpenBlockConfirm,
  onOpenReport,
}) => {
  const joinedDays = getJoinedDaysCount(profile.created_at);
  const firstFollowerName = followerPreviews[0]?.username;
  const remainingFollowers = Math.max(0, profile.stats.followersCount - 1);

  return (
    <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
      <div className="overflow-hidden rounded-xl border border-border/80 bg-card/85 shadow-sm">
        {/* Banner */}
        <div className="relative h-24 w-full overflow-hidden bg-gradient-to-br from-primary/25 via-primary/10 to-secondary/50">
          {profile.bannerUrl ? (
            <img
              src={profile.bannerUrl}
              alt={`${profile.username} kapak görseli`}
              className="h-full w-full object-cover"
              loading="eager"
              decoding="async"
            />
          ) : null}
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card/90 to-transparent" />
        </div>

        <div className="px-4 pb-4">
          {/* Avatar + Primary Action */}
          <div className="-mt-9 flex items-end justify-between gap-2">
            <Avatar className="h-[72px] w-[72px] shrink-0 border-[3px] border-card bg-background shadow-md">
              <AvatarImage src={profile.avatar || undefined} alt={profile.username} />
              <AvatarFallback className="bg-primary/15 text-xl font-bold text-primary">
                {(profile.username || 'U').slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="flex items-center gap-1.5 pb-0.5">
              {isOwnProfile ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={onOpenEditCustomization}
                    className="h-8 rounded-full px-3 text-xs font-medium"
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Düzenle
                  </Button>
                  <Button
                    asChild
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 rounded-full"
                    title="Hesap ve Gizlilik Ayarları"
                    aria-label="Hesap ve Gizlilik Ayarları"
                  >
                    <Link to="/settings">
                      <Settings className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant={profile.relationship.isFollowing ? 'outline' : 'default'}
                    onClick={onToggleFollow}
                    disabled={followLoading}
                    className={cn(
                      'h-8 rounded-full px-3.5 text-xs font-semibold',
                      !profile.relationship.isFollowing && 'bg-foreground text-background hover:bg-foreground/90',
                    )}
                  >
                    {profile.relationship.isFollowing ? (
                      <>
                        <UserMinus className="mr-1.5 h-3.5 w-3.5" />
                        Takipten Çık
                      </>
                    ) : (
                      <>
                        <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                        Takip Et
                      </>
                    )}
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-8 w-8 rounded-full"
                        aria-label="Kullanıcı işlemleri"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={onOpenBlockConfirm}>
                        {profile.relationship.isBlocked ? (
                          <>
                            <ShieldCheck className="mr-2 h-4 w-4 text-emerald-500" />
                            Engeli Kaldır
                          </>
                        ) : (
                          <>
                            <ShieldAlert className="mr-2 h-4 w-4 text-rose-500" />
                            Kullanıcıyı Engelle
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={onOpenReport}>
                        <Flag className="mr-2 h-4 w-4" />
                        Kullanıcıyı Bildir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          </div>

          {/* Username, Role & Unlocked Achievement Chips */}
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <h1
                className={cn(
                  'truncate text-lg font-bold tracking-tight',
                  getStaffTextClassName(profile.role),
                )}
              >
                {profile.username}
              </h1>
              <StaffBadge role={profile.role} compact />
            </div>

            {achievements.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {achievements.map((entry) => {
                  const cfg = ACHIEVEMENTS[entry.achievementId];
                  if (!cfg) return null;
                  const Icon = cfg.icon;
                  return (
                    <span
                      key={entry.achievementId}
                      title={cfg.description}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-[11px] font-medium',
                        cfg.bgColor,
                        cfg.color,
                      )}
                    >
                      <Icon className="h-3 w-3 shrink-0" />
                      <span>{cfg.title}</span>
                    </span>
                  );
                })}
              </div>
            )}

            {profile.bio ? (
              <p className="mt-2.5 whitespace-pre-line break-words text-xs leading-relaxed text-muted-foreground sm:text-sm">
                {profile.bio}
              </p>
            ) : isOwnProfile ? (
              <button
                type="button"
                onClick={onOpenEditCustomization}
                className="mt-2 text-xs text-muted-foreground/80 underline-offset-4 hover:text-primary hover:underline"
              >
                Profil açıklaması ekle...
              </button>
            ) : null}

            {profile.relationship.isBlocked && (
              <p className="mt-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-400">
                Bu kullanıcıyı engellediniz.
              </p>
            )}
          </div>

          {/* Follower & Following Stack Strip */}
          <div className="mt-3.5 rounded-lg border border-border/70 bg-secondary/35 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onOpenFollowModal('followers')}
                className="flex min-w-0 items-center gap-2 text-left transition-colors hover:text-primary"
              >
                {followerPreviews.length > 0 && (
                  <div className="flex -space-x-1.5 shrink-0">
                    {followerPreviews.slice(0, 3).map((follower) => (
                      <Avatar
                        key={follower.id}
                        className="h-5 w-5 border border-card bg-muted"
                      >
                        <AvatarImage src={follower.avatar || undefined} alt={follower.username} />
                        <AvatarFallback className="text-[9px] font-bold">
                          {(follower.username || 'U').slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                  </div>
                )}
                <div className="min-w-0 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold tabular-nums text-foreground">
                      {profile.stats.followersCount}
                    </span>
                    <span className="text-muted-foreground">takipçi</span>
                  </div>
                  {firstFollowerName && (
                    <p className="truncate text-[11px] text-muted-foreground">
                      {firstFollowerName}
                      {remainingFollowers > 0 ? ` ve ${remainingFollowers} kişi daha` : ''}
                    </p>
                  )}
                </div>
              </button>

              <button
                type="button"
                onClick={() => onOpenFollowModal('following')}
                className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <span className="font-bold tabular-nums text-foreground">
                  {profile.stats.followingCount}
                </span>
                <span>takip</span>
                <ChevronRight className="h-3.5 w-3.5 opacity-60" />
              </button>
            </div>
          </div>

          {/* Compact Reading Metrics Box */}
          <div className="mt-2.5 rounded-lg border border-border/70 bg-secondary/35 p-2.5">
            {canViewReadingStats ? (
              <div className="grid grid-cols-3 divide-x divide-border/60 text-center">
                <div className="px-1">
                  <p className="text-sm font-bold tabular-nums text-foreground">
                    {profile.stats.totalChapters.toLocaleString('tr-TR')}
                  </p>
                  <p className="text-[11px] text-muted-foreground">bölüm</p>
                </div>
                <div className="px-1">
                  <p className="text-sm font-bold tabular-nums text-foreground">
                    {completedSeriesCount.toLocaleString('tr-TR')}
                  </p>
                  <p className="text-[11px] text-muted-foreground">seri bitti</p>
                </div>
                <div className="px-1">
                  <p className="text-sm font-bold tabular-nums text-foreground">
                    {readingDaysCount.toLocaleString('tr-TR')}
                  </p>
                  <p className="text-[11px] text-muted-foreground">gün</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-1.5 py-1 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" />
                <span>Okuma istatistikleri gizli</span>
              </div>
            )}
          </div>

          {/* Join Duration */}
          <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            <span>{joinedDays.toLocaleString('tr-TR')} gündür ToonParrot&apos;ta</span>
          </div>
        </div>
      </div>

      {/* Desktop Vertical Section Navigation */}
      <nav
        aria-label="Profil bölümleri"
        className="hidden rounded-xl border border-border/80 bg-card/75 p-1.5 lg:block"
      >
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
                  )}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {typeof item.count === 'number' && (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                        isActive
                          ? 'bg-background/15 text-background'
                          : 'bg-secondary text-muted-foreground',
                      )}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
};

export default ProfileSidebar;
