import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { getAllMangas, getCharacters } from '@/lib/database';
import { Save, Search, ArrowLeft, Image as ImageIcon } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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

const getItemDisplayName = (item: any) => item?.name || item?.title || '';

const normalizeSearchValue = (value: string) =>
  value.toLocaleLowerCase('tr-TR');

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

export default function TierListEditor() {
  const { id } = useParams<{ id: string }>(); // 'create' or uuid
  const { user } = useAuth();
  const navigate = useNavigate();

  const [title, setTitle] = useState('Benim Sıralamam');
  const [type, setType] = useState<'manga' | 'character'>('manga');
  const [items, setItems] = useState<any[]>([]); // all possible mangas/characters
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
  const autoScrollSpeedRef = useRef(0);
  const autoScrollFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const loadItems = async () => {
      const dbItems = type === 'manga' ? await getAllMangas() : await getCharacters();
      setItems(dbItems || []);
      
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
            setType(data.type === 'character' ? 'character' : 'manga');
            
            const correctDbItems = data.type === 'character' ? await getCharacters() : await getAllMangas();
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

  const filteredUnrankedItems = useMemo(() => {
    const query = normalizeSearchValue(poolSearch.trim());
    const unrankedItems = tierState['unranked'] ?? [];

    if (!query) return unrankedItems;

    return unrankedItems.filter((item) =>
      normalizeSearchValue(getItemDisplayName(item)).includes(query)
    );
  }, [poolSearch, tierState]);

  const onDragStart = (e: React.DragEvent, sourceTierId: string, itemId: string | number) => {
    const idStr = itemId.toString();
    e.dataTransfer.setData('sourceTier', sourceTierId);
    e.dataTransfer.setData('itemId', idStr);
    e.dataTransfer.setData('text/plain', idStr);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(idStr);
  };

  const onDragEnd = () => {
    setDraggingId(null);
    autoScrollSpeedRef.current = 0;
  };

  const onDrop = (e: React.DragEvent, targetTierId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingId(null);
    const sourceTierId = e.dataTransfer.getData('sourceTier');
    const itemId = e.dataTransfer.getData('itemId') || e.dataTransfer.getData('text/plain');

    if (!sourceTierId || !itemId || sourceTierId === targetTierId) return;
    moveItem(itemId, sourceTierId, targetTierId);
  };

  const moveItem = (itemId: string, sourceTierId: string, targetTierId: string) => {
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
  };

  const handleItemClick = (e: React.MouseEvent, id: string, source: string) => {
    e.stopPropagation();
    if (selectedItem?.id === id.toString()) {
        setSelectedItem(null);
    } else {
        setSelectedItem({ id: id.toString(), source });
    }
  };

  const handleTierAreaClick = (targetTierId: string) => {
    if (selectedItem && selectedItem.source !== targetTierId) {
        moveItem(selectedItem.id, selectedItem.source, targetTierId);
    }
  };

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

  const renderTierItemCard = (item: any, sourceTierId: string, widthClass: string, idleClassName: string) => {
    const itemId = item.id.toString();
    const isSelected = selectedItem?.id === itemId;
    const itemLabel = getItemDisplayName(item);

    return (
      <div
        key={item.id}
        draggable
        onDragStart={(e) => onDragStart(e, sourceTierId, item.id)}
        onDragEnd={onDragEnd}
        onClick={(e) => handleItemClick(e, item.id, sourceTierId)}
        className={`${widthClass} aspect-[3/4] rounded-md overflow-hidden cursor-pointer border-2 transition-all bg-secondary flex items-center justify-center relative ${draggingId === itemId ? 'opacity-30' : ''} ${isSelected ? 'border-primary ring-4 ring-primary/20 scale-110 z-10 shadow-lg' : idleClassName}`}
        title={itemLabel}
      >
        {item.cover || item.imageUrl || item.image_url ? (
          <img src={item.cover || item.imageUrl || item.image_url} alt={itemLabel} className="w-full h-full object-cover pointer-events-none" draggable={false} />
        ) : (
          <ImageIcon className="w-6 h-6 text-muted-foreground/50 pointer-events-none" />
        )}

        {isSelected && (
          <>
            <div className="pointer-events-none absolute inset-0 bg-black/35" />
            <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 rounded-md bg-black/70 px-2 py-1 text-center text-[10px] font-medium leading-tight text-white backdrop-blur-sm">
              <span className="block line-clamp-2 break-words">
                {itemLabel}
              </span>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header />
      <main className="container flex-1 py-24 flex flex-col gap-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
           <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => navigate('/tier-lists')}>
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <Input 
                value={title ?? ''} 
                onChange={(e) => setTitle(e.target.value)} 
                className="text-2xl font-bold bg-transparent border border-border focus-visible:ring-0 focus-visible:border-primary w-full max-w-[500px] px-4 py-3 h-auto rounded-xl"
                placeholder="Sıralamana efsane bir başlık ver..."
              />
           </div>
           
           <div className="flex items-center gap-4">
             {(!id || id === 'create') && (
               <Tabs value={type} onValueChange={(v) => {
                 setType(v as any);
                 // Reset tiers when switching type
                 setTierState({ unranked: [], 'S': [], 'A': [], 'B': [], 'C': [], 'D': [], 'F': [] });
               }}>
                 <TabsList>
                   <TabsTrigger value="manga">Mangalar</TabsTrigger>
                   <TabsTrigger value="character">Karakterler</TabsTrigger>
                 </TabsList>
               </Tabs>
             )}
             <Button onClick={handleSave} disabled={isSaving} className="gap-2">
                <Save className="w-4 h-4" /> {isSaving ? 'Kaydediliyor...' : 'Kaydet'}
             </Button>
           </div>
        </div>

        <div className="flex-1 bg-card/50 border border-border rounded-xl shadow-xl overflow-hidden flex flex-col p-4 gap-2">
           {defaultTiers.map(tier => (
              <div 
                key={tier.id} 
                className={`flex border-b border-border min-h-[100px] last:border-b-0 cursor-pointer transition-colors ${selectedItem ? 'hover:bg-primary/5' : ''}`}
                onDrop={(e) => onDrop(e, tier.id)}
                onDragOver={onDragOver}
                onClick={() => handleTierAreaClick(tier.id)}
              >
                  <div className={`w-24 ${tier.color} flex items-center justify-center shadow-inner relative group`}>
                      <Input 
                        value={tierLabels[tier.id] ?? tier.id}
                        onChange={(e) => setTierLabels(prev => ({ ...prev, [tier.id]: e.target.value }))}
                        className="bg-transparent border-none text-center font-bold text-black text-xl h-full w-full focus-visible:ring-0 focus:bg-white/10"
                      />
                  </div>
                  <div className="flex-1 bg-background/50 flex flex-wrap gap-2 p-3 items-center">
                      {tierState[tier.id]?.map((item) =>
                        renderTierItemCard(item, tier.id, 'w-[70px]', 'border-border/50 shadow-md hover:scale-105')
                      )}
                      {tierState[tier.id]?.length === 0 && <span className="text-muted-foreground/30 text-sm font-medium w-full text-center">İçerikleri buraya sürükleyin...</span>}
                  </div>
              </div>
           ))}
        </div>

         {/* Unranked Items Pool */}
         <div className="bg-secondary/20 border border-border rounded-xl p-4">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <h3 className="font-bold flex items-center gap-2 text-muted-foreground">
                Havuz (Sıralanmamış)
              </h3>
              <div className="relative w-full md:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={poolSearch}
                  onChange={(e) => setPoolSearch(e.target.value)}
                  placeholder="İsme göre ara..."
                  className="pl-9"
                />
              </div>
            </div>
            <div 
              className={`flex flex-wrap gap-3 min-h-[150px] p-2 cursor-pointer transition-colors ${selectedItem ? 'hover:bg-primary/5 rounded-lg' : ''}`}
              onDrop={(e) => onDrop(e, 'unranked')}
              onDragOver={onDragOver}
              onClick={() => handleTierAreaClick('unranked')}
            >
               {filteredUnrankedItems.map((item) =>
                 renderTierItemCard(item, 'unranked', 'w-[80px]', 'border-transparent shadow-sm hover:shadow-primary/20 hover:border-primary')
               )}
               {tierState['unranked']?.length === 0 && <span className="text-muted-foreground/50 w-full text-center py-8">Tüm içerikler sıralandı! Mükemmel.</span>}
               {tierState['unranked']?.length > 0 && filteredUnrankedItems.length === 0 && (
                 <span className="text-muted-foreground/50 w-full text-center py-8">
                   Aramanızla eşleşen içerik bulunamadı.
                 </span>
               )}
            </div>
         </div>
      </main>
    </div>
  );
}
