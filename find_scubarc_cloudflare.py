import os
import re
import sqlite3
import shutil
import subprocess
import tempfile
from pathlib import Path
from datetime import datetime, timedelta
from urllib.parse import urlsplit, urlunsplit

DOMAIN = "scubaresearchcollective.com"

NEEDLES = [
    "scubaresearchcollective.com",
    "scubaresearchcollective",
    "scubarc",
    "scubarc-website",
    "pages.dev",
    "cloudflare",
    "lila.ns.cloudflare.com",
    "tate.ns.cloudflare.com",
    "elisa.ns.cloudflare.com",
    "boyd.ns.cloudflare.com",
]

TEXT_SUFFIXES = {
    ".html", ".css", ".js", ".json", ".toml", ".yml", ".yaml",
    ".md", ".txt", ".log", ".ini", ".cfg", ".conf", ".env",
    ".ps1", ".sh", ".bat", ".cmd", ".xml", ".csv"
}

SKIP_DIRS = {
    "node_modules", ".venv", "venv", "env", "__pycache__",
    ".git\\objects", ".git/objects", "AppData\\Local\\Temp"
}

MAX_FILE_SIZE = 2_000_000  # 2 MB


def redact(s: str) -> str:
    # Redact common secrets if they appear in text.
    patterns = [
        (r"(?i)(api[_-]?token\s*[:=]\s*)[A-Za-z0-9._\-]+", r"\1[REDACTED]"),
        (r"(?i)(access[_-]?token\s*[:=]\s*)[A-Za-z0-9._\-]+", r"\1[REDACTED]"),
        (r"(?i)(secret\s*[:=]\s*)[A-Za-z0-9._\-]+", r"\1[REDACTED]"),
        (r"(?i)(password\s*[:=]\s*)[^\s]+", r"\1[REDACTED]"),
        (r"(?i)(bearer\s+)[A-Za-z0-9._\-]+", r"\1[REDACTED]"),
    ]
    for pat, repl in patterns:
        s = re.sub(pat, repl, s)
    return s


def clean_url(url: str) -> str:
    # Keep scheme/netloc/path, drop query and fragment to avoid tokens.
    try:
        p = urlsplit(url)
        return urlunsplit((p.scheme, p.netloc, p.path, "", ""))
    except Exception:
        return url


def chrome_time_to_dt(chrome_time):
    try:
        # Chrome time is microseconds since 1601-01-01
        return datetime(1601, 1, 1) + timedelta(microseconds=int(chrome_time))
    except Exception:
        return None


def should_skip(path: Path) -> bool:
    s = str(path)
    return any(skip in s for skip in SKIP_DIRS)


def find_git_configs(start: Path):
    results = []
    for root, dirs, files in os.walk(start):
        root_path = Path(root)
        if should_skip(root_path):
            dirs[:] = []
            continue
        if ".git" in dirs:
            cfg = root_path / ".git" / "config"
            if cfg.exists():
                results.append(cfg)
            # Do not traverse into .git
            dirs[:] = [d for d in dirs if d != ".git"]
    return results


def search_text_files(roots):
    hits = []

    for root in roots:
        root = Path(root)
        if not root.exists():
            continue

        for path in root.rglob("*"):
            if should_skip(path):
                continue
            if not path.is_file():
                continue

            try:
                if path.stat().st_size > MAX_FILE_SIZE:
                    continue
            except Exception:
                continue

            # Search likely text files only.
            if path.suffix.lower() not in TEXT_SUFFIXES and path.name.lower() not in {"config", "_headers", "readme"}:
                continue

            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue

            lower = text.lower()
            matched = [n for n in NEEDLES if n.lower() in lower]
            if not matched:
                continue

            snippets = []
            lines = text.splitlines()
            for i, line in enumerate(lines, start=1):
                lline = line.lower()
                if any(n.lower() in lline for n in NEEDLES):
                    snippets.append(f"L{i}: {redact(line.strip())}")
                    if len(snippets) >= 5:
                        break

            hits.append({
                "path": str(path),
                "matched": matched,
                "snippets": snippets,
            })

    return hits


