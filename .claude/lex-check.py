#!/usr/bin/env python3
"""
Post-edit guard for the LEX single-file app.

Wired as a PostToolUse hook on Edit/Write (see .claude/settings.json). It reads the
hook payload on stdin, and if the edited file is a LEX HTML file it checks the two
things that have actually broken this app before:

  1. LF-only lines. The file must be entirely CRLF. A stray LF line has slipped
     through a patch script more than once and shows up as a spurious whole-file
     diff on deploy.
  2. Syntax, per inline <script> block. Checking the whole file at once misses
     which block broke; node --check on each block names it.

Exit 2 tells Claude Code the edit has a problem and feeds stderr back, so the
mistake is caught in the same turn rather than at the end of the session.
Anything else (a different file, a malformed payload) exits 0 and stays out of
the way.

Run with --changed it is the Bash hook instead. CLAUDE.md requires patches to go
through Python scripts run in Bash, and an Edit/Write hook never sees those, so
until v179 the check was not running on real patches at all (handover §0, §24).
Bash payloads do not say which file a command touched, so this mode checks every
LEX-*.html that differs from HEAD (staged, unstaged, or new and untracked), and
exits 0 silently when there is none.
"""
import json
import os
import re
import subprocess
import sys
import tempfile


def is_lex_html(path: str) -> bool:
    name = os.path.basename(path)
    return name.startswith("LEX-") and name.endswith(".html")


def check_file(path: str) -> list:
    problems = []

    raw = open(path, "rb").read()
    lf_only = raw.count(b"\n") - raw.count(b"\r\n")
    if lf_only:
        # Name the first few offending line numbers — enough to find the patch
        # that did it without dumping the file.
        lines = raw.split(b"\n")[:-1]
        bad = [i + 1 for i, line in enumerate(lines) if not line.endswith(b"\r")]
        problems.append(
            f"{lf_only} LF-only line(s) — the file must be entirely CRLF. "
            f"First at line(s): {', '.join(map(str, bad[:10]))}"
            + (" …" if len(bad) > 10 else "")
        )

    text = raw.decode("utf-8", errors="replace")
    blocks = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)</script>", text)
    for i, block in enumerate(blocks, 1):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
            fh.write(block)
            tmp = fh.name
        try:
            res = subprocess.run(
                ["node", "--check", tmp], capture_output=True, text=True, timeout=60
            )
        except FileNotFoundError:
            # A machine that cannot syntax-check must not edit this file quietly:
            # a broken script block takes the live system down for the whole school.
            problems.append(
                "node is not on PATH, so the syntax check could not run. Install "
                "Node before editing this file — a silent half-check is worse than none."
            )
            break
        except subprocess.TimeoutExpired:
            problems.append(f"node --check timed out on inline <script> block {i}")
            break
        finally:
            os.unlink(tmp)
        if res.returncode:
            first = (res.stderr or "").strip().splitlines()
            problems.append(
                f"syntax error in inline <script> block {i} of {len(blocks)}: "
                + " / ".join(first[:4])
            )

    return problems


def report(name: str, problems: list) -> None:
    sys.stderr.write(
        "LEX post-edit check failed on " + name + ":\n  - "
        + "\n  - ".join(problems)
        + "\nFix this before going further; do not continue on top of it.\n"
    )


def changed_lex_files(root: str) -> list:
    def git(*args):
        res = subprocess.run(
            ["git", "-C", root, *args], capture_output=True, text=True, timeout=30
        )
        return res.stdout.splitlines() if res.returncode == 0 else []

    # Against HEAD, not the index: a patch that has been `git add`-ed but not
    # committed is still unchecked. Untracked files count too, because a fresh
    # scratch copy of the app is exactly where a patch gets tried first.
    paths = git("diff", "--name-only", "HEAD") + git(
        "ls-files", "--others", "--exclude-standard"
    )
    found = []
    for rel in dict.fromkeys(paths):
        full = os.path.join(root, rel)
        if is_lex_html(rel) and os.path.exists(full):
            found.append(full)
    return found


def main_changed() -> int:
    root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    failed = False
    for path in changed_lex_files(root):
        problems = check_file(path)
        if problems:
            report(os.path.relpath(path, root), problems)
            failed = True
    return 2 if failed else 0


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    path = (payload.get("tool_input") or {}).get("file_path") or ""
    if not is_lex_html(path) or not os.path.exists(path):
        return 0

    problems = check_file(path)
    if problems:
        report(os.path.basename(path), problems)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main_changed() if "--changed" in sys.argv[1:] else main())
