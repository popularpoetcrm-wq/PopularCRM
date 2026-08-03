import Link from "next/link";

export default function AdminExportsPage() {
  const items = [
    { type: "week", label: "CSV неделя (кто придёт)" },
    { type: "debt", label: "CSV долги" },
    { type: "students", label: "CSV ученики (лист группы)" },
    { type: "attendance", label: "CSV посещаемость" },
    { type: "makeups", label: "CSV отработки" },
    { type: "audit", label: "CSV audit" },
  ];

  return (
    <section className="space-y-4">
      <h1 className="font-display text-3xl">Экспорты</h1>
      <p className="text-fog">Фильтр по текущей вкладке бренда (где применимо).</p>
      <div className="grid gap-3 sm:flex sm:flex-wrap">
        {items.map((i) => (
          <Link
            key={i.type}
            className="btn btn-ghost w-full sm:w-auto"
            href={`/api/v1/reports/export?type=${i.type}`}
          >
            {i.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