def search_browser_history():
    results = []
    local = Path(os.environ.get("LOCALAPPDATA", ""))

    history_globs = [
        local / "Microsoft" / "Edge" / "User Data",
        local / "Google" / "Chrome" / "User Data",
        local / "BraveSoftware" / "Brave-Browser" / "User Data",
    ]

    for base in history_globs:
        if not base.exists():
            continue

        for history in base.glob("*/History"):
            profile = history.parent.name
            browser = str(base)

            try:
                with tempfile.NamedTemporaryFile(delete=False) as tmp:
                    tmp_path = Path(tmp.name)
                shutil.copy2(history, tmp_path)
            except Exception:
                continue

            try:
                conn = sqlite3.connect(str(tmp_path))
                cur = conn.cursor()

                clauses = " OR ".join(["url LIKE ?" for _ in NEEDLES])
                params = [f"%{n}%" for n in NEEDLES]

                cur.execute(
                    f"""
                    SELECT url, title, last_visit_time
                    FROM urls
                    WHERE {clauses}
                    ORDER BY last_visit_time DESC
                    LIMIT 100
                    """,
                    params
                )

                for url, title, last_visit_time in cur.fetchall():
                    when = chrome_time_to_dt(last_visit_time)
                    results.append({
                        "browser_base": browser,
                        "profile": profile,
                        "when": when.isoformat(sep=" ", timespec="seconds") if when else "unknown",
                        "title": title or "",
                        "url": clean_url(url),
                    })

                conn.close()
            except Exception:
                pass
            finally:
                try:
                    tmp_path.unlink(missing_ok=True)
                except Exception:
                    pass

    return results


def nslookup():
    try:
        r = subprocess.run(
            ["nslookup", "-type=NS", DOMAIN],
            capture_output=True,
            text=True,
            timeout=20
        )
        return (r.stdout or "") + (r.stderr or "")
    except Exception as e:
        return f"nslookup failed: {e}"


def main():
    cwd = Path.cwd()
    home = Path.home()

    roots = [
        cwd,
        home / "Downloads",
        home / "Documents",
        home / "Desktop",
        home / ".cloudflare",
        home / ".wrangler",
        home / ".config",
    ]

    report = []
    report.append("ScubaRC Cloudflare Locator Report")
    report.append("=" * 80)
    report.append(f"Run time: {datetime.now().isoformat(sep=' ', timespec='seconds')}")
    report.append(f"Current folder: {cwd}")
    report.append("")

    report.append("DNS NSLOOKUP")
    report.append("-" * 80)
    report.append(nslookup().strip())
    report.append("")

    report.append("GIT CONFIGS")
    report.append("-" * 80)
    git_configs = find_git_configs(cwd)
    if not git_configs:
        report.append("No .git/config files found under current folder.")
    else:
        for cfg in git_configs:
            report.append(f"\n{cfg}")
            try:
                report.append(redact(cfg.read_text(encoding='utf-8', errors='ignore')).strip())
            except Exception as e:
                report.append(f"Could not read: {e}")
    report.append("")

    report.append("TEXT FILE HITS")
    report.append("-" * 80)
    hits = search_text_files(roots)
    if not hits:
        report.append("No text file hits found.")
    else:
        for hit in hits:
            report.append(f"\nFILE: {hit['path']}")
            report.append(f"MATCHED: {', '.join(hit['matched'])}")
            for snip in hit["snippets"]:
                report.append(f"  {snip}")
    report.append("")

    report.append("BROWSER HISTORY HITS")
    report.append("-" * 80)
    bh = search_browser_history()
    if not bh:
        report.append("No browser history hits found. Close browsers and rerun if history DBs were locked.")
    else:
        for item in bh[:200]:
            report.append(f"\nWHEN: {item['when']}")
            report.append(f"BROWSER PROFILE: {item['profile']}")
            report.append(f"TITLE: {item['title']}")
            report.append(f"URL: {item['url']}")

    out = cwd / "scubarc_cloudflare_locator_report.txt"
    out.write_text("\n".join(report), encoding="utf-8")

    print(f"\nReport written to:\n{out}\n")
    print("Open it with:")
    print(f'notepad "{out}"')
    print("\nDo not paste the entire report publicly. Paste only the relevant Cloudflare URL/history lines if needed.")


if __name__ == "__main__":
    main()