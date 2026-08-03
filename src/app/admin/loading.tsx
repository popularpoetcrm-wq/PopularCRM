export default function AdminLoading() {
  return (
    <section className="space-y-6" aria-busy="true" aria-label="Загружаем раздел">
      <div>
        <div className="skeleton h-9 w-44" />
        <div className="skeleton mt-3 h-5 w-full max-w-xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="glass p-5">
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton mt-4 h-9 w-1/2" />
          </div>
        ))}
      </div>
      <div className="glass space-y-4 p-5">
        {[0, 1, 2].map((item) => (
          <div key={item} className="skeleton h-14 w-full" />
        ))}
      </div>
    </section>
  );
}
