import React from 'react';
import Header from '@/components/layout/Header';
import OfflineNotice from '@/components/offline/OfflineNotice';

interface OfflineRequiredScreenProps {
  title?: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}

const OfflineRequiredScreen: React.FC<OfflineRequiredScreenProps> = ({
  title,
  description,
  actionHref,
  actionLabel,
}) => (
  <div className="min-h-screen bg-background">
    <Header />
    <main className="container flex min-h-[70vh] items-center justify-center pt-24 pb-12">
      <div className="w-full max-w-3xl">
        <OfflineNotice
          title={title}
          description={description}
          actionHref={actionHref}
          actionLabel={actionLabel}
        />
      </div>
    </main>
  </div>
);

export default OfflineRequiredScreen;
