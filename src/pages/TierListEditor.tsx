import React, { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { getAllMangas, getCharacters, getCharacterSeriesMap } from '@/lib/database';
import { Save, Search, ArrowLeft, Image as ImageIcon } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import TierItemCard from '@/components/tierlist/TierItemCard';
import OptimizedImage from '@/components/media/OptimizedImage';
import { cn } from '@/lib/utils';

const defaultTiers = [
  { id: 'S', color: 'bg-red-500' },
  { id: 'A', color: 'bg-orange-500' },
  { id: 'B', color: 'bg-amber-500' },
  { id: 'C', color: 'bg-yellow-500' },
  { id: 'D', color: 'bg-green-500' },
  { id: 'F', color: 'bg-gray-500' },
];

const defaultTierLabels: Record<string, string> = {
  S: 'S',
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
  F: 'F',
};

const AUTO_SCROLL_EDGE_THRESHOLD = 120;
const AUTO_SCROLL_MAX_SPEED = 18;
const TOUCH_DRAG_START_THRESHOLD = 10;

const getItemDisplayName = (item: any) => item?.name || item?.title || '';

const normalizeSearchValue = (value: string) =>
  value.toLocaleLowerCase('tr-TR');

const getTierLabelTextClassName = (label: string) => {
  const labelLength = label.trim().length;

  if (labelLength > 26) {
    return 'text-[10px] sm:text-xs';
  }

  if (labelLength > 16) {
    return 'text-xs sm:text-sm';
  }

  if (labelLength > 9) {
    return 'text-sm sm:text-base';
  }

  return 'text-xl sm:text-2xl';
};

const getAutoScrollSpeed = (clientY: number, viewportHeight: number) => {
  if (clientY < AUTO_SCROLL_EDGE_THRESHOLD) {
    const intensity = (AUTO_SCROLL_EDGE_THRESHOLD - clientY) / AUTO_SCROLL_EDGE_THRESHOLD;
    return -Math.max(4, Math.round(intensity * AUTO_SCROLL_MAX_SPEED));
  }

  const distanceToBottom = viewportHeight - clientY;
  if (distanceToBottom < AUTO_SCROLL_EDGE_THRESHOLD) {
    const intensity = (AUTO_SCROLL_EDGE_THRESHOLD - distanceToBottom) / AUTO_SCROLL_EDGE_THRESHOLD;
    return Math.max(4, Math.round(intensity * AUTO_SCROLL_MAX_SPEED));
  }

  return 0;
};

const getTierDropTargetFromPoint = (clientX: number, clientY: number) => {
  if (typeof document === 'undefined') {
    return null;
  }

  const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-tier-dropzone="true"]');
  return target?.dataset.tierId || null;
};

type TouchDragState = {
  id: string;
  sourceTierId: string;
  item: any;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isActive: boolean;
};

