"use client";

export default function CabinetAppError({
  unstable_retry,
}: {
  unstable_retry: () => void;
}) {
  return (
    <section className="card-quiet mx-auto max-w-xl p-6 text-center sm:p-8" role="alert">
      <p className="font-display text-2xl">Не удалось открыть кабинет</p>
      <p className="mt-2 text-fog">
        Попробуйте ещё раз. Если проблема повторится, напишите администратору студии.
      </p>
      <button type="button" className="btn btn-stage mt-5" onClick={unstable_retry}>
        Повторить
      </button>
    </section>
  );
}
