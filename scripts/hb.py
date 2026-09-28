#!/usr/bin/env python3
"""Forudsig HB-godkendelse for næste år ud fra kvartalskravet.

HB-kravet (Organisationshåndbogen 8.2) er mindst ét medlemsarrangement pr. kvartal i det
foregående kalenderår. Scriptet tjekker kun, om der er afholdt et arrangement i hvert kvartal
(ikke om det er fagligt), sammenholder data/events.json med data/hb.json (årets HB-status)
og skriver data/hb_<år+1>.json:

    python3 scripts/hb.py [ÅR]      # standard: indeværende år

Et kvartal får en af disse statusser:
  ja        mindst ét afholdt arrangement
  nej       intet afholdt arrangement, og hele kvartalet er dækket af data
  ukendt    intet fundet, men data dækker ikke hele kvartalet (historik mangler)
  planlagt  kvartalet er ikke slut; intet afholdt endnu, men der er planlagt et arrangement
  mangler   kvartalet er ikke slut; intet afholdt eller planlagt endnu (data dækker kvartalet)

Prognosen er "ikke_godkendt" ved mindst ét "nej", "ukendt" ved manglende data, "i_fare" ved
"mangler" og ellers "på_vej".
"""
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TZ = ZoneInfo("Europe/Copenhagen")


def dansk_dag(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(TZ).date()


def kvartaler(aar):
    return [(q + 1, date(aar, 3 * q + 1, 1), date(aar + (q == 3), (3 * q + 3) % 12 + 1, 1)) for q in range(4)]


def data_fra(meta):
    """Første dag, hvor foreningernes arrangementer er kendt (ugentlige kørsler eller historik)."""
    starter = [dansk_dag(k["tid"]) for k in meta.get("koersler", [])]
    hist = meta.get("historik") or {}
    if hist.get("fra") and any(k.get("status") == "SUCCEEDED" for k in hist.get("koersler", [])):
        starter.append(dansk_dag(hist["fra"]))
    return min(starter) if starter else None


def vurder(aar, idag=None):
    idag = idag or datetime.now(TZ).date()
    foreninger = json.loads((DATA / "foreninger.json").read_text(encoding="utf-8"))
    events = json.loads((DATA / "events.json").read_text(encoding="utf-8"))
    meta = json.loads((DATA / "meta.json").read_text(encoding="utf-8"))
    hb = json.loads((DATA / "hb.json").read_text(encoding="utf-8"))
    hb_nu = hb.get(f"hb{aar}", {}).get("foreninger", {})
    fra = data_fra(meta)

    resultat = {}
    for f in foreninger:
        if f.get("national"):
            continue
        navn = f["navn"]
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

        statusser = [k["status"] for k in kv.values()]
        if "nej" in statusser:
            prognose = "ikke_godkendt"
        elif "ukendt" in statusser:
            prognose = "ukendt"
        elif "mangler" in statusser:
            prognose = "i_fare"
        else:
            prognose = "på_vej"

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
        "data_fra": fra.isoformat() if fra else None,
        "note": "Kun kvartalskravet vurderes her: om der er afholdt et arrangement i hvert kvartal. "
                "Medlemstal, regnskab, bank og generalforsamling for året vurderes først ved ansøgningen.",
        "foreninger": resultat,
    }


def main():
    aar = int(sys.argv[1]) if len(sys.argv) > 1 else datetime.now(TZ).year
    res = vurder(aar)
    ud = DATA / f"hb_{aar + 1}.json"
    ud.write_text(json.dumps(res, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    tegn = {"ja": "✓", "nej": "✗", "ukendt": "?", "planlagt": "…", "mangler": "!"}
    print(f"HB {aar + 1} – kvartalskrav i {aar} (data fra {res['data_fra']}, i dag {res['idag']})")
    print(f"{'Forening':16} {'HB ' + str(aar):14} Q1 Q2 Q3 Q4  Prognose")
    for navn, r in sorted(res["foreninger"].items(), key=lambda x: (x[1]["prognose"], x[0])):
        kv = "  ".join(tegn[r["kvartaler"][f"Q{q}"]["status"]] for q in range(1, 5))
        print(f"{navn:16} {r[f'hb{aar}'].get('status', '–'):14} {kv}   {r['prognose']}")
    print(f"Skrevet til {ud.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
