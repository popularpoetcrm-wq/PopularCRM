"use client";

import { useRef, useState } from "react";

export function AvatarUpload({
  url,
  onUploaded,
}: {
  url?: string | null;
  onUploaded?: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(url ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError("");
    const local = URL.createObjectURL(file);
    setPreview(local);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/v1/me/avatar", { method: "POST", body: fd });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setError(json.error ?? "Не удалось загрузить");
      return;
    }
    setPreview(json.data.url);
    onUploaded?.(json.data.url);
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <button
        type="button"
        className="relative h-20 w-20 overflow-hidden rounded-full bg-white/10"
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
