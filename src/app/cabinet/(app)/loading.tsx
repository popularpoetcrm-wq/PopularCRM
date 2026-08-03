export default function CabinetAppLoading() {
  return (
    <section className="space-y-5" aria-busy="true" aria-label="Загружаем кабинет">
      <div>
        <div className="skeleton h-9 w-48" />
        <div className="skeleton mt-3 h-5 w-full max-w-lg" />
      </div>
      {[0, 1, 2].map((item) => (
        <div key={item} className="card-quiet p-5">
          <div className="skeleton h-5 w-2/3" />
          <div className="skeleton mt-3 h-4 w-full" />
          <div className="skeleton mt-2 h-4 w-4/5" />
        </div>
      ))}
    </section>
  );
}