export default function TierListEditor() {
  const { isOnline } = useEffectiveOnlineStatus();
  const { id } = useParams<{ id: string }>(); // 'create' or uuid
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!isOnline) {
    return (
      <OfflineRequiredScreen
        description="Tier listesi oluşturmak veya düzenlemek için internete bağlanın."
        actionHref="/downloads"
        actionLabel="İndirilenlere Git"
      />
    );
  }

  const [title, setTitle] = useState('Benim Sıralamam');
  const [type, setType] = useState<'manga' | 'character'>('manga');
  const [items, setItems] = useState<any[]>([]); // all possible mangas/characters
  const [characterSeriesMap, setCharacterSeriesMap] = useState<Record<string, string>>({});
  const [tierState, setTierState] = useState<Record<string, any[]>>({
    unranked: [],
    'S': [],
    'A': [],
    'B': [],
    'C': [],
    'D': [],
    'F': []
  });
  const [isSaving, setIsSaving] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<{ id: string, source: string } | null>(null);
  const [tierLabels, setTierLabels] = useState<Record<string, string>>(defaultTierLabels);
  const [isOwner, setIsOwner] = useState(true);
  const [poolSearch, setPoolSearch] = useState('');
  const [visiblePoolCount, setVisiblePoolCount] = useState(80);
  const poolSentinelRef = useRef<HTMLDivElement | null>(null);
  const deferredSearch = useDeferredValue(poolSearch.trim());

  const [touchDragState, setTouchDragState] = useState<TouchDragState | null>(null);
  const [touchDropTargetId, setTouchDropTargetId] = useState<string | null>(null);
  const autoScrollSpeedRef = useRef(0);
  const autoScrollFrameRef = useRef<number | null>(null);
  const touchDragStateRef = useRef<TouchDragState | null>(null);
  const touchDropTargetIdRef = useRef<string | null>(null);

  useEffect(() => {
    setVisiblePoolCount(80);
  }, [deferredSearch, type]);

  useEffect(() => {
    const loadItems = async () => {
      let dbItems: any[] = [];
      if (type === 'character') {
        const [chars, seriesMap] = await Promise.all([
          getCharacters(),
          getCharacterSeriesMap(),
        ]);
        setCharacterSeriesMap(seriesMap || {});
        dbItems = chars || [];
      } else {
        dbItems = (await getAllMangas()) || [];
      }
      setItems(dbItems);
      
      if (!id || id === 'create') {
         if (!user) {
           toast.error('Giriş yapmanız gerekiyor.');
           navigate('/');
           return;
         }
         setTierState(prev => ({ ...prev, unranked: dbItems || [] }));
      } else {
         const { data, error } = await supabase.from('tier_lists').select('*').eq('id', id).single();
         if (!error && data) {
            if (data.user_id !== user?.id) {
              setIsOwner(false);
              toast.error('Bu tier listesini düzenleme yetkiniz yok.');
              navigate(-1);
              return;
            }
            setIsOwner(true);
            setTitle(data.title || 'Benim Sıralamam');
            const loadedType = data.type === 'character' ? 'character' : 'manga';
            setType(loadedType);
            
            let correctDbItems: any[] = [];
            if (loadedType === 'character') {
              const [chars, seriesMap] = await Promise.all([
                getCharacters(),
                getCharacterSeriesMap(),
              ]);
              setCharacterSeriesMap(seriesMap || {});
              correctDbItems = chars || [];
            } else {
              correctDbItems = (await getAllMangas()) || [];
            }
            setItems(correctDbItems);

            const savedTiers = data.items || {};
            const savedLabels = data.tier_labels || {};
            setTierLabels({ ...defaultTierLabels, ...savedLabels });
            const unranked = (correctDbItems || []).filter(m => {
                for (const t in savedTiers) {
                   if (savedTiers[t].includes(m.id)) return false;
                }
                return true;
            });

            const newTs: any = { unranked };
            defaultTiers.forEach(t => {
               newTs[t.id] = (savedTiers[t.id] || []).map((mid: string) => correctDbItems?.find(x => x.id === mid)).filter(Boolean);
            });
            setTierState(newTs);
         }
      }
    };
    loadItems();
  }, [id, type]);

  useEffect(() => {
    if (!draggingId) {
      autoScrollSpeedRef.current = 0;
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
      return;
    }

    const tick = () => {
      if (autoScrollSpeedRef.current !== 0) {
        window.scrollBy(0, autoScrollSpeedRef.current);
      }
      autoScrollFrameRef.current = window.requestAnimationFrame(tick);
    };

    const handleWindowDragOver = (event: DragEvent) => {
      autoScrollSpeedRef.current = getAutoScrollSpeed(event.clientY, window.innerHeight);
    };

    const handleWindowDragStop = () => {
      autoScrollSpeedRef.current = 0;
    };

    autoScrollFrameRef.current = window.requestAnimationFrame(tick);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('drop', handleWindowDragStop);
    window.addEventListener('dragend', handleWindowDragStop);

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('drop', handleWindowDragStop);
      window.removeEventListener('dragend', handleWindowDragStop);
      autoScrollSpeedRef.current = 0;
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
    };
  }, [draggingId]);

  useEffect(() => {
    touchDragStateRef.current = touchDragState;
  }, [touchDragState]);

  useEffect(() => {
    touchDropTargetIdRef.current = touchDropTargetId;
  }, [touchDropTargetId]);

  useEffect(() => {
    if (!touchDragState) {
      return;
    }

    const handleTouchMove = (event: TouchEvent) => {
      const currentDrag = touchDragStateRef.current;
      const touch = event.touches[0];

      if (!currentDrag || !touch) {
        return;
      }

      const nextX = touch.clientX;
      const nextY = touch.clientY;
      const distance = Math.hypot(nextX - currentDrag.startX, nextY - currentDrag.startY);
      const isActive = currentDrag.isActive || distance >= TOUCH_DRAG_START_THRESHOLD;

      if (!isActive) {
        return;
      }

      event.preventDefault();

      setDraggingId(currentDrag.id);
      autoScrollSpeedRef.current = getAutoScrollSpeed(nextY, window.innerHeight);

      const nextTargetId = getTierDropTargetFromPoint(nextX, nextY);
      setTouchDropTargetId(nextTargetId);

      setTouchDragState((prev) => prev ? {
        ...prev,
        currentX: nextX,
        currentY: nextY,
        isActive: true,
      } : prev);
    };

    const endTouchDrag = (event: TouchEvent) => {
      const currentDrag = touchDragStateRef.current;

      if (!currentDrag) {
        return;
      }

      if (currentDrag.isActive) {
        event.preventDefault();
        const dropTargetId = touchDropTargetIdRef.current
          || getTierDropTargetFromPoint(currentDrag.currentX, currentDrag.currentY);

        if (dropTargetId && dropTargetId !== currentDrag.sourceTierId) {
          moveItem(currentDrag.id, currentDrag.sourceTierId, dropTargetId);
        }
      }

      setDraggingId(null);
      setTouchDragState(null);
      setTouchDropTargetId(null);
      autoScrollSpeedRef.current = 0;
    };

    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', endTouchDrag, { passive: false });
    window.addEventListener('touchcancel', endTouchDrag, { passive: false });

    return () => {
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', endTouchDrag);
      window.removeEventListener('touchcancel', endTouchDrag);
      autoScrollSpeedRef.current = 0;
    };
  }, [Boolean(touchDragState)]);

  const filteredUnrankedItems = useMemo(() => {
    const query = normalizeSearchValue(deferredSearch);
    const unrankedItems = tierState['unranked'] ?? [];

    if (!query) return unrankedItems;

    return unrankedItems.filter((item) => {
      const name = normalizeSearchValue(getItemDisplayName(item));
      if (name.includes(query)) return true;
      const series = characterSeriesMap[item.id];
      if (series && normalizeSearchValue(series).includes(query)) return true;
      return false;
    });
  }, [deferredSearch, tierState, characterSeriesMap]);

  const visibleUnrankedItems = useMemo(() => {
    return filteredUnrankedItems.slice(0, visiblePoolCount);
  }, [filteredUnrankedItems, visiblePoolCount]);

  useEffect(() => {
    const sentinel = poolSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisiblePoolCount((prev) => Math.min(prev + 80, filteredUnrankedItems.length));
        }
      },
      { rootMargin: '350px 0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredUnrankedItems.length, visiblePoolCount]);

  const onDragStart = useCallback((e: React.DragEvent, sourceTierId: string, itemId: string | number) => {
    const idStr = itemId.toString();
    e.dataTransfer.setData('sourceTier', sourceTierId);
    e.dataTransfer.setData('itemId', idStr);
    e.dataTransfer.setData('text/plain', idStr);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(idStr);
  }, []);

  const onDragEnd = useCallback(() => {
    setDraggingId(null);
    autoScrollSpeedRef.current = 0;
  }, []);

  const moveItem = useCallback((itemId: string, sourceTierId: string, targetTierId: string) => {
    setTierState(prev => {
       const sourceList = [...prev[sourceTierId]];
       const itemIndex = sourceList.findIndex(x => x.id?.toString() === itemId);
       if (itemIndex === -1) return prev;

       const [movedItem] = sourceList.splice(itemIndex, 1);
       const targetList = [...prev[targetTierId], movedItem];

       return {
           ...prev,
           [sourceTierId]: sourceList,
           [targetTierId]: targetList
       };
    });
    setSelectedItem(null);
  }, []);

  const onDrop = useCallback((e: React.DragEvent, targetTierId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingId(null);
    const sourceTierId = e.dataTransfer.getData('sourceTier');
    const itemId = e.dataTransfer.getData('itemId') || e.dataTransfer.getData('text/plain');

    if (!sourceTierId || !itemId || sourceTierId === targetTierId) return;
    moveItem(itemId, sourceTierId, targetTierId);
  }, [moveItem]);

  const handleItemClick = useCallback((e: React.MouseEvent, id: string, source: string) => {
    e.stopPropagation();
    setSelectedItem(prev => (prev?.id === id.toString() ? null : { id: id.toString(), source }));
  }, []);

  const handleTouchDragStart = useCallback((event: React.TouchEvent, sourceTierId: string, item: any) => {
    if (event.touches.length !== 1) {
      return;
    }

    event.stopPropagation();

    const touch = event.touches[0];
    setTouchDropTargetId(sourceTierId);
    setTouchDragState({
      id: item.id.toString(),
      sourceTierId,
      item,
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      currentY: touch.clientY,
      isActive: false,
    });
  }, []);

  const handleTierAreaClick = useCallback((targetTierId: string) => {
    if (selectedItem && selectedItem.source !== targetTierId) {
        moveItem(selectedItem.id, selectedItem.source, targetTierId);
    }
  }, [selectedItem, moveItem]);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    autoScrollSpeedRef.current = getAutoScrollSpeed(e.clientY, window.innerHeight);
  };

  const handleSave = async () => {
    if (!title.trim()) return toast.error('Lütfen bir başlık girin.');
    if (!user) return toast.error('Giriş yapmanız gerekiyor.');

    setIsSaving(true);
    try {
      const dbItems: Record<string, string[]> = {};
      defaultTiers.forEach(t => {
         dbItems[t.id] = tierState[t.id].map(x => x.id);
      });

      const payload = {
         title,
         type,
         user_id: user.id,
         items: dbItems,
         tier_labels: tierLabels,
         is_public: true
      };

      if (!id || id === 'create') {
         const { error } = await supabase.from('tier_lists').insert([payload]);
         if (error) throw error;
         toast.success('Tier Listesi oluşturuldu!');
         navigate('/tier-lists');
      } else {
         const { error } = await supabase.from('tier_lists').update(payload).eq('id', id);
         if (error) throw error;
         toast.success('Tier Listesi güncellendi!');
      }
    } catch (err) {
       console.error(err);
       toast.error('Kaydedilirken bir sorun oluştu.');
    } finally {
       setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header />
      <main className="container flex flex-1 flex-col gap-5 py-20 sm:gap-6 sm:py-24">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
           <div className="flex w-full min-w-0 flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
              <Button variant="ghost" size="icon" onClick={() => navigate('/tier-lists')}>
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <Input 
                value={title ?? ''} 
                onChange={(e) => setTitle(e.target.value)} 
                className="h-auto w-full max-w-none rounded-xl border border-border bg-transparent px-4 py-3 text-xl font-bold focus-visible:border-primary focus-visible:ring-0 sm:max-w-[500px] sm:text-2xl"
                placeholder="Sıralamana efsane bir başlık ver..."
              />
           </div>
           
           <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
             {(!id || id === 'create') && (
               <Tabs className="w-full sm:w-auto" value={type} onValueChange={(v) => {
                 setType(v as any);
                 // Reset tiers when switching type
                 setTierState({ unranked: [], 'S': [], 'A': [], 'B': [], 'C': [], 'D': [], 'F': [] });
               }}>
                 <TabsList className="grid h-auto w-full grid-cols-2 sm:flex sm:w-auto">
                   <TabsTrigger className="w-full" value="manga">Mangalar</TabsTrigger>
                   <TabsTrigger className="w-full" value="character">Karakterler</TabsTrigger>
                 </TabsList>
               </Tabs>
             )}
             <Button onClick={handleSave} disabled={isSaving} className="w-full gap-2 sm:w-auto">
                <Save className="w-4 h-4" /> {isSaving ? 'Kaydediliyor...' : 'Kaydet'}
             </Button>
           </div>
        </div>

        <div className="flex flex-1 flex-col gap-2 overflow-hidden rounded-xl border border-border bg-card/50 p-2.5 shadow-xl sm:p-4">
            {defaultTiers.map(tier => {
              const tierLabel = tierLabels[tier.id] ?? tier.id;

              return (
               <div
                 key={tier.id}
                 data-tier-dropzone="true"
                 data-tier-id={tier.id}
                 className={`flex min-h-[84px] border-b border-border last:border-b-0 cursor-pointer transition-colors sm:min-h-[100px] ${selectedItem ? 'hover:bg-primary/5' : ''} ${touchDropTargetId === tier.id && touchDragState?.isActive ? 'bg-primary/5 ring-1 ring-inset ring-primary/30' : ''}`}
                 onDrop={(e) => onDrop(e, tier.id)}
                 onDragOver={onDragOver}
                 onClick={() => handleTierAreaClick(tier.id)}
               >
                   <div className={`w-20 shrink-0 ${tier.color} relative overflow-hidden shadow-inner sm:w-24`}>
                       <Textarea
                         value={tierLabel}
                         onChange={(e) => setTierLabels(prev => ({ ...prev, [tier.id]: e.target.value }))}
                         onClick={(e) => e.stopPropagation()}
                         onPointerDown={(e) => e.stopPropagation()}
                         rows={3}
                         spellCheck={false}
                         aria-label={`${tier.id} etiketi`}
                         className={cn(
                           'h-full min-h-0 resize-none overflow-y-auto rounded-none border-none bg-transparent px-2 py-2 text-center font-bold leading-[0.95] text-black shadow-none [overflow-wrap:anywhere] focus:bg-white/10 focus-visible:ring-0 focus-visible:ring-offset-0',
                           getTierLabelTextClassName(tierLabel),
                         )}
                       />
                   </div>
                   <div className="flex flex-1 flex-wrap items-center gap-1.5 bg-background/50 p-2 sm:gap-2 sm:p-3">
                       {tierState[tier.id]?.map((item) => (
                         <TierItemCard
                           key={item.id}
                           item={item}
                           sourceTierId={tier.id}
                           isSelected={selectedItem?.id === item.id.toString()}
                           isDragging={draggingId === item.id.toString()}
                           isTouchDragging={touchDragState?.id === item.id.toString() && Boolean(touchDragState?.isActive)}
                           widthClass="w-[54px] sm:w-[70px]"
                           idleClassName="border-border/50 shadow-md hover:scale-105"
                           seriesTitle={characterSeriesMap[item.id]}
                           onDragStart={onDragStart}
                           onDragEnd={onDragEnd}
                           onTouchStart={handleTouchDragStart}
                           onClick={handleItemClick}
                         />
                       ))}
                       {tierState[tier.id]?.length === 0 && <span className="w-full text-center text-xs font-medium text-muted-foreground/30 sm:text-sm">İçerikleri buraya sürükleyin...</span>}
                   </div>
               </div>
              );
            })}
         </div>

         {/* Unranked Items Pool */}
         <div className="rounded-xl border border-border bg-secondary/20 p-3 sm:p-4">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-muted-foreground">
                  Havuz (Sıralanmamış)
                </h3>
                <span className="rounded-full bg-secondary/80 border border-border/50 px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                  {filteredUnrankedItems.length} {type === 'character' ? 'karakter' : 'manga'}
                </span>
              </div>
              <div className="relative w-full md:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={poolSearch}
                  onChange={(e) => setPoolSearch(e.target.value)}
                  placeholder={type === 'character' ? "Karakter veya seri ara..." : "Manga ara..."}
                  className="pl-9"
                />
              </div>
            </div>
            <div 
              data-tier-dropzone="true"
              data-tier-id="unranked"
              className={`flex min-h-[132px] flex-wrap gap-2 rounded-lg p-2 transition-colors sm:min-h-[150px] sm:gap-3 ${selectedItem ? 'cursor-pointer hover:bg-primary/5' : 'cursor-pointer'} ${touchDropTargetId === 'unranked' && touchDragState?.isActive ? 'bg-primary/5 ring-1 ring-inset ring-primary/30' : ''}`}
              onDrop={(e) => onDrop(e, 'unranked')}
              onDragOver={onDragOver}
              onClick={() => handleTierAreaClick('unranked')}
            >
               {visibleUnrankedItems.map((item) => (
                 <TierItemCard
                   key={item.id}
                   item={item}
                   sourceTierId="unranked"
                   isSelected={selectedItem?.id === item.id.toString()}
                   isDragging={draggingId === item.id.toString()}
                   isTouchDragging={touchDragState?.id === item.id.toString() && Boolean(touchDragState?.isActive)}
                   widthClass="w-[58px] sm:w-[80px]"
                   idleClassName="border-transparent shadow-sm hover:shadow-primary/20 hover:border-primary"
                   seriesTitle={characterSeriesMap[item.id]}
                   onDragStart={onDragStart}
                   onDragEnd={onDragEnd}
                   onTouchStart={handleTouchDragStart}
                   onClick={handleItemClick}
                 />
               ))}
               {tierState['unranked']?.length === 0 && <span className="text-muted-foreground/50 w-full text-center py-8">Tüm içerikler sıralandı! Mükemmel.</span>}
               {tierState['unranked']?.length > 0 && filteredUnrankedItems.length === 0 && (
                 <span className="text-muted-foreground/50 w-full text-center py-8">
                   Aramanızla eşleşen içerik bulunamadı.
                 </span>
               )}
            </div>

            {visiblePoolCount < filteredUnrankedItems.length && (
              <div ref={poolSentinelRef} className="w-full flex justify-center pt-4 pb-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setVisiblePoolCount((prev) => Math.min(prev + 80, filteredUnrankedItems.length))}
                  className="text-xs font-semibold"
                >
                  Daha Fazla Göster ({filteredUnrankedItems.length - visiblePoolCount} kaldı)
                </Button>
              </div>
            )}
         </div>

         {touchDragState?.isActive && (
           <div
             className="pointer-events-none fixed left-0 top-0 z-[70] -translate-x-1/2 -translate-y-1/2"
             style={{ transform: `translate(${touchDragState.currentX}px, ${touchDragState.currentY}px) translate(-50%, -50%)` }}
           >
             <div className="w-[64px] overflow-hidden rounded-lg border-2 border-primary bg-card shadow-2xl shadow-primary/30 sm:w-[74px]">
               {touchDragState.item.cover || touchDragState.item.imageUrl || touchDragState.item.image_url ? (
                 <OptimizedImage
                   src={touchDragState.item.cover || touchDragState.item.imageUrl || touchDragState.item.image_url}
                   alt={getItemDisplayName(touchDragState.item)}
                   allowProxy
                   transform={{ width: 320, quality: 75, fit: 'cover' }}
                   className="aspect-[3/4] w-full object-cover opacity-95"
                   containerClassName="w-full h-full"
                 />
               ) : (
                 <div className="flex aspect-[3/4] w-full items-center justify-center bg-secondary">
                   <ImageIcon className="h-6 w-6 text-muted-foreground/60" />
                 </div>
               )}
             </div>
           </div>
         )}
      </main>
    </div>
  );
}
