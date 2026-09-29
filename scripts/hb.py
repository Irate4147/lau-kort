#!/usr/bin/env python3
"""Forudsig HB-godkendelse for næste år ud fra kvartalskravet.

HB-kravet (Organisationshåndbogen 8.2) er mindst ét medlemsarrangement pr. kvartal i det
foregående kalenderår. Scriptet tjekker kun, om der er afholdt et arrangement i hvert kvartal
(ikke om det er fagligt), sammenholder data/events.json med årets HB-status og skriver
prognosen. HB-data er fortrolige og krypteres (se scripts/admin.py): årets status læses fra
data/admin/hb.krypt.json, og prognosen skrives til data/admin/hb_<år+1>.krypt.json – derfor kræver
scriptet miljøvariablen ADMIN_KODE. Rettelser (fx bekræftet afholdt eller tilføjet manuelt) går forud
for Facebook-data:

    python3 scripts/hb.py [ÅR]      # standard: indeværende år

Et kvartal får en af disse statusser:
  ja        mindst ét afholdt arrangement
  nej       intet afholdt arrangement, og hele kvartalet er dækket af data
  ukendt    intet fundet, men data dækker ikke hele kvartalet (historik mangler)
  planlagt  kvartalet er ikke slut; intet afholdt endnu, men der er planlagt et arrangement
  mangler   kvartalet er ikke slut; intet afholdt eller planlagt endnu (data dækker kvartalet)

Prognosen er en af disse kategorier (bedst først):
  alle_plus_naeste  aktivitet i alle kvartaler indtil nu, inkl. det indeværende, + planlagt i næste kvartal
  alle              aktivitet i alle kvartaler indtil nu, inkl. det indeværende
  planlagt_nu       aktivitet i alle tidligere kvartaler; det indeværende har et planlagt arrangement
  mangler_nu        aktivitet i alle tidligere kvartaler; intet planlagt i det indeværende endnu
  ikke_godkendt     et afsluttet kvartal uden aktivitet – kan ikke godkendes
  ukendt            historik mangler for et kvartal
"""
import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import admin

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TZ = ZoneInfo("Europe/Copenhagen")


