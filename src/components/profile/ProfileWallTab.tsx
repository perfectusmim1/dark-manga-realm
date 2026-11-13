import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { BookOpen, Loader2, Play, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { RichTextToolbar } from '@/components/common/RichTextToolbar';
import { SeriesTagPopover } from '@/components/common/SeriesTagPopover';
import StaffBadge from '@/components/user/StaffBadge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSeriesMention } from '@/hooks/useSeriesMention';
import { getMangaTypeLabel } from '@/lib/mangaType';
import {
  createProfileWallPost,
  deleteProfileWallPost,
  type ProfileWallPost,
} from '@/lib/profile';
import { renderRichContent } from '@/lib/richTextRender';
import { getStaffTextClassName } from '@/lib/staffRoles';
import type { User } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface ProfileReadingHistoryEntry {
  id?: string;
  mangaId: string;
  mangaTitle: string;
  mangaCover?: string | null;
  mangaType?: string | null;
  mangaStatus?: string | null;
  chapterNumber: number;
  lastRead: string;
}

interface ProfileWallTabProps {
  profileId: string;
  profileUsername: string;
  profileAvatar?: string | null;
  profileRole?: User['role'];
  wallPosts: ProfileWallPost[];
  readingHistory: ProfileReadingHistoryEntry[];
  canViewHistory: boolean;
  includeAdult: boolean;
  currentUser: User | null;
  isBlockedUser: boolean;
  onPostCreated: (post: ProfileWallPost) => void;
  onPostDeleted: (postId: string) => void;
}

type WallFilter = 'all' | 'posts' | 'activity';

type TimelineItem =
  | { kind: 'post'; sortTime: number; post: ProfileWallPost }
  | { kind: 'activity'; sortTime: number; item: ProfileReadingHistoryEntry };

const formatRelative = (isoDate: string): string => {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatDistanceToNow(parsed, { addSuffix: true, locale: tr });
};

/**
 * Profile `Duvar` timeline blending user wall notes (with `#` series tagging and rich formatting)
 * and chronological reading activity updates.
 */
const ProfileWallTab: React.FC<ProfileWallTabProps> = ({
  profileId,
  profileUsername,
  profileAvatar,
  profileRole,
  wallPosts,
  readingHistory,
  canViewHistory,
  includeAdult,
  currentUser,
  isBlockedUser,
  onPostCreated,
  onPostDeleted,
}) => {
  const [filter, setFilter] = useState<WallFilter>('all');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mention = useSeriesMention({
    value: content,
    onChange: setContent,
    textareaRef,
  });

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];

    if (filter === 'all' || filter === 'posts') {
      wallPosts.forEach((post) => {
        const ts = new Date(post.createdAt).getTime();
        items.push({ kind: 'post', sortTime: Number.isNaN(ts) ? 0 : ts, post });
      });
    }

    if ((filter === 'all' || filter === 'activity') && canViewHistory) {
      readingHistory.forEach((entry) => {
        const ts = new Date(entry.lastRead).getTime();
        items.push({ kind: 'activity', sortTime: Number.isNaN(ts) ? 0 : ts, item: entry });
      });
    }

    return items.sort((a, b) => b.sortTime - a.sortTime);
  }, [canViewHistory, filter, readingHistory, wallPosts]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser) {
      toast.error('Duvara yazmak için giriş yapmalısınız.');
      return;
    }

    const trimmed = content.trim();
    if (!trimmed) {
      toast.error('Paylaşılacak bir mesaj yazın.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createProfileWallPost(profileId, currentUser.id, trimmed);
      setContent('');
      onPostCreated(created);
      toast.success('Duvar yazısı paylaşıldı.');
    } catch (error) {
      console.error('Wall post create error:', error);
      toast.error('Mesaj paylaşılamadı. Lütfen tekrar deneyin.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (postId: string) => {
    setDeletingIds((prev) => ({ ...prev, [postId]: true }));
    try {
      await deleteProfileWallPost(postId);
      onPostDeleted(postId);
      toast.success('Yazı silindi.');
    } catch (error) {
      console.error('Wall post delete error:', error);
      toast.error('Yazı silinemedi.');
    } finally {
      setDeletingIds((prev) => {
        const copy = { ...prev };
        delete copy[postId];
        return copy;
      });
    }
  };

  const isStaff = currentUser?.role === 'admin' || currentUser?.role === 'moderator';

  return (
    <div className="space-y-4">
      {/* Wall Composer */}
      {!isBlockedUser && (
        <form
          onSubmit={handleSubmit}
          className="relative overflow-visible rounded-xl border border-border/80 bg-card/75 shadow-sm"
        >
          <RichTextToolbar
            textareaRef={textareaRef}
            value={content}
            onChange={setContent}
            onTriggerSeriesTag={mention.triggerManually}
            leftSlot={
              currentUser ? (
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Avatar className="h-5 w-5">
                    <AvatarImage src={currentUser.avatar || undefined} alt={currentUser.username} />
                    <AvatarFallback className="text-[10px]">
                      {(currentUser.username || 'U').slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate max-w-[110px] text-foreground/90">{currentUser.username}</span>
                </div>
              ) : null
            }
          />

          <div className="relative">
            <Textarea
              ref={textareaRef}
              value={content}
              disabled={!currentUser || submitting}
              maxLength={1000}
              onChange={(event) => {
                setContent(event.target.value);
                mention.syncTriggerFromTextarea(event.target.value, event.target.selectionStart);
              }}
              onClick={(event) => {
                mention.syncTriggerFromTextarea(
                  event.currentTarget.value,
                  event.currentTarget.selectionStart,
                );
              }}
              onKeyDown={(event) => {
                if (mention.handleKeyDown(event)) return;
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void handleSubmit(event);
                }
              }}
              placeholder={
                currentUser
                  ? `${profileUsername} duvarına bir şeyler yaz... (# ile seri etiketle)`
                  : 'Duvara yazmak için giriş yapmalısın.'
              }
              className="min-h-[76px] resize-none border-0 bg-transparent px-3.5 py-2.5 text-sm shadow-none focus-visible:ring-0"
            />

            <SeriesTagPopover
              open={mention.isPopoverOpen}
              query={mention.mentionQuery}
              includeAdult={includeAdult}
              anchorEl={textareaRef.current}
              onSelect={mention.selectSeries}
              onClose={mention.closePopover}
              highlightedIndex={mention.highlightedIndex}
              onHighlightedIndexChange={mention.setHighlightedIndex}
              onResultsChange={mention.setResults}
            />
          </div>

          <div className="flex items-center justify-between border-t border-border/50 px-3 py-2">
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {content.length}/1000
            </span>
            <Button
              type="submit"
              size="sm"
              disabled={!currentUser || submitting || !content.trim()}
              className="h-8 rounded-lg px-3.5 text-xs font-semibold"
            >
              {submitting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Paylaş
            </Button>
          </div>
        </form>
      )}

      {/* Filter Pills */}
      <div className="flex items-center gap-1.5">
        {(
          [
            { id: 'all', label: 'Tümü' },
            { id: 'posts', label: `Yazılar (${wallPosts.length})` },
            ...(canViewHistory
              ? [{ id: 'activity' as const, label: `Etkinlik (${readingHistory.length})` }]
              : []),
          ] as Array<{ id: WallFilter; label: string }>
        ).map((pill) => (
          <button
            key={pill.id}
            type="button"
            onClick={() => setFilter(pill.id)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              filter === pill.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            {pill.label}
          </button>
        ))}
      </div>

      {/* Unified Timeline */}
      {timeline.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-card/30 px-6 py-10 text-center text-sm text-muted-foreground">
          Henüz paylaşılan yazı veya okuma etkinliği yok.
        </div>
      ) : (
        <div className="space-y-3">
          {timeline.map((entry) => {
            if (entry.kind === 'post') {
              const { post } = entry;
              const canDelete = Boolean(
                currentUser &&
                  (currentUser.id === post.authorUserId ||
                    currentUser.id === profileId ||
                    isStaff),
              );
              const authorRole =
                post.authorRole === 'admin' ||
                post.authorRole === 'moderator' ||
                post.authorRole === 'user'
                  ? post.authorRole
                  : undefined;

              return (
                <article
                  key={`post-${post.id}`}
                  className="rounded-xl border border-border/75 bg-card/65 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Link to={`/profile/${post.authorUserId}`} className="shrink-0">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={post.authorAvatar || undefined} alt={post.authorUsername} />
                          <AvatarFallback className="text-xs font-semibold">
                            {(post.authorUsername || 'U').slice(0, 1).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </Link>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link
                            to={`/profile/${post.authorUserId}`}
                            className={cn(
                              'truncate text-sm font-semibold hover:text-primary',
                              getStaffTextClassName(authorRole),
                            )}
                          >
                            {post.authorUsername}
                          </Link>
                          <StaffBadge role={authorRole} compact />
                          <span className="text-xs text-muted-foreground">
                            {formatRelative(post.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {canDelete && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={Boolean(deletingIds[post.id])}
                        onClick={() => void handleDelete(post.id)}
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label="Duvar yazısını sil"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  <div className="mt-2.5 text-sm text-foreground/95">
                    {renderRichContent(post.content)}
                  </div>
                </article>
              );
            }

            const { item } = entry;
            return (
              <article
                key={`activity-${item.mangaId}-${item.chapterNumber}-${item.lastRead}`}
                className="rounded-xl border border-border/75 bg-card/55 p-3.5"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Avatar className="h-6 w-6 shrink-0">
                    <AvatarImage src={profileAvatar || undefined} alt={profileUsername} />
                    <AvatarFallback className="text-[10px]">
                      {(profileUsername || 'U').slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <p className="min-w-0 truncate">
                    <span className={cn('font-semibold text-foreground', getStaffTextClassName(profileRole))}>
                      {profileUsername}
                    </span>{' '}
                    <span>Bölüm {item.chapterNumber} okudu</span>
                  </p>
                  <span className="ml-auto shrink-0 text-[11px]">{formatRelative(item.lastRead)}</span>
                </div>

                <div className="mt-2.5 flex items-center gap-3 rounded-lg border border-border/60 bg-secondary/35 p-2.5">
                  <Link
                    to={`/manga/${item.mangaId}`}
                    className="h-16 w-11 shrink-0 overflow-hidden rounded-md bg-muted"
                  >
                    {item.mangaCover ? (
                      <img
                        src={item.mangaCover}
                        alt={item.mangaTitle}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <BookOpen className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </Link>

                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/manga/${item.mangaId}`}
                      className="line-clamp-1 text-sm font-semibold text-foreground hover:text-primary"
                    >
                      {item.mangaTitle}
                    </Link>
                    {(item.mangaType || item.mangaStatus) && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[
                          item.mangaType ? getMangaTypeLabel(item.mangaType) : null,
                          item.mangaStatus,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Button asChild size="sm" variant="secondary" className="h-6 rounded-md px-2 text-[11px]">
                        <Link to={`/manga/${item.mangaId}/chapter/${item.chapterNumber}`}>
                          <Play className="mr-1 h-2.5 w-2.5" />
                          Bölüm {item.chapterNumber}
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost" className="h-6 rounded-md px-2 text-[11px]">
                        <Link to={`/manga/${item.mangaId}`}>Seriye git</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProfileWallTab;
