"use client";

import { useOps } from "@/store/ops";

export function Toasts() {
  const toasts = useOps((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={`panel fade-in pointer-events-auto max-w-[380px] px-3 py-2 text-[12px] shadow-[var(--shadow-2)] ${t.tone === "bad" ? "border-[var(--red)]" : t.tone === "warn" ? "border-[var(--amber)]" : t.tone === "ok" ? "border-[var(--teal)]" : ""}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
