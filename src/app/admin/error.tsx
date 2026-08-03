"use client";

export default function AdminError({
  unstable_retry,
}: {
  unstable_retry: () => void;
}) {
  return (
    <section className="glass mx-auto max-w-xl p-6 text-center sm:p-8" role="alert">
      <p className="font-display text-2xl">Раздел временно недоступен</p>
      <p className="mt-2 text-fog">
        Данные не изменились. Попробуйте загрузить страницу ещё раз.
      </p>
      <button type="button" className="btn btn-stage mt-5" onClick={unstable_retry}>
        Повторить
      </button>
    </section>
  );
}
