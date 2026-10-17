# CLAUDE.md

Project wfm. Work is driven by `ai wfm task|resume|ask` (skill task-flow); packs live in
`%USERPROFILE%\.copilot\wfm\tasks\<slug>\` (brief.md, state.md).

## Always

- Commits are allowed: small, descriptive, on the task branch; open the PR at the end.
- Build: `npm run build` · Test: `npm test` — run them through `build_digest.py` (errors and failed tests only).
- Never dump a file into the context (`cat`, unbounded `grep`): use `trace.py`, Grep with limits, Read with offset/limit.
- Past ~50 turns or ~120k of context: update `state.md` with `checkpoint.py` and restart with `ai wfm resume`.
- Keep answers short: plans and reports go to files, the chat gets the outcome and the next step.
- Lessons that cost time go to the project KB: `checkpoint.py --lesson "..."`.
