// memgraph core: a small decision-memory graph with provenance.
//
// A store is plain JSON:
//
//   {
//     "version": 1,
//     "nodes": [
//       { "id": "m-001", "type": "decision", "title": "...",
//         "source": "ADR-014", "created": "2026-10-19",
//         "supersededBy": null, "supersedes": null }
//     ],
//     "links": [
//       { "from": "m-001", "to": "m-002", "relation": "supports", "reason": "" }
//     ]
//   }
//
// Node types: decision | fact | constraint | question.
// Relations: supports | contradicts | supersedes | depends-on.
//
// Semantics:
// - "A supports B" means A is evidence for B.
// - "A contradicts B" means A and B cannot both be true.
// - "A supersedes B" means A replaces B; B is history, not live.
// - "A depends-on B" means A only holds if B holds.
//
// Everything is local and dependency-free. The store file is the whole
// database, so it can live in git next to the code it documents.

import fs from "node:fs";

export const NODE_TYPES = ["decision", "fact", "constraint", "question"];
export const RELATIONS = ["supports", "contradicts", "supersedes", "depends-on"];
export const STORE_VERSION = 1;

export class MemgraphError extends Error {}

export function emptyStore() {
  return { version: STORE_VERSION, nodes: [], links: [] };
}

export function loadStore(storePath) {
  let raw;
  try {
    raw = fs.readFileSync(storePath, "utf8");
  } catch {
    throw new MemgraphError(
      `store not found: ${storePath} (run 'memgraph init' first)`,
    );
  }
  let store;
  try {
    store = JSON.parse(raw);
  } catch {
    throw new MemgraphError(`invalid store: ${storePath} is not valid JSON`);
  }
  if (
    !store ||
    typeof store !== "object" ||
    !Array.isArray(store.nodes) ||
    !Array.isArray(store.links)
  ) {
    throw new MemgraphError(
      `invalid store: ${storePath} must have "nodes" and "links" arrays`,
    );
  }
  return store;
}

export function saveStore(storePath, store) {
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2) + "\n");
}

export function getNode(store, id) {
  return store.nodes.find((n) => n.id === id) || null;
}

