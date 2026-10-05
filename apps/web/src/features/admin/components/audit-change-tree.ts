import type { AuditChange } from "./audit-log-display";

export type AuditChangeNode = {
  part: string | number;
  children: AuditChangeNode[];
  values?: { before: unknown; after: unknown };
};

function equal(before: unknown, after: unknown): boolean {
  if (Object.is(before, after)) return true;
  if (Array.isArray(before) && Array.isArray(after)) return before.length === after.length && before.every((item, index) => equal(item, after[index]));
  if (isRecord(before) && isRecord(after)) {
    const keys = Object.keys(before);
    return keys.length === Object.keys(after).length && keys.every((key) => Object.hasOwn(after, key) && equal(before[key], after[key]));
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function expand(node: AuditChangeNode, before: unknown, after: unknown): boolean {
  if (equal(before, after)) return false;
  if ((isRecord(before) || before === undefined) && (isRecord(after) || after === undefined)) {
    const previous = isRecord(before) ? before : {};
    const next = isRecord(after) ? after : {};
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const key of keys) {
      const child: AuditChangeNode = { part: key, children: [] };
      if (expand(child, Object.hasOwn(previous, key) ? previous[key] : undefined, Object.hasOwn(next, key) ? next[key] : undefined)) node.children.push(child);
    }
    if (node.children.length) return true;
  }
  if ((Array.isArray(before) || before === undefined) && (Array.isArray(after) || after === undefined)) {
    const previous = Array.isArray(before) ? before : [];
    const next = Array.isArray(after) ? after : [];
    for (let index = 0; index < Math.max(previous.length, next.length); index++) {
      const child: AuditChangeNode = { part: index, children: [] };
      if (expand(child, previous[index], next[index])) node.children.push(child);
    }
    if (node.children.length) return true;
  }
  node.values = { before, after };
  return true;
}

function decode(value: string | null, nested: boolean): unknown {
  if (value === null) return undefined;
  if (nested) {
    try { const parsed: unknown = JSON.parse(value); return typeof parsed === "number" ? value : parsed; }
    catch { return value; }
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" ? parsed : value;
  } catch { return value; }
}

export function buildAuditChangeTree(changes: Record<string, AuditChange>): AuditChangeNode[] {
  const roots: AuditChangeNode[] = [];
  for (const [field, change] of Object.entries(changes)) {
    const path = change.path ?? [field];
    const leaf: AuditChangeNode = { part: path[path.length - 1], children: [] };
    const before = decode(change.before, Boolean(change.path));
    const after = decode(change.after, Boolean(change.path));
    if (!expand(leaf, before, after)) {
      if (!change.path || change.before === change.after) continue;
      // Numeric and string tokens can display alike while retaining distinct types.
      leaf.values = { before, after };
    }
    let siblings = roots;
    for (const part of path.slice(0, -1)) {
      let parent = siblings.find((node) => node.part === part);
      if (!parent) { parent = { part, children: [] }; siblings.push(parent); }
      siblings = parent.children;
    }
    siblings.push(leaf);
  }
  return roots;
}
