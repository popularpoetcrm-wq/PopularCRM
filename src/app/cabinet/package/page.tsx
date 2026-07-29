import { getSessionUser } from "@/lib/auth";
import { getDemoState } from "@/lib/demo-store";
import { format } from "date-fns";
import { pl } from "date-fns/locale";

export default async function PackagePage() {
  const user = await getSessionUser();
  const state = getDemoState();
  const enrollments = state.enrollments.filter((e) => e.student_person_id === user!.personId);
  const packages = state.packages.filter((p) => enrollments.some((e) => e.id === p.enrollment_id));

  return (
    <section className="space-y-4">
      <h1 className="font-display text-3xl">Pakiet i kredyty</h1>
      <p className="text-fog">
        Saldo liczone z <code>lesson_credits</code> — nie ręcznym licznikiem.
      </p>
      {packages.map((p) => (
        <article key={p.id} className="card-quiet p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl">{p.plan.name}</h2>
              <p className="text-sm text-fog">Status: {p.status}</p>
            </div>
            <p className="text-3xl font-semibold">
              {p.credits_available}
              <span className="text-base text-fog"> / {p.credits_total}</span>
            </p>
          </div>
          <dl className="mt-6 grid gap-3 text-sm md:grid-cols-3">
            <div>
              <dt className="text-fog">Wygasa</dt>
              <dd>{format(new Date(p.expires_at), "d MMM yyyy", { locale: pl })}</dd>
            </div>
            <div>
              <dt className="text-fog">Makeup policy</dt>
              <dd>{p.plan.makeup_policy}</dd>
            </div>
            <div>
              <dt className="text-fog">Start pakietu</dt>
              <dd>{p.plan.start_policy}</dd>
            </div>
          </dl>
        </article>
      ))}
      {!packages.length ? <p className="text-fog">Brak pakietów.</p> : null}
    </section>
  );
}