export function nextId(store) {
  let max = 0;
  for (const node of store.nodes) {
    const m = /^m-(\d+)$/.exec(node.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `m-${String(max + 1).padStart(3, "0")}`;
}

export function addNode(store, { type = "decision", title, source = "", created = "", id = null }) {
  if (!NODE_TYPES.includes(type)) {
    throw new MemgraphError(
      `invalid type "${type}" — expected one of: ${NODE_TYPES.join(", ")}`,
    );
  }
  if (!title || !title.trim()) {
    throw new MemgraphError("add requires a non-empty --title");
  }
  const nodeId = id || nextId(store);
  if (!/^m-[a-z0-9-]+$/.test(nodeId)) {
    throw new MemgraphError(`invalid id "${nodeId}" — expected like m-001`);
  }
  if (getNode(store, nodeId)) {
    throw new MemgraphError(`node ${nodeId} already exists`);
  }
  const node = {
    id: nodeId,
    type,
    title: title.trim(),
    source: (source || "").trim(),
    created: created || new Date().toISOString().slice(0, 10),
    supersededBy: null,
    supersedes: null,
  };
  store.nodes.push(node);
  return node;
}

export function addLink(store, { from, to, relation, reason = "" }) {
  if (!RELATIONS.includes(relation)) {
    throw new MemgraphError(
      `invalid relation "${relation}" — expected one of: ${RELATIONS.join(", ")}`,
    );
  }
  if (from === to) {
    throw new MemgraphError("a node cannot link to itself");
  }
  if (!getNode(store, from)) {
    throw new MemgraphError(`unknown node ${from}`);
  }
  if (!getNode(store, to)) {
    throw new MemgraphError(`unknown node ${to}`);
  }
  if (store.links.some((l) => l.from === from && l.to === to && l.relation === relation)) {
    throw new MemgraphError(`link ${from} --${relation}--> ${to} already exists`);
  }
  if (relation === "supersedes") {
    // A supersedes link must mean the same thing as the supersede
    // command: the target stops being live truth. Before this fix a
    // direct `link --relation supersedes` left both nodes' pointers
    // unset, so `why`, `check` and `list` kept treating the old node
    // as live. Sync the pointers here, and refuse a second, different
    // supersession instead of silently overwriting the first one.
    const fromNode = getNode(store, from);
    const toNode = getNode(store, to);
    const priorBy = [toNode.supersededBy,
      ...store.links.filter((l) => l.to === to && l.relation === "supersedes").map((l) => l.from),
    ].filter(Boolean);
    if (priorBy.length && !priorBy.every((id) => id === from)) {
      throw new MemgraphError(`${to} was already superseded by ${priorBy[0]}`);
    }
    const priorTargets = [fromNode.supersedes,
      ...store.links.filter((l) => l.from === from && l.relation === "supersedes").map((l) => l.to),
    ].filter(Boolean);
    if (priorTargets.length && !priorTargets.every((id) => id === to)) {
      throw new MemgraphError(`${from} already supersedes ${priorTargets[0]}`);
    }
  }
  const link = { from, to, relation, reason: (reason || "").trim() };
  store.links.push(link);
  if (relation === "supersedes") {
    getNode(store, to).supersededBy = from;
    getNode(store, from).supersedes = to;
  }
  return link;
}

// Mark oldId as replaced by newId. Records a supersedes link and sets
// the pointers on both nodes, so `why` and `check` can treat the old
// node as history instead of live truth.
export function supersede(store, { oldId, newId, reason = "" }) {
  if (oldId === newId) {
    throw new MemgraphError("a node cannot supersede itself");
  }
  const oldNode = getNode(store, oldId);
  const newNode = getNode(store, newId);
  if (!oldNode) throw new MemgraphError(`unknown node ${oldId}`);
  if (!newNode) throw new MemgraphError(`unknown node ${newId}`);
  if (oldNode.supersededBy) {
    throw new MemgraphError(
      `${oldId} was already superseded by ${oldNode.supersededBy}`,
    );
  }
  addLink(store, { from: newId, to: oldId, relation: "supersedes", reason });
  oldNode.supersededBy = newId;
  newNode.supersedes = oldId;
  return { oldNode, newNode };
}

function outgoing(store, id, relation) {
  return store.links
    .filter((l) => l.from === id && l.relation === relation)
    .map((l) => l.to);
}

function incoming(store, id, relation) {
  return store.links
    .filter((l) => l.to === id && l.relation === relation)
    .map((l) => l.from);
}

// Full neighbourhood of one node: what it says, what says things
// about it, and whether it is still live or superseded.
// Supersession is read from the pointers AND from supersedes links,
// so a store written by hand (link present, pointers unset) is audited
// the same way as one built with the supersede command.
function dedupe(ids) {
  return [...new Set(ids.filter(Boolean))];
}

export function why(store, id) {
  const node = getNode(store, id);
  if (!node) throw new MemgraphError(`unknown node ${id}`);
  return {
    node,
    supports: outgoing(store, id, "supports"),
    supportedBy: incoming(store, id, "supports"),
    contradicts: outgoing(store, id, "contradicts"),
    contradictedBy: incoming(store, id, "contradicts"),
    dependsOn: outgoing(store, id, "depends-on"),
    dependedOnBy: incoming(store, id, "depends-on"),
    supersedes: dedupe([node.supersedes, ...outgoing(store, id, "supersedes")]),
    supersededBy: dedupe([node.supersededBy, ...incoming(store, id, "supersedes")]),
  };
}

// Audit the graph. Errors fail the run (exit 1); warnings do not.
// Findings are sorted by code then message so output is deterministic.
export function check(store) {
  const findings = [];
  const supersededBy = (id) => {
    const n = getNode(store, id);
    if (!n) return null;
    return n.supersededBy || incoming(store, id, "supersedes")[0] || null;
  };
  const isSuperseded = (id) => Boolean(supersededBy(id));

  // Contradictions only matter while both sides are still live. Once
  // one side is superseded, the contradiction is resolved history.
  const seenPairs = new Set();
  for (const link of store.links) {
    if (link.relation !== "contradicts") continue;
    const key = [link.from, link.to].sort().join("|");
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    if (!isSuperseded(link.from) && !isSuperseded(link.to)) {
      findings.push({
        severity: "error",
        code: "contradiction-unresolved",
        message:
          `${link.from} contradicts ${link.to} and neither is superseded — ` +
          `decide which one wins, or supersede the loser.`,
      });
    }
  }

  // A live node must not rest on a superseded one. A superseded node
  // depending on another superseded node is history, not a bug.
  for (const link of store.links) {
    if (link.relation !== "depends-on") continue;
    if (isSuperseded(link.to) && !isSuperseded(link.from)) {
      const by = supersededBy(link.to);
      findings.push({
        severity: "error",
        code: "superseded-dependency",
        message:
          `${link.from} depends on ${link.to}, which was superseded by ${by}.`,
      });
    }
  }

  // A dependency loop has no base to rest on: if A depends on B and B
  // (transitively) depends on A, neither can hold. Only edges between
  // live nodes count — a loop that passes through a superseded node
  // is history, handled by the checks above.
  const liveDepEdges = new Map(); // from -> Set(to)
  for (const link of store.links) {
    if (link.relation !== "depends-on") continue;
    if (isSuperseded(link.from) || isSuperseded(link.to)) continue;
    if (!liveDepEdges.has(link.from)) liveDepEdges.set(link.from, new Set());
    liveDepEdges.get(link.from).add(link.to);
  }
  const canonicalCycle = (cycle) => {
    // cycle is distinct ids [a, b, c] meaning a -> b -> c -> a.
    // Rotate so the lexicographically smallest id leads, so the
    // reported loop is deterministic no matter where it was found.
    let best = cycle;
    for (let i = 1; i < cycle.length; i++) {
      const rotated = cycle.slice(i).concat(cycle.slice(0, i));
      if (rotated.join(">") < best.join(">")) best = rotated;
    }
    return best;
  };
  const reportedCycles = new Set();
  for (const start of [...liveDepEdges.keys()].sort()) {
    const stack = [[start, [start]]];
    while (stack.length) {
      const [node, path] = stack.pop();
      const nexts = liveDepEdges.get(node);
      if (!nexts) continue;
      for (const next of [...nexts].sort().reverse()) {
        if (next === start) {
          const canon = canonicalCycle(path);
          const key = canon.join(">");
          if (!reportedCycles.has(key)) {
            reportedCycles.add(key);
            findings.push({
              severity: "error",
              code: "dependency-cycle",
              message:
                `dependency cycle: ${[...canon, canon[0]].join(" -> ")} — ` +
                `break the loop or supersede one side.`,
            });
          }
        } else if (!path.includes(next)) {
          stack.push([next, [...path, next]]);
        }
      }
    }
  }

  for (const node of store.nodes) {
    if (!node.source) {
      findings.push({
        severity: "warning",
        code: "no-source",
        message: `${node.id} has no source — provenance missing.`,
      });
    }
  }

  for (const node of store.nodes) {
    if (node.type !== "decision" || isSuperseded(node.id)) continue;
    const hasLinks = store.links.some((l) => l.from === node.id || l.to === node.id);
    if (!hasLinks) {
      findings.push({
        severity: "warning",
        code: "orphan-decision",
        message:
          `${node.id} has no links — nothing supports it, nothing depends on it.`,
      });
    }
  }

  findings.sort((a, b) =>
    a.code.localeCompare(b.code) || a.message.localeCompare(b.message),
  );
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  return { findings, errors, warnings };
}
