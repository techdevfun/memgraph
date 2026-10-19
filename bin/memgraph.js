#!/usr/bin/env node
// memgraph CLI — thin wrapper over src/memgraph.js.
// Usage: memgraph <command> [args] [--store <path>] [--json]
// Commands: init, add, link, supersede, why, check, list, show, help.
// Exit codes: 0 ok, 1 finding/error (check fails on errors), 2 usage error.

import fs from "node:fs";
import {
  MemgraphError,
  addLink,
  addNode,
  check,
  emptyStore,
  getNode,
  loadStore,
  saveStore,
  supersede,
  why,
} from "../src/memgraph.js";

const HELP = `memgraph — decision memory with provenance.

Usage:
  memgraph init [--store <path>]
  memgraph add --title "..." [--type decision|fact|constraint|question]
               [--source "..."] [--id m-010] [--created YYYY-MM-DD]
  memgraph link <from> <to> --relation supports|contradicts|supersedes|depends-on
               [--reason "..."]
  memgraph supersede <old-id> <new-id> [--reason "..."]
  memgraph why <id>
  memgraph check
  memgraph list [--type <type>]
  memgraph show <id>

Options:
  --store <path>   Store file (default: memgraph.json in the current directory)
  --json           Machine-readable output (why, check, list, show)

The store is plain JSON, so it can live in git next to the code it
documents. Every node should carry a --source: the file, URL, person,
or meeting the claim came from.`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (name === "json") {
        flags.json = true;
      } else {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new MemgraphError(`flag --${name} needs a value`);
        }
        flags[name] = value;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function storePath(flags) {
  return flags.store || "memgraph.json";
}

function fail(message, code = 1) {
  process.stderr.write(`memgraph: error: ${message}\n`);
  process.exit(code);
}

function dash(ids) {
  return ids.length ? ids.join(", ") : "—";
}

function printWhy(result, asJson) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const n = result.node;
  console.log(`${n.id} — ${n.type} — ${n.title}`);
  console.log(`  source: ${n.source || "(none)"}`);
  console.log(`  supersedes: ${dash(result.supersedes)}`);
  console.log(`  superseded-by: ${dash(result.supersededBy)}`);
  console.log(`  supports: ${dash(result.supports)}`);
  console.log(`  supported-by: ${dash(result.supportedBy)}`);
  console.log(`  contradicts: ${dash(result.contradicts)}`);
  console.log(`  contradicted-by: ${dash(result.contradictedBy)}`);
  console.log(`  depends-on: ${dash(result.dependsOn)}`);
  console.log(`  depended-on-by: ${dash(result.dependedOnBy)}`);
}

function printCheck(result, asJson) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.findings.length === 0) {
    console.log("memgraph: clean — no problems found.");
    return;
  }
  console.log(`memgraph: ${result.findings.length} problem(s) found:`);
  for (const f of result.findings) {
    const label = f.severity === "error" ? "[error]" : "[warn ]";
    console.log(`  ${label} ${f.code}: ${f.message}`);
  }
}

function printList(store, type, asJson) {
  const nodes = type
    ? store.nodes.filter((n) => n.type === type)
    : store.nodes;
  if (asJson) {
    console.log(JSON.stringify({ nodes }, null, 2));
    return;
  }
  for (const n of nodes) {
    const extra = n.supersededBy ? ` [superseded by ${n.supersededBy}]` : "";
    console.log(`${n.id} [${n.type}] ${n.title} (source: ${n.source || "none"})${extra}`);
  }
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  let positional;
  let flags;
  try {
    ({ positional, flags } = parseArgs(rest));
  } catch (err) {
    fail(err.message, 2);
  }
  const path = storePath(flags);

  try {
    switch (command) {
      case "init": {
        if (fs.existsSync(path)) {
          fail(`store already exists: ${path}`, 1);
        }
        saveStore(path, emptyStore());
        console.log(`Created ${path}`);
        break;
      }
      case "add": {
        const store = loadStore(path);
        const node = addNode(store, {
          type: flags.type || "decision",
          title: flags.title,
          source: flags.source || "",
          created: flags.created || "",
          id: flags.id || null,
        });
        if (!flags.source) {
          process.stderr.write(
            "memgraph: warning: no --source given — 'memgraph check' will flag this node.\n",
          );
        }
        saveStore(path, store);
        console.log(`Added ${node.id} — ${node.title}`);
        break;
      }
      case "link": {
        const [from, to] = positional;
        if (!from || !to) fail("usage: memgraph link <from> <to> --relation <relation>", 2);
        const store = loadStore(path);
        addLink(store, {
          from,
          to,
          relation: flags.relation,
          reason: flags.reason || "",
        });
        saveStore(path, store);
        console.log(`Linked ${from} --${flags.relation}--> ${to}`);
        break;
      }
      case "supersede": {
        const [oldId, newId] = positional;
        if (!oldId || !newId) fail("usage: memgraph supersede <old-id> <new-id>", 2);
        const store = loadStore(path);
        supersede(store, { oldId, newId, reason: flags.reason || "" });
        saveStore(path, store);
        console.log(`Superseded ${oldId} by ${newId}`);
        break;
      }
      case "why": {
        const [id] = positional;
        if (!id) fail("usage: memgraph why <id>", 2);
        const store = loadStore(path);
        printWhy(why(store, id), Boolean(flags.json));
        break;
      }
      case "check": {
        const store = loadStore(path);
        const result = check(store);
        printCheck(result, Boolean(flags.json));
        process.exit(result.errors > 0 ? 1 : 0);
        break;
      }
      case "list": {
        const store = loadStore(path);
        if (flags.type && !["decision", "fact", "constraint", "question"].includes(flags.type)) {
          fail(`invalid type "${flags.type}"`, 2);
        }
        printList(store, flags.type || null, Boolean(flags.json));
        break;
      }
      case "show": {
        const [id] = positional;
        if (!id) fail("usage: memgraph show <id>", 2);
        const store = loadStore(path);
        const node = getNode(store, id);
        if (!node) fail(`unknown node ${id}`, 1);
        if (flags.json) {
          console.log(JSON.stringify({ node }, null, 2));
        } else {
          console.log(`${node.id} — ${node.type} — ${node.title}`);
          console.log(`  source: ${node.source || "(none)"}`);
          console.log(`  created: ${node.created}`);
          console.log(`  supersedes: ${node.supersedes || "—"}`);
          console.log(`  superseded-by: ${node.supersededBy || "—"}`);
        }
        break;
      }
      default:
        fail(`unknown command "${command}" — run 'memgraph help'`, 2);
    }
  } catch (err) {
    if (err instanceof MemgraphError) {
      fail(err.message, 1);
    }
    throw err;
  }
}

main();
