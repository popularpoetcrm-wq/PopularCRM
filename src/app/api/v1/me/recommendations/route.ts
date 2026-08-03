import { getSessionUser } from "@/lib/auth";
import { getTicketsPublicUrl } from "@/lib/brands";
import { getExtendedDemo } from "@/lib/demo-ops";
import { hasSupabase } from "@/lib/env";
import { jsonError, jsonOk } from "@/lib/api";

type Trial = {
  id: string;
  slug: string;
  title: string;
  starts_at: string;
  venue: string;
  remaining: number;
};

function normalized(value: string | null | undefined) {
  return (value ?? "").toLocaleLowerCase("ru-RU");
}

function directionOf(value: string | null | undefined) {
  const text = normalized(value);
  if (/(импро|impro)/.test(text)) return "impro";
  if (/(акт[её]р|acting)/.test(text)) return "acting";
  return null;
}

function makeRecommendations(
  trials: Trial[],
  currentGroups: Array<{ title?: string | null; direction?: string | null }>,
) {
  const directions = new Set(
    currentGroups
      .flatMap((group) => [directionOf(group.direction), directionOf(group.title)])
      .filter((direction): direction is "impro" | "acting" => Boolean(direction)),
  );
  const desired = directions.has("impro") && !directions.has("acting")
    ? "acting"
    : directions.has("acting") && !directions.has("impro")
      ? "impro"
      : null;
  const suitable = desired
    ? trials.filter((trial) => directionOf(trial.title) === desired)
    : trials;
  const visible = (suitable.length ? suitable : trials).slice(0, 3);

  return visible.map((trial) => ({
    ...trial,
    reason:
      desired === "acting"
        ? "Ты ходишь на импровизацию — актёрское даст опору в сценах и персонажах."
        : desired === "impro"
          ? "Ты ходишь на актёрское — импровизация добавит свободы и реакции в моменте."
          : "Новое направление можно сначала спокойно попробовать на пробном.",
    href: `${getTicketsPublicUrl().replace(/\/$/, "")}/ru/events/${encodeURIComponent(trial.slug)}`,
  }));
}

/**
 * Soft cross-sell for current clients. Trial creation remains in PopularTickets;
 * CRM receives only the live public inventory and never exposes the shared secret.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);

  if (!hasSupabase() || user.mode === "demo") {
    const now = Date.now();
    const state = getExtendedDemo();
    const currentGroups = state.groups
      .filter((group) =>
        state.enrollments.some(
          (enrollment) =>
            enrollment.group_id === group.id &&
            enrollment.student_person_id === user.personId &&
            enrollment.status === "active",
        ),
      )
      .map((group) => ({ title: group.title }));
    const trials = state.offers
      .filter(
        (offer) =>
          offer.product_kind === "trial" &&
          offer.status === "open" &&
          new Date(offer.starts_at).getTime() > now,
      )
      .map((offer) => ({
        id: offer.id,
        slug: offer.id,
        title: offer.title,
        starts_at: offer.starts_at,
        venue: "Popular Poet",
        remaining: offer.capacity,
      }));
    return jsonOk({
      recommendations: makeRecommendations(trials, currentGroups).map((item) => ({
        ...item,
        href: "/pay",
      })),
      source: "demo",
    });
  }

  try {
    const [{ getCabinetDashboardDb }, { fetchTicketsTrials }] = await Promise.all([
      import("@/lib/supabase-data"),
      import("@/lib/tickets-makeup"),
    ]);
    const [dashboard, trials] = await Promise.all([
      getCabinetDashboardDb(user.personId, user.tenantId),
      fetchTicketsTrials(),
    ]);
    const currentGroups = (dashboard.groups ?? []).map((group) => ({
      title: group.title,
      direction: group.direction,
    }));
    const available = trials.filter(
      (trial) =>
        trial.remaining > 0 && new Date(trial.starts_at).getTime() > Date.now(),
    );
    return jsonOk({
      recommendations: makeRecommendations(available, currentGroups),
      source: "populartickets.pl",
    });
  } catch (error) {
    // Recommendations must never make the main client cabinet feel broken.
    console.error("[recommendations] PopularTickets", error);
    return jsonOk({ recommendations: [], source: "unavailable" });
  }
}
