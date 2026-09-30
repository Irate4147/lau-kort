#!/usr/bin/env python3
"""Månedsrapport over ændringer i foreningerne (kun admins).

Ved den første kørsel i en måned tages et snapshot af tilstanden ved månedens start: momentum-niveau,
HB-prognose og antal afholdte/planlagte arrangementer pr. forening. Rapporten for en måned sammenligner månedens
snapshot med den næste måneds og lister, hvad der skete i måneden: afholdte, aflyste, nye og fra Facebook
forsvundne arrangementer, registreret fremmøde og ændringer i momentum og HB-prognose – plus højdepunkterne
(faldet i momentum, uden afholdt aktivitet, nye aflysninger og forbedringer).

Alt er fortroligt og ligger krypteret i data/admin/rapporter.krypt.json (se scripts/admin.py), derfor kræver
scriptet ADMIN_KODE:
    {"snapshots": {"ÅÅÅÅ-MM": {...}}, "rapporter": {"ÅÅÅÅ-MM": {...}}}

    python3 scripts/rapport.py            # snapshot af denne måned + rapport for sidste måned
    python3 scripts/rapport.py ÅÅÅÅ-MM    # genberegn rapporten for en bestemt måned (indeværende: foreløbig)
    python3 scripts/rapport.py alle       # genberegn alle måneder, data dækker

Hver rapport har også en fremadskuende del ("fremad") set fra månedens slutning (den 1. i måneden efter; for
indeværende måned: nu): kommende arrangementer de næste 35 dage pr. forening, lokalforeninger uden noget planlagt og
risici sorteret efter alvor. Den rekonstrueres som snapshots, så en gammel rapport viser, hvad man vidste dengang.

Hele rapporten – snapshots, Bagud, Fremad, hvornår et gemt snapshot eller en gemt rapport erstattes, og udskriften –
laves af kernen (opdater() i kerne/rapport.js, de samme regler og tekster som "Denne måned indtil nu" på siden). Den
køres med Node via scripts/kerne.py. Her er kun fil-I/O, kryptering og kommandolinjen. Mangler et snapshot (fx fordi den
første kørsel i måneden ikke var den 1.), rekonstrueres det ud fra data pr. den 1. i måneden og markeres
"rekonstrueret": true. Kun begivenheder, der var set på Facebook den dag (foerst_set), tæller da som planlagte; senere
aflysninger fra Facebook og forsvundne begivenheder regnes som ikke sket endnu (tilstandVed() i kernen).
"""
import json
import re
import sys
from datetime import datetime, timezone

import admin
import hb
import kerne


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    if arg and arg != "alle" and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", arg):
        sys.exit("Brug: scripts/rapport.py [ÅÅÅÅ-MM | alle]")
    if not admin.har_noegle():
        print("Månedsrapporten er fortrolig og laves kun med ADMIN_KODE (se README: Adminlogin) – springes over.")
        return
    laes = lambda navn: json.loads((hb.DATA / navn).read_text(encoding="utf-8"))  # noqa: E731
    gemt = admin.laes("rapporter", {}) or {}
    svar = kerne.beregn(laes("foreninger.json"), laes("events.json"), laes("meta.json"), admin.rettelser(),
                        datetime.now(timezone.utc), rapport={"valg": arg, "gemt": gemt})["rapport"]
    if svar.get("fejl"):
        sys.exit(svar["fejl"])

    # Kernen giver kun de nye og ændrede snapshots og rapporter. "normalt" er et decimaltal (1.0, ikke 1), som snapshots
    # altid har været gemt – JSON fra Node skelner ikke.
    for s in svar["snapshots"].values():
        for f in s["foreninger"].values():
            if f.get("normalt") is not None:
                f["normalt"] = float(f["normalt"])
    snapshots = {**gemt.get("snapshots", {}), **svar["snapshots"]}
    rapporter = {**gemt.get("rapporter", {}), **svar["rapporter"]}
    ud = {"snapshots": dict(sorted(snapshots.items())), "rapporter": dict(sorted(rapporter.items()))}
    skrevet = admin.skriv("rapporter", ud)  # skriver kun, når indholdet er ændret (ingen tomme commits)
    print(svar["udskrift"], end="")
    if arg == "alle":
        print(f"\nGenberegnede {len(svar['maaneder'])} måneder: {', '.join(svar['maaneder'])}")
    print(f"\n{'Skrevet til' if skrevet else 'Uændret:'} {admin.sti('rapporter').relative_to(hb.ROOT)} (krypteret)")


if __name__ == "__main__":
    main()
