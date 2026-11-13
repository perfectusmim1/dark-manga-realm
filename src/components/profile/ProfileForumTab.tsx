import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { MessageSquareText, ThumbsUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ProfileForumActivityItem } from '@/lib/profile';
import { cn } from '@/lib/utils';

interface ProfileForumTabProps {
  items: ProfileForumActivityItem[];
}

type ForumFilter = 'all' | 'topic' | 'reply';

const formatRelative = (isoDate: string): string => {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatDistanceToNow(parsed, { addSuffix: true, locale: tr });
};

/**
 * Profile `Forum` tab displaying topics started and forum replies authored by the profile user.
 */
const ProfileForumTab: React.FC<ProfileForumTabProps> = ({ items }) => {
  const [filter, setFilter] = useState<ForumFilter>('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((item) => item.kind === filter);
  }, [filter, items]);

  const topicCount = items.filter((i) => i.kind === 'topic').length;
  const replyCount = items.filter((i) => i.kind === 'reply').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5">
        {(
          [
            { id: 'all', label: `Tümü (${items.length})` },
            { id: 'topic', label: `Konular (${topicCount})` },
            { id: 'reply', label: `Yanıtlar (${replyCount})` },
          ] as const
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

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-card/30 px-6 py-10 text-center text-sm text-muted-foreground">
          <MessageSquareText className="mx-auto mb-2 h-8 w-8 opacity-40" />
          Forum etkinliği bulunamadı.
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((item) => (
            <Link
              key={`${item.kind}-${item.id}`}
              to={`/community/topic/${item.topicId}`}
              className="block rounded-xl border border-border/75 bg-card/65 p-3.5 transition-colors hover:border-primary/40 hover:bg-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="h-5 px-2 text-[11px] font-medium">
                    {item.kind === 'topic' ? 'Konu' : 'Yanıt'}
                  </Badge>
                  {item.category && <span className="text-muted-foreground">{item.category}</span>}
                </div>
                <span>{formatRelative(item.createdAt)}</span>
              </div>

              <h3 className="mt-2 line-clamp-1 text-sm font-semibold text-foreground">
                {item.topicTitle}
              </h3>

              {item.excerpt && (
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {item.excerpt}
                </p>
              )}

              <div className="mt-2 flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                <ThumbsUp className="h-3 w-3" />
                <span>{item.likeCount}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProfileForumTab;
