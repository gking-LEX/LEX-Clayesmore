# LEX — working instructions

LEX is a single-file vanilla-JavaScript HTML application (~16,000 lines) that runs
Clayesmore School's co-curricular programme. `LEX-2026-27.html` is the live system,
served by GitHub Pages at lex.clayesmore.com. There is no build step: the file in
this repo IS the deployed application.

Gideon King is the sole developer and administrator, working on this alongside a
full teaching and SLT load. He wants reliability over speed, plain-English
explanations rather than jargon, and to be told when something he asked for is the
wrong approach. Where a request has a judgement call in it, ask the one question
that decides it rather than guessing.

## Non-negotiables

- **CRLF line endings.** Every line ends `\r\n`. In Python patch scripts:
  `open(path, encoding="utf-8", newline="")`. After any write, the file must
  contain zero LF-only lines.
- **Patch, never rewrite.** Edit with Python scripts that assert an exact single
  match for every string replaced. Never regex-replace blind, and never rewrite a
  whole function to change one line.
- **Syntax-check every inline `<script>` block** after each edit, not just the file
  as a whole. `node --check` is blind to scope: it passes calls to functions that
  do not exist, so follow it with an identifier audit (every function called is
  defined exactly once).
- **Run `lex-tests.js` after every change.** Add tests for new behaviour, and prove
  they work by deliberately breaking the new code and watching them fail. Tests
  must extract the real functions from the shipped HTML — never re-implement the
  logic in the test, which tests the copy rather than the code.
- **Test against real data when a backup is supplied.** Nearly every bug found in
  this system was confirmed by running the shipped code over real records.
- **One version bump per change.** `CURRENT_VERSION` near the top of the file.
  Chunk risky changes into separate versions.
- **Report the diff.** Before delivering, list the lines removed between the
  previous version and the new one, and confirm every one was intended.
- **Update the handover document** with each version: what changed, why, and what
  the next session needs to know.
- **When a test fails, work out which is wrong before fixing either.** Several
  "failures" have been mis-specified assertions; at least as many were real bugs.

## Architecture essentials

- State lives in module-level arrays and maps (`acts`, `pupils`, `dates`, `staff`,
  `sa`, `allocRes`, `allocOverrides`, `allocDateOverrides`, `formData`,
  `attendance`), persisted to localStorage and synced to Supabase.
- **Never store concurrent data in a blob.** Blob writes are last-write-wins; ~30
  staff marking registers at once once clobbered a day's data. Anything many people
  write at the same time belongs in a per-row Supabase table with a compound
  primary key (`lex_attendance`, `lex_date_overrides`, `lex_sa`, `lex_overview`,
  `lex_signins`, `lex_feedback`).
- There is **no Supabase JS library**; the app calls the REST API directly via
  `supaClient={url,key}`. Do not go looking for a client library.
- The allocation engine works per **half-term** and cannot see per-date overrides.
  Effective allocation precedence is: per-date override → half-term override →
  engine result. Anything that reads a pupil's timetable must go through
  `getEffectiveAllocOnDate()`.
- Attendance keys are `di|activity|email`. Parse the email from the **right**
  (`lastIndexOf("|")`): an activity name containing a pipe would otherwise silently
  lose the record.
- The save-guard blocks an empty-in-memory save over non-empty-in-cloud. Its
  "Force save empty values" button is a data-loss trap — never instruct its use.
- The staff and pupil portals render from localStorage first, then correct when the
  cloud load lands. A wrong-looking value is often stale cache, not a bug: read
  after it settles before hunting.
- Two screens can disagree because they **count** differently. When two numbers
  disagree, compare the methods before hunting for bad data.

## Security posture

Access control (`ADMIN_EMAILS`, the Google sign-in gate, role detection) is an
accident gate, not security. This repository is public and the Supabase key ships
in the page, so a capable person with a school account could work around it.
Never treat these as protection, and never add a feature that relies on them to
keep something confidential.

## Never commit

Pupil personal data. Backup JSON exports, form-response CSVs, iSAMS exports and
the handover document all name pupils, and this repository is **public** (GitHub
Pages on the free plan requires it). Keep them in `local-data/` (gitignored). If
real-data analysis is needed and no file is present, ask for one rather than
proceeding without.

This applies to **comments and test fixtures too**, not just data files. A real
pupil's address used to illustrate a rule is still a real pupil's address (found in
v166, present since v161). Use invented values, and before committing anything new
to the repo, search it for every real address and surname from the roster
**case-insensitively** — a capitalised fixture is exactly what a search for the
lowercase form misses.

## Comments

Explain why a thing exists and what breaks without it. A comment restating the
code is noise; a comment recording the incident that caused a guard is worth
keeping forever.
