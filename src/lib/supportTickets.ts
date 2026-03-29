import { invokeAuthenticatedFunction, supabase } from '@/lib/supabase';
import { SupportTicket, SupportTicketCategory, SupportTicketStatus } from '@/lib/types';

interface SupportTicketsResponse {
  success?: boolean;
  message?: string;
  tickets?: SupportTicket[];
  ticket?: SupportTicket;
  ticketId?: string;
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
  appealAccountEmail?: string | null;
}): Promise<SupportTicket> => {
  const data = await invokeAuthenticatedFunction<SupportTicketsResponse>('support-tickets', {
    action: 'create',
    ...payload,
  });

  ensureSuccess(data, 'SUPPORT_TICKET_CREATE_FAILED');
  return data.ticket as SupportTicket;
};

export const createPublicSupportTicket = async (payload: {
  subject: string;
  category: SupportTicketCategory;
  message: string;
  imageUrl?: string | null;
  contactName: string;
  contactEmail: string;
  appealAccountEmail?: string | null;
}): Promise<SupportTicket> => {
  const { data, error } = await supabase.functions.invoke<SupportTicketsResponse>('support-ticket-public-create', {
    body: payload,
  });

  if (error) {
    throw error;
  }

  ensureSuccess(data, 'PUBLIC_SUPPORT_TICKET_CREATE_FAILED');
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

export const deleteSupportTicket = async (ticketId: string): Promise<string> => {
  const data = await invokeAuthenticatedFunction<SupportTicketsResponse>('support-tickets', {
    action: 'delete',
    ticketId,
  });

  ensureSuccess(data, 'SUPPORT_TICKET_DELETE_FAILED');
  if (!data?.ticketId) {
    throw new Error('SUPPORT_TICKET_DELETE_FAILED');
  }

  return data.ticketId;
};
