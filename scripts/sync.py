#!/usr/bin/env python3
"""Saml LAU-begivenheder fra de løbende Apify-kørsler til data/events.json.

Scraperen køres ugentligt af Google Apps Scriptet i regnearket "LAU – begivenheder".
Dette script scraper ikke selv: det læser resultaterne af de kørsler, der allerede
er lavet (kun kørsler på lokalforeningernes "upcoming_hosted_events"), og fletter dem
ind i en voksende database, så afholdte begivenheder bevares til analyserne.

    APIFY_TOKEN=... python3 scripts/sync.py

Kører i GitHub Actions (.github/workflows/sync.yml); lokalt læses token også fra
../.apify_token, hvis miljøvariablen mangler.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
EVENTS = DATA / "events.json"
META = DATA / "meta.json"
FORENINGER = DATA / "foreninger.json"
TOPO = ROOT / "geo" / "kommuner.topo.json"

API = "https://api.apify.com/v2"
ACTOR = "apify~facebook-events-scraper"
DEFAULT_DURATION_MIN = 120
MAX_BESKRIVELSE = 600


# ---------------------------------------------------------------- apify

def token():
    tok = os.environ.get("APIFY_TOKEN")
    local = ROOT.parent / ".apify_token"
    if not tok and local.exists():
        tok = local.read_text().strip()
    if not tok:
        sys.exit("Mangler APIFY_TOKEN")
    return tok


def api(path):
    req = urllib.request.Request(API + path, headers={"authorization": f"Bearer {token()}"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


# ---------------------------------------------------------------- geografi

def load_kommuner():
    """Kommunepolygoner (lon/lat-ringe) fra TopoJSON-filen, til punkt-i-polygon."""
    topo = json.loads(TOPO.read_text(encoding="utf-8"))
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)

    def ring(idx):
        pts = []
        for i in idx:
            seg = arcs[i] if i >= 0 else arcs[~i][::-1]
            pts.extend(seg if not pts else seg[1:])
        return pts

    out = []
    for g in topo["objects"]["kom"]["geometries"]:
        polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
        out.append((g["properties"]["navn"], g["properties"]["forening"],
                    [[ring(r) for r in poly] for poly in polys]))
    return out


def inside(pt, rng):
    x, y = pt
    hit = False
    for (x1, y1), (x2, y2) in zip(rng, rng[1:] + rng[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def kommune_for(lat, lng, kommuner):
    if lat is None or lng is None:
        return None, None
    for navn, forening, polys in kommuner:
        for poly in polys:
            if inside((lng, lat), poly[0]) and not any(inside((lng, lat), h) for h in poly[1:]):
                return navn, forening
    return None, None


# ---------------------------------------------------------------- foreninger

def side_key(url):
    """Normaliseret nøgle for en Facebook-side: 'id=123' eller '/slug/'."""
    url = (url or "").lower()
    m = re.search(r"profile\.php\?id=(\d+)", url)
    if m:
        return "id=" + m.group(1)
    m = re.search(r"facebook\.com/([^/?#]+)", url)
    return f"/{m.group(1)}/" if m else None


def load_foreninger():
    return [(f["navn"], side_key(f["facebook"])) for f in json.loads(FORENINGER.read_text(encoding="utf-8"))
            if f.get("facebook")]


def forening_for_url(url, foreninger):
    url = (url or "").lower() + "/"
    for navn, key in foreninger:
        if key and key in url:
            return navn
    return None


def vaerter(item, foreninger):
    """Foreninger bag begivenheden: den scrapede side først, derefter medarrangører."""
    out = []
    for s in [item.get("inputUrl")] + [f"{o.get('url') or ''}/ id={o.get('id') or ''}"
                                       for o in item.get("organizators") or []]:
        f = forening_for_url(s, foreninger)
        if f and f not in out:
            out.append(f)
    return out


# ---------------------------------------------------------------- begivenheder

def varighed_min(d):
    s = str(d or "").lower()
    n = lambda pat: int(m.group(1)) if (m := re.search(pat, s)) else 0
    return (n(r"(\d+)\s*(?:day|dag)") * 1440 + n(r"(\d+)\s*(?:hr|hour|t\b)") * 60
            + n(r"(\d+)\s*min")) or DEFAULT_DURATION_MIN


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def record(item, hosts, kommune, seen):
    loc = item.get("location") or {}
    start = parse(item.get("utcStartDate"))
    steder = [str(s).strip().rstrip(".") for s in (loc.get("name"), item.get("address")) if s]
    steder = [s for i, s in enumerate(steder) if i == 0 or s.split(",")[0] not in steder[0]]
    return {
        "id": str(item["id"]),
        "forening": hosts[0],
        "foreninger": hosts,
        "navn": str(item.get("name") or "(uden navn)").strip(),
        "url": str(item.get("url") or f"https://www.facebook.com/events/{item['id']}/")
                  .replace("://web.facebook.com", "://www.facebook.com"),
        "start": iso(start) if start else None,
        "slut": iso(start + timedelta(minutes=varighed_min(item.get("duration")))) if start else None,
        "sted": ", ".join(steder) or ("Online" if item.get("isOnline") else ""),
        "lat": loc.get("latitude"),
        "lng": loc.get("longitude"),
        "kommune": kommune,
        "online": bool(item.get("isOnline")),
        "aflyst": bool(item.get("isCanceled")),
        "deltager": item.get("usersGoing"),
        "interesserede": item.get("usersInterested"),
        "svar": item.get("usersResponded"),
        "beskrivelse": str(item.get("description") or "")[:MAX_BESKRIVELSE],
        "foerst_set": seen,
        "sidst_set": seen,
        "forsvundet": False,
    }


def main():
    foreninger = load_foreninger()
    kommuner = load_kommuner()
    events = {e["id"]: e for e in json.loads(EVENTS.read_text(encoding="utf-8"))} if EVENTS.exists() else {}
    meta = json.loads(META.read_text(encoding="utf-8")) if META.exists() else {"koersler": [], "behandlet": []}
    behandlet = set(meta["behandlet"])

    runs = (api(f"/acts/{ACTOR}/runs?desc=1&limit=100&status=SUCCEEDED") or {}).get("data", {}).get("items", [])
    nye_runs = sorted((r for r in runs if r["id"] not in behandlet), key=lambda r: r["startedAt"])

    for run in nye_runs:
        behandlet.add(run["id"])
        inp = api(f"/key-value-stores/{run['defaultKeyValueStoreId']}/records/INPUT") or {}
        urls = [u if isinstance(u, str) else (u or {}).get("url", "") for u in inp.get("startUrls") or []]
        if not any("upcoming_hosted_events" in u for u in urls):
            continue  # kun de løbende kørsler på kommende begivenheder
        items = api(f"/datasets/{run['defaultDatasetId']}/items?clean=true&format=json")
        if items is None:
            print(f"{run['id']}: datasættet er slettet (Apify gemmer det kun i en periode)", file=sys.stderr)
            continue
        seen = iso(parse(run["startedAt"]))
        daekket = {f for u in urls if (f := forening_for_url(u, foreninger))}
        set_ids = set()
        for item in items:
            if not item.get("id"):
                continue
            kommune, kom_forening = kommune_for((item.get("location") or {}).get("latitude"),
                                                (item.get("location") or {}).get("longitude"), kommuner)
            hosts = vaerter(item, foreninger) or [kom_forening or "?"]
            old = events.get(str(item["id"]))
            if old:  # behold den oprindelige hovedarrangør, tilføj nye medarrangører
                hosts = list(dict.fromkeys(old.get("foreninger", [old["forening"]]) + hosts))
            rec = record(item, hosts, kommune, seen)
            if old:
                rec["foerst_set"] = min(old["foerst_set"], seen)
                if old["sidst_set"] > seen:  # ældre kørsel end det, vi allerede har
                    continue
            events[rec["id"]] = rec
            set_ids.add(rec["id"])
        # Kommende begivenheder fra dækkede foreninger, som ikke længere vises, er slettet/skjult.
        for e in events.values():
            if (e["forening"] in daekket and e["id"] not in set_ids and e["start"]
                    and e["start"] > seen and e["sidst_set"] < seen):
                e["forsvundet"] = True
        meta["koersler"].append({"id": run["id"], "tid": seen, "foreninger": sorted(daekket),
                                 "begivenheder": len(set_ids)})
        print(f"{run['id']} ({seen}): {len(set_ids)} begivenheder fra {len(daekket)} foreninger")

    meta["behandlet"] = sorted(behandlet)
    meta["koersler"].sort(key=lambda k: k["tid"])
    if nye_runs or not META.exists():
        meta["opdateret"] = iso(datetime.now(timezone.utc))
    DATA.mkdir(exist_ok=True)
    EVENTS.write_text(json.dumps(sorted(events.values(), key=lambda e: e["start"] or ""),
                                 ensure_ascii=False, indent=1), encoding="utf-8")
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    ukendte = sum(1 for e in events.values() if e["forening"] == "?")
    print(f"I alt {len(events)} begivenheder" + (f" ({ukendte} uden forening)" if ukendte else ""))


if __name__ == "__main__":
    main()
