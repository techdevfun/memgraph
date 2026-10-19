#!/bin/sh
# Demo: read-only commands against the example team graph.
# Expected output is in expected-output.txt.
set -eu
cd "$(dirname "$0")/.."
echo "$ memgraph why m-004 --store examples/team/graph.json"
node bin/memgraph.js why m-004 --store examples/team/graph.json
echo
echo "$ memgraph check --store examples/team/graph.json"
node bin/memgraph.js check --store examples/team/graph.json || true
echo
echo "$ memgraph list --store examples/team/graph.json"
node bin/memgraph.js list --store examples/team/graph.json
