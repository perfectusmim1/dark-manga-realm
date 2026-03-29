import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  destructive?: boolean;
};

const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Onayla',
  cancelLabel = 'Vazgeç',
  onConfirm,
  destructive = false,
}: ConfirmDialogProps) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent className="max-w-md rounded-[1.75rem] border-border bg-card p-0 shadow-2xl">
      <div className="p-6">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border',
              destructive
                ? 'border-destructive/20 bg-destructive/10 text-destructive'
                : 'border-primary/20 bg-primary/10 text-primary',
            )}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>

          <AlertDialogHeader className="flex-1 space-y-2 text-left">
            <AlertDialogTitle className="text-base sm:text-lg">{title}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-6 text-muted-foreground">
              {description}
            </AlertDialogDescription>
          </AlertDialogHeader>
        </div>

        <AlertDialogFooter className="mt-6">
          <AlertDialogCancel className="rounded-xl"> {cancelLabel} </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(
              'rounded-xl',
              destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
            )}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </div>
    </AlertDialogContent>
  </AlertDialog>
);

export default ConfirmDialog;
