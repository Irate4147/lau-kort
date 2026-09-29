"""Bro til kernen (kerne/): forretningsreglerne beregnes af scripts/kerne.js med Node, så de kun findes ét sted.

Scriptene læser og skriver selv filerne (og krypterer); kernen får data og rettelser og giver regnestykkerne tilbage:
arrangementer med rettelser, dækning, momentum, HB-prognose og HB-risiko pr. forening på de ønskede tidspunkter. Se
scripts/kerne.js for formatet. Kræver Node 22 (GitHub Actions: actions/setup-node og npm ci).
"""
import json
import shutil
import subprocess
import sys
from datetime import timezone
from pathlib import Path

CLI = Path(__file__).resolve().parent / "kerne.js"


def iso(t):
    """Tidspunktet som ISO i UTC med millisekunder (JavaScripts Date har ikke mere)."""
    return t.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def beregn(foreninger, events, meta, rettelser, nu, tidspunkter=()):
    """Kør kernen. nu og tidspunkternes "tid" er datetimes med tidszone; se scripts/kerne.js."""
    if not shutil.which("node"):
        sys.exit("Mangler Node (22 eller nyere): reglerne ligger i kerne/ og køres med node scripts/kerne.js")
    ind = {"foreninger": foreninger, "events": events, "meta": meta, "rettelser": rettelser or {}, "nu": iso(nu),
           "tidspunkter": [{**t, "tid": iso(t["tid"])} for t in tidspunkter]}
    p = subprocess.run(["node", str(CLI)], input=json.dumps(ind, ensure_ascii=False), capture_output=True, text=True,
                       encoding="utf-8")
    if p.returncode:
        sys.exit(f"Kernen (scripts/kerne.js) fejlede:\n{p.stderr}")
    return json.loads(p.stdout)
