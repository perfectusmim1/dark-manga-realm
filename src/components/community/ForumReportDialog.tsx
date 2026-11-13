import React, { useEffect, useState } from 'react';
import { Flag, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { createForumReport } from '@/lib/forum';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const REPORT_REASONS = [
  'Hakaret / Saygısızlık',
  'Spoiler Etiketi Eksik',
  'Spam / Reklam',
  'Uygunsuz İçerik',
  'Diğer',
] as const;

interface ForumReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: 'topic' | 'post';
  topicId: string;
  postId?: string;
  reportedUserId: string;
  reportedUsername?: string;
}

const ForumReportDialog: React.FC<ForumReportDialogProps> = ({
  open,
  onOpenChange,
  targetType,
  topicId,
  postId,
  reportedUserId,
  reportedUsername,
}) => {
  const { user } = useAuth();
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setReason(REPORT_REASONS[0]);
      setDetails('');
    }
  }, [open]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!user) {
      toast.error('Bildirim göndermek için giriş yapmalısınız.');
      return;
    }

    if (user.id === reportedUserId) {
      toast.error('Kendi içeriğinizi bildiremezsiniz.');
      return;
    }

    if (!reason.trim()) {
      toast.error('Lütfen bir bildirim nedeni seçin.');
      return;
    }

    try {
      setIsSubmitting(true);
      await createForumReport({
        targetType,
        topicId,
        postId,
        reporterId: user.id,
        reportedUserId,
        reason,
        details: details.trim() || undefined,
      });
      toast.success('Bildiriminiz moderasyon ekibine iletildi.');
      onOpenChange(false);
    } catch (error) {
      console.error('Forum report submit error:', error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Bildirim gönderilemedi.';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-2xl border border-border bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <Flag className="h-4 w-4 text-destructive" />
            {targetType === 'post' ? 'Yanıtı Bildir' : 'Konuyu Bildir'}
          </DialogTitle>
          <DialogDescription>
            {reportedUsername
              ? `${reportedUsername} kullanıcısına ait içeriği moderasyon ekibine bildirin.`
              : 'İçeriği moderasyon ekibine bildirin.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="forum-report-reason">Bildirim Nedeni</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="forum-report-reason">
                <SelectValue placeholder="Neden seçin" />
              </SelectTrigger>
              <SelectContent>
                {REPORT_REASONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="forum-report-details">Ek Açıklama (İsteğe bağlı)</Label>
            <Textarea
              id="forum-report-details"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Moderasyon ekibinin incelemesine yardımcı olacak ayrıntıları yazabilirsiniz..."
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Vazgeç
            </Button>
            <Button type="submit" variant="destructive" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Bildirimi Gönder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ForumReportDialog;
