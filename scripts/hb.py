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

Reglerne (rettelser, dækning, kvartalsstatus og prognose) er kernens – hbKvartal() og hbPrognose() i kerne/regler.js,
de samme som siden bruger – og køres med Node via scripts/kerne.py. Et arrangement er afholdt, når det er slut, og
planlagt, indtil det er slut. Filen bruger de oprindelige navne alle_plus_naeste og ikke_godkendt for kernens
plus_naeste og ikke. Et andet ÅR end det indeværende regnes som afsluttet.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import admin
import kerne

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TZ = ZoneInfo("Europe/Copenhagen")
# Prognosens navne i filen (kernens navne: plus_naeste og ikke, se HB_STATUS i kerne/lau.js).
FIL_NAVN = {"plus_naeste": "alle_plus_naeste", "ikke": "ikke_godkendt"}


def dansk_dag(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(TZ).date()


def vurder(aar, nu=None):
    nu = nu or datetime.now(timezone.utc)
    idag = nu.astimezone(TZ).date()
    foreninger = json.loads((DATA / "foreninger.json").read_text(encoding="utf-8"))
    events = json.loads((DATA / "events.json").read_text(encoding="utf-8"))
    meta = json.loads((DATA / "meta.json").read_text(encoding="utf-8"))
    hb = admin.laes("hb", {})
    hb_nu = hb.get(f"hb{aar}", {}).get("foreninger", {})
    # Kernen anvender rettelserne, beregner dækningen (ud fra de hentede data, før rettelser) og vurderer kvartalerne.
    svar = kerne.beregn(foreninger, events, meta, admin.rettelser(), nu, [{"tid": nu, "hbAar": aar}])
    ved = svar["tidspunkter"][0]["foreninger"]
    ev = {e["id"]: e for e in svar["arrangementer"]}

    def liste(ids):
        return [{"dato": dansk_dag(ev[i]["start"]).isoformat(), "navn": ev[i]["navn"]} for i in ids]

    resultat = {}
    for f in foreninger:
        if f.get("national"):
            continue
        navn = f["navn"]
        vurdering = ved[navn]["hb"]
        kv = {}
        grunde = []
        for q in range(1, 5):
            x = vurdering["kvartaler"][f"Q{q}"]
            status = x["status"]
            kv[f"Q{q}"] = {"status": status, "afholdt": liste(x["afholdt"]), "planlagt": liste(x["planlagt"])}
            if status == "nej":
                grunde.append(f"Intet arrangement i {q}. kvartal {aar}")
            elif status == "mangler":
                grunde.append(f"{q}. kvartal {aar}: intet arrangement afholdt eller planlagt endnu")
            elif status == "ukendt":
                grunde.append(f"{q}. kvartal {aar}: ingen data" + ("" if f.get("facebook") else " (ingen Facebook-side)"))

        nu_status = hb_nu.get(navn, {})
        resultat[navn] = {
            "prognose": FIL_NAVN.get(vurdering["status"], vurdering["status"]),
            "grunde": grunde,
            "kvartaler": kv,
            f"hb{aar}": {k: nu_status[k] for k in ("status", "mangler", "note") if k in nu_status},
        }

    return {
        "aar": aar,
        "hb_aar": aar + 1,
        "beregnet": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "idag": idag.isoformat(),
        "data_fra": {f["navn"]: svar["daekketFra"][f["navn"]] for f in foreninger if not f.get("national")},
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

    tegn = {"ja": "✓", "nej": "✗", "ukendt": "?", "planlagt": "…", "mangler": "!"}
    print(f"HB {aar + 1} – kvartalskrav i {aar} (i dag {res['idag']})")
    print(f"{'Forening':16} {'HB ' + str(aar):14} {'Data fra':11} Q1 Q2 Q3 Q4  Prognose")
    for navn, r in sorted(res["foreninger"].items(), key=lambda x: (x[1]["prognose"], x[0])):
        kv = "  ".join(tegn[r["kvartaler"][f"Q{q}"]["status"]] for q in range(1, 5))
        print(f"{navn:16} {r[f'hb{aar}'].get('status', '–'):14} {res['data_fra'][navn] or '–':11} {kv}   {r['prognose']}")
    print(f"Skrevet til {ud.relative_to(ROOT)} (krypteret)")


if __name__ == "__main__":
    main()
