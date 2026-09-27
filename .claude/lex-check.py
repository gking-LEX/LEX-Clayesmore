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
Anything else (a different file, a malformed payload, node missing) exits 0 and
stays out of the way.
"""
import json
import os
import re
import subprocess
import sys
import tempfile


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    path = (payload.get("tool_input") or {}).get("file_path") or ""
    name = os.path.basename(path)
    if not (name.startswith("LEX-") and name.endswith(".html")):
        return 0
    if not os.path.exists(path):
        return 0

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

    if problems:
        sys.stderr.write(
            "LEX post-edit check failed on " + name + ":\n  - "
            + "\n  - ".join(problems)
            + "\nFix this before going further; do not continue on top of it.\n"
        )
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
