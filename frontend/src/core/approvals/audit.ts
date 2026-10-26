/** Append-only, hash-chained audit trail. Each record commits to the previous record's hash, so any
 * later modification of an earlier record is detectable by `verify()`. */

import { sha256 } from "./sha256";

export interface AuditEntry {
  seq: number;
  t: number;
  wall: number;
  actor: string;
  role: string;
  action: string;
  target: string;
  detail: string;
  prevHash: string;
  hash: string;
}

export class AuditLog {
  entries: AuditEntry[] = [];

  append(t: number, actor: string, role: string, action: string, target: string, detail: string, wall = Date.now()): AuditEntry {
    const prevHash = this.entries.length ? this.entries[this.entries.length - 1].hash : "GENESIS";
    const seq = this.entries.length + 1;
    const body = JSON.stringify({ seq, t, wall, actor, role, action, target, detail, prevHash });
    const e: AuditEntry = { seq, t, wall, actor, role, action, target, detail, prevHash, hash: sha256(body) };
    this.entries.push(e);
    return e;
  }

  verify(): { ok: boolean; brokenAt: number | null } {
    let prev = "GENESIS";
    for (const e of this.entries) {
      const body = JSON.stringify({ seq: e.seq, t: e.t, wall: e.wall, actor: e.actor, role: e.role, action: e.action, target: e.target, detail: e.detail, prevHash: prev });
      if (e.prevHash !== prev || sha256(body) !== e.hash) return { ok: false, brokenAt: e.seq };
      prev = e.hash;
    }
    return { ok: true, brokenAt: null };
  }
}
