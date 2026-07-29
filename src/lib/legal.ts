import { readFileSync } from "fs";
import path from "path";

export type LegalDocKey = "studio_offer" | "photo_marketing";

export const LEGAL_DOCS: Record<
  LegalDocKey,
  { file: string; title: string; version: string }
> = {
  studio_offer: {
    file: "studio_offer.ru.md",
    title: "Оферта и правила студии",
    version: "1.0",
  },
  photo_marketing: {
    file: "photo_marketing.ru.md",
    title: "Согласие на фото и видео",
    version: "1.0",
  },
};

export const REQUIRED_CONSENT_KEYS: LegalDocKey[] = [
  "studio_offer",
  "photo_marketing",
];

function parseFrontmatter(raw: string): { version?: string; title?: string; body: string } {
  if (!raw.startsWith("---")) return { body: raw.trim() };
  const end = raw.indexOf("---", 3);
  if (end < 0) return { body: raw.trim() };
  const fm = raw.slice(3, end);
  const body = raw.slice(end + 3).trim();
  const version = fm.match(/version:\s*["']?([^"'\n]+)/)?.[1]?.trim();
  const title = fm.match(/title:\s*["']?([^"'\n]+)/)?.[1]?.trim();
  return { version, title, body };
}

export function loadLegalDoc(key: LegalDocKey) {
  const meta = LEGAL_DOCS[key];
  const filePath = path.join(process.cwd(), "content", "legal", meta.file);
  const raw = readFileSync(filePath, "utf8");
  const parsed = parseFrontmatter(raw);
  return {
    key,
    title: parsed.title ?? meta.title,
    version: parsed.version ?? meta.version,
    body: parsed.body,
  };
}

export function listLegalDocs() {
  return REQUIRED_CONSENT_KEYS.map((key) => loadLegalDoc(key));
}
