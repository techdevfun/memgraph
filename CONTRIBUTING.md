# Contributing to memgraph

Small, focused PRs are welcome.

- Keep it zero-dependency. If a feature needs a package, it probably
  doesn't belong here.
- Add a test in `tests/memgraph.test.js` for every behavior change
  (`node --test tests/memgraph.test.js`).
- Keep the CLI contract stable: commands, flags, exit codes, and the
  `--json` shapes. If you must change them, say so loudly in the PR
  description.
- Keep the demo deterministic: `sh examples/run-demo.sh` output must
  match `examples/expected-output.txt` exactly. If you change any
  output format, regenerate the expected file and say why.
- Don't rewrite history: supersede, don't delete. A deleted node
  destroys the provenance chain the tool exists to preserve.
