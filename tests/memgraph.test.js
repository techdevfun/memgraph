import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addLink,
  addNode,
  check,
  emptyStore,
  loadStore,
  saveStore,
  supersede,
  why,
} from "../src/memgraph.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "memgraph.js");
const EXAMPLE = path.join(ROOT, "examples", "team", "graph.json");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "memgraph-"));
}

function runCli(dir, args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd: dir, encoding: "utf8" });
}

test("add assigns sequential ids and persists", () => {
  const store = emptyStore();
  const a = addNode(store, { type: "fact", title: "First", source: "s", created: "2026-01-01" });
  const b = addNode(store, { type: "decision", title: "Second", source: "s", created: "2026-01-01" });
  assert.equal(a.id, "m-001");
  assert.equal(b.id, "m-002");
  const dir = tmpDir();
  const file = path.join(dir, "g.json");
  saveStore(file, store);
  assert.equal(loadStore(file).nodes.length, 2);
});

test("add rejects a bad type and an empty title", () => {
  assert.throws(() => addNode(emptyStore(), { type: "hunch", title: "x" }), /invalid type/);
  assert.throws(() => addNode(emptyStore(), { type: "fact", title: "  " }), /non-empty/);
});

test("add rejects a duplicate explicit id", () => {
  const store = emptyStore();
  addNode(store, { type: "fact", title: "A", source: "s", id: "m-007" });
  assert.throws(
    () => addNode(store, { type: "fact", title: "B", source: "s", id: "m-007" }),
    /already exists/,
  );
});

test("link rejects unknown nodes, bad relations, self-links, duplicates", () => {
  const store = emptyStore();
  const a = addNode(store, { type: "fact", title: "A", source: "s" });
  const b = addNode(store, { type: "fact", title: "B", source: "s" });
  assert.throws(() => addLink(store, { from: a.id, to: "m-999", relation: "supports" }), /unknown node/);
  assert.throws(() => addLink(store, { from: a.id, to: b.id, relation: "likes" }), /invalid relation/);
  assert.throws(() => addLink(store, { from: a.id, to: a.id, relation: "supports" }), /itself/);
  addLink(store, { from: a.id, to: b.id, relation: "supports" });
  assert.throws(() => addLink(store, { from: a.id, to: b.id, relation: "supports" }), /already exists/);
});

test("supersede sets pointers and refuses a second supersede", () => {
  const store = emptyStore();
  const oldN = addNode(store, { type: "decision", title: "Old", source: "s" });
  const newN = addNode(store, { type: "decision", title: "New", source: "s" });
  supersede(store, { oldId: oldN.id, newId: newN.id, reason: "better" });
  assert.equal(store.nodes[0].supersededBy, newN.id);
  assert.equal(store.nodes[1].supersedes, oldN.id);
  const third = addNode(store, { type: "decision", title: "Third", source: "s" });
  assert.throws(
    () => supersede(store, { oldId: oldN.id, newId: third.id }),
    /already superseded/,
  );
  assert.throws(
    () => supersede(store, { oldId: newN.id, newId: newN.id }),
    /itself/,
  );
});

test("why returns the full neighbourhood", () => {
  const store = emptyStore();
  const fact = addNode(store, { type: "fact", title: "F", source: "s" });
  const dec = addNode(store, { type: "decision", title: "D", source: "s" });
  const con = addNode(store, { type: "constraint", title: "C", source: "s" });
  addLink(store, { from: fact.id, to: dec.id, relation: "supports" });
  addLink(store, { from: dec.id, to: con.id, relation: "depends-on" });
  const r = why(store, dec.id);
  assert.deepEqual(r.supportedBy, [fact.id]);
  assert.deepEqual(r.dependsOn, [con.id]);
  assert.deepEqual(r.supports, []);
  assert.throws(() => why(store, "m-999"), /unknown node/);
});

