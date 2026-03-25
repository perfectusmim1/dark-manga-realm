import { User } from '@/lib/types';

type StaffRole = User['role'];

const isStaffRole = (role?: StaffRole): role is 'admin' | 'moderator' =>
  role === 'admin' || role === 'moderator';

const getStaffTextClassName = (role?: StaffRole, interactive = true) => {
  if (role === 'admin') {
    return interactive ? 'text-violet-300 hover:text-violet-200' : 'text-violet-300';
  }

  if (role === 'moderator') {
    return interactive ? 'text-orange-300 hover:text-orange-200' : 'text-orange-300';
  }

  return '';
};

export { getStaffTextClassName, isStaffRole };
