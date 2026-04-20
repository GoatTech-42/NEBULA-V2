#!/usr/bin/env python3
"""
deploy.py — Nebula V2 interactive release & deploy tool
========================================================

Goals
-----
A single Python script that takes you from "I'm done coding" to
"the new build is live on Firebase Hosting" in one interactive flow:

  1.  Reads the CURRENT version info straight out of `public/js/version.js`
      and prints the last 5 releases so you can see where you are.
  2.  Lets you pick the NEXT version with four choices:
        p)  patch   2.5.0 -> 2.5.1
        m)  minor   2.5.0 -> 2.6.0
        M)  major   2.5.0 -> 3.0.0
        c)  custom  "whatever you type"
  3.  Prompts for a release codename, a release title, a channel
      (production/beta/dev/nightly), and a multi-line changelog
      (one bullet per line, blank line to finish).
  4.  Auto-stamps BUILD_DATE (current UTC, ISO-8601), BUILD_COMMIT
      (current `git rev-parse --short HEAD`), and bumps BUILD_NUMBER.
  5.  Updates `public/js/version.js` (APP_VERSION + friends + CHANGELOG
      entry prepended) and `public/service-worker.js` (CACHE_VERSION).
  6.  Shows you a unified diff of every change and asks for final
      confirmation.
  7.  Creates a git commit + annotated tag `vX.Y.Z`, pushes to the
      current branch, then optionally runs `firebase deploy`.

Design principles
-----------------
* **Zero third-party dependencies.**  Standard library only, so anyone
  cloning the repo can just `python3 deploy.py`.
* **Safe by default.**  `--dry-run` prints every edit without writing.
  The interactive "Confirm?" step is still shown even outside dry-run;
  pass `--yes` to skip for CI.
* **Idempotent marker-based edits.**  `version.js` / `service-worker.js`
  carry `// @@deploy:FIELD` anchors that this script uses for targeted
  replacement — no fragile full-file regex.
* **Fail loud.**  Any subprocess error aborts the flow before anything
  is committed or pushed.

Usage
-----
Interactive (the normal case):

    python3 deploy.py

Non-interactive / CI:

    python3 deploy.py --yes --bump minor --codename "Orbit" \
        --title "Faster chat, new themes" \
        --changelog "Chat 2x faster" "Three new themes" "Bug fixes"

Dry-run preview only:

    python3 deploy.py --dry-run

Skip the `firebase deploy` step (commit/tag/push only):

    python3 deploy.py --no-firebase

See `--help` for the full flag list.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as _dt
import difflib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Iterable, Sequence

# ---------------------------------------------------------------------------
#  Paths & constants
# ---------------------------------------------------------------------------

REPO_ROOT     = Path(__file__).resolve().parent
VERSION_FILE  = REPO_ROOT / "public" / "js" / "version.js"
SW_FILE       = REPO_ROOT / "public" / "service-worker.js"
FIREBASE_JSON = REPO_ROOT / "firebase.json"
DATABASE_RULES = REPO_ROOT / "database.rules.json"

# Allowed channels (also used for prompt validation).
CHANNELS      = ("production", "beta", "dev", "nightly")

# ANSI colour helpers — stripped automatically when stdout isn't a TTY.
class C:
    RESET  = "\033[0m"
    BOLD   = "\033[1m"
    DIM    = "\033[2m"
    RED    = "\033[31m"
    GREEN  = "\033[32m"
    YELLOW = "\033[33m"
    BLUE   = "\033[34m"
    MAG    = "\033[35m"
    CYAN   = "\033[36m"

    @classmethod
    def disable(cls):
        for name in list(vars(cls)):
            if name.isupper():
                setattr(cls, name, "")

if not sys.stdout.isatty() or os.environ.get("NO_COLOR"):
    C.disable()


# ---------------------------------------------------------------------------
#  Data classes
# ---------------------------------------------------------------------------

@dataclasses.dataclass
class VersionInfo:
    """A parsed snapshot of version.js."""
    version:  str
    codename: str
    date:     str
    channel:  str
    commit:   str
    number:   int
    changelog: list[dict]

    def pretty(self) -> str:
        return (
            f"{C.BOLD}v{self.version}{C.RESET} "
            f"{C.CYAN}{self.codename}{C.RESET} "
            f"{C.DIM}· {self.channel} · {self.commit} · #{self.number} · {self.date}{C.RESET}"
        )


# ---------------------------------------------------------------------------
#  Tiny UI helpers
# ---------------------------------------------------------------------------

def info(msg: str) -> None:
    print(f"{C.CYAN}›{C.RESET} {msg}")

def ok(msg: str) -> None:
    print(f"{C.GREEN}✓{C.RESET} {msg}")

def warn(msg: str) -> None:
    print(f"{C.YELLOW}!{C.RESET} {msg}")

def fail(msg: str, code: int = 1) -> None:
    print(f"{C.RED}✗ {msg}{C.RESET}", file=sys.stderr)
    sys.exit(code)

def header(title: str) -> None:
    bar = "─" * max(4, min(60, len(title) + 4))
    print(f"\n{C.BOLD}{C.MAG}{bar}\n  {title}\n{bar}{C.RESET}")

def prompt(question: str, default: str | None = None) -> str:
    suffix = f" [{C.DIM}{default}{C.RESET}]" if default is not None else ""
    while True:
        try:
            raw = input(f"{C.BLUE}?{C.RESET} {question}{suffix}: ").strip()
        except EOFError:
            raw = ""
        if raw:
            return raw
        if default is not None:
            return default

def confirm(question: str, default: bool = True) -> bool:
    yn = "Y/n" if default else "y/N"
    try:
        ans = input(f"{C.BLUE}?{C.RESET} {question} [{yn}]: ").strip().lower()
    except EOFError:
        ans = ""
    if not ans:
        return default
    return ans in ("y", "yes")


# ---------------------------------------------------------------------------
#  Shell helper
# ---------------------------------------------------------------------------

def run(cmd: Sequence[str] | str, *, check: bool = True, capture: bool = False,
        cwd: Path | None = None) -> subprocess.CompletedProcess:
    """Run a shell command, streaming output by default.

    If `capture=True` we capture stdout/stderr and return them; otherwise
    we stream so the user sees `firebase deploy` progress live.
    """
    if isinstance(cmd, str):
        printable = cmd
        shell = True
    else:
        printable = " ".join(shlex.quote(c) for c in cmd)
        shell = False
    info(f"{C.DIM}$ {printable}{C.RESET}")
    return subprocess.run(
        cmd,
        shell=shell,
        cwd=str(cwd or REPO_ROOT),
        check=check,
        text=True,
        capture_output=capture,
    )


# ---------------------------------------------------------------------------
#  version.js parsing + rewriting
# ---------------------------------------------------------------------------

# Each marker maps to the export-const line that follows it. We use a
# permissive regex that survives minor whitespace/formatting changes.
_MARKER_RE = re.compile(
    r"(// @@deploy:(?P<field>[A-Z_]+)\s*\n\s*export const\s+\w+\s*=\s*)"
    r"(?P<value>[^;\n]+)(;)",
    re.MULTILINE,
)

def read_version_info() -> VersionInfo:
    """Parse the current values out of version.js."""
    if not VERSION_FILE.exists():
        fail(f"{VERSION_FILE} not found — are you running this from the repo root?")

    text = VERSION_FILE.read_text(encoding="utf-8")

    fields: dict[str, str] = {}
    for m in _MARKER_RE.finditer(text):
        fields[m.group("field")] = m.group("value").strip()

    required = ("APP_VERSION", "APP_CODENAME", "BUILD_DATE",
                "BUILD_CHANNEL", "BUILD_COMMIT", "BUILD_NUMBER")
    for key in required:
        if key not in fields:
            fail(f"version.js is missing the // @@deploy:{key} marker.")

    def _unquote(v: str) -> str:
        v = v.strip()
        if (v.startswith("'") and v.endswith("'")) or (v.startswith('"') and v.endswith('"')):
            return v[1:-1]
        return v

    changelog = _parse_changelog(text)

    try:
        number = int(fields["BUILD_NUMBER"])
    except ValueError:
        number = 0

    return VersionInfo(
        version  = _unquote(fields["APP_VERSION"]),
        codename = _unquote(fields["APP_CODENAME"]),
        date     = _unquote(fields["BUILD_DATE"]),
        channel  = _unquote(fields["BUILD_CHANNEL"]),
        commit   = _unquote(fields["BUILD_COMMIT"]),
        number   = number,
        changelog = changelog,
    )


def _parse_changelog(text: str) -> list[dict]:
    """Best-effort parse of existing CHANGELOG entries (for display only).

    We don't need perfect JS parsing — we only use this to print the last
    few releases. If anything goes wrong we fall back to `[]`.
    """
    m = re.search(
        r"// @@deploy:CHANGELOG_BEGIN.*?export const CHANGELOG\s*=\s*\[(?P<body>.*?)\];\s*// @@deploy:CHANGELOG_END",
        text, flags=re.DOTALL,
    )
    if not m:
        return []
    body = m.group("body")

    entries: list[dict] = []
    # Each top-level `{ ... }` block is one release.
    depth = 0
    start = None
    for i, ch in enumerate(body):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                block = body[start:i + 1]
                entries.append(_parse_entry(block))
                start = None
    return [e for e in entries if e]


def _parse_entry(block: str) -> dict | None:
    try:
        version  = re.search(r"version\s*:\s*['\"]([^'\"]+)['\"]", block).group(1)
        date     = re.search(r"date\s*:\s*['\"]([^'\"]+)['\"]", block).group(1)
        title_m  = re.search(r"title\s*:\s*['\"]([^'\"]*)['\"]", block)
        title    = title_m.group(1) if title_m else ""
        items_m  = re.search(r"items\s*:\s*\[(.*?)\]\s*,?\s*}?", block, re.DOTALL)
        items    = []
        if items_m:
            # Naive split on quoted strings — good enough for preview.
            items = re.findall(r"['\"]((?:\\.|[^'\"\\])*)['\"]", items_m.group(1))
        return {"version": version, "date": date, "title": title, "items": items}
    except Exception:
        return None


def replace_marker(text: str, field: str, new_value: str) -> str:
    """Replace the value for a `// @@deploy:FIELD` marker in-place."""
    def _sub(m: re.Match) -> str:
        if m.group("field") != field:
            return m.group(0)
        return f"{m.group(1)}{new_value}{m.group(4)}"
    new_text, count = _MARKER_RE.subn(_sub, text)
    if count == 0:
        fail(f"marker @@deploy:{field} not found in version.js")
    return new_text


def _js_string(s: str) -> str:
    """Encode a Python string as a JS literal, preferring single quotes.

    * If the string contains a single-quote we fall back to JSON-style
      double quotes (both are valid JS), which keeps escapes correct.
    * Otherwise we wrap in single quotes; inside we still need to
      escape backslashes (and un-escape any \\" produced by json.dumps).

    Passes through non-ASCII characters as-is (`ensure_ascii=False`) so
    em-dashes and other Unicode survive round-trips.
    """
    dq = json.dumps(s, ensure_ascii=False)   # e.g. "don\"t"
    inner = dq[1:-1]                          # strip outer quotes
    if "'" in inner or "'" in s:
        # Keep the JSON double-quoted form — safest.
        return dq
    # Re-wrap in single quotes. `inner` is a JSON-escaped body, so
    # backslashes are already doubled and quotes are escaped.  We only
    # need to turn \" back into a bare " (safe inside single quotes).
    inner = inner.replace('\\"', '"')
    return f"'{inner}'"


def build_changelog_entry(version: str, date_str: str, title: str,
                          items: Sequence[str]) -> str:
    """Render a JS object literal for one CHANGELOG entry."""
    lines = [
        "  {",
        f"    version: {_js_string(version)},",
        f"    date: {_js_string(date_str)},",
        f"    title: {_js_string(title)},",
        "    items: [",
    ]
    for it in items:
        lines.append(f"      {_js_string(it)},")
    lines += [
        "    ],",
        "  },",
    ]
    return "\n".join(lines)


def prepend_changelog(text: str, entry_block: str) -> str:
    """Insert a new entry at the top of the CHANGELOG array."""
    # We anchor on the line that opens the array: `export const CHANGELOG = [`
    pattern = re.compile(r"(export const CHANGELOG\s*=\s*\[\n)")
    if not pattern.search(text):
        fail("Couldn't find `export const CHANGELOG = [` in version.js.")
    return pattern.sub(r"\1" + entry_block + "\n", text, count=1)


# ---------------------------------------------------------------------------
#  service-worker rewrite
# ---------------------------------------------------------------------------

_SW_RE = re.compile(
    r"(// @@deploy:CACHE_VERSION[^\n]*\n\s*const\s+CACHE_VERSION\s*=\s*')"
    r"[^']*(';)",
    re.MULTILINE,
)

def rewrite_service_worker(new_value: str) -> tuple[str, str]:
    """Return (old_text, new_text) for service-worker.js."""
    if not SW_FILE.exists():
        fail(f"{SW_FILE} not found.")
    old = SW_FILE.read_text(encoding="utf-8")
    if not _SW_RE.search(old):
        fail("service-worker.js is missing the @@deploy:CACHE_VERSION marker.")
    new = _SW_RE.sub(rf"\g<1>{new_value}\g<2>", old)
    return old, new


# ---------------------------------------------------------------------------
#  Version math & git helpers
# ---------------------------------------------------------------------------

_SEMVER_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:-[\w.+-]+)?$")

def bump_semver(current: str, kind: str) -> str:
    m = _SEMVER_RE.match(current)
    if not m:
        fail(f"Current version '{current}' is not a valid semver.")
    major, minor, patch = (int(x) for x in m.groups())
    if kind == "patch":
        patch += 1
    elif kind == "minor":
        minor += 1
        patch  = 0
    elif kind == "major":
        major += 1
        minor  = 0
        patch  = 0
    else:
        fail(f"Unknown bump type '{kind}'.")
    return f"{major}.{minor}.{patch}"


def git_short_sha() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            cwd=str(REPO_ROOT), capture_output=True, text=True, check=True,
        ).stdout.strip()
        return out or "local"
    except Exception:
        return "local"


def git_is_dirty() -> bool:
    try:
        out = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(REPO_ROOT), capture_output=True, text=True, check=True,
        ).stdout.strip()
        return bool(out)
    except Exception:
        return False


def git_current_branch() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(REPO_ROOT), capture_output=True, text=True, check=True,
        ).stdout.strip()
    except Exception:
        return "HEAD"


# ---------------------------------------------------------------------------
#  Interactive release planning
# ---------------------------------------------------------------------------

def print_previous_releases(vi: VersionInfo, count: int = 5) -> None:
    header("Current build")
    print(f"  {vi.pretty()}")
    if not vi.changelog:
        return
    header(f"Last {min(count, len(vi.changelog))} releases")
    for entry in vi.changelog[:count]:
        v = entry.get("version", "?")
        d = entry.get("date", "?")
        t = entry.get("title", "")
        print(f"  {C.BOLD}v{v}{C.RESET}  {C.DIM}{d}{C.RESET}  {t}")
        for it in entry.get("items", [])[:3]:
            print(f"    {C.DIM}• {it}{C.RESET}")
        extras = max(0, len(entry.get("items", [])) - 3)
        if extras:
            print(f"    {C.DIM}  …and {extras} more{C.RESET}")


def pick_next_version(current: str, args: argparse.Namespace) -> str:
    if args.version:
        if not _SEMVER_RE.match(args.version):
            fail(f"--version '{args.version}' is not a valid semver.")
        return args.version
    if args.bump:
        return bump_semver(current, args.bump)

    header("Pick the next version")
    patch_v = bump_semver(current, "patch")
    minor_v = bump_semver(current, "minor")
    major_v = bump_semver(current, "major")
    print(f"  {C.BOLD}p){C.RESET}  patch    {current} → {C.GREEN}{patch_v}{C.RESET}")
    print(f"  {C.BOLD}m){C.RESET}  minor    {current} → {C.GREEN}{minor_v}{C.RESET}")
    print(f"  {C.BOLD}M){C.RESET}  major    {current} → {C.GREEN}{major_v}{C.RESET}")
    print(f"  {C.BOLD}c){C.RESET}  custom   type your own")

    while True:
        choice = prompt("Choice (p/m/M/c)", default="p").strip()
        if choice in ("p", "patch"):  return patch_v
        if choice in ("m", "minor"):  return minor_v
        if choice in ("M", "major"):  return major_v
        if choice in ("c", "custom"):
            raw = prompt("Custom version (semver X.Y.Z)", default=patch_v)
            if _SEMVER_RE.match(raw):
                return raw
            warn(f"'{raw}' is not a valid semver, try again.")
            continue
        warn("Please answer p, m, M, or c.")


def collect_changelog_items(args: argparse.Namespace) -> list[str]:
    if args.changelog:
        return list(args.changelog)
    header("Changelog bullets")
    print(f"  {C.DIM}Enter one bullet per line. Blank line to finish.{C.RESET}")
    items: list[str] = []
    while True:
        try:
            raw = input(f"  {C.BLUE}›{C.RESET} ").rstrip()
        except EOFError:
            break
        if not raw:
            if items:
                break
            warn("Add at least one changelog bullet.")
            continue
        items.append(raw)
    return items


def pick_channel(current: str, args: argparse.Namespace) -> str:
    if args.channel:
        if args.channel not in CHANNELS:
            fail(f"--channel must be one of {CHANNELS}")
        return args.channel
    raw = prompt(f"Channel ({'/'.join(CHANNELS)})", default=current)
    if raw not in CHANNELS:
        warn(f"Unknown channel '{raw}', keeping '{current}'.")
        return current
    return raw


# ---------------------------------------------------------------------------
#  Diff preview
# ---------------------------------------------------------------------------

def show_diff(path: Path, old: str, new: str) -> None:
    rel  = path.relative_to(REPO_ROOT)
    diff = list(difflib.unified_diff(
        old.splitlines(keepends=True),
        new.splitlines(keepends=True),
        fromfile=f"a/{rel}", tofile=f"b/{rel}", n=2,
    ))
    if not diff:
        info(f"{rel}: no changes")
        return
    header(f"Diff: {rel}")
    for line in diff:
        if line.startswith("+++") or line.startswith("---"):
            sys.stdout.write(f"{C.BOLD}{line}{C.RESET}")
        elif line.startswith("+"):
            sys.stdout.write(f"{C.GREEN}{line}{C.RESET}")
        elif line.startswith("-"):
            sys.stdout.write(f"{C.RED}{line}{C.RESET}")
        elif line.startswith("@@"):
            sys.stdout.write(f"{C.CYAN}{line}{C.RESET}")
        else:
            sys.stdout.write(line)
    print()


# ---------------------------------------------------------------------------
#  RTDB rules preflight
# ---------------------------------------------------------------------------

_RTDB_NULL_COMPARE_RE = re.compile(r"\b(newData\s*([!=]=)\s*null|null\s*([!=]=)\s*newData)\b")


def _firebase_targets(args: argparse.Namespace) -> set[str]:
    only = args.firebase_only or "hosting,firestore:rules,database"
    return {p.strip() for p in only.split(",") if p.strip()}


def validate_database_rules_safety(args: argparse.Namespace) -> None:
    """Block known-invalid RTDB null comparisons before deploy.

    Firebase RTDB rules do not allow comparing DataSnapshot values directly to
    null (for example `newData == null`). Use existence checks instead.
    """
    if args.no_firebase:
        return
    if "database" not in _firebase_targets(args):
        return
    if not DATABASE_RULES.exists():
        return

    text = DATABASE_RULES.read_text(encoding="utf-8")
    offenders: list[tuple[int, str]] = []

    for idx, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("//"):
            continue
        m = _RTDB_NULL_COMPARE_RE.search(raw_line)
        if m:
            offenders.append((idx, m.group(1).strip()))

    if not offenders:
        return

    details = ", ".join(f"line {line_no}: {expr}" for line_no, expr in offenders[:5])
    if len(offenders) > 5:
        details += f", ... (+{len(offenders) - 5} more)"

    fail(
        "Realtime Database rules contain invalid null comparisons "
        f"({details}). Use !newData.exists() instead of newData == null "
        "and newData.exists() instead of newData != null."
    )


# ---------------------------------------------------------------------------
#  Main
# ---------------------------------------------------------------------------

def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Interactive Nebula V2 deploy tool.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            Examples:
              python3 deploy.py
              python3 deploy.py --bump patch --yes
              python3 deploy.py --version 3.0.0 --codename Nova \\
                  --title "Major rewrite" --channel production \\
                  --changelog "New chat engine" "Theme overhaul" --yes
              python3 deploy.py --dry-run
        """),
    )
    p.add_argument("--bump", choices=("patch", "minor", "major"),
                   help="Non-interactive: bump the version this way.")
    p.add_argument("--version", help="Non-interactive: set this exact version.")
    p.add_argument("--codename", help="Release codename (e.g. 'Orbit').")
    p.add_argument("--title",    help="One-line release title.")
    p.add_argument("--channel",  choices=CHANNELS,
                   help="Release channel. Defaults to previous channel.")
    p.add_argument("--changelog", nargs="+",
                   help="One or more changelog bullets (skips prompt).")
    p.add_argument("--dry-run", action="store_true",
                   help="Preview all edits and commands; write nothing.")
    p.add_argument("--yes", "-y", action="store_true",
                   help="Assume yes to the final confirmation.")
    p.add_argument("--no-commit", action="store_true",
                   help="Skip git add/commit/tag/push.")
    p.add_argument("--no-tag", action="store_true",
                   help="Skip `git tag vX.Y.Z` (still commits & pushes).")
    p.add_argument("--no-push", action="store_true",
                   help="Skip `git push`.")
    p.add_argument("--no-firebase", action="store_true",
                   help="Skip the `firebase deploy` step.")
    p.add_argument("--firebase-only",
                   help="Value for `firebase deploy --only ...` "
                        "(default: hosting,firestore:rules,database).")
    p.add_argument("--allow-dirty", action="store_true",
                   help="Proceed even if the working tree has uncommitted changes.")
    return p.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)

    # ---- sanity checks -----------------------------------------------------
    if not VERSION_FILE.exists():
        fail(f"{VERSION_FILE} not found — run this script from the repo root.")
    if not FIREBASE_JSON.exists():
        warn("firebase.json not found — --no-firebase will be forced.")
        args.no_firebase = True

    validate_database_rules_safety(args)

    print(f"{C.BOLD}{C.MAG}╭───────────────────────────────────────────╮")
    print(f"│  Nebula V2 · deploy.py · interactive build │")
    print(f"╰───────────────────────────────────────────╯{C.RESET}")

    # ---- read current state ------------------------------------------------
    current = read_version_info()
    print_previous_releases(current)

    if git_is_dirty() and not args.allow_dirty and not args.dry_run:
        warn("You have uncommitted changes in the working tree.")
        if not confirm("Continue anyway?", default=False):
            fail("Aborted — commit or stash your changes first (or pass --allow-dirty).", code=2)

    # ---- collect the release plan -----------------------------------------
    next_version = pick_next_version(current.version, args)
    if next_version == current.version:
        warn(f"New version equals current version ({current.version}).")
        if not confirm("Continue anyway?", default=False):
            fail("Aborted.", code=2)

    codename = args.codename or prompt("Codename", default=current.codename)
    title    = args.title or prompt("One-line title",
                                    default=f"{codename} — release {next_version}")
    channel  = pick_channel(current.channel, args)
    items    = collect_changelog_items(args)

    # Auto-computed fields.
    now_iso   = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    today     = _dt.date.today().isoformat()
    commit    = git_short_sha()
    number    = current.number + 1
    sw_cache  = f"nebula-v{next_version}-{commit}"

    # ---- summary -----------------------------------------------------------
    header("Release plan")
    print(f"  {C.BOLD}Version {C.RESET}  {C.GREEN}v{next_version}{C.RESET}  "
          f"(was v{current.version})")
    print(f"  {C.BOLD}Codename{C.RESET}  {codename}")
    print(f"  {C.BOLD}Title   {C.RESET}  {title}")
    print(f"  {C.BOLD}Channel {C.RESET}  {channel}")
    print(f"  {C.BOLD}Commit  {C.RESET}  {commit}")
    print(f"  {C.BOLD}Number  {C.RESET}  #{number}")
    print(f"  {C.BOLD}Date    {C.RESET}  {now_iso}")
    print(f"  {C.BOLD}SW cache{C.RESET}  {sw_cache}")
    print(f"  {C.BOLD}Branch  {C.RESET}  {git_current_branch()}")
    print(f"  {C.BOLD}Bullets {C.RESET}")
    for it in items:
        print(f"    • {it}")

    # ---- prepare file edits in memory -------------------------------------
    v_old = VERSION_FILE.read_text(encoding="utf-8")
    v_new = v_old
    v_new = replace_marker(v_new, "APP_VERSION",   _js_string(next_version))
    v_new = replace_marker(v_new, "APP_CODENAME",  _js_string(codename))
    v_new = replace_marker(v_new, "BUILD_DATE",    _js_string(now_iso))
    v_new = replace_marker(v_new, "BUILD_CHANNEL", _js_string(channel))
    v_new = replace_marker(v_new, "BUILD_COMMIT",  _js_string(commit))
    v_new = replace_marker(v_new, "BUILD_NUMBER",  str(number))
    v_new = prepend_changelog(
        v_new, build_changelog_entry(next_version, today, title, items)
    )

    sw_old, sw_new = rewrite_service_worker(sw_cache)

    show_diff(VERSION_FILE, v_old, v_new)
    show_diff(SW_FILE,      sw_old, sw_new)

    # ---- confirm -----------------------------------------------------------
    if args.dry_run:
        ok("Dry-run complete — no files were written.")
        return 0

    if not args.yes and not confirm("Apply these changes and deploy?", default=True):
        fail("Aborted by user.", code=2)

    # ---- write files -------------------------------------------------------
    VERSION_FILE.write_text(v_new, encoding="utf-8")
    ok(f"wrote {VERSION_FILE.relative_to(REPO_ROOT)}")
    SW_FILE.write_text(sw_new, encoding="utf-8")
    ok(f"wrote {SW_FILE.relative_to(REPO_ROOT)}")

    # ---- git commit / tag / push ------------------------------------------
    tag = f"v{next_version}"
    if not args.no_commit:
        try:
            run(["git", "add", "public/js/version.js", "public/service-worker.js"])
            commit_msg = _build_commit_message(next_version, codename, title, items)
            run(["git", "commit", "-m", commit_msg])
            ok(f"committed {tag}")
        except subprocess.CalledProcessError as e:
            fail(f"git commit failed (exit {e.returncode}).")

        if not args.no_tag:
            try:
                tag_msg = f"{codename} — {title}"
                run(["git", "tag", "-a", tag, "-m", tag_msg])
                ok(f"tagged {tag}")
            except subprocess.CalledProcessError:
                warn(f"tag {tag} already exists — continuing.")

        if not args.no_push:
            branch = git_current_branch()
            try:
                run(["git", "push", "origin", branch])
                if not args.no_tag:
                    run(["git", "push", "origin", tag], check=False)
                ok(f"pushed {branch}")
            except subprocess.CalledProcessError as e:
                warn(f"git push failed (exit {e.returncode}) — continuing with deploy.")

    # ---- firebase deploy ---------------------------------------------------
    if not args.no_firebase:
        firebase_bin = shutil.which("firebase")
        if not firebase_bin:
            warn("firebase CLI not found on PATH — skipping deploy.")
        else:
            only = args.firebase_only or "hosting,firestore:rules,database"
            header(f"firebase deploy --only {only}")
            try:
                run([firebase_bin, "deploy", "--only", only])
                ok(f"deployed {tag} to Firebase ({channel})")
            except subprocess.CalledProcessError as e:
                fail(f"firebase deploy failed (exit {e.returncode}).")
    else:
        info("skipping firebase deploy (--no-firebase)")

    header("Done")
    print(f"  {C.GREEN}✓ Nebula V2 {tag} · {codename} · #{number} is live!{C.RESET}")
    print(f"  {C.DIM}Commit: {commit}  ·  {now_iso}{C.RESET}")
    return 0


def _build_commit_message(version: str, codename: str, title: str,
                          items: Iterable[str]) -> str:
    body_lines = [f"- {i}" for i in items]
    body = "\n".join(body_lines) if body_lines else "(no changelog body)"
    return (
        f"release(v{version}): {codename} — {title}\n\n"
        f"{body}\n"
    )


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print()
        fail("Interrupted.", code=130)
