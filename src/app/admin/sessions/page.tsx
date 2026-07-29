import { getDemoState } from "@/lib/demo-store";
import { format } from "date-fns";
import { pl } from "date-fns/locale";

export default function AdminSessionsPage() {
  const sessions = getDemoState().sessions;

  return (
    <section className="space-y-4">
      <h1 className="font-display text-3xl">Zajęcia</h1>
      <ul className="space-y-3">
        {sessions.map((s) => (
          <li key={s.id} className="card-quiet flex items-center justify-between p-5">
            <div>
              <p className="font-semibold">{s.title}</p>
              <p className="text-sm text-fog">
                {format(new Date(s.starts_at), "EEEE d MMMM yyyy HH:mm", { locale: pl })}
              </p>
            </div>
            <span className="badge">{s.status}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
