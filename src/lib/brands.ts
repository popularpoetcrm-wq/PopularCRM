export type BrandId = "poet" | "kids" | "tickets";

export type ProductKind = "package" | "trial" | "event";

export type BrandConfig = {
  id: BrandId;
  name: string;
  shortName: string;
  tagline: string;
  /** Public hosts. Empty = no public domain yet (admin-only product line). */
  hosts: string[];
  theme: "poet" | "kids" | "tickets";
  productLine: "theater" | "kids" | "checkout";
  cabinetPath: string;
  primaryLocale: "ru" | "pl";
  /** Soft path on poet domain when brand has no own host */
  softPath?: string;
};

/**
 * Popular org — one CRM:
 * - popularpoet.pl → взрослая студия (ЛК + маркетинг)
 * - Kids → пока без домена (вкладка в админке / soft path /kids)
 * - populartickets.pl → оплата пробных и ивентов (P24-bound)
 */
export const BRANDS: Record<BrandId, BrandConfig> = {
  poet: {
    id: "poet",
    name: "Popular Poet",
    shortName: "Poet",
    tagline: "Театр импровизации",
    hosts: ["popularpoet.pl", "www.popularpoet.pl", "poet.localhost", "localhost"],
    theme: "poet",
    productLine: "theater",
    cabinetPath: "/cabinet",
    primaryLocale: "ru",
  },
  kids: {
    id: "kids",
    name: "Popular Kids",
    shortName: "Kids",
    tagline: "Детская студия (без отдельного домена)",
    hosts: [], // no public domain yet
    theme: "kids",
    productLine: "kids",
    cabinetPath: "/cabinet",
    primaryLocale: "ru",
    softPath: "/kids",
  },
  tickets: {
    id: "tickets",
    name: "Popular Tickets",
    shortName: "Tickets",
    tagline: "Пробные занятия и ивенты",
    hosts: ["populartickets.pl", "www.populartickets.pl", "tickets.localhost"],
    theme: "tickets",
    productLine: "checkout",
    cabinetPath: "/cabinet",
    primaryLocale: "pl",
  },
};

export const ADMIN_BRAND_TABS: BrandId[] = ["poet", "kids"];

/** What populartickets.pl sells online via P24 */
export const TICKETS_PRODUCT_KINDS: ProductKind[] = ["trial", "event"];

export function resolveBrandFromHost(host: string | null): BrandConfig {
  const normalized = (host ?? "localhost").split(":")[0].toLowerCase();
  for (const brand of Object.values(BRANDS)) {
    if (brand.hosts.includes(normalized)) return brand;
  }
  return BRANDS.poet;
}

export function resolveBrandFromPath(pathname: string, hostBrand: BrandConfig): BrandConfig {
  if (pathname === "/kids" || pathname.startsWith("/kids/")) {
    return BRANDS.kids;
  }
  return hostBrand;
}

/** Checkout / P24-bound public URL (trials + events). */
export function getTicketsPublicUrl(): string {
  return (
    process.env.TICKETS_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_TICKETS_URL ||
    "https://populartickets.pl"
  );
}

export function getPoetPublicUrl(): string {
  return process.env.NEXT_PUBLIC_POET_URL || "https://popularpoet.pl";
}

export function paymentReturnUrl(path = "/pay/return"): string {
  return `${getTicketsPublicUrl()}${path}`;
}

export function paymentStatusUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_API_URL ||
    getTicketsPublicUrl() ||
    process.env.NEXT_PUBLIC_APP_URL;
  return `${base}/api/v1/webhooks/przelewy24`;
}

/** Online checkout links for trials/events always on tickets domain. */
export function checkoutUrl(kind: ProductKind, sessionId: string): string {
  const app = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const base =
    app.includes("localhost") || app.includes("127.0.0.1")
      ? app.replace(/\/$/, "")
      : getTicketsPublicUrl();
  if (TICKETS_PRODUCT_KINDS.includes(kind) || kind === "package") {
    return `${base}/pay/${kind}/${sessionId}`;
  }
  return `${base}/pay/${sessionId}`;
}

export function brandById(id: string | null | undefined): BrandConfig {
  if (id && id in BRANDS) return BRANDS[id as BrandId];
  return BRANDS.poet;
}
