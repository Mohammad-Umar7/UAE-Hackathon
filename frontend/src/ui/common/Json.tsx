"use client";

import { useState } from "react";

/** Compact, collapsible JSON viewer for agent evidence. */
export function Json({ value, depth = 0, name }: { value: unknown; depth?: number; name?: string }) {
  const [open, setOpen] = useState(depth < 2);
  const key = name !== undefined ? <span className="text-ink-2">{name}: </span> : null;
  if (value === null || value === undefined) return <div className="mono text-[11px]">{key}<span className="text-faint">null</span></div>;
  if (typeof value === "number") return <div className="mono text-[11px]">{key}<span className="text-[var(--blue)]">{Number.isInteger(value) ? value : value.toFixed(2)}</span></div>;
  if (typeof value === "boolean") return <div className="mono text-[11px]">{key}<span className="text-[var(--violet)]">{String(value)}</span></div>;
  if (typeof value === "string") return <div className="mono break-words text-[11px]">{key}<span className="text-[var(--teal)]">&quot;{value}&quot;</span></div>;
  const isArr = Array.isArray(value);
  const entries = isArr ? (value as unknown[]).map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
  return (
    <div className="mono text-[11px]">
      <button className="text-left hover:text-ink" onClick={() => setOpen(!open)}>
        <span className="inline-block w-3 text-faint">{open ? "▾" : "▸"}</span>{key}
        <span className="text-faint">{isArr ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-line pl-2">
          {entries.slice(0, 60).map(([k, v]) => <Json key={k} name={isArr ? undefined : k} value={v} depth={depth + 1} />)}
          {entries.length > 60 && <div className="text-faint">… {entries.length - 60} more</div>}
        </div>
      )}
    </div>
  );
}
