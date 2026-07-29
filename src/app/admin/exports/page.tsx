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
      <div className="flex flex-wrap gap-3">
        {items.map((i) => (
          <Link
            key={i.type}
            className="btn btn-ghost"
            href={`/api/v1/reports/export?type=${i.type}`}
          >
            {i.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
