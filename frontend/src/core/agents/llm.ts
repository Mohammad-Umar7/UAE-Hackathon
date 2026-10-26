/**
 * Optional local language model (Ollama on 127.0.0.1:11434). Never required.
 *
 * Bounded uses only: (1) rephrasing a plan briefing from structured facts, accepted only if every
 * number it mentions appears in the facts (grounding check); (2) turning a stakeholder's free-text
 * rejection reason into a structured category, validated against an allow-list. The optimiser,
 * validation and approvals never depend on it.
 */

export interface LlmStatus {
  available: boolean;
  model: string | null;
  models: string[];
  checkedAt: number;
}

const URL_BASE = "http://127.0.0.1:11434";
const PREFERRED = ["qwen2.5:3b", "llama3.2:3b", "llama3.2:latest", "gemma3:1b"];

export async function detectLlm(timeoutMs = 1200): Promise<LlmStatus> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(`${URL_BASE}/api/tags`, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = (data.models ?? []).map((m) => m.name);
    const model = PREFERRED.find((p) => models.includes(p)) ?? null;
    return { available: model !== null, model, models, checkedAt: Date.now() };
  } catch {
    return { available: false, model: null, models: [], checkedAt: Date.now() };
  }
}

async function generate(model: string, prompt: string, json = false, timeoutMs = 15000): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${URL_BASE}/api/generate`, {
      method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false, format: json ? "json" : undefined, options: { temperature: 0, seed: 7, num_predict: 220 } }),
    });
    const data = (await res.json()) as { response?: string };
    return (data.response ?? "").trim();
  } finally {
    clearTimeout(timer);
  }
}

/** Numbers in `text` must all appear in `facts` (after rounding) — otherwise the text is rejected. */
export function grounded(text: string, facts: string): boolean {
  const nums = text.match(/\d+(?:\.\d+)?/g) ?? [];
  const factNums = new Set((facts.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Math.round(Number(n)))));
  return nums.every((n) => factNums.has(String(Math.round(Number(n)))));
}

export async function narrateBriefing(model: string, facts: string): Promise<string | null> {
  const prompt = `You are writing a two-sentence operations briefing for an airport duty supervisor.\nUse ONLY these facts; do not add numbers that are not in them; do not give instructions to pilots or ATC.\nFacts:\n${facts}\nBriefing:`;
  try {
    const text = await generate(model, prompt);
    return text && grounded(text, facts) ? text.replace(/\s+/g, " ") : null;
  } catch {
    return null;
  }
}

const CATEGORIES = ["RESOURCE_UNAVAILABLE", "STAND_UNAVAILABLE", "CAPACITY", "SAFETY", "COMMERCIAL", "OTHER"] as const;

export async function interpretReason(model: string, text: string): Promise<{ category: string; resource: string | null } | null> {
  const prompt = `Classify this airport stakeholder's rejection reason. Reply as JSON {"category": one of ${CATEGORIES.join("|")}, "resource": short noun or null}.\nReason: "${text}"`;
  try {
    const out = JSON.parse(await generate(model, prompt, true, 10000)) as { category?: string; resource?: string | null };
    if (!out.category || !CATEGORIES.includes(out.category as (typeof CATEGORIES)[number])) return null;
    return { category: out.category, resource: typeof out.resource === "string" ? out.resource.slice(0, 40) : null };
  } catch {
    return null;
  }
}

/** Deterministic fallback used when no local model is available. */
export function interpretReasonRules(text: string): { category: string; resource: string | null } {
  const t = text.toLowerCase();
  if (/ambulift|wheelchair|prm|assist/.test(t)) return { category: "RESOURCE_UNAVAILABLE", resource: "ambulift" };
  if (/handling|team|crew|roster|staff/.test(t)) return { category: "RESOURCE_UNAVAILABLE", resource: "handling team" };
  if (/stand|gate|apron|closed/.test(t)) return { category: "STAND_UNAVAILABLE", resource: "stand" };
  if (/capacity|runway|rate|slot/.test(t)) return { category: "CAPACITY", resource: null };
  if (/safety|risk|hazard/.test(t)) return { category: "SAFETY", resource: null };
  return { category: "OTHER", resource: null };
}
