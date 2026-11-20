# Start Here (Atlas + Codex)

1. Create a NEW empty folder for the project and open a git repo in it:
   mkdir atlas && cd atlas && git init
2. Copy everything from this zip into that folder, so you have:
   AGENTS.md
   docs/prompts/phase-0.md ... phase-9.md
3. Open Codex in that folder and send this message (Phase 0):

   Read AGENTS.md completely. Then read docs/prompts/phase-0.md and execute it fully. Follow the Definition of Done in AGENTS.md, write docs/reports/phase-0.md, commit, tag phase-0-done, and stop. Do not start any other phase.

4. When Codex finishes, review docs/reports/phase-0.md. If it looks good, send the next message (change N to 1, then 2, ... up to 9):

   Read AGENTS.md and docs/reports/phase-<N-1>.md. Then read docs/prompts/phase-<N>.md and execute it fully. Respect all existing ADRs and docs/logic files. Write docs/reports/phase-<N>.md, tag phase-<N>-done, and stop.

   Example for phase 1:
   Read AGENTS.md and docs/reports/phase-0.md. Then read docs/prompts/phase-1.md and execute it fully. Respect all existing ADRs and docs/logic files. Write docs/reports/phase-1.md, tag phase-1-done, and stop.

5. If a phase fails or stops halfway: send the same message again and add:
   Continue from the current repo state; do not redo finished work.
   If tests fail, use docs/prompts/fix-phase.md and paste the error output.

Rule: ONE phase at a time. Never give Codex all phases together.
