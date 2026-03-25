import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getUserFollowers, getUserFollowing } from '@/lib/profile';
import StaffBadge from '@/components/user/StaffBadge';
import { getStaffTextClassName } from '@/lib/staffRoles';
import { cn } from '@/lib/utils';

interface UserListModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  type: 'followers' | 'following';
}

const UserListModal: React.FC<UserListModalProps> = ({ isOpen, onClose, userId, type }) => {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchUsers = useCallback(async (pageNum: number) => {
    if (loading) return;
    setLoading(true);
    
    try {
      const response = type === 'followers' 
        ? await getUserFollowers(userId, pageNum) 
        : await getUserFollowing(userId, pageNum);
      
      if (response.users) {
        setUsers(prev => pageNum === 1 ? response.users : [...prev, ...response.users]);
        setHasMore(response.users.length === 50);
      }
    } catch (error) {
      console.error(`Error fetching ${type}:`, error);
    } finally {
      setLoading(false);
    }
  }, [userId, type, loading]);

  useEffect(() => {
    if (isOpen) {
      setUsers([]);
      setPage(1);
      setHasMore(true);
      fetchUsers(1);
    }
  }, [isOpen, type, userId]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 50 && hasMore && !loading) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchUsers(nextPage);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md p-0 overflow-hidden bg-background border-border">
        <DialogHeader className="p-4 border-b border-border">
          <DialogTitle>
            {type === 'followers' ? 'Takipçiler' : 'Takip Edilenler'}
          </DialogTitle>
        </DialogHeader>
        
        <div 
          className="h-[400px] overflow-y-auto custom-scrollbar" 
          onScroll={handleScroll}
        >
          <div className="p-4 space-y-4">
            {users.map((user) => (
              <Link 
                key={user.id} 
                to={`/profile/${user.id}`} 
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/50 transition-colors"
                onClick={onClose}
              >
                <Avatar className="w-10 h-10 border border-border">
                  <AvatarImage src={user.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${user.username}`} />
                  <AvatarFallback>{user.username?.substring(0,2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className={cn(
                        'font-semibold',
                        user.role ? getStaffTextClassName(user.role, false) : 'text-foreground'
                      )}
                    >
                      {user.username}
                    </p>
                    <StaffBadge role={user.role} compact />
                  </div>
                </div>
              </Link>
            ))}
            
            {loading && (
              <div className="flex justify-center p-6">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            )}
            
            {!loading && users.length === 0 && (
              <div className="text-center py-12 text-muted-foreground bg-secondary/10 rounded-xl border border-dashed border-border mx-4">
                Henüz kimse yok.
              </div>
            )}
            
            {!loading && hasMore && users.length > 0 && (
              <div className="h-1" />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UserListModal;
