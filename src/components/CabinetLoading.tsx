export function CabinetLoading({ label = "Загружаем…" }: { label?: string }) {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true">
      <p className="text-sm text-fog">{label}</p>
      <div className="space-y-3">
        <div className="skeleton h-28" />
        <div className="skeleton h-20" />
        <div className="skeleton h-20" />
      </div>
    </div>
  );
}
