import React from 'react';
import { Crown, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { User } from '@/lib/types';
import { isStaffRole } from '@/lib/staffRoles';
import { cn } from '@/lib/utils';

type StaffRole = User['role'];

interface StaffBadgeProps {
  role?: StaffRole;
  compact?: boolean;
  className?: string;
}

const StaffBadge: React.FC<StaffBadgeProps> = ({ role, compact = false, className }) => {
  if (!isStaffRole(role)) {
    return null;
  }

  const Icon = role === 'admin' ? Crown : ShieldCheck;
  const label = role === 'admin' ? 'Admin' : compact ? 'Mod' : 'Moderatör';

  return (
    <Badge
      variant="outline"
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold',
        compact ? 'h-5 px-1.5 text-[10px]' : 'h-6 px-2.5 text-[11px]',
        role === 'admin'
          ? 'border-violet-400/30 bg-violet-500/10 text-violet-200'
          : 'border-orange-400/30 bg-orange-500/10 text-orange-200',
        className
      )}
    >
      <Icon className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      <span>{label}</span>
    </Badge>
  );
};

export default StaffBadge;
