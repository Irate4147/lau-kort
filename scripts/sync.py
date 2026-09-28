#!/usr/bin/env python3
"""Saml LAU-begivenheder fra de løbende Apify-kørsler til data/events.json.

Scraperen køres ugentligt af Google Apps Scriptet i regnearket "LAU – begivenheder".
Dette script scraper ikke selv: det læser resultaterne af de kørsler, der allerede
er lavet (kun kørsler på lokalforeningernes "upcoming_hosted_events"), og fletter dem
ind i en voksende database, så afholdte begivenheder bevares til analyserne.

    APIFY_TOKEN=... python3 scripts/sync.py

Historik (engangskørsel): scraper foreningernes "past_hosted_events" og tilføjer de
afholdte begivenheder siden FRA (ÅÅÅÅ-MM-DD eller antal dage; standard 1. januar i år):

    APIFY_TOKEN=... python3 scripts/sync.py --historik [FRA]

Kører i GitHub Actions (.github/workflows/sync.yml og historik.yml); lokalt læses token
også fra ../.apify_token, hvis miljøvariablen mangler.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
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
HISTORIK_MAX_PR_SIDE = 20   # loft pr. side: siden viser nyeste først, og 20 dækker 2026 for de fleste
HISTORIK_SAMTIDIGE = 2


# ---------------------------------------------------------------- apify

def token():
    tok = os.environ.get("APIFY_TOKEN")
    local = ROOT.parent / ".apify_token"
    if not tok and local.exists():
        tok = local.read_text().strip()
    if not tok:
        sys.exit("Mangler APIFY_TOKEN")
    return tok


def api(path, body=None):
    headers = {"authorization": f"Bearer {token()}"}
    if body is not None:
        headers["content-type"] = "application/json"
        body = json.dumps(body).encode()
    req = urllib.request.Request(API + path, data=body, headers=headers)
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


def merge(item, events, foreninger, kommuner, seen, historisk=False):
    """Flet én scrapet begivenhed ind i events. Returnerer id, eller None hvis den blev sprunget over."""
    if not item.get("id"):
        return None
    loc = item.get("location") or {}
    kommune, kom_forening = kommune_for(loc.get("latitude"), loc.get("longitude"), kommuner)
    hosts = vaerter(item, foreninger) or [kom_forening or "?"]
    old = events.get(str(item["id"]))
    if old:  # behold den oprindelige hovedarrangør, tilføj nye medarrangører
        hosts = list(dict.fromkeys(old.get("foreninger", [old["forening"]]) + hosts))
    rec = record(item, hosts, kommune, seen)
    if old:
        rec["foerst_set"] = min(old["foerst_set"], seen)
        if old["sidst_set"] > seen:  # ældre kørsel end det, vi allerede har
            return None
        if old.get("historisk"):
            rec["historisk"] = True
    elif historisk:
        rec["historisk"] = True  # fundet bagudrettet: foerst_set siger intet om varsel/nyhed
    events[rec["id"]] = rec
    return rec["id"]


def load_state():
    events = {e["id"]: e for e in json.loads(EVENTS.read_text(encoding="utf-8"))} if EVENTS.exists() else {}
    meta = json.loads(META.read_text(encoding="utf-8")) if META.exists() else {"koersler": [], "behandlet": []}
    return events, meta


def save_state(events, meta):
    DATA.mkdir(exist_ok=True)
    EVENTS.write_text(json.dumps(sorted(events.values(), key=lambda e: e["start"] or ""),
                                 ensure_ascii=False, indent=1), encoding="utf-8")
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    ukendte = sum(1 for e in events.values() if e["forening"] == "?")
    print(f"I alt {len(events)} begivenheder" + (f" ({ukendte} uden forening)" if ukendte else ""))


def main():
    foreninger = load_foreninger()
    kommuner = load_kommuner()
    events, meta = load_state()
    behandlet = set(meta["behandlet"])

    runs = (api(f"/acts/{ACTOR}/runs?desc=1&limit=100&status=SUCCEEDED") or {}).get("data", {}).get("items", [])
    nye_runs = sorted((r for r in runs if r["id"] not in behandlet), key=lambda r: r["startedAt"])

    for run in nye_runs:
        behandlet.add(run["id"])
        inp = api(f"/key-value-stores/{run['defaultKeyValueStoreId']}/records/INPUT") or {}
        urls = [u if isinstance(u, str) else (u or {}).get("url", "") for u in inp.get("startUrls") or []]
        if not any("upcoming_hosted_events" in u for u in urls):
            continue  # kun de løbende kørsler på kommende begivenheder (historik hentes med --historik)
        items = api(f"/datasets/{run['defaultDatasetId']}/items?clean=true&format=json")
        if items is None:
            print(f"{run['id']}: datasættet er slettet (Apify gemmer det kun i en periode)", file=sys.stderr)
            continue
        seen = iso(parse(run["startedAt"]))
        daekket = {f for u in urls if (f := forening_for_url(u, foreninger))}
        set_ids = {i for item in items if (i := merge(item, events, foreninger, kommuner, seen))}
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
    save_state(events, meta)


# ---------------------------------------------------------------- historik

def past_url(fb):
    if "profile.php" in fb:
        return fb.split("&")[0] + "&sk=past_hosted_events"
    return fb.split("?")[0].rstrip("/") + "/past_hosted_events"


def log_tail(run_id, n=15):
    """De sidste linjer af en Apify-kørsels log, så fejl kan ses i GitHub Actions."""
    req = urllib.request.Request(f"{API}/actor-runs/{run_id}/log", headers={"authorization": f"Bearer {token()}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            lines = r.read().decode("utf-8", "replace").splitlines()
        return "\n".join("    " + l for l in lines[-n:])
    except urllib.error.URLError as e:
        return f"    (kunne ikke hente log: {e})"


STOP = []  # sat, når Apify afviser nye kørsler (fx fordi månedens forbrug er brugt op)


def run_actor(url):
    """Start én Apify-kørsel på en sides tidligere begivenheder og vent på den."""
    if STOP:
        return url, None, []
    try:
        run = api(f"/acts/{ACTOR}/runs", {"startUrls": [url], "maxEvents": HISTORIK_MAX_PR_SIDE})["data"]
        while run["status"] in ("READY", "RUNNING"):
            time.sleep(10)
            run = api(f"/actor-runs/{run['id']}")["data"]
        if run["status"] != "SUCCEEDED":
            print(f"{url}: {run['status']} – {run.get('statusMessage') or ''}\n{log_tail(run['id'])}", file=sys.stderr)
        items = api(f"/datasets/{run['defaultDatasetId']}/items?clean=true&format=json") or []
        return url, run, items
    except urllib.error.HTTPError as e:
        if e.code in (402, 403):
            STOP.append(e.code)
            print(f"{url}: Apify afviste kørslen ({e.code}) – sandsynligvis er månedens forbrug brugt op. "
                  "Stopper; kør workflowet igen senere for at hente resten.", file=sys.stderr)
        else:
            print(f"{url}: fejlede ({e})", file=sys.stderr)
        return url, None, []
    except (urllib.error.URLError, KeyError, TypeError) as e:
        print(f"{url}: fejlede ({e})", file=sys.stderr)
        return url, None, []


def historik_fra(arg):
    """Startdato for historikken: 'ÅÅÅÅ-MM-DD', et antal dage bagud eller (tom) 1. januar i år."""
    now = datetime.now(timezone.utc)
    if not arg:
        return datetime(now.year, 1, 1, tzinfo=timezone.utc)
    if re.fullmatch(r"\d+", arg):
        return now - timedelta(days=int(arg))
    return datetime.fromisoformat(arg).replace(tzinfo=timezone.utc)


def historik(fra):
    foreninger = load_foreninger()
    kommuner = load_kommuner()
    events, meta = load_state()
    # Foreninger, hvis historik allerede er hentet, springes over, så en afbrudt kørsel kan genoptages billigt.
    hentet = {k["forening"] for k in (meta.get("historik") or {}).get("koersler", []) if k.get("status") == "SUCCEEDED"}
    mangler = [f for f in json.loads(FORENINGER.read_text(encoding="utf-8")) if f.get("facebook") and f["navn"] not in hentet]
    if hentet:
        print(f"Springer over (allerede hentet): {', '.join(sorted(hentet))}")
    print(f"Henter: {', '.join(f['navn'] for f in mangler) or '(ingen)'}")
    urls = [past_url(f["facebook"]) for f in mangler]

    with ThreadPoolExecutor(HISTORIK_SAMTIDIGE) as pool:
        results = list(pool.map(run_actor, urls))

    koersler = []
    for url, run, items in sorted((r for r in results if r[1]), key=lambda r: r[1]["startedAt"]):
        seen = iso(parse(run["startedAt"]))
        tilfoejet = 0
        for item in items:
            start = parse(item.get("utcStartDate"))
            if start and start >= fra and merge(item, events, foreninger, kommuner, seen, historisk=True):
                tilfoejet += 1
        forening = forening_for_url(url, foreninger)
        meta["behandlet"] = sorted(set(meta["behandlet"]) | {run["id"]})
        koersler.append({"id": run["id"], "tid": seen, "forening": forening, "status": run["status"],
                         "hentet": len(items), "begivenheder": tilfoejet})
        print(f"{forening}: {run['status']}, {len(items)} hentet, {tilfoejet} siden {fra.date()}")

    # "fra" sættes kun, når mindst én kørsel lykkedes – ellers ville siden påstå at have data, den ikke har.
    gammel = meta.get("historik") or {}
    alle = gammel.get("koersler", []) + koersler
    ok = any(k["status"] == "SUCCEEDED" for k in koersler)
    meta["historik"] = {"koersler": alle}
    gammel_ok = any(k.get("status") == "SUCCEEDED" for k in gammel.get("koersler", []))
    if fra_ := [f for f in (gammel.get("fra") if gammel_ok else None, iso(fra) if ok else None) if f]:
        meta["historik"]["fra"] = min(fra_)
    if not ok:
        print("Ingen kørsler lykkedes – se fejlene ovenfor.", file=sys.stderr)
    meta["opdateret"] = iso(datetime.now(timezone.utc))
    save_state(events, meta)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--historik":
        historik(historik_fra(sys.argv[2] if len(sys.argv) > 2 else ""))
    else:
        main()