test("check flags an unresolved contradiction, resolved when superseded", () => {
  const store = emptyStore();
  const a = addNode(store, { type: "decision", title: "A", source: "s" });
  const b = addNode(store, { type: "decision", title: "B", source: "s" });
  addLink(store, { from: a.id, to: b.id, relation: "contradicts" });
  let result = check(store);
  assert.equal(result.errors, 1);
  assert.equal(result.findings[0].code, "contradiction-unresolved");
  const c = addNode(store, { type: "decision", title: "C", source: "s" });
  supersede(store, { oldId: b.id, newId: c.id });
  result = check(store);
  assert.equal(result.errors, 0);
});

test("check flags a live node depending on a superseded node", () => {
  const store = emptyStore();
  const oldN = addNode(store, { type: "decision", title: "Old", source: "s" });
  const replacement = addNode(store, { type: "decision", title: "New", source: "s" });
  const live = addNode(store, { type: "decision", title: "Live", source: "s" });
  addLink(store, { from: live.id, to: oldN.id, relation: "depends-on" });
  assert.equal(check(store).errors, 0);
  supersede(store, { oldId: oldN.id, newId: replacement.id });
  const result = check(store);
  assert.equal(result.errors, 1);
  assert.equal(result.findings[0].code, "superseded-dependency");
});

test("check flags a dependency cycle between live nodes", () => {
  const store = emptyStore();
  const a = addNode(store, { type: "decision", title: "A", source: "s" });
  const b = addNode(store, { type: "decision", title: "B", source: "s" });
  addLink(store, { from: a.id, to: b.id, relation: "depends-on" });
  addLink(store, { from: b.id, to: a.id, relation: "depends-on" });
  const result = check(store);
  assert.equal(result.errors, 1);
  assert.equal(result.findings[0].code, "dependency-cycle");
  assert.match(result.findings[0].message, /m-001 -> m-002 -> m-001/);
});

test("check reports a longer loop once, and drops it once superseded", () => {
  const store = emptyStore();
  const a = addNode(store, { type: "decision", title: "A", source: "s" });
  const b = addNode(store, { type: "decision", title: "B", source: "s" });
  const c = addNode(store, { type: "decision", title: "C", source: "s" });
  addLink(store, { from: a.id, to: b.id, relation: "depends-on" });
  addLink(store, { from: b.id, to: c.id, relation: "depends-on" });
  addLink(store, { from: c.id, to: a.id, relation: "depends-on" });
  const cycles = check(store).findings.filter(
    (f) => f.code === "dependency-cycle",
  );
  assert.equal(cycles.length, 1);
  assert.match(cycles[0].message, /m-001 -> m-002 -> m-003 -> m-001/);
  // Superseding one side of the loop turns it into history: the cycle
  // finding goes away, replaced by the superseded-dependency error.
  const d = addNode(store, { type: "decision", title: "D", source: "s" });
  supersede(store, { oldId: a.id, newId: d.id });
  const after = check(store);
  assert.equal(
    after.findings.filter((f) => f.code === "dependency-cycle").length,
    0,
  );
  assert.deepEqual(
    after.findings.filter((f) => f.severity === "error").map((f) => f.code),
    ["superseded-dependency"],
  );
});

test("check catches a self-dependency written into the store by hand", () => {
  const store = emptyStore();
  const a = addNode(store, { type: "decision", title: "A", source: "s" });
  store.links.push({
    from: a.id,
    to: a.id,
    relation: "depends-on",
    reason: "",
  });
  const result = check(store);
  const cycle = result.findings.find((f) => f.code === "dependency-cycle");
  assert.ok(cycle);
  assert.match(cycle.message, /m-001 -> m-001/);
});

test("check flags no-source and orphan decisions, clean graph passes", () => {
  const store = emptyStore();
  const lonely = addNode(store, { type: "decision", title: "Lonely", source: "" });
  const result = check(store);
  assert.equal(result.warnings, 2);
  assert.deepEqual(
    result.findings.map((f) => f.code).sort(),
    ["no-source", "orphan-decision"],
  );
  assert.equal(lonely.id, "m-001");

  const clean = emptyStore();
  const f = addNode(clean, { type: "fact", title: "F", source: "s" });
  const d = addNode(clean, { type: "decision", title: "D", source: "s" });
  addLink(clean, { from: f.id, to: d.id, relation: "supports" });
  assert.deepEqual(check(clean), { findings: [], errors: 0, warnings: 0 });
});

