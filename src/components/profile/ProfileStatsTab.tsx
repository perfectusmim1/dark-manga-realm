import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Clock, Lock, Star } from 'lucide-react';
import HeatMap from '@/components/profile/HeatMap';
import { getMangaTypeLabel } from '@/lib/mangaType';
import { formatReadingDuration, type ProfileExtendedData } from '@/lib/profile';
import { cn } from '@/lib/utils';

interface ProfileStatsTabProps {
  extendedData: ProfileExtendedData;
  heatmapActivity: { date: string; count: number }[];
  totalChapters: number;
  totalSeries: number;
  totalReadingSeconds: number;
  canViewHistory: boolean;
  canViewReviews: boolean;
}

const TURKISH_SHORT_MONTHS = [
  '',
  'Oca',
  'Şub',
  'Mar',
  'Nis',
  'May',
  'Haz',
  'Tem',
  'Ağu',
  'Eyl',
  'Eki',
  'Kas',
  'Ara',
];

/**
 * Profile `İstatistik` dashboard featuring the 12-month bar chart, top genres,
 * rating distribution, top read series, community stats, and yearly reading heatmap.
 */
const ProfileStatsTab: React.FC<ProfileStatsTabProps> = ({
  extendedData,
  heatmapActivity,
  totalChapters,
  totalSeries,
  totalReadingSeconds,
  canViewHistory,
  canViewReviews,
}) => {
  const maxMonthlyCount = Math.max(1, ...extendedData.monthlyReading.map((m) => m.count));
  const maxGenreCount = Math.max(1, ...extendedData.topGenres.map((g) => g.count));
  const maxRatingCount = Math.max(1, ...extendedData.ratingDistribution.map((r) => r.count));
  const fiveStarAverage = (extendedData.ratingAverage / 2).toFixed(1);

  return (
    <div className="space-y-4">
      {/* Monthly 12-Month Bar Chart */}
      <section className="rounded-xl border border-border/80 bg-card/70 p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold tracking-tight sm:text-base">Aylık okuma</h2>
          <span className="text-xs text-muted-foreground">Tamamlanan bölüm</span>
        </div>

        {canViewHistory ? (
          extendedData.monthlyReading.length > 0 ? (
            <div className="grid grid-cols-12 items-end gap-1.5 pt-5 sm:gap-2.5">
              {extendedData.monthlyReading.map((point) => {
                const heightPct =
                  point.count > 0 ? Math.max(6, Math.round((point.count / maxMonthlyCount) * 100)) : 3;
                const monthLabel = TURKISH_SHORT_MONTHS[point.monthIndex] || point.monthKey.slice(5);

                return (
                  <div
                    key={point.monthKey}
                    className="flex flex-col items-center gap-1.5"
                    title={`${monthLabel}: ${point.count} bölüm`}
                  >
                    <span className="h-4 text-[10px] font-semibold tabular-nums text-muted-foreground">
                      {point.count > 0 ? point.count.toLocaleString('tr-TR') : ''}
                    </span>
                    <div className="flex h-28 w-full items-end justify-center">
                      <div
                        className={cn(
                          'w-full max-w-[26px] rounded-t-md transition-all',
                          point.count > 0
                            ? 'bg-gradient-to-t from-primary to-emerald-400'
                            : 'bg-secondary/70',
                        )}
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-medium text-muted-foreground">{monthLabel}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">
              Son 12 ay için okuma kaydı bulunmuyor.
            </p>
          )
        ) : (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            <span>Okuma geçmişi gizli</span>
          </div>
        )}
      </section>

      {/* Top Genres + Rating Distribution */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-border/80 bg-card/70 p-4 sm:p-5">
          <h2 className="mb-3.5 text-sm font-bold tracking-tight sm:text-base">
            En çok okunan türler
          </h2>

          {extendedData.topGenres.length > 0 ? (
            <div className="space-y-2.5">
              {extendedData.topGenres.map((item) => {
                const widthPct = Math.max(8, Math.round((item.count / maxGenreCount) * 100));
                return (
                  <div key={item.genre} className="grid grid-cols-[minmax(88px,auto)_1fr_28px] items-center gap-2.5 text-xs">
                    <span className="truncate font-medium text-foreground/90">{item.genre}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-primary"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="text-right font-semibold tabular-nums text-muted-foreground">
                      {item.count}
                    </span>
                  </div>
                );
              })}

              {extendedData.typeCounts.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {extendedData.typeCounts.map((entry) => (
                    <span
                      key={entry.type}
                      className="rounded-full bg-secondary/75 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                    >
                      {getMangaTypeLabel(entry.type)}{' '}
                      <strong className="font-semibold text-foreground">{entry.count}</strong>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">
              Tür verisi henüz oluşmadı.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-border/80 bg-card/70 p-4 sm:p-5">
          <div className="mb-3.5 flex items-center justify-between">
            <h2 className="text-sm font-bold tracking-tight sm:text-base">Verdiği puanlar</h2>
            {canViewReviews && extendedData.ratingAverage > 0 && (
              <span className="inline-flex items-center gap-1 text-sm font-bold tabular-nums text-amber-400">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                {fiveStarAverage}
              </span>
            )}
          </div>

          {canViewReviews ? (
            extendedData.ratingDistribution.some((r) => r.count > 0) ? (
              <div className="space-y-2.5">
                {extendedData.ratingDistribution.map((bucket) => {
                  const widthPct =
                    bucket.count > 0
                      ? Math.max(6, Math.round((bucket.count / maxRatingCount) * 100))
                      : 0;
                  return (
                    <div
                      key={bucket.stars}
                      className="grid grid-cols-[76px_1fr_28px] items-center gap-2.5 text-xs"
                    >
                      <div className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }).map((_, idx) => (
                          <Star
                            key={idx}
                            className={cn(
                              'h-3 w-3',
                              idx < bucket.stars
                                ? 'fill-amber-400 text-amber-400'
                                : 'fill-muted/40 text-muted-foreground/30',
                            )}
                          />
                        ))}
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-emerald-400"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                      <span className="text-right font-semibold tabular-nums text-muted-foreground">
                        {bucket.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-8 text-center text-xs text-muted-foreground">
                Henüz değerlendirme puanı verilmemiş.
              </p>
            )
          ) : (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              <span>İnceleme puanları gizli</span>
            </div>
          )}
        </section>
      </div>

      {/* Top Read Series */}
      {canViewHistory && extendedData.topReadSeries.length > 0 && (
        <section className="rounded-xl border border-border/80 bg-card/70 p-4 sm:p-5">
          <h2 className="mb-3.5 text-sm font-bold tracking-tight sm:text-base">
            En çok okunan seriler
          </h2>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {extendedData.topReadSeries.map((series, index) => (
              <Link
                key={series.id}
                to={`/manga/${series.id}`}
                className="group flex items-center gap-3 rounded-lg border border-border/60 bg-secondary/35 p-2.5 transition-colors hover:border-primary/40 hover:bg-secondary/60"
              >
                <span className="w-5 shrink-0 text-center text-xs font-bold tabular-nums text-muted-foreground">
                  #{index + 1}
                </span>
                <div className="h-12 w-9 shrink-0 overflow-hidden rounded bg-muted">
                  {series.cover ? (
                    <img
                      src={series.cover}
                      alt={series.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-xs font-semibold text-foreground group-hover:text-primary sm:text-sm">
                    {series.title}
                  </p>
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    {series.readChapters} bölüm okundu
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Community Stats */}
      <section className="rounded-xl border border-border/80 bg-card/70 p-4 sm:p-5">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold tracking-tight sm:text-base">Topluluk ve özet</h2>
          {canViewHistory && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {formatReadingDuration(totalReadingSeconds)}
              </span>
              <span>
                {totalSeries} seri · {totalChapters} bölüm
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              { label: 'Yorumlar', value: extendedData.communityStats.commentCount },
              { label: 'İncelemeler', value: extendedData.communityStats.reviewCount },
              { label: 'Forum Konuları', value: extendedData.communityStats.topicCount },
              { label: 'Forum Yanıtları', value: extendedData.communityStats.forumReplyCount },
              { label: 'Duvar Yazıları', value: extendedData.communityStats.wallPostCount },
              { label: 'Alınan Beğeni', value: extendedData.communityStats.likesReceived },
            ] as const
          ).map((tile) => (
            <div
              key={tile.label}
              className="rounded-lg border border-border/60 bg-secondary/35 p-3 text-center"
            >
              <p className="text-lg font-bold tabular-nums text-foreground">
                {tile.value.toLocaleString('tr-TR')}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{tile.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Yearly Activity Heatmap */}
      {canViewHistory && (
        <section className="rounded-xl border border-border/80 bg-card/70 p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-bold tracking-tight sm:text-base">
            Yıllık okuma aktivitesi
          </h2>
          <HeatMap data={heatmapActivity} />
        </section>
      )}
    </div>
  );
};

export default ProfileStatsTab;
