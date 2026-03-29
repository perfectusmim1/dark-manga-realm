import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, json, requireRequester } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

type TicketStatus = "open" | "waiting_staff" | "waiting_user" | "closed";
type TicketCategory = "bug_report" | "account" | "content_issue" | "ban_appeal" | "other";
type AuthorRole = "user" | "moderator" | "admin" | "system";

const STAFF_ROLES = new Set(["admin", "moderator"]);
const TICKET_STATUSES = new Set<TicketStatus>(["open", "waiting_staff", "waiting_user", "closed"]);
const TICKET_CATEGORIES = new Set<TicketCategory>(["bug_report", "account", "content_issue", "ban_appeal", "other"]);
const TICKET_CREATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;

type TicketRow = {
  id: string;
  user_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  appeal_account_email: string | null;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  closed_at?: string | null;
  closed_by?: string | null;
};

type TicketMessageRow = {
  id: string;
  ticket_id: string;
  author_id: string | null;
  author_name: string;
  author_role: AuthorRole;
  content: string;
  image_url: string | null;
  created_at: string;
};

const isStaff = (role: string) => STAFF_ROLES.has(role);

const normalizeImageUrl = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.href;
  } catch {
    return null;
  }
};

const normalizeEmail = (value?: string | null) => {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  return isValidEmail ? trimmed : null;
};

const loadUserMap = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  userIds: string[],
) => {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueUserIds.length === 0) {
    return new Map<string, { username: string; email: string }>();
  }

  const { data, error } = await serviceClient
    .from("users")
    .select("id, username, email")
    .in("id", uniqueUserIds);

  if (error) {
    throw error;
  }

  return new Map((data || []).map((user) => [
    user.id,
    {
      username: user.username,
      email: user.email,
    },
  ]));
};

const serializeTicket = (
  ticket: TicketRow,
  userMap: Map<string, { username: string; email: string }>,
  messages: TicketMessageRow[],
) => {
  const owner = userMap.get(ticket.user_id);
  const userName = owner?.username || ticket.contact_name?.trim() || "Misafir";
  const userEmail = owner?.email || ticket.contact_email?.trim() || "";

  return {
    id: ticket.id,
    userId: ticket.user_id,
    userName,
    userEmail,
    contactName: ticket.contact_name,
    contactEmail: ticket.contact_email,
    appealAccountEmail: ticket.appeal_account_email,
    isGuestTicket: !ticket.user_id,
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    imageUrl: ticket.image_url,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    lastMessageAt: ticket.last_message_at,
    messages: messages.map((message) => ({
      id: message.id,
      ticketId: message.ticket_id,
      authorId: message.author_id,
      authorName: message.author_name,
      authorRole: message.author_role,
      content: message.content,
      imageUrl: message.image_url,
      createdAt: message.created_at,
    })),
  };
};

