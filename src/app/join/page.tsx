import { Suspense } from "react";
import JoinClient from "./JoinClient";

export default function JoinPage() {
  return (
    <Suspense fallback={<main className="p-10 text-center text-fog">Загрузка…</main>}>
      <JoinClient />
    </Suspense>
  );
}