def dansk_dag(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(TZ).date()


def kvartaler(aar):
    return [(q + 1, date(aar, 3 * q + 1, 1), date(aar + (q == 3), (3 * q + 3) % 12 + 1, 1)) for q in range(4)]


def anvend_rettelser(events, rettelser):
    """Rettelser går forud for Facebook-data. Samme regler som anvendRettelser() i app.js."""
    events = [dict(e) for e in events]
    by_id = {e["id"]: e for e in events}
    for id_, r in (rettelser or {}).items():
        e = by_id.get(id_)
        if e is None:
            if not (r.get("manuel") and r.get("start") and r.get("forening")):
                continue
            e = {"id": id_, "manuel": True, "navn": "", "aflyst": False, "forsvundet": False}
            events.append(e)
        for k in ("navn", "start", "slut", "sted"):
            if r.get(k) not in (None, ""):
                e[k] = r[k]
        if r.get("forening") and r["forening"] != e.get("forening"):
            e["forening"] = r["forening"]
            e["foreninger"] = [r["forening"]]
        status = r.get("status")
        if status == "afholdt":
            e.update(aflyst=False, forsvundet=False, bekraeftet=True)
        elif status == "ikke_afholdt":
            e["aflyst"] = True
        elif status == "skjult":
            e["skjult"] = True
    return [e for e in events if not e.get("skjult")]


HISTORIK_LOFT = 20  # højst så mange begivenheder pr. side i historikken (HISTORIK_MAX_PR_SIDE i sync.py)


def daekning(meta, events, foreninger):
    """Første dag med fuld data pr. forening: de ugentlige kørsler for alle, og historikken, hvor den er hentet
    for alle foreningens sider (facebook + facebook_ekstra).

    Ramte historik-kørslen loftet, og lå alle hentede begivenheder i perioden, kan der mangle ældre
    begivenheder; så dækker historikken kun fra den ældste hentede. Samme regel som daekketFra() i app.js.
    """
    ugentlig = min((dansk_dag(k["tid"]) for k in meta.get("koersler", [])), default=None)
    hist = meta.get("historik") or {}
    hist_fra = dansk_dag(hist["fra"]) if hist.get("fra") else ugentlig
    # Pr. side: seneste vellykkede kørsel vinder. Ældre kørsler uden "side" gjaldt hovedsiden.
    pr_side = {}
    for k in hist.get("koersler", []):
        if k.get("status") != "SUCCEEDED":
            continue
        navn = k["forening"]
        if k.get("aeldste"):
            aeldste = dansk_dag(k["aeldste"])
        else:
            aeldste = min((dansk_dag(e["start"]) for e in events
                           if e.get("historisk") and navn in (e.get("foreninger") or [e["forening"]])), default=None)
        loft = k.get("hentet", 0) >= k.get("max", HISTORIK_LOFT) and k.get("begivenheder", 0) >= k.get("hentet", 0)
        pr_side[(navn, k.get("side"))] = aeldste if loft and aeldste else hist_fra
    # En forening er kun dækket, når alle dens sider er hentet – og så fra den seneste af siderne.
    fra_for = {}
    for f in foreninger:
        s = [pr_side.get((f["navn"], u)) or (pr_side.get((f["navn"], None)) if i == 0 else None)
             for i, u in enumerate(u for u in [f.get("facebook")] + [e["url"] if isinstance(e, dict) else e
                                                                    for e in f.get("facebook_ekstra") or []] if u)]
        if s and all(s):
            fra_for[f["navn"]] = max(s)
    for f in foreninger:  # historik tjekket manuelt fra historik_fra (fx ingen arrangementer)
        if f.get("historik_fra"):
            fra_for[f["navn"]] = date.fromisoformat(f["historik_fra"])
    return lambda navn: min(d for d in (ugentlig, fra_for.get(navn)) if d) if ugentlig else None


def naeste_kvartal(idag):
    """(start, slut) for kvartalet efter det, idag ligger i (evt. 1. kvartal næste år)."""
    q = (idag.month - 1) // 3
    start = date(idag.year + (q == 3), (3 * q + 3) % 12 + 1, 1)
    return start, date(start.year + (start.month == 10), (start.month + 2) % 12 + 1, 1)


def kategori(kv, ev, idag, aar):
    """Samme kategorier som hbPrognose() i app.js (se modulets docstring)."""
    nu = (idag.month - 1) // 3 + 1 if idag.year == aar else 5  # 5: året er slut
    foer = [kv[f"Q{q}"]["status"] for q in range(1, nu)]
    status_nu = kv[f"Q{nu}"]["status"] if nu <= 4 else "ja"
    if "nej" in foer:
        return "ikke_godkendt"
    if "ukendt" in foer or status_nu == "ukendt":
        return "ukendt"
    if status_nu == "planlagt":
        return "planlagt_nu"
    if status_nu != "ja":
        return "mangler_nu"
    start, slut = naeste_kvartal(idag)
    naeste = any(start <= dansk_dag(e["start"]) < slut for e in ev if dansk_dag(e["start"]) >= idag)
    return "alle_plus_naeste" if naeste else "alle"


def vurder(aar, idag=None):
    idag = idag or datetime.now(TZ).date()
    foreninger = json.loads((DATA / "foreninger.json").read_text(encoding="utf-8"))
    events = json.loads((DATA / "events.json").read_text(encoding="utf-8"))
    meta = json.loads((DATA / "meta.json").read_text(encoding="utf-8"))
    hb = admin.laes("hb", {})
    hb_nu = hb.get(f"hb{aar}", {}).get("foreninger", {})
    fra_for = daekning(meta, events, foreninger)  # dækning ud fra de hentede data, før rettelser
    events = anvend_rettelser(events, admin.rettelser())

    resultat = {}
    for f in foreninger:
        if f.get("national"):
            continue
        navn = f["navn"]
        fra = fra_for(navn)
        ev = [e for e in events
              if navn in (e.get("foreninger") or [e["forening"]]) and not e.get("aflyst") and not e.get("forsvundet")]
        kv = {}
        grunde = []
        for q, start, slut in kvartaler(aar):
            i_kv = [e for e in ev if start <= dansk_dag(e["start"]) < slut]
            afholdt = [e for e in i_kv if dansk_dag(e["start"]) < idag]
            planlagt = [e for e in i_kv if dansk_dag(e["start"]) >= idag]
            if afholdt:
                status = "ja"
            elif planlagt:
                status = "planlagt"
            elif not (fra and fra <= start and f.get("facebook")):
                status = "ukendt"
            elif idag < slut:
                status = "mangler"
            else:
                status = "nej"
            kv[f"Q{q}"] = {
                "status": status,
                "afholdt": [{"dato": dansk_dag(e["start"]).isoformat(), "navn": e["navn"]} for e in afholdt],
                "planlagt": [{"dato": dansk_dag(e["start"]).isoformat(), "navn": e["navn"]} for e in planlagt],
            }
            if status == "nej":
                grunde.append(f"Intet arrangement i {q}. kvartal {aar}")
            elif status == "mangler":
                grunde.append(f"{q}. kvartal {aar}: intet arrangement afholdt eller planlagt endnu")
            elif status == "ukendt":
                grunde.append(f"{q}. kvartal {aar}: ingen data" + ("" if f.get("facebook") else " (ingen Facebook-side)"))

        prognose = kategori(kv, ev, idag, aar)

        nu = hb_nu.get(navn, {})
        resultat[navn] = {
            "prognose": prognose,
            "grunde": grunde,
            "kvartaler": kv,
            f"hb{aar}": {k: nu[k] for k in ("status", "mangler", "note") if k in nu},
        }

    return {
        "aar": aar,
        "hb_aar": aar + 1,
        "beregnet": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "idag": idag.isoformat(),
        "data_fra": {f["navn"]: (fra_for(f["navn"]).isoformat() if fra_for(f["navn"]) else None)
                     for f in foreninger if not f.get("national")},
        "note": "Kun kvartalskravet vurderes her: om der er afholdt et arrangement i hvert kvartal. "
                "Medlemstal, regnskab, bank og generalforsamling for året vurderes først ved ansøgningen.",
        "foreninger": resultat,
    }


def main():
    aar = int(sys.argv[1]) if len(sys.argv) > 1 else datetime.now(TZ).year
    if not admin.har_noegle():
        print("HB-prognosen er fortrolig og beregnes kun med ADMIN_KODE (se README: Adminlogin) – springes over.")
        return
    res = vurder(aar)
    ud = admin.sti(f"hb_{aar + 1}")
    # "beregnet" ændres hver gang; skriv kun, når selve vurderingen er ændret, så der ikke kommer tomme commits.
    gammel = admin.laes(f"hb_{aar + 1}", {})
    if {**gammel, "beregnet": None} != {**res, "beregnet": None}:
        admin.skriv(f"hb_{aar + 1}", res)

    if os.environ.get("GITHUB_ACTIONS"):  # Actions-logs er offentlige i et offentligt repo – ingen fortrolige tal dér
        print(f"HB {aar + 1} beregnet – skrevet til {ud.relative_to(ROOT)} (krypteret)")
        return
    tegn = {"ja": "✓", "nej": "✗", "ukendt": "?", "planlagt": "…", "mangler": "!"}
    print(f"HB {aar + 1} – kvartalskrav i {aar} (i dag {res['idag']})")
    print(f"{'Forening':16} {'HB ' + str(aar):14} {'Data fra':11} Q1 Q2 Q3 Q4  Prognose")
    for navn, r in sorted(res["foreninger"].items(), key=lambda x: (x[1]["prognose"], x[0])):
        kv = "  ".join(tegn[r["kvartaler"][f"Q{q}"]["status"]] for q in range(1, 5))
        print(f"{navn:16} {r[f'hb{aar}'].get('status', '–'):14} {res['data_fra'][navn] or '–':11} {kv}   {r['prognose']}")
    print(f"Skrevet til {ud.relative_to(ROOT)} (krypteret)")


if __name__ == "__main__":
    main()
