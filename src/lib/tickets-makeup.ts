import { getEnv } from "@/lib/env";

function ticketsBaseUrl() {
  const env = getEnv();
  return (
    env.TICKETS_PUBLIC_URL ||
    env.NEXT_PUBLIC_TICKETS_URL ||
    "https://www.populartickets.pl"
  ).replace(/\/$/, "");
}

function crmSecret() {
  const env = getEnv();
  const secret =
    env.CRM_CHECKOUT_SECRET?.trim() || env.CRM_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "CRM_CHECKOUT_SECRET (или CRM_WEBHOOK_SECRET) не задан в Vercel",
    );
  }
  return secret;
}

export type TicketsTrial = {
  id: string;
  slug: string;
  title: string;
  starts_at: string;
  venue: string;
  total_tickets: number;
  remaining: number;
  price_grosze: number;
};

export type TicketsListing = TicketsTrial & {
  listing_kind: "trial" | "performance" | "special";
  source?: string;
};

export async function fetchTicketsTrials(): Promise<TicketsTrial[]> {
  const res = await fetch(`${ticketsBaseUrl()}/api/crm/trials`, {
    headers: { Authorization: `Bearer ${crmSecret()}` },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    trials?: TicketsTrial[];
    error?: string;
  };
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `Tickets trials HTTP ${res.status}`);
  }
  return json.trials ?? [];
}

/** Trials + performances + specials for CRM calendar (populartickets / poet showcase). */
export async function fetchTicketsListings(
  month?: string,
): Promise<TicketsListing[]> {
  const q = month ? `?month=${encodeURIComponent(month)}` : "";
  const res = await fetch(`${ticketsBaseUrl()}/api/crm/events${q}`, {
    headers: { Authorization: `Bearer ${crmSecret()}` },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    events?: TicketsListing[];
    error?: string;
  };
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `Tickets events HTTP ${res.status}`);
  }
  return json.events ?? [];
}

export async function reserveTicketsMakeupTrial(input: {
  crmMakeupCreditId: string;
  eventId: string;
  buyerEmail: string;
  buyerName?: string;
}) {
  const res = await fetch(`${ticketsBaseUrl()}/api/crm/makeup-trial`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${crmSecret()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      crm_makeup_credit_id: input.crmMakeupCreditId,
      event_id: input.eventId,
      buyer_email: input.buyerEmail,
      buyer_name: input.buyerName,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    ticket_id?: string;
    order_id?: string;
    event_id?: string;
    starts_at?: string;
    title?: string;
    slug?: string;
    remaining?: number;
    already?: boolean;
  };
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `Tickets makeup-trial HTTP ${res.status}`);
  }
  return json;
}

export async function cancelTicketsMakeupTrial(input: {
  crmMakeupCreditId: string;
  ticketId?: string;
}) {
  const res = await fetch(`${ticketsBaseUrl()}/api/crm/makeup-trial/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${crmSecret()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      crm_makeup_credit_id: input.crmMakeupCreditId,
      ticket_id: input.ticketId,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `Tickets makeup cancel HTTP ${res.status}`);
  }
  return json;
}
