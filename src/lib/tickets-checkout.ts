import { getEnv } from "@/lib/env";

export type TicketsCheckoutInput = {
  crmPaymentId: string;
  amount: number;
  currency?: string;
  description: string;
  buyerEmail: string;
  buyerName?: string;
  payerName?: string;
  invoiceNumber?: string;
};

export type TicketsCheckoutResult = {
  ok: true;
  checkout_url: string;
  order_id: string;
  crm_payment_id: string;
};

function ticketsBaseUrl() {
  const env = getEnv();
  return (
    env.TICKETS_PUBLIC_URL ||
    env.NEXT_PUBLIC_TICKETS_URL ||
    "https://www.populartickets.pl"
  ).replace(/\/$/, "");
}

function appBaseUrl() {
  return (getEnv().NEXT_PUBLIC_APP_URL || "https://popularcrm.vercel.app").replace(
    /\/$/,
    "",
  );
}

/** Create (or reuse) a PopularTickets CRM checkout that charges via P24. */
export async function createTicketsCrmCheckout(
  input: TicketsCheckoutInput,
): Promise<TicketsCheckoutResult> {
  const env = getEnv();
  const secret = env.CRM_CHECKOUT_SECRET?.trim();
  if (!secret) {
    throw new Error("CRM_CHECKOUT_SECRET не задан — нельзя открыть кассу Tickets");
  }

  const returnUrl = `${appBaseUrl()}/pay/return?payment_id=${encodeURIComponent(input.crmPaymentId)}`;
  const webhookUrl = `${appBaseUrl()}/api/v1/webhooks/tickets`;

  const res = await fetch(`${ticketsBaseUrl()}/api/crm/checkout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      crm_payment_id: input.crmPaymentId,
      amount: input.amount,
      currency: input.currency ?? "PLN",
      description: input.description,
      buyer_email: input.buyerEmail,
      buyer_name: input.buyerName,
      payer_name: input.payerName ?? input.buyerName,
      invoice_number: input.invoiceNumber,
      return_url: returnUrl,
      webhook_url: webhookUrl,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as Partial<TicketsCheckoutResult> & {
    error?: string;
    message?: string;
  };

  if (!res.ok || !json.ok || !json.checkout_url) {
    throw new Error(
      json.error || json.message || `Tickets checkout HTTP ${res.status}`,
    );
  }

  return {
    ok: true,
    checkout_url: json.checkout_url,
    order_id: String(json.order_id ?? ""),
    crm_payment_id: String(json.crm_payment_id ?? input.crmPaymentId),
  };
}

export function hasTicketsCheckout(): boolean {
  const env = getEnv();
  return Boolean(env.CRM_CHECKOUT_SECRET?.trim());
}
