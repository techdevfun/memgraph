# memgraph — decision memory with provenance

Last month my team reversed a queue decision. Nobody could say why we had
picked the first design, what evidence it rested on, or who had signed off
on the replacement. The old design was still half-wired in as a "fallback",
quietly depending on the thing we had just replaced. We found out in
production.

Vector RAG remembers *text*. It does not remember *decisions* — what was
chosen, what it rested on, what contradicted it, and what replaced it.
**memgraph** is a tiny local graph for exactly that: every decision,
fact, and constraint is a node with a source, linked by what supports,
contradicts, supersedes, or depends on what.

## What it does

One zero-dependency Node.js CLI. No network, no server, no embeddings.
The store is a single JSON file you can commit next to your code.

```bash
memgraph init
memgraph add --type decision --title "Use Postgres LISTEN/NOTIFY for the queue" --source "ADR-014"
memgraph add --type fact --title "NOTIFY payloads cap at 8000 bytes" --source "Postgres docs"
memgraph link m-002 m-001 --relation contradicts
memgraph add --type decision --title "Switch the queue to Redis Streams" --source "ADR-019"
memgraph supersede m-001 m-003 --reason "payload cap makes NOTIFY the wrong tool"
```

Three questions it answers, fast:

| Question | Command |
|---|---|
| Why did we decide this? | `memgraph why m-003` — source, supporters, contradictions, supersession |
| Is anything stale or contradictory? | `memgraph check` — unresolved contradictions, live nodes resting on superseded ones, sourceless claims |
| What do we believe? | `memgraph list` — every node, with superseded ones marked |

`memgraph check` exits 1 when it finds an error, so it works as a CI
gate on a `decisions/` folder: a PR that introduces a contradiction, or
keeps depending on a superseded decision, fails before it merges.

## Demo

The repo ships a small team graph — a queue decision, the fact that
killed it, its replacement, and one leftover fallback still depending
on the dead design:

```bash
sh examples/run-demo.sh
```

`memgraph check` on that graph reports exactly two problems: the
fallback reader depends on a superseded decision, and one open
question has no source. The contradiction between the payload-cap
fact and the old decision does *not* get flagged — the old decision
was superseded, so that contradiction is resolved history, not a
live conflict.

## Try it in 3 steps

```bash
# 1. Clone
git clone https://github.com/techdevfun/memgraph.git
cd memgraph

# 2. No dependencies to install (Node.js 18+). Optional: link the command
npm link   # makes `memgraph` available everywhere

# 3. Start a graph for your own project
memgraph init
memgraph add --type decision --title "Use Postgres for the queue" --source "ADR-014"
memgraph why m-001
```

More commands:

```bash
# Record evidence and constraints, not just decisions
memgraph add --type fact --title "Peak depth hit 40k jobs" --source "metrics 2026-10-12"
memgraph add --type constraint --title "Queue must survive a broker restart" --source "SLO doc"

# Link them: supports | contradicts | supersedes | depends-on
memgraph link m-001 m-002 --relation supports

# Machine-readable output for scripts and CI
memgraph why m-003 --json
memgraph check --json
memgraph list --type decision --json
```

## One honesty note

A graph is only as good as what you record. memgraph cannot tell you
whether a source is *true* — it tells you where every claim came from
and whether the graph still holds together. A decision with no source
is a rumor with formatting; that is why `check` flags it. And when a
decision changes, supersede it — don't delete it. Deleting history is
how teams end up re-litigating the same choice every six months.

## Roadmap

- `memgraph blame <file>` — which decisions touch a given file or ADR.
- Time-travel: `memgraph at <date>` to see the graph as it was.
- Export to Mermaid / Graphviz for ADRs and reviews.
- `--stale <days>` warnings for decisions whose sources are old.

Repo: https://github.com/techdevfun/memgraph — MIT, zero dependencies,
Node.js 18+.
