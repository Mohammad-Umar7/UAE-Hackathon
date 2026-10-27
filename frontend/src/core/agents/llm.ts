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
  const plain = (x: string) => x.replace(/(?<=\d),(?=\d{3}\b)/g, ""); // "12,602" is 12602
  const nums = plain(text).match(/\d+(?:\.\d+)?/g) ?? [];
  const factNums = new Set((plain(facts).match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Math.round(Number(n)))));
  return nums.every((n) => factNums.has(String(Math.round(Number(n)))));
}

// spelled-out numbers cannot be checked against the facts ("twelve-five" for 125), so they are refused
const NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|dozen)\b/i;

/** "down from 8 to 5" must really go down (a model copying an example can get the direction wrong). */
function directionsHold(text: string): boolean {
  const num = (x: string) => Number(x.replace(/,/g, ""));
  for (const m of text.matchAll(/\b(down|lower|fell|reduced|decreased|up|higher|rose|increased)\s+from\s+([\d,.]+)\s+(?:\w+\s+)?to\s+([\d,.]+)/gi)) {
    const down = /down|lower|fell|reduced|decreased/i.test(m[1]);
    if (down ? num(m[2]) <= num(m[3]) : num(m[2]) >= num(m[3])) return false;
  }
  return true;
}

/** A briefing is shown only if it is grounded, short, in the third person and states numbers as digits. */
export function acceptableBriefing(text: string, facts: string): boolean {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 0);
  return grounded(text, facts) && directionsHold(text) && !NUMBER_WORDS.test(text) && !/\b(we|our|us|I)\b/.test(text)
    && sentences.length <= 3 && text.length <= 420;
}

export async function narrateBriefing(model: string, facts: string): Promise<string | null> {
  // one worked example keeps a small model to restating the facts (asked for "the effect", it computes
  // differences and gets them wrong)
  const prompt = [
    "You summarise airport recovery plans for a duty supervisor.",
    "Rewrite the facts below as exactly two plain sentences in the third person.",
    "Keep every number exactly as written in the facts (digits, same units). Do not add numbers, words like 'our' or 'we', or advice.",
    "Example facts:\n4 stand reassignments\n60 landing-sequence targets at capacity-restricted airports\nProjected total delay 900 min vs 1000 min with no coordinated action (950 min local-only).\nAirborne holding 100 min vs 180 min; uncoordinated fuel diversions 1 vs 3.",
    "Example briefing: The plan makes 4 stand reassignments and sets 60 landing-sequence targets at capacity-restricted airports. It projects 900 min of total delay against 1000 min with no coordinated action, with airborne holding down from 180 to 100 min and uncoordinated fuel diversions down from 3 to 1.",
    `Facts:\n${facts}`,
    "Briefing:",
  ].join("\n");
  try {
    const text = (await generate(model, prompt)).replace(/\s+/g, " ").trim();
    return text && acceptableBriefing(text, facts) ? text : null;
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
