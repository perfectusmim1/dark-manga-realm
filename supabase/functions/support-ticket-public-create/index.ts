import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, json } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

type TicketCategory = "bug_report" | "account" | "content_issue" | "ban_appeal" | "other";

const TICKET_CATEGORIES = new Set<TicketCategory>(["bug_report", "account", "content_issue", "ban_appeal", "other"]);
const TICKET_CREATION_COOLDOWN_MS = 3 * 60 * 60 * 1000;
const PUBLIC_TICKET_CREATION_COOLDOWN_MESSAGE = "Aynı iletişim e-postasıyla 3 saatte yalnızca 1 destek bileti oluşturabilirsin.";

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

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
};

const normalizeContactName = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length >= 2 ? trimmed : null;
};

const getRateLimitMessage = (message?: string | null) => {
  if (!message) {
    return null;
  }

  if (message.includes("3 saatte yalnızca 1 destek bileti")) {
    return message;
  }

  return null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, message: "Unsupported method" }, 405);
  }

  const serviceClient = createServiceClient();

  try {
    let payload: {
      subject?: string;
      category?: TicketCategory;
      message?: string;
      imageUrl?: string | null;
      contactName?: string;
      contactEmail?: string;
      appealAccountEmail?: string | null;
    } = {};

    try {
      payload = await req.json();
    } catch {
      payload = {};
    }

    const subject = payload.subject?.trim() || "";
    const category = payload.category;
    const message = payload.message?.trim() || "";
    const imageUrl = normalizeImageUrl(payload.imageUrl);
    const contactName = normalizeContactName(payload.contactName);
    const contactEmail = normalizeEmail(payload.contactEmail);
    const appealAccountEmail = normalizeEmail(payload.appealAccountEmail);

    if (subject.length < 3 || message.length < 1) {
      return json({ success: false, message: "Başlık ve açıklama zorunlu" }, 400);
    }

    if (!category || !TICKET_CATEGORIES.has(category)) {
      return json({ success: false, message: "Geçersiz kategori" }, 400);
    }

    if (!contactName || !contactEmail) {
      return json({ success: false, message: "İsim ve iletişim e-postası zorunlu" }, 400);
    }

    if (category === "ban_appeal" && !appealAccountEmail) {
      return json({ success: false, message: "Ban itirazı için banlanan hesabın e-postası zorunlu" }, 400);
    }

    if (payload.appealAccountEmail?.trim() && !appealAccountEmail) {
      return json({ success: false, message: "Geçerli bir hesap e-postası girin" }, 400);
    }

    if (payload.imageUrl?.trim() && !imageUrl) {
      return json({ success: false, message: "Geçerli bir http/https görsel linki girin" }, 400);
    }

    const recentTicketWindowStart = new Date(Date.now() - TICKET_CREATION_COOLDOWN_MS).toISOString();
    const { data: recentTicket, error: recentTicketError } = await serviceClient
      .from("support_tickets")
      .select("id, created_at")
      .eq("contact_email", contactEmail)
      .gte("created_at", recentTicketWindowStart)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentTicketError) {
      console.error("Public ticket rate-limit lookup failed:", recentTicketError);
      return json({ success: false, message: "Bilet limiti kontrol edilemedi" }, 500);
    }

    if (recentTicket) {
      return json({
        success: false,
        message: PUBLIC_TICKET_CREATION_COOLDOWN_MESSAGE,
      }, 429);
    }

    const now = new Date().toISOString();
    const { data: createdTicket, error: ticketError } = await serviceClient
      .from("support_tickets")
      .insert({
        user_id: null,
        contact_name: contactName,
        contact_email: contactEmail,
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
      console.error("Public ticket create failed:", ticketError);
      const rateLimitMessage = getRateLimitMessage(ticketError?.message);
      if (rateLimitMessage) {
        return json({ success: false, message: rateLimitMessage }, 429);
      }
      return json({ success: false, message: "Bilet oluşturulamadı" }, 500);
    }

    const { error: messageError } = await serviceClient
      .from("support_ticket_messages")
      .insert({
        ticket_id: createdTicket.id,
        author_id: null,
        author_name: contactName,
        author_role: "user",
        content: message,
        image_url: imageUrl,
        created_at: now,
      });

    if (messageError) {
      console.error("Public ticket first message failed:", messageError);
      try {
        await serviceClient
          .from("support_tickets")
          .delete()
          .eq("id", createdTicket.id);
      } catch (cleanupError) {
        console.error("Public ticket cleanup failed:", cleanupError);
      }
      return json({ success: false, message: "Bilet mesajı kaydedilemedi" }, 500);
    }

    return json({
      success: true,
      ticket: {
        id: createdTicket.id,
        userId: null,
        userName: contactName,
        userEmail: contactEmail,
        contactName,
        contactEmail,
        appealAccountEmail,
        isGuestTicket: true,
        subject,
        category,
        status: "open",
        imageUrl,
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
        messages: [{
          id: crypto.randomUUID(),
          ticketId: createdTicket.id,
          authorId: null,
          authorName: contactName,
          authorRole: "user",
          content: message,
          imageUrl,
          createdAt: now,
        }],
      },
    });
  } catch (error) {
    console.error("Unexpected error in support-ticket-public-create:", error);
    return json({ success: false, message: "An unexpected error occurred" }, 500);
  }
});
