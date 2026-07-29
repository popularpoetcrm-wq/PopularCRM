import { notFound } from "next/navigation";
import PayKindClientPage from "./pay-client";

const kinds = new Set(["trial", "event", "package"]);

export default async function PayKindPage({
  params,
}: {
  params: Promise<{ kind: string; sessionId: string }>;
}) {
  const { kind, sessionId } = await params;
  if (!kinds.has(kind)) notFound();
  return <PayKindClientPage kind={kind} sessionId={sessionId} />;
}
