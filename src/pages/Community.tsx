import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookMarked, ListOrdered, MessageSquare, Trophy } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { cn } from '@/lib/utils';
import Header from '@/components/layout/Header';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import ForumTab from '@/components/community/ForumTab';
import TierListsDiscoveryTab from '@/components/community/TierListsDiscoveryTab';
import ReadingListsDiscoveryTab from '@/components/community/ReadingListsDiscoveryTab';
import LeadersTab from '@/components/community/LeadersTab';

type CommunityTabId = 'forum' | 'tier-lists' | 'reading-lists' | 'leaders';

const COMMUNITY_TABS: Array<{
  id: CommunityTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'forum', label: 'Forum', icon: MessageSquare },
  { id: 'tier-lists', label: 'Tier Listeler', icon: ListOrdered },
  { id: 'reading-lists', label: 'Okuma Listeleri', icon: BookMarked },
  { id: 'leaders', label: 'Liderler', icon: Trophy },
];

const isValidCommunityTab = (value: string | null): value is CommunityTabId =>
  value === 'forum' ||
  value === 'tier-lists' ||
  value === 'reading-lists' ||
  value === 'leaders';

const Community: React.FC = () => {
  const { isOnline } = useEffectiveOnlineStatus();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab');
  const activeTab: CommunityTabId = isValidCommunityTab(tabParam) ? tabParam : 'forum';

  useDocumentTitle('Topluluk');

  if (!isOnline) {
    return (
      <OfflineRequiredScreen
        description="Topluluk merkezini görüntülemek ve etkileşime geçmek için internete bağlanın."
        actionHref="/downloads"
        actionLabel="İndirilenlere Git"
      />
    );
  }

  const handleSelectTab = (tabId: CommunityTabId) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', tabId);
        if (tabId !== 'forum') {
          next.delete('category');
          next.delete('q');
        }
        return next;
      },
      { replace: true },
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container max-w-6xl mx-auto px-4 pt-24 pb-16 space-y-6">
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Topluluk</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Forum tartışmaları, tier listeler, okuma listeleri ve en aktif okurlar.
            </p>
          </div>

          <nav
            aria-label="Topluluk sekmeleri"
            className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-3"
          >
            {COMMUNITY_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleSelectTab(tab.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <section aria-live="polite" className="min-w-0">
          {activeTab === 'forum' && <ForumTab />}
          {activeTab === 'tier-lists' && <TierListsDiscoveryTab />}
          {activeTab === 'reading-lists' && <ReadingListsDiscoveryTab />}
          {activeTab === 'leaders' && <LeadersTab />}
        </section>
      </main>
    </div>
  );
};

export default Community;
