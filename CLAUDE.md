# Notes for Claude Code sessions in this repository

- **Use CodeGraph first.** This repo has a local `.codegraph/` index. Before grep, find or reading files to understand or locate code, call `codegraph_explore` (or run `codegraph explore "<symbol names or question>"` in a shell). It returns the verbatim source, the callers and the tests. In a git worktree or a fresh clone there is no index until `codegraph init` is run there.
- **CodeGraph indexes code only.** The docs (`docs/`), the D-pins (`docs/21-deferred.md`), configs and workflows are not indexed: read those normally. Start with `docs/46-learning-path.md` and `docs/20-orientation.md`.
- When you start a subagent to search code, tell it to use `codegraph_explore` first.
