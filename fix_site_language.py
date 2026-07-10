from pathlib import Path

files = list(Path(".").glob("*.html"))

footer_old = "� Scuba Research Collective. Nonprofit research institute. Motto:"
footer_new = "&copy; Scuba Research Collective. Veteran-founded research organization. Motto:"

replacements = {
    footer_old: footer_new,

    # Common bad dash character fixes
    " � ": " &mdash; ",
    "it�where": "it&mdash;where",
    "data�without": "data&mdash;without",

    # Entity/legal posture cleanup
    "ScubaRC is being structured as a nonprofit research institute.": 
    "ScubaRC is currently operated through Scuba Research Collective LLC while a separate nonprofit foundation is being formed.",

    "As formal nonprofit status and accounting infrastructure are finalized, this": 
    "As formal nonprofit status and accounting infrastructure are finalized, support mechanisms will be updated. Contributions are not currently presented as tax-deductible. This",
}

for path in files:
    text = path.read_text(encoding="utf-8", errors="replace")
    original = text

    for old, new in replacements.items():
        text = text.replace(old, new)

    if text != original:
        path.write_text(text, encoding="utf-8")
        print(f"Updated {path}")

print("Cleanup complete.")
