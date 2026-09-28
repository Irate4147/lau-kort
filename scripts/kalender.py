#!/usr/bin/env python3
"""Skriv abonnerbare kalendere (iCalendar/.ics) til kalender/.

    python3 scripts/kalender.py

Filer (kan abonneres på i fx Google Kalender, Apple Kalender og Outlook):
  kalender/<forening>.ics        foreningens arrangementer + landsforeningens (til én forening)
  kalender/<forening>-kun.ics    kun foreningens arrangementer (til flere foreninger sammen med landsforeningen.ics)
  kalender/landsforeningen.ics   kun landsforeningens arrangementer
  kalender/alle.ics              alle arrangementer

Rettelser i data/rettelser.json (den offentlige del, se scripts/admin.py) anvendes (samme regler som siden og hb.py). Skjulte arrangementer,
arrangementer fjernet fra Facebook og arrangementer mere end et år tilbage udelades; aflyste står som aflyst. Filnavnene laves med slug() –
samme regel som kalenderSlug() i app.js.
"""
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from hb import anvend_rettelser

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
UD = ROOT / "kalender"
NATIONAL = "Landsforeningen"
SIDE = "https://irate4147.github.io/lau-kort/"


def slug(navn):
    s = navn.lower().replace("æ", "ae").replace("ø", "oe").replace("å", "aa")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def tid(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(timezone.utc)


def ics_tid(d):
    return d.strftime("%Y%m%dT%H%M%SZ")


def tekst(s):
    return str(s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\\n").replace("\n", "\\n")


def fold(linje):
    """Linjer må højst være 75 oktetter (RFC 5545); fortsættelseslinjer starter med et mellemrum."""
    ud, cur, n = [], "", 0
    for c in linje:
        b = len(c.encode("utf-8"))
        if n + b > (75 if not ud else 74):
            ud.append(cur)
            cur, n = "", 0
        cur += c
        n += b
    ud.append(cur)
    return "\r\n ".join(ud)


def visningsnavn(navn):
    return NATIONAL if navn == NATIONAL else f"LAU {navn}"


def vevent(e):
    start = tid(e["start"])
    slut = tid(e["slut"]) if e.get("slut") else start + timedelta(hours=2)
    if slut <= start:
        slut = start + timedelta(hours=2)
    stempel = tid(e.get("foerst_set") or e["start"])
    beskrivelse = [" · ".join(visningsnavn(f) for f in e.get("foreninger") or [e["forening"]])]
    if e.get("aflyst"):
        beskrivelse.append("AFLYST")
    if e.get("beskrivelse"):
        beskrivelse += ["", e["beskrivelse"]]
    if e.get("url"):
        beskrivelse += ["", e["url"]]
    linjer = [
        "BEGIN:VEVENT",
        f"UID:{e['id']}@lau-kort",
        f"DTSTAMP:{ics_tid(stempel)}",
        f"DTSTART:{ics_tid(start)}",
        f"DTEND:{ics_tid(slut)}",
        f"SUMMARY:{tekst(('AFLYST: ' if e.get('aflyst') else '') + (e.get('navn') or 'Arrangement'))}",
        f"DESCRIPTION:{tekst(chr(10).join(beskrivelse))}",
        f"CATEGORIES:{tekst(visningsnavn(e['forening']))}",
    ]
    if e.get("sted"):
        linjer.append(f"LOCATION:{tekst(e['sted'])}")
    if e.get("lat") is not None and e.get("lng") is not None:
        linjer.append(f"GEO:{e['lat']};{e['lng']}")
    if e.get("url"):
        linjer.append(f"URL:{e['url']}")
    linjer += [f"STATUS:{'CANCELLED' if e.get('aflyst') else 'CONFIRMED'}", "END:VEVENT"]
    return linjer


def kalender(navn, beskrivelse, events):
    linjer = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//LAU//lau-kort//DA",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{tekst(navn)}",
        f"X-WR-CALDESC:{tekst(beskrivelse)}",
        "X-WR-TIMEZONE:Europe/Copenhagen",
        "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
        "X-PUBLISHED-TTL:PT12H",
    ]
    for e in sorted(events, key=lambda e: (e["start"], e["id"])):
        linjer += vevent(e)
    linjer.append("END:VCALENDAR")
    return "\r\n".join(fold(l) for l in linjer) + "\r\n"


def main():
    foreninger = json.loads((DATA / "foreninger.json").read_text(encoding="utf-8"))
    events = json.loads((DATA / "events.json").read_text(encoding="utf-8"))
    rettelser_fil = DATA / "rettelser.json"
    if rettelser_fil.exists():
        events = anvend_rettelser(events, json.loads(rettelser_fil.read_text(encoding="utf-8")).get("rettelser"))
    # Fjernet fra Facebook: kun med, hvis det er bekræftet afholdt.
    events = [e for e in events if e.get("start") and (not e.get("forsvundet") or e.get("bekraeftet"))]
    # Tidligere arrangementer højst et år tilbage (som på siden).
    graense = datetime.now(timezone.utc) - timedelta(days=365)
    events = [e for e in events if tid(e.get("slut") or e["start"]) >= graense]
    for e in events:
        e["foreninger"] = e.get("foreninger") or [e["forening"]]
    hos = lambda navn: [e for e in events if navn in e["foreninger"]]
    national = hos(NATIONAL)

    UD.mkdir(exist_ok=True)
    filer = {"alle.ics": kalender("LAU – alle foreninger", f"Alle LAU-arrangementer. {SIDE}", events),
             "landsforeningen.ics": kalender("LAU – Landsforeningen", f"Landsforeningens arrangementer. {SIDE}", national)}
    for f in foreninger:
        if f.get("national"):
            continue
        egne = hos(f["navn"])
        ids = {e["id"] for e in egne}
        filer[f"{slug(f['navn'])}.ics"] = kalender(
            f"LAU {f['navn']}", f"LAU {f['navn']} og Landsforeningen. {SIDE}#{f['navn']}",
            egne + [e for e in national if e["id"] not in ids])
        filer[f"{slug(f['navn'])}-kun.ics"] = kalender(
            f"LAU {f['navn']} (kun lokalt)", f"Kun LAU {f['navn']}s egne arrangementer. {SIDE}#{f['navn']}", egne)

    for gammel in UD.glob("*.ics"):
        if gammel.name not in filer:
            gammel.unlink()
    for navn, indhold in filer.items():
        sti = UD / navn
        if not sti.exists() or sti.read_bytes() != indhold.encode("utf-8"):
            sti.write_bytes(indhold.encode("utf-8"))
    print(f"Skrev {len(filer)} kalendere til {UD.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
