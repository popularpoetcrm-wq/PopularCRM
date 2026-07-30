"use client";

import { useEffect, useRef, useState } from "react";

export function AvatarUpload({
  url,
  onUploaded,
  size = "md",
}: {
  url?: string | null;
  onUploaded?: (url: string) => void;
  size?: "sm" | "md" | "lg";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(url ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPreview(url ?? null);
  }, [url]);

  const dim = size === "lg" ? "h-24 w-24" : size === "sm" ? "h-14 w-14" : "h-20 w-20";

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError("");
    const local = URL.createObjectURL(file);
    setPreview(local);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/v1/me/avatar", { method: "POST", body: fd });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Не удалось загрузить");
        setPreview(url ?? null);
        URL.revokeObjectURL(local);
        return;
      }
      URL.revokeObjectURL(local);
      setPreview(json.data.url);
      onUploaded?.(json.data.url);
    } catch {
      setError("Не удалось загрузить");
      setPreview(url ?? null);
      URL.revokeObjectURL(local);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <button
        type="button"
        className={`relative ${dim} shrink-0 overflow-hidden rounded-full bg-white/10 ring-2 ring-white/15`}
        onClick={() => inputRef.current?.click()}
        aria-label="Загрузить фото"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center text-xs text-fog">
            фото
          </span>
        )}
      </button>
      <div className="space-y-1 text-sm">
        <button
          type="button"
          className="btn btn-ghost text-sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Загрузка…" : preview ? "Сменить фото" : "Загрузить фото"}
        </button>
        <p className="text-xs text-fog">JPEG / PNG / WebP · до 2 МБ</p>
        {error ? <p className="text-xs text-warn">{error}</p> : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}
