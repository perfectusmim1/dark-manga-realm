import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import { supabase } from '@/lib/supabase';
import { getAllMangas, getCharacters } from '@/lib/database';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Edit, Globe, Lock, ImageIcon, Trophy, User } from 'lucide-react';

const defaultTiers = [
  { id: 'S', color: 'bg-red-500' },
  { id: 'A', color: 'bg-orange-500' },
  { id: 'B', color: 'bg-amber-500' },
  { id: 'C', color: 'bg-yellow-500' },
  { id: 'D', color: 'bg-green-500' },
  { id: 'F', color: 'bg-gray-500' },
];

export default function TierListView() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tierList, setTierList] = useState<any>(null);
  const [tierState, setTierState] = useState<Record<string, any[]>>({});
  const [tierLabels, setTierLabels] = useState<Record<string, string>>({
    'S': 'S', 'A': 'A', 'B': 'B', 'C': 'C', 'D': 'D'
  });
  const [loading, setLoading] = useState(true);
  const [ownerName, setOwnerName] = useState('');

  const isOwner = user?.id === tierList?.user_id;

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      setLoading(true);

      const { data, error } = await supabase.from('tier_lists').select('*').eq('id', id).single();
      if (error || !data) {
        navigate('/tier-lists');
        return;
      }

      setTierList(data);
      setTierLabels(data.tier_labels || { 'S': 'S', 'A': 'A', 'B': 'B', 'C': 'C', 'D': 'D' });

      const { data: profile } = await supabase.from('public_profiles').select('username').eq('id', data.user_id).single();
      setOwnerName(profile?.username || 'Anonim');

      const allItems = data.type === 'character' ? await getCharacters() : await getAllMangas();
      const savedTiers = data.items || {};

      const resolved: Record<string, any[]> = {};
      defaultTiers.forEach(t => {
        resolved[t.id] = (savedTiers[t.id] || [])
          .map((mid: string) => allItems?.find(x => x.id === mid))
          .filter(Boolean);
      });

      setTierState(resolved);
      setLoading(false);
    };

    load();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container py-24 flex flex-col gap-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-[400px] w-full rounded-xl" />
        </main>
      </div>
    );
  }

  if (!tierList) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-24 flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold">{tierList.title}</h1>
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                <Link to={`/profile/${tierList.user_id}`} className="flex items-center gap-1 hover:text-primary transition-colors">
                  <User className="w-3.5 h-3.5" />
                  {ownerName}
                </Link>
                <span>•</span>
                <Badge variant="outline" className="text-[10px]">
                  {tierList.type === 'character' ? 'Karakter' : 'Manga'}
                </Badge>
                <span>•</span>
                <span>{new Date(tierList.created_at).toLocaleDateString('tr-TR')}</span>
              </div>
            </div>
          </div>

          {isOwner && (
            <Button onClick={() => navigate(`/tier-lists/${id}/edit`)} className="gap-2">
              <Edit className="w-4 h-4" /> Düzenle
            </Button>
          )}
        </div>

        <div className="bg-card/50 border border-border rounded-xl shadow-xl overflow-hidden flex flex-col">
          {defaultTiers.map(tier => {
            const items = tierState[tier.id] || [];
            return (
              <div key={tier.id} className="flex border-b border-border min-h-[90px] last:border-b-0">
                <div className={`w-24 ${tier.color} flex items-center justify-center font-bold text-black text-2xl shadow-inner shrink-0`}>
                  {tierLabels[tier.id] || tier.id}
                </div>
                <div className="flex-1 bg-background/50 flex flex-wrap gap-2 p-3 items-center">
                  {items.map((item: any) => (
                    <div
                      key={item.id}
                      className="w-[70px] aspect-[3/4] rounded-md overflow-hidden border border-border/50 shadow-md bg-secondary flex items-center justify-center relative group"
                      title={item.name || item.title}
                    >
                      {item.cover || item.imageUrl || item.image_url ? (
                        <img
                          src={item.cover || item.imageUrl || item.image_url}
                          alt={item.name || item.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <ImageIcon className="w-6 h-6 text-muted-foreground/50" />
                      )}
                      <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1">
                        <span className="text-[9px] text-white font-medium leading-tight line-clamp-2">
                          {item.name || item.title}
                        </span>
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && (
                    <span className="text-muted-foreground/30 text-sm font-medium w-full text-center">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
