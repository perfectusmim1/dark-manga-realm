import { invokeAuthenticatedFunction } from '@/lib/supabase';
import { SupportTicket, SupportTicketCategory, SupportTicketStatus } from '@/lib/types';

interface SupportTicketsResponse {
  success?: boolean;
  message?: string;
  tickets?: SupportTicket[];
  ticket?: SupportTicket;
}

const ensureSuccess = (data: SupportTicketsResponse | null | undefined, fallback: string) => {
  if (!data?.success) {
    throw new Error(data?.message || fallback);
  }
};

export const listSupportTickets = async (): Promise<SupportTicket[]> => {
  const data = await invokeAuthenticatedFunction<SupportTicketsResponse>('support-tickets', {
    action: 'list',
  });

  ensureSuccess(data, 'SUPPORT_TICKETS_LIST_FAILED');
  return Array.isArray(data?.tickets) ? data.tickets : [];
};

export const createSupportTicket = async (payload: {
  subject: string;
  category: SupportTicketCategory;
  message: string;
  imageUrl?: string | null;
}): Promise<SupportTicket> => {
  const data = await invokeAuthenticatedFunction<SupportTicketsResponse>('support-tickets', {
    action: 'create',
    ...payload,
  });

  ensureSuccess(data, 'SUPPORT_TICKET_CREATE_FAILED');
  return data.ticket as SupportTicket;
};

export const replyToSupportTicket = async (payload: {
  ticketId: string;
  message: string;
  imageUrl?: string | null;
}): Promise<SupportTicket> => {
  const data = await invokeAuthenticatedFunction<SupportTicketsResponse>('support-tickets', {
    action: 'reply',
    ...payload,
  });

  ensureSuccess(data, 'SUPPORT_TICKET_REPLY_FAILED');
  return data.ticket as SupportTicket;
};

export const updateSupportTicketStatus = async (payload: {
  ticketId: string;
  status: SupportTicketStatus;
}): Promise<SupportTicket> => {
  const data = await invokeAuthenticatedFunction<SupportTicketsResponse>('support-tickets', {
    action: 'update-status',
    ...payload,
  });

  ensureSuccess(data, 'SUPPORT_TICKET_STATUS_FAILED');
  return data.ticket as SupportTicket;
};
