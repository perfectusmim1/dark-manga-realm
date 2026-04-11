import { User } from '@/lib/types';

type StaffRole = User['role'];

const isStaffRole = (role?: StaffRole): role is 'admin' | 'moderator' =>
  role === 'admin' || role === 'moderator';

const getStaffTextClassName = (role?: StaffRole, interactive = true) => {
  if (role === 'admin') {
    return interactive ? 'text-[#d77878] hover:text-[#e08a8a]' : 'text-[#d77878]';
  }

  if (role === 'moderator') {
    return interactive ? 'text-orange-100 hover:text-orange-50' : 'text-orange-100';
  }

  return '';
};

export { getStaffTextClassName, isStaffRole };