const loadTickets = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  options: { requesterId: string; requesterRole: string; ticketId?: string },
) => {
  let query = serviceClient
    .from("support_tickets")
    .select("id, user_id, contact_name, contact_email, appeal_account_email, subject, category, status, image_url, created_at, updated_at, last_message_at")
    .order("last_message_at", { ascending: false });

  if (options.ticketId) {
    query = query.eq("id", options.ticketId);
  } else if (!isStaff(options.requesterRole)) {
    query = query.eq("user_id", options.requesterId);
  }

  const { data: tickets, error: ticketsError } = await query;
  if (ticketsError) {
    throw ticketsError;
  }

  const ticketRows = (tickets || []) as TicketRow[];
  if (ticketRows.length === 0) {
    return [];
  }

  const ticketIds = ticketRows.map((ticket) => ticket.id);
  const { data: messages, error: messagesError } = await serviceClient
    .from("support_ticket_messages")
    .select("id, ticket_id, author_id, author_name, author_role, content, image_url, created_at")
    .in("ticket_id", ticketIds)
    .order("created_at", { ascending: true });

  if (messagesError) {
    throw messagesError;
  }

  const userMap = await loadUserMap(serviceClient, ticketRows.map((ticket) => ticket.user_id));
  const groupedMessages = new Map<string, TicketMessageRow[]>();
  for (const message of (messages || []) as TicketMessageRow[]) {
    const existingGroup = groupedMessages.get(message.ticket_id);
    if (existingGroup) {
      existingGroup.push(message);
      continue;
    }
    groupedMessages.set(message.ticket_id, [message]);
  }

  return ticketRows.map((ticket) =>
    serializeTicket(ticket, userMap, groupedMessages.get(ticket.id) || [])
  );
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, message: "Unsupported method" }, 405);
  }

  try {
    const auth = await requireRequester(req);
    if (!auth.ok) {
      return auth.response;
    }

    let payload: {
      action?: string;
      ticketId?: string;
      subject?: string;
      category?: TicketCategory;
      message?: string;
      imageUrl?: string | null;
      appealAccountEmail?: string | null;
      status?: TicketStatus;
    } = {};

    try {
      payload = await req.json();
    } catch {
      payload = {};
    }

    const action = payload.action || "list";
    const requesterId = auth.requesterProfile.id;
    const requesterRole = auth.requesterProfile.role;
    const requesterIsStaff = isStaff(requesterRole);

    if (action === "list") {
      const tickets = await loadTickets(auth.serviceClient, {
        requesterId,
        requesterRole,
      });

      return json({
        success: true,
        tickets,
      });
    }

    if (action === "create") {
      const subject = payload.subject?.trim() || "";
      const category = payload.category;
      const message = payload.message?.trim() || "";
      const imageUrl = normalizeImageUrl(payload.imageUrl);
      const appealAccountEmail = normalizeEmail(payload.appealAccountEmail);

      if (subject.length < 3 || message.length < 1) {
        return json({ success: false, message: "Başlık ve açıklama zorunlu" }, 400);
      }

      if (!category || !TICKET_CATEGORIES.has(category)) {
        return json({ success: false, message: "Geçersiz kategori" }, 400);
      }

      if (payload.imageUrl?.trim() && !imageUrl) {
        return json({ success: false, message: "Geçerli bir http/https görsel linki girin" }, 400);
      }

      if (category === "ban_appeal" && !appealAccountEmail) {
        return json({ success: false, message: "Ban itirazı için banlanan hesabın e-postası zorunlu" }, 400);
      }

      if (payload.appealAccountEmail?.trim() && !appealAccountEmail) {
        return json({ success: false, message: "Geçerli bir hesap e-postası girin" }, 400);
      }

      if (!requesterIsStaff) {
        const recentTicketWindowStart = new Date(Date.now() - TICKET_CREATION_COOLDOWN_MS).toISOString();
        const { data: recentTicket, error: recentTicketError } = await auth.serviceClient
          .from("support_tickets")
          .select("id, created_at")
          .eq("user_id", requesterId)
          .gte("created_at", recentTicketWindowStart)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (recentTicketError) {
          console.error("Recent ticket lookup failed:", recentTicketError);
          return json({ success: false, message: "Bilet limiti kontrol edilemedi" }, 500);
        }

        if (recentTicket) {
          return json({
            success: false,
            message: "24 saat içinde yalnızca 1 destek bileti oluşturabilirsin.",
          }, 429);
        }
      }

      const now = new Date().toISOString();
      const { data: createdTicket, error: ticketError } = await auth.serviceClient
        .from("support_tickets")
        .insert({
          user_id: requesterId,
          contact_name: auth.requesterProfile.username,
          contact_email: auth.requesterProfile.email,
          appeal_account_email: appealAccountEmail,
          subject,
          category,
          status: "open",
          image_url: imageUrl,
          created_at: now,
          updated_at: now,
          last_message_at: now,
        })
        .select("id")
        .single();

      if (ticketError || !createdTicket) {
        console.error("Ticket create failed:", ticketError);
        return json({ success: false, message: "Bilet oluşturulamadı" }, 500);
      }

      const { error: messageError } = await auth.serviceClient
        .from("support_ticket_messages")
        .insert({
          ticket_id: createdTicket.id,
          author_id: requesterId,
          author_name: auth.requesterProfile.username,
          author_role: requesterRole,
          content: message,
          image_url: imageUrl,
          created_at: now,
        });

      if (messageError) {
        console.error("Ticket first message failed:", messageError);
        try {
          await auth.serviceClient
            .from("support_tickets")
            .delete()
            .eq("id", createdTicket.id);
        } catch (cleanupError) {
          console.error("Ticket cleanup after first message failure failed:", cleanupError);
        }
        return json({ success: false, message: "Bilet mesajı kaydedilemedi" }, 500);
      }

      const [ticket] = await loadTickets(auth.serviceClient, {
        requesterId,
        requesterRole,
        ticketId: createdTicket.id,
      });

      return json({
        success: true,
        ticket,
      });
    }

    const ticketId = payload.ticketId?.trim();
    if (!ticketId) {
      return json({ success: false, message: "ticketId is required" }, 400);
    }

    const { data: targetTicket, error: targetTicketError } = await auth.serviceClient
      .from("support_tickets")
      .select("id, user_id, status, updated_at, last_message_at, closed_at, closed_by")
      .eq("id", ticketId)
      .maybeSingle();

    if (targetTicketError) {
      console.error("Ticket lookup failed:", targetTicketError);
      return json({ success: false, message: "Bilet bulunamadı" }, 500);
    }

    if (!targetTicket) {
      return json({ success: false, message: "Bilet bulunamadı" }, 404);
    }

    if (!requesterIsStaff && targetTicket.user_id !== requesterId) {
      return json({ success: false, message: "Bu bilete erişim yok" }, 403);
    }

    if (action === "delete") {
      if (requesterIsStaff) {
        return json({ success: false, message: "Staff ticket silemez" }, 403);
      }

      const { error: deleteMessagesError } = await auth.serviceClient
        .from("support_ticket_messages")
        .delete()
        .eq("ticket_id", ticketId);

      if (deleteMessagesError) {
        console.error("Ticket messages delete failed:", deleteMessagesError);
        return json({ success: false, message: "Bilet mesajları silinemedi" }, 500);
      }

      const { error: deleteTicketError } = await auth.serviceClient
        .from("support_tickets")
        .delete()
        .eq("id", ticketId)
        .eq("user_id", requesterId);

      if (deleteTicketError) {
        console.error("Ticket delete failed:", deleteTicketError);
        return json({ success: false, message: "Bilet silinemedi" }, 500);
      }

      return json({
        success: true,
        ticketId,
      });
    }

    if (action === "reply") {
      const message = payload.message?.trim() || "";
      const imageUrl = normalizeImageUrl(payload.imageUrl);

      if (!message) {
        return json({ success: false, message: "Yanıt gerekli" }, 400);
      }

      if (payload.imageUrl?.trim() && !imageUrl) {
        return json({ success: false, message: "Geçerli bir http/https görsel linki girin" }, 400);
      }

      if (targetTicket.status === "closed") {
        return json({
          success: false,
          message: requesterIsStaff
            ? "Kapalı bilete yanıt göndermek için önce bileti yeniden aç"
            : "Kapalı bilette kullanıcı yanıtı kapalı",
        }, 409);
      }

      const now = new Date().toISOString();
      const nextStatus: TicketStatus = requesterIsStaff ? "waiting_user" : "waiting_staff";

      const { data: insertedReply, error: replyError } = await auth.serviceClient
        .from("support_ticket_messages")
        .insert({
          ticket_id: ticketId,
          author_id: requesterId,
          author_name: auth.requesterProfile.username,
          author_role: requesterRole,
          content: message,
          image_url: imageUrl,
          created_at: now,
        })
        .select("id")
        .single();

      if (replyError || !insertedReply) {
        console.error("Ticket reply failed:", replyError);
        return json({ success: false, message: "Yanıt kaydedilemedi" }, 500);
      }

      const { error: updateError } = await auth.serviceClient
        .from("support_tickets")
        .update({
          status: nextStatus,
          updated_at: now,
          last_message_at: now,
          closed_at: null,
          closed_by: null,
        })
        .eq("id", ticketId);

      if (updateError) {
        console.error("Ticket status update failed:", updateError);
        try {
          await auth.serviceClient
            .from("support_ticket_messages")
            .delete()
            .eq("id", insertedReply.id);
        } catch (cleanupError) {
          console.error("Ticket reply cleanup failed:", cleanupError);
        }
        try {
          await auth.serviceClient
            .from("support_tickets")
            .update({
              status: targetTicket.status,
              updated_at: targetTicket.updated_at,
              last_message_at: targetTicket.last_message_at,
              closed_at: targetTicket.closed_at ?? null,
              closed_by: targetTicket.closed_by ?? null,
            })
            .eq("id", ticketId);
        } catch (restoreError) {
          console.error("Ticket state restore after reply failure failed:", restoreError);
        }
        return json({ success: false, message: "Bilet güncellenemedi" }, 500);
      }

      const [ticket] = await loadTickets(auth.serviceClient, {
        requesterId,
        requesterRole,
        ticketId,
      });

      return json({ success: true, ticket });
    }

    if (action === "update-status") {
      if (!requesterIsStaff) {
        return json({ success: false, message: "Not authorized" }, 403);
      }

      const status = payload.status;
      if (!status || !TICKET_STATUSES.has(status)) {
        return json({ success: false, message: "Geçersiz durum" }, 400);
      }

      const now = new Date().toISOString();
      const { error: statusError } = await auth.serviceClient
        .from("support_tickets")
        .update({
          status,
          updated_at: now,
          closed_at: status === "closed" ? now : null,
          closed_by: status === "closed" ? requesterId : null,
        })
        .eq("id", ticketId);

      if (statusError) {
        console.error("Ticket close/open failed:", statusError);
        return json({ success: false, message: "Bilet durumu güncellenemedi" }, 500);
      }

      const [ticket] = await loadTickets(auth.serviceClient, {
        requesterId,
        requesterRole,
        ticketId,
      });

      return json({ success: true, ticket });
    }

    return json({ success: false, message: "Unknown action" }, 400);
  } catch (error) {
    console.error("Unexpected error in support-tickets:", error);
    return json({ success: false, message: "An unexpected error occurred" }, 500);
  }
});
