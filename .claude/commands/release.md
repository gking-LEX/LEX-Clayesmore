---
description: Run the full LEX release check and report what changed
---

Run the release check for the current working copy of `LEX-2026-27.html` and report
back. Do not skip a step because an earlier one passed.

1. **Line endings.** Confirm zero LF-only lines.
2. **Syntax.** `node --check` each inline `<script>` block separately.
3. **Identifier audit.** Every function called by code added or changed in this
   version is defined exactly once. `node --check` will not catch a call to a
   function that does not exist.
4. **Tests.** Run `node lex-tests.js LEX-2026-27.html` and, if a backup is present
   in `local-data/`, pass it as the second argument so the real-data checks run
   instead of skipping. Report passed / failed / skipped.
5. **New tests earn their place.** For behaviour added in this version, break the
   new code deliberately in a scratch copy and confirm the new tests fail. Report
   which test caught it. Never leave this out — a test that cannot fail is noise.
6. **Version.** Confirm `CURRENT_VERSION` was bumped exactly once.
7. **Diff.** Show the lines *removed* since the previous version (`git diff` against
   the last commit, or the previous version's file). List them and confirm each was
   intended. This is what catches an accidental edit.
8. **Handover.** Confirm the handover document records this version: what changed,
   why, and anything the next session needs to know.

Finish with a short summary in plain English: what changed, what Gideon needs to do
after deploying (re-run the allocation, run SQL, adjust a setting), and anything
found along the way that he should decide on. Do not commit unless asked.
