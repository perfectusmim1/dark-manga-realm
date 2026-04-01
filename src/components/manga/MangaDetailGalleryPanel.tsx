import type { EntityGalleryImage } from '@/lib/types';
import EntityGalleryGrid from '@/components/entities/EntityGalleryGrid';

interface MangaDetailGalleryPanelProps {
  images: EntityGalleryImage[];
}

const MangaDetailGalleryPanel = ({ images }: MangaDetailGalleryPanelProps) => {
  if (images.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center">
        <h3 className="text-xl font-semibold">Bu seri için galeri bulunamadi</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Ice aktarilan seri gorselleri oldugunda bu sekmede gorunecek.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 sm:p-6">
      <EntityGalleryGrid
        images={images}
        title="Seri Galerisi"
      />
    </div>
  );
};

export default MangaDetailGalleryPanel;