test("example team graph: exactly 1 error + 1 warning, why m-004 is right", () => {
  const store = loadStore(EXAMPLE);
  const result = check(store);
  assert.equal(result.errors, 1);
  assert.equal(result.warnings, 1);
  assert.deepEqual(
    result.findings.map((f) => f.code),
    ["no-source", "superseded-dependency"],
  );
  const r = why(store, "m-004");
  assert.deepEqual(r.supersedes, ["m-002"]);
  assert.deepEqual(r.dependsOn, ["m-005"]);
});

test("loadStore rejects a missing file and invalid JSON", () => {
  const dir = tmpDir();
  assert.throws(() => loadStore(path.join(dir, "nope.json")), /store not found/);
  const bad = path.join(dir, "bad.json");
  fs.writeFileSync(bad, "{not json");
  assert.throws(() => loadStore(bad), /not valid JSON/);
  const wrong = path.join(dir, "wrong.json");
  fs.writeFileSync(wrong, JSON.stringify({ nodes: "x" }));
  assert.throws(() => loadStore(wrong), /must have "nodes"/);
});

test("CLI end-to-end: init, add, link, supersede, why, check", () => {
  const dir = tmpDir();
  assert.equal(runCli(dir, ["init"]).status, 0);
  assert.notEqual(runCli(dir, ["init"]).status, 0, "second init must fail");
  const a = runCli(dir, ["add", "--type", "fact", "--title", "Load hit 40k", "--source", "metrics"]);
  assert.equal(a.status, 0);
  assert.match(a.stdout, /Added m-001/);
  const b = runCli(dir, ["add", "--title", "Use NOTIFY", "--source", "ADR-1"]);
  assert.equal(b.status, 0);
  const link = runCli(dir, ["link", "m-001", "m-002", "--relation", "supports"]);
  assert.equal(link.status, 0);
  const whyOut = runCli(dir, ["why", "m-002"]);
  assert.equal(whyOut.status, 0);
  assert.match(whyOut.stdout, /supported-by: m-001/);
  const clean = runCli(dir, ["check"]);
  assert.equal(clean.status, 0);
  assert.match(clean.stdout, /clean/);
  const c = runCli(dir, ["add", "--title", "Use Streams", "--source", "ADR-2"]);
  assert.equal(c.status, 0);
  const sup = runCli(dir, ["supersede", "m-002", "m-003", "--reason", "cap"]);
  assert.equal(sup.status, 0);
  // m-001 still supports the superseded m-002 — supports links are
  // history, not dependencies, so check stays clean.
  assert.equal(runCli(dir, ["check"]).status, 0);
  const json = runCli(dir, ["check", "--json"]);
  assert.equal(json.status, 0);
  assert.deepEqual(JSON.parse(json.stdout), { findings: [], errors: 0, warnings: 0 });
});

test("CLI: check exits 1 and names a dependency cycle", () => {
  const dir = tmpDir();
  runCli(dir, ["init"]);
  runCli(dir, ["add", "--title", "A", "--source", "s"]);
  runCli(dir, ["add", "--title", "B", "--source", "s"]);
  runCli(dir, ["link", "m-001", "m-002", "--relation", "depends-on"]);
  runCli(dir, ["link", "m-002", "m-001", "--relation", "depends-on"]);
  const out = runCli(dir, ["check"]);
  assert.equal(out.status, 1);
  assert.match(out.stdout, /dependency-cycle/);
  assert.match(out.stdout, /m-001 -> m-002 -> m-001/);
});

test("CLI: why on an unknown id fails; missing store is a helpful error", () => {
  const dir = tmpDir();
  const missing = runCli(dir, ["why", "m-001"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /store not found/);
  runCli(dir, ["init"]);
  const unknown = runCli(dir, ["why", "m-999"]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown node/);
  const badCmd = runCli(dir, ["frobnicate"]);
  assert.equal(badCmd.status, 2);
});
