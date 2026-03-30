import React from 'react';
import { ExternalLink, Languages } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buildEntityMetadataEntries } from '@/lib/entityMetadata';
import { EntityMetadata, ExternalSourceLink } from '@/lib/types';

interface EntityMetadataGridProps {
  metadata?: EntityMetadata | null;
  alternativeNames?: string[];
  sourceLinks?: ExternalSourceLink[];
  title?: string;
}

const EntityMetadataGrid: React.FC<EntityMetadataGridProps> = ({
  metadata,
  alternativeNames,
  sourceLinks,
  title = 'Detaylar',
}) => {
  const entries = buildEntityMetadataEntries(metadata);
  const visibleAlternativeNames = (alternativeNames || []).filter(Boolean);
  const visibleSourceLinks = (sourceLinks || []).filter((item) => item?.url);

  if (entries.length === 0 && visibleAlternativeNames.length === 0 && visibleSourceLinks.length === 0) {
    return null;
  }

  return (
    <Card className="border-border/60 bg-card/70 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {visibleAlternativeNames.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Languages className="h-4 w-4" />
              Alternatif İsimler
            </div>
            <div className="flex flex-wrap gap-2">
              {visibleAlternativeNames.map((name) => (
                <Badge key={name} variant="secondary" className="rounded-full px-3 py-1">
                  {name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {entries.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {entries.map((entry) => (
              <div
                key={`${entry.label}-${entry.value}`}
                className="rounded-2xl border border-border/60 bg-secondary/25 p-4"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {entry.label}
                </p>
                <p className="mt-2 text-sm leading-6 text-foreground/90">
                  {entry.value}
                </p>
              </div>
            ))}
          </div>
        )}

        {visibleSourceLinks.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-muted-foreground">Kaynak Linkleri</p>
            <div className="flex flex-wrap gap-2">
              {visibleSourceLinks.map((link) => (
                <a
                  key={`${link.source}-${link.url}`}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary/15"
                >
                  <span>{link.label || link.source}</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default EntityMetadataGrid;
