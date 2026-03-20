#!/usr/bin/env python3
"""
patch_themes.py
Adds GoatCoin / Blackjack theme overrides to every Nebula theme CSS file.
Run from the project root:  python patch_themes.py

Each theme gets:
  - Blackjack card face colors that match the theme palette
  - GoatCoin stat card accent glow
  - Leaderboard row accent
  - Badge chip color override (the general border/color comes from JS inline styles,
    but this sets the hover highlight per-theme)
"""

import os, re, glob, sys

THEMES_DIR = os.path.join(os.path.dirname(__file__), "public", "css", "themes")
if not os.path.isdir(THEMES_DIR):
    # Fallback: look next to this script
    THEMES_DIR = os.path.join(os.path.dirname(__file__), "css", "themes")
if not os.path.isdir(THEMES_DIR):
    print(f"ERROR: themes directory not found. Tried:\n  public/css/themes\n  css/themes")
    sys.exit(1)

# ── Per-theme card-face overrides ──
# Each value is a dict of CSS overrides injected at the end of that theme file.
# Keys map to CSS selectors or custom properties.
THEME_CARD_STYLES = {
    "og": {
        "bj_card_bg":     "#e8f7ff",
        "bj_card_border": "rgba(79,201,234,.4)",
        "bj_card_shadow": "0 4px 16px rgba(79,201,234,.2)",
        "gc_glow":        "rgba(79,201,234,.18)",
    },
    "dark": {
        "bj_card_bg":     "#f3f0ff",
        "bj_card_border": "rgba(167,139,250,.4)",
        "bj_card_shadow": "0 4px 16px rgba(167,139,250,.2)",
        "gc_glow":        "rgba(167,139,250,.15)",
    },
    "light": {
        "bj_card_bg":     "#fff",
        "bj_card_border": "rgba(59,130,246,.35)",
        "bj_card_shadow": "0 4px 14px rgba(59,130,246,.15)",
        "gc_glow":        "rgba(59,130,246,.1)",
    },
    "aurora": {
        "bj_card_bg":     "#eafff9",
        "bj_card_border": "rgba(0,229,160,.35)",
        "bj_card_shadow": "0 4px 16px rgba(0,229,160,.2)",
        "gc_glow":        "rgba(0,229,160,.15)",
    },
    "synthwave": {
        "bj_card_bg":     "#fff0fb",
        "bj_card_border": "rgba(255,45,138,.45)",
        "bj_card_shadow": "0 4px 18px rgba(255,45,138,.25)",
        "gc_glow":        "rgba(255,45,138,.18)",
    },
    "crimson": {
        "bj_card_bg":     "#fff5f5",
        "bj_card_border": "rgba(240,80,80,.4)",
        "bj_card_shadow": "0 4px 16px rgba(240,80,80,.2)",
        "gc_glow":        "rgba(240,80,80,.15)",
    },
    "midnight": {
        "bj_card_bg":     "#fff8e8",
        "bj_card_border": "rgba(240,160,48,.4)",
        "bj_card_shadow": "0 4px 16px rgba(240,160,48,.2)",
        "gc_glow":        "rgba(240,160,48,.15)",
    },
    "slate": {
        "bj_card_bg":     "#f0f0ff",
        "bj_card_border": "rgba(99,102,241,.4)",
        "bj_card_shadow": "0 4px 16px rgba(99,102,241,.2)",
        "gc_glow":        "rgba(99,102,241,.15)",
    },
    "forest": {
        "bj_card_bg":     "#edfff6",
        "bj_card_border": "rgba(52,211,153,.4)",
        "bj_card_shadow": "0 4px 16px rgba(52,211,153,.2)",
        "gc_glow":        "rgba(52,211,153,.15)",
    },
    "ocean": {
        "bj_card_bg":     "#e8faff",
        "bj_card_border": "rgba(6,182,212,.4)",
        "bj_card_shadow": "0 4px 16px rgba(6,182,212,.2)",
        "gc_glow":        "rgba(6,182,212,.15)",
    },
    "rose": {
        "bj_card_bg":     "#fff0f8",
        "bj_card_border": "rgba(244,114,182,.4)",
        "bj_card_shadow": "0 4px 16px rgba(244,114,182,.2)",
        "gc_glow":        "rgba(244,114,182,.15)",
    },
    "solar": {
        "bj_card_bg":     "#fffbe8",
        "bj_card_border": "rgba(251,191,36,.4)",
        "bj_card_shadow": "0 4px 16px rgba(251,191,36,.2)",
        "gc_glow":        "rgba(251,191,36,.15)",
    },
    "void": {
        "bj_card_bg":     "#f8f8f8",
        "bj_card_border": "rgba(255,255,255,.35)",
        "bj_card_shadow": "0 4px 14px rgba(255,255,255,.1)",
        "gc_glow":        "rgba(255,255,255,.08)",
    },
    "neon": {
        "bj_card_bg":     "#f4ffe8",
        "bj_card_border": "rgba(163,230,53,.45)",
        "bj_card_shadow": "0 4px 16px rgba(163,230,53,.2)",
        "gc_glow":        "rgba(163,230,53,.15)",
    },
    "blush": {
        "bj_card_bg":     "#fff5f8",
        "bj_card_border": "rgba(251,113,133,.4)",
        "bj_card_shadow": "0 4px 16px rgba(251,113,133,.2)",
        "gc_glow":        "rgba(251,113,133,.15)",
    },
    "ice": {
        "bj_card_bg":     "#f0faff",
        "bj_card_border": "rgba(56,189,248,.4)",
        "bj_card_shadow": "0 4px 16px rgba(56,189,248,.2)",
        "gc_glow":        "rgba(56,189,248,.12)",
    },
}

INJECTION_MARKER = "/* __NEBULA_GC_THEME__ */"

def build_injection(theme_name):
    s = THEME_CARD_STYLES.get(theme_name, THEME_CARD_STYLES["og"])
    return f"""\n{INJECTION_MARKER}
/* GoatCoin + Blackjack overrides for {theme_name} theme */
.bj-card {{
  background: {s['bj_card_bg']};
  border-color: {s['bj_card_border']};
  box-shadow: {s['bj_card_shadow']};
}}
.bj-card.red .bj-cv,
.bj-card.red .bj-cs {{
  color: #dc2626;
}}
.bj-card .bj-cv,
.bj-card .bj-cs {{
  color: #0f172a;
}}
.gc-stat-card {{
  box-shadow: 0 4px 20px {s['gc_glow']};
}}
.lb-me {{
  box-shadow: 0 0 12px {s['gc_glow']};
}}
.badge-chip:hover {{
  box-shadow: 0 0 8px {s['gc_glow']};
}}
"""

def process_file(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    theme_name = os.path.splitext(os.path.basename(path))[0]

    # Remove any existing injection
    if INJECTION_MARKER in content:
        idx = content.index(INJECTION_MARKER)
        # Remove from marker back to the preceding newline
        content = content[:idx].rstrip() + "\n"

    # Append new injection
    injection = build_injection(theme_name)
    content = content.rstrip() + "\n" + injection

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    return theme_name

def main():
    css_files = sorted(glob.glob(os.path.join(THEMES_DIR, "*.css")))
    if not css_files:
        print(f"No CSS files found in {THEMES_DIR}")
        sys.exit(1)

    print(f"Found {len(css_files)} theme files in {THEMES_DIR}\n")
    patched = []
    for path in css_files:
        name = process_file(path)
        patched.append(name)
        print(f"  ✓ {name}.css")

    print(f"\nDone — patched {len(patched)} themes:")
    print(", ".join(patched))

if __name__ == "__main__":
    main()