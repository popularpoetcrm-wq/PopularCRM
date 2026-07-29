import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const DIR = path.join(process.cwd(), ".demo-data");
const FILE = path.join(DIR, "state.json");

export function loadPersistedDemo<T>(): T | null {
  try {
    if (!existsSync(FILE)) return null;
    const raw = readFileSync(FILE, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function savePersistedDemo(state: unknown) {
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(state), "utf8");
  } catch (e) {
    console.warn("[demo-persist] save failed", e);
  }
}

export function clearPersistedDemo() {
  try {
    if (existsSync(FILE)) writeFileSync(FILE, "", "utf8");
  } catch {
    /* ignore */
  }
}
