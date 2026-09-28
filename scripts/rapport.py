#!/usr/bin/env python3
"""Månedsrapport over ændringer i foreningerne (kun admins).

Ved den første kørsel i en måned tages et snapshot af tilstanden ved månedens start: momentum-niveau, rytme,
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

Hver rapport har også en fremadskuende del ("fremad", se lav_fremad) set fra månedens slutning (den 1. i måneden
efter; for indeværende måned: nu): kommende arrangementer de næste FREMAD_DAGE dage pr. forening, lokalforeninger uden
noget planlagt og risici sorteret efter alvor – HB-kvartalet (samme regler som hbRisiko() i udvidelser/hb-risiko.js),
momentum "Brug for hjælp"/"Mister fart", kvartaler, der kun hænger på planlagte arrangementer, og årsskiftet. Den
rekonstrueres som snapshots, så en gammel rapport viser, hvad man vidste dengang.

Momentum og HB-prognose beregnes med samme regler og konstanter som rytme(), momentum() og hbPrognose() i app.js.
Mangler et snapshot (fx fordi den første kørsel i måneden ikke var den 1.), rekonstrueres det ud fra data pr. den
1. i måneden og markeres "rekonstrueret": true. Kun begivenheder, der var set på Facebook den dag (foerst_set), tæller
da som planlagte; senere aflysninger fra Facebook og forsvundne begivenheder regnes som ikke sket endnu.
"""
import json
import math
import re
import sys
from datetime import date, datetime, time, timedelta, timezone

import admin
import hb

TZ = hb.TZ
DAG = timedelta(days=1)
# Samme grænser som app.js (se "Momentum" i README).
MOM_BAGUD, MOM_FREMAD, MOM_RYTME_MIN, MOM_RYTME_MAX = 60, 60, 31, 61
MOM_ORDEN = {"hjaelp": 0, "faldende": 1, "fremad": 2, "ukendt": 3, "stabil": 4, "godt": 5, "ingenfb": 6}
MOM_IKON = {"godt": "↗", "stabil": "→", "fremad": "⤴", "faldende": "↘", "hjaelp": "⚠", "ukendt": "?", "ingenfb": "–"}
# HB-kategorierne med samme nøgler som HB_STATUS i app.js, bedst først ('ukendt' sammenlignes ikke).
HB_ORDEN = ["plus_naeste", "alle", "planlagt_nu", "mangler_nu", "ikke"]
# HB-risiko: samme grænser som GRAENSE i udvidelser/hb-risiko.js (se "Analyser og advarsler" i README).
HB_GRAENSE = {"kritisk_dage": 14, "advarsel_min_dage": 45, "planlagt_dage": 21}
# Den fremadskuende del ser så mange dage frem fra rapportens tidspunkt (5 uger ≈ den næste måned).
FREMAD_DAGE = 35
RISIKO_ORDEN = {"kritisk": 0, "advarsel": 1, "opmaerksom": 2}
RISIKO_TYPE = ["aarsskifte", "hb", "hb_planlagt", "hjaelp", "faldende"]  # inden for samme niveau
MAANEDER = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober",
            "november", "december"]


# ------------------------------------------------------------------ tid

def tid(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(timezone.utc) if iso else None


def iso(t):
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def dansk(t):
    return t.astimezone(TZ).date()


def dage_mellem(a, b):
    """Som dageMellem() i app.js: hele døgn (à 24 timer) fra a til b."""
    return math.floor((b - a) / DAG)


def midnat_utc(d):
    """Som new Date('ÅÅÅÅ-MM-DD' + 'T00:00:00Z') i app.js."""
    return datetime.combine(d, time(), timezone.utc)


def maaned_af(t):
    return dansk(t).strftime("%Y-%m")


def maaned_start(m):
    """Den 1. i måneden kl. 0 dansk tid (som UTC)."""
    return datetime(int(m[:4]), int(m[5:]), 1, tzinfo=TZ).astimezone(timezone.utc)


def naeste_maaned(m):
    y, mm = int(m[:4]), int(m[5:])
    return f"{y + mm // 12}-{mm % 12 + 1:02d}"


def forrige_maaned(m):
    y, mm = int(m[:4]), int(m[5:])
    return f"{y - (mm == 1)}-{(mm - 2) % 12 + 1:02d}"


def maaned_navn(m):
    return f"{MAANEDER[int(m[5:]) - 1]} {m[:4]}"


def kort_dato(d):
    """Som fmtKort i udvidelser/maanedsrapport.js: "30. sep.", men "31. maj"."""
    navn = MAANEDER[d.month - 1]
    return f"{d.day}. {navn[:3]}{'.' if len(navn) > 3 else ''}"


def punktum(t):
    return t if t.endswith(".") else t + "."


def opremsning(a):
    return a[0] if len(a) < 2 else f"{', '.join(a[:-1])} og {a[-1]}"


def afkort(t, n):
    """Som trunc() i app.js."""
    return t[:n - 1].rstrip() + "…" if len(t) > n else t


def dage_tekst(d):
    return "sidste dag i dag" if d <= 0 else "1 dag tilbage" if d == 1 else f"{d} dage tilbage"


# ------------------------------------------------------------------ data

class Data:
    """Alle data til rapporten: foreninger, begivenheder (med rettelser og fremmøde) og dækning. Som load()/beregn()."""

    def __init__(self, nu):
        self.nu = nu
        self.foreninger = json.loads((hb.DATA / "foreninger.json").read_text(encoding="utf-8"))
        raa = json.loads((hb.DATA / "events.json").read_text(encoding="utf-8"))
        meta = json.loads((hb.DATA / "meta.json").read_text(encoding="utf-8"))
        rettelser = admin.rettelser()
        fra_for = hb.daekning(meta, raa, self.foreninger)  # ud fra de hentede data, før rettelser (som app.js)
        # Første dag med fuld data pr. forening (daekketFra() i app.js); uden kørsler: i dag.
        self.daekket = lambda navn: fra_for(navn) or dansk(nu)
        koersler = [tid(k["tid"]) for k in meta.get("koersler", [])]
        self.foerste_koersel = min(koersler) if koersler else nu
        self.events = []
        for e in hb.anvend_rettelser(raa, rettelser):  # skjulte er fjernet
            if not e.get("start"):
                continue
            r = rettelser.get(e["id"]) or {}
            e["foreninger"] = e.get("foreninger") or [e["forening"]]
            e["_start"] = tid(e["start"])
            e["_slut"] = tid(e.get("slut") or e["start"])
            # Manuelle arrangementer har ingen foerst_set: de kendes fra rettelsen (som anvendRettelser() i app.js).
            e["_foerst"] = tid(e.get("foerst_set") or r.get("rettet") or e["start"])
            e["_sidst"] = tid(e.get("sidst_set"))
            # Hvornår en rettelse markerede arrangementet som ikke afholdt (til rekonstruktion af snapshots).
            e["_aflyst_rettet"] = (tid(r.get("rettet")) or datetime.min.replace(tzinfo=timezone.utc)) \
                if r.get("status") == "ikke_afholdt" else None
            if r.get("deltagere") is not None:
                e["fremmoede"] = r["deltagere"]
            self.events.append(e)
        self.by_id = {e["id"]: e for e in self.events}

    def lokale(self):
        return [f for f in self.foreninger if not f.get("national")]


def tilstand_ved(e, idag):
    """Begivenheden, som den så ud på tidspunktet idag (til rekonstruerede snapshots) – None, hvis den var ukendt.

    Afholdte (slut før idag) er, som vi kender dem nu. Kommende tæller kun, hvis de var set på Facebook (foerst_set);
    aflysninger fra Facebook og forsvundne begivenheder regnes som sket efter idag, medmindre en rettelse eller
    sidst_set siger andet.
    """
    if e["_slut"] < idag:
        return e
    if e["_foerst"] > idag:
        return None
    aflyst = bool(e.get("aflyst")) and e["_aflyst_rettet"] is not None and e["_aflyst_rettet"] <= idag
    forsvundet = bool(e.get("forsvundet")) and e["_sidst"] is not None and e["_sidst"] < idag
    return {**e, "aflyst": aflyst, "forsvundet": forsvundet}


def forening_ved(f, events, idag):
    """Foreningens arrangementer på tidspunktet idag, delt op som i beregn() i app.js."""
    ev = sorted((e for e in events if f["navn"] in e["foreninger"]), key=lambda e: e["_start"])
    gyldige = [e for e in ev if not e.get("forsvundet") and not e.get("aflyst")]
    afholdt = [e for e in gyldige if e["_slut"] < idag]
    planlagt = [e for e in gyldige if e["_slut"] >= idag]
    return {**f, "events": ev, "gyldige": gyldige, "afholdt": afholdt, "planlagt": planlagt,
            "sidste": afholdt[-1]["_start"] if afholdt else None, "naeste": planlagt[0] if planlagt else None}


# ------------------------------------------------------------------ momentum og HB (port af app.js)

def rytme(f, idag, daekket):
    """Foreningens rytme: {dage, kilde, antal, periode, type}. Som rytme() i app.js."""
    def type_(d):
        return "stor" if d <= MOM_RYTME_MIN + 4 else "lille" if d >= MOM_RYTME_MAX - 6 else "mellem"
    if f.get("momentum_rytme"):
        return {"dage": f["momentum_rytme"], "kilde": "fast", "antal": None, "type": type_(f["momentum_rytme"])}
    fra = max(midnat_utc(daekket), idag - 365 * DAG)
    periode, antal = dage_mellem(fra, idag), sum(1 for e in f["afholdt"] if e["_start"] >= fra)
    if periode < 120:  # for lidt historik til at kende rytmen: den milde grænse
        return {"dage": MOM_RYTME_MAX, "kilde": "standard", "antal": antal, "periode": periode, "type": "ukendt"}
    # Math.round() i JavaScript runder halve op; uden afholdte er rytmen den milde grænse.
    dage = min(MOM_RYTME_MAX, max(MOM_RYTME_MIN, math.floor(periode / antal + 0.5) if antal else MOM_RYTME_MAX))
    return {"dage": dage, "kilde": "historik", "antal": antal, "periode": periode, "type": type_(dage)}


def momentum(f, idag, daekket):
    """Foreningens momentum på tidspunktet idag (datetime). Samme niveauer som momentum() i app.js."""
    fra, fra2, til = idag - MOM_BAGUD * DAG, idag - 2 * MOM_BAGUD * DAG, idag + MOM_FREMAD * DAG
    bagud = sum(1 for e in f["afholdt"] if e["_start"] >= fra)
    fremad = sum(1 for e in f["planlagt"] if e["_start"] <= til)
    forrige = sum(1 for e in f["afholdt"] if fra2 <= e["_start"] < fra) if daekket <= dansk(fra2) else None
    aflyst = sum(1 for e in f["events"] if e.get("aflyst") and fra <= e["_start"] < idag)
    sidste_dage = dage_mellem(f["sidste"], idag) if f["sidste"] else None
    naeste_dage = max(0, dage_mellem(idag, f["naeste"]["_start"])) if f["naeste"] else None
    r = rytme(f, idag, daekket)
    R = r["dage"]
    # Uden afholdte arrangementer er dagene siden dækningens start en nedre grænse.
    d = sidste_dage if sidste_dage is not None else dage_mellem(midnat_utc(daekket), idag)
    if not f.get("facebook") and not f["gyldige"]:
        niveau = "ingenfb"
    elif d <= R and sidste_dage is not None:
        niveau = "godt" if fremad else "stabil"
    elif fremad:
        niveau = "fremad"
    elif sidste_dage is None and d <= R:
        niveau = "ukendt"
    else:
        niveau = "faldende" if d <= 2 * R else "hjaelp"
    return {"niveau": niveau, "rytme": r, "sidste_dage": sidste_dage, "naeste_dage": naeste_dage,
            "bagud": bagud, "fremad": fremad, "forrige": forrige, "aflyst": aflyst}


def hb_kvartaler(f, idag, daekket):
    """HB-årets kvartaler [(navn, start, slut, status)] og indekset for det indeværende på tidspunktet idag.
    Status som hbKvartal() i app.js: 'ja', 'planlagt', 'mangler' (kvartalet er ikke slut), 'nej' eller 'ukendt'."""
    dag = dansk(idag)

    def status(start, slut):
        if any(start <= dansk(e["_start"]) < slut for e in f["afholdt"]):
            return "ja"
        if any(start <= dansk(e["_start"]) < slut for e in f["planlagt"]):
            return "planlagt"
        if not f.get("facebook") or start < daekket:
            return "ukendt"
        return "mangler" if dag < slut else "nej"

    kv = [(f"Q{q}", start, slut, status(start, slut)) for q, start, slut in hb.kvartaler(dag.year)]
    return kv, next(i for i, k in enumerate(kv) if k[1] <= dag < k[2])


def hb_prognose(f, idag, daekket):
    """HB-kategori (nøgle i HB_STATUS i app.js) for næste år på tidspunktet idag. Som hbKvartal()/hbPrognose()."""
    kv, nu_i = hb_kvartaler(f, idag, daekket)
    s = [k[3] for k in kv]
    foer, nu = s[:nu_i], s[nu_i]
    if "nej" in foer:
        return "ikke"
    if "ukendt" in foer or nu == "ukendt":
        return "ukendt"
    if nu == "planlagt":
        return "planlagt_nu"
    if nu != "ja":
        return "mangler_nu"
    start, slut = hb.naeste_kvartal(dansk(idag))
    return "plus_naeste" if any(start <= dansk(e["_start"]) < slut for e in f["planlagt"]) else "alle"


def hb_risiko(f, idag, daekket):
    """Risikoen for, at foreningen mister HB-godkendelsen på grund af det indeværende kvartal, på tidspunktet idag.
    Samme niveauer og grænser (HB_GRAENSE) som hbRisiko() i udvidelser/hb-risiko.js:
    {niveau: kritisk | advarsel | opmaerksom | ukendt | tabt | sikret, kvartal, dage, frist, status, rytme, planlagt,
    forklaring}, hvor dage er kalenderdage til kvartalets sidste dag (frist) og planlagt kvartalets planlagte."""
    dag = dansk(idag)
    kv, i = hb_kvartaler(f, idag, daekket)
    navn, start, slut, status = kv[i]
    sidste = slut - timedelta(days=1)
    dage, R, aar = (sidste - dag).days, rytme(f, idag, daekket)["dage"], dag.year + 1
    tabte = [k[0] for k in kv[:i] if k[3] == "nej"]
    planlagt = [e for e in f["planlagt"] if start <= dansk(e["_start"]) < slut]
    frist = f" {navn} er årets sidste kvartal: {kort_dato(sidste)} er også fristen for HB-godkendelsen." if i == 3 else ""
    if tabte:
        niveau, tekst = "tabt", f"{opremsning(tabte)} uden afholdt arrangement – kan ikke HB-godkendes i {aar}."
    elif status == "ja":
        niveau, tekst = "sikret", f"{navn} er i hus."
    elif status == "planlagt":
        e = planlagt[0]
        niveau = "advarsel" if dage <= HB_GRAENSE["planlagt_dage"] else "opmaerksom"
        hvad = f"\"{e.get('navn') or ''}\" ({kort_dato(dansk(e['_start']))})" if len(planlagt) == 1 \
            else f"{len(planlagt)} planlagte arrangementer (det første {kort_dato(dansk(e['_start']))})"
        tekst = f"Intet afholdt i {navn} endnu – kvartalet afhænger af {hvad}." + frist
    elif status == "mangler":
        niveau = "kritisk" if dage <= HB_GRAENSE["kritisk_dage"] or dage <= R / 2 \
            else "advarsel" if dage <= max(HB_GRAENSE["advarsel_min_dage"], R) else "opmaerksom"
        tekst = f"Intet afholdt eller planlagt i {navn} – {dage_tekst(dage)} (rytme: hver {R}. dag)." + frist
    else:
        niveau, tekst = "ukendt", f"Data dækker ikke hele {navn}."
    return {"niveau": niveau, "kvartal": navn, "dage": dage, "frist": sidste, "status": status, "rytme": R,
            "planlagt": planlagt, "forklaring": tekst}


# ------------------------------------------------------------------ snapshots

def tilstand(data, idag, rekonstruer):
    """Tilstanden for alle foreninger på tidspunktet idag."""
    events = [x for e in data.events if (x := tilstand_ved(e, idag) if rekonstruer else e)]
    ud = {}
    for f0 in data.foreninger:
        f = forening_ved(f0, events, idag)
        s = {"afholdt": len(f["afholdt"]), "planlagt": len(f["planlagt"]),
             "aflyste": sorted(e["id"] for e in f["events"] if e.get("aflyst"))}
        if not f.get("national"):
            dk = data.daekket(f["navn"])
            m = momentum(f, idag, dk)
            s.update(niveau=m["niveau"], rytme=m["rytme"]["dage"], sidste_dage=m["sidste_dage"],
                     naeste_dage=m["naeste_dage"], bagud=m["bagud"], fremad=m["fremad"], hb=hb_prognose(f, idag, dk))
        ud[f["navn"]] = s
    return {"tid": iso(idag), "hb_aar": dansk(idag).year + 1, "foreninger": ud}


def lav_snapshot(data, m):
    """Snapshot for måned m: den 1. om morgenen med data, som de er (første kørsel i måneden), ellers rekonstrueret
    pr. den 1. kl. 0."""
    live = m == maaned_af(data.nu) and dansk(data.nu).day == 1
    idag = data.nu if live else maaned_start(m)
    return {**tilstand(data, idag, rekonstruer=not live), "rekonstrueret": not live, "taget": iso(data.nu)}


def uden(d, *felter):
    return {k: v for k, v in d.items() if k not in felter}


# ------------------------------------------------------------------ rapport

def ev_kort(e, **ekstra):
    return {"id": e["id"], "dato": dansk(e["_start"]).isoformat(), "navn": e.get("navn") or "", **ekstra}


def lav_rapport(data, m, start, slut, foreloebig):
    """Rapporten for måned m ud fra snapshots ved månedens start og slut (for indeværende måned: nu).

    "fremad" er den fremadskuende del set fra rapportens slutning (lav_fremad): for en afsluttet måned den 1. i
    måneden efter, rekonstrueret som et snapshot; for indeværende måned fra nu. Resten er den bagudskuende del."""
    fra, til = dansk(maaned_start(m)), dansk(maaned_start(naeste_maaned(m)))
    i_md = lambda t: t is not None and fra <= dansk(t) < til  # noqa: E731
    # Når et nyt kvartal begynder, starter HB-prognosen forfra (fx "alle" → "mangler_nu"): så tæller kun et skift
    # til "ikke" (kan ikke godkendes) som et fald. Ved nytår gælder prognosen et nyt HB-år og sammenlignes ikke.
    kvartal = lambda s: (dansk(tid(s["tid"])).year, (dansk(tid(s["tid"])).month - 1) // 3)  # noqa: E731
    hb_samme, kv_samme = start["hb_aar"] == slut["hb_aar"], kvartal(start) == kvartal(slut)
    foreninger, alle = {}, {k: {} for k in ("afholdt", "aflyst", "nye", "forsvundet")}
    hoejde = {"faldet": [], "forbedret": [], "uden_aktivitet": [], "nye_aflysninger": []}
    uden_data = 0
    for f in data.foreninger:
        navn = f["navn"]
        mine = [e for e in data.events if navn in e["foreninger"]]
        mine.sort(key=lambda e: e["_start"])
        gyldig = lambda e: not e.get("aflyst") and not e.get("forsvundet")  # noqa: E731
        r = {
            "afholdt": [e for e in mine if i_md(e["_start"]) and gyldig(e) and e["_slut"] < data.nu],
            "aflyst": [e for e in mine if i_md(e["_start"]) and e.get("aflyst")],
            # Nye på Facebook i måneden – ikke hentet bagudrettet, manuelle eller fundet ved den første kørsel.
            "nye": [e for e in mine if not e.get("historisk") and not e.get("manuel") and i_md(e["_foerst"])
                    and e["_foerst"] - data.foerste_koersel > DAG],
            "forsvundet": [e for e in mine if e.get("forsvundet") and i_md(e["_sidst"])],
        }
        for k, lst in r.items():
            alle[k].update((e["id"], e) for e in lst)
        moedt = [e["fremmoede"] for e in r["afholdt"] if e.get("fremmoede") is not None]
        s0, s1 = start["foreninger"].get(navn, {}), slut["foreninger"].get(navn, {})
        dk = data.daekket(navn)
        daekket = bool(f.get("facebook")) and dk <= fra
        rf = {
            "afholdt": [ev_kort(e, **({"fremmoede": e["fremmoede"]} if e.get("fremmoede") is not None else {}))
                        for e in r["afholdt"]],
            "aflyst": [ev_kort(e) for e in r["aflyst"]],
            "nye": [ev_kort(e, oprettet=dansk(e["_foerst"]).isoformat()) for e in r["nye"]],
            "forsvundet": [ev_kort(e) for e in r["forsvundet"]],
            "fremmoede": sum(moedt) if moedt else None,
            "daekket": daekket,
        }
        # Nye aflysninger: aflyst ved slut, men ikke ved start (uanset arrangementets dato).
        for id_ in sorted(set(s1.get("aflyste", [])) - set(s0.get("aflyste", []))):
            if id_ in data.by_id:
                hoejde["nye_aflysninger"].append({"forening": navn, **ev_kort(data.by_id[id_])})
        if not f.get("national"):
            rf["momentum"] = {"start": s0.get("niveau"), "slut": s1.get("niveau")}
            rf["hb"] = {"start": s0.get("hb"), "slut": s1.get("hb")}
            a, b = rf["momentum"]["start"], rf["momentum"]["slut"]
            mom = [a, b] if a and b and a != b and not {a, b} & {"ukendt", "ingenfb"} else None
            ha, hb_ = rf["hb"]["start"], rf["hb"]["slut"]
            hbx = [ha, hb_] if hb_samme and ha in HB_ORDEN and hb_ in HB_ORDEN and ha != hb_ \
                and (kv_samme or hb_ == "ikke") else None
            ned = (mom and MOM_ORDEN[b] < MOM_ORDEN[a]) or (hbx and HB_ORDEN.index(hb_) > HB_ORDEN.index(ha))
            op = (mom and MOM_ORDEN[b] > MOM_ORDEN[a]) or (hbx and HB_ORDEN.index(hb_) < HB_ORDEN.index(ha))
            # Faldet i momentum går forud; en forening kan kun stå ét sted.
            if ned or op:
                hoejde["faldet" if ned else "forbedret"].append({"forening": navn, "momentum": mom, "hb": hbx})
            if not rf["afholdt"]:
                if daekket:
                    sidste = max((e["_start"] for e in mine if gyldig(e) and dansk(e["_start"]) < fra), default=None)
                    hoejde["uden_aktivitet"].append({"forening": navn, "niveau": b,
                                                     "sidste": dansk(sidste).isoformat() if sidste else None})
                else:
                    uden_data += 1
        foreninger[navn] = rf

    moedt = [e["fremmoede"] for e in alle["afholdt"].values() if e.get("fremmoede") is not None]
    lokale = [f["navn"] for f in data.lokale()]
    fordeling = lambda s, felt: {k: sum(1 for n in lokale if s["foreninger"].get(n, {}).get(felt) == k)  # noqa: E731
                                 for k in ([*MOM_ORDEN] if felt == "niveau" else [*HB_ORDEN, "ukendt"])}
    return {
        "maaned": m, "fra": fra.isoformat(), "til": til.isoformat(), "foreloebig": foreloebig,
        "beregnet": iso(data.nu),
        "fremad": lav_fremad(data, data.nu if foreloebig else maaned_start(naeste_maaned(m)), not foreloebig),
        "start": {"tid": start["tid"], "rekonstrueret": start.get("rekonstrueret", False), "hb_aar": start["hb_aar"]},
        "slut": {"tid": slut["tid"], "rekonstrueret": slut.get("rekonstrueret", False), "hb_aar": slut["hb_aar"]},
        "total": {
            "afholdt": len(alle["afholdt"]), "aflyst": len(alle["aflyst"]), "nye": len(alle["nye"]),
            "forsvundet": len(alle["forsvundet"]), "fremmoede": sum(moedt) if moedt else None, "med_fremmoede": len(moedt),
            "lokale": len(lokale), "aktive": sum(1 for n in lokale if foreninger[n]["afholdt"]),
            "uden_aktivitet": len(hoejde["uden_aktivitet"]), "uden_data": uden_data,
            "faldet": len(hoejde["faldet"]), "forbedret": len(hoejde["forbedret"]),
            "nye_aflysninger": len(hoejde["nye_aflysninger"]),
        },
        "fordeling": {
            "momentum": {"start": fordeling(start, "niveau"), "slut": fordeling(slut, "niveau")},
            "hb": {"start": fordeling(start, "hb"), "slut": fordeling(slut, "hb")},
        },
        "hoejdepunkter": hoejde,
        "foreninger": foreninger,
    }


# ------------------------------------------------------------------ fremad

def lav_fremad(data, idag, rekonstruer):
    """Den fremadskuende del af rapporten, set fra tidspunktet idag (for en afsluttet måned: den 1. i måneden efter).

    Med rekonstruer=True bruges de samme regler som for rekonstruerede snapshots (tilstand_ved): kun begivenheder, der
    var set på Facebook på tidspunktet, tæller som planlagte – så en gammel rapport viser, hvad man vidste dengang.
    Indeholder kommende arrangementer de næste FREMAD_DAGE dage pr. forening, lokalforeninger uden noget planlagt i
    perioden og risici sorteret efter alvor (HB-kvartalet, momentum og årsskiftet), hver med en konkret handling.
    """
    events = [x for e in data.events if (x := tilstand_ved(e, idag) if rekonstruer else e)]
    fra, til = dansk(idag), dansk(idag) + timedelta(days=FREMAD_DAGE)  # til: første dag efter perioden
    i_periode = lambda e: fra <= dansk(e["_start"]) < til  # noqa: E731
    kommende, uden_planlagt, risici, alle = {}, [], [], {}
    aar_frist, mangler_q4 = date(fra.year, 12, 31), []
    kvartal = None
    for f0 in data.foreninger:
        f = forening_ved(f0, events, idag)
        navn, mine = f["navn"], [e for e in f["planlagt"] if i_periode(e)]
        if mine:
            kommende[navn] = [ev_kort(e) for e in mine]
            alle.update((e["id"], e) for e in mine)
        if f.get("national"):
            continue
        dk = data.daekket(navn)
        m, r = momentum(f, idag, dk), hb_risiko(f, idag, dk)
        kvartal = kvartal or {"navn": r["kvartal"], "hb_aar": fra.year + 1, "sidste_dag": r["frist"].isoformat(),
                              "dage": r["dage"]}
        if not mine:
            efter = next((e for e in f["planlagt"] if dansk(e["_start"]) >= til), None)
            uden_planlagt.append({"forening": navn, "niveau": m["niveau"], "facebook": bool(f.get("facebook")),
                                  "sidste": dansk(f["sidste"]).isoformat() if f["sidste"] else None,
                                  "naeste": dansk(efter["_start"]).isoformat() if efter else None})
        # Teksterne er de samme som i liveFremad() i udvidelser/maanedsrapport.js.
        frist = kort_dato(r["frist"])
        if r["status"] == "mangler" and r["niveau"] in ("kritisk", "advarsel"):
            risici.append({"forening": navn, "niveau": r["niveau"], "type": "hb", "dage": r["dage"],
                           "tekst": f"HB {fra.year + 1} i fare – intet afholdt eller planlagt i {r['kvartal']},"
                                    f" {dage_tekst(r['dage'])}.",
                           "handling": punktum(f"Afhold et arrangement senest {frist}"),
                           "forklaring": r["forklaring"]})
        elif r["status"] == "planlagt" and r["niveau"] in ("advarsel", "opmaerksom") and r["dage"] < FREMAD_DAGE:
            e = r["planlagt"][0]
            hvad = f"ét planlagt arrangement: \"{afkort(e.get('navn') or 'uden titel', 50)}\" " \
                   f"{kort_dato(dansk(e['_start']))}" if len(r["planlagt"]) == 1 \
                else f"{len(r['planlagt'])} planlagte arrangementer (det første {kort_dato(dansk(e['_start']))})"
            risici.append({"forening": navn, "niveau": r["niveau"], "type": "hb_planlagt", "dage": r["dage"],
                           "tekst": f"{r['kvartal']} hænger på {hvad} – {dage_tekst(r['dage'])}.",
                           "handling": "Sørg for, at det bliver afholdt, og bekræft det bagefter (✓ Afholdt).",
                           "forklaring": r["forklaring"]})
        if r["kvartal"] == "Q4" and r["niveau"] in ("kritisk", "advarsel", "opmaerksom"):
            mangler_q4.append(navn)
        if m["niveau"] in ("hjaelp", "faldende"):
            siden = f"{m['sidste_dage']} dage siden sidste arrangement" if m["sidste_dage"] is not None \
                else f"intet afholdt siden {kort_dato(dk)}"
            hjaelp = m["niveau"] == "hjaelp"
            risici.append({"forening": navn, "niveau": "advarsel" if hjaelp else "opmaerksom", "type": m["niveau"],
                           "tekst": f"{'Brug for hjælp' if hjaelp else 'Mister fart'} – {siden}"
                                    f" (rytme {m['rytme']['dage']}), intet i kalenderen.",
                           "handling": "Kontakt foreningen, og hjælp med at planlægge næste arrangement." if hjaelp
                           else "Spørg til næste arrangement, før foreningen går i stå."})
    if fra <= aar_frist < til and mangler_q4:
        risici.append({"forening": None, "niveau": "advarsel", "type": "aarsskifte",
                       "dage": (aar_frist - fra).days,
                       "tekst": f"Årsskiftet: 31. dec. er fristen for HB-godkendelse {fra.year + 1} – "
                                f"{len(mangler_q4)} {'lokalforening' if len(mangler_q4) == 1 else 'lokalforeninger'}"
                                f" mangler stadig et afholdt arrangement i Q4 ({opremsning(mangler_q4)}).",
                       "handling": "Sørg for, at de afholder et arrangement før jul, og at arrangementer uden for"
                                   " Facebook er tilføjet under Arrangementer."})
    risici.sort(key=lambda x: (RISIKO_ORDEN[x["niveau"]], RISIKO_TYPE.index(x["type"]),
                               x.get("dage", 999), x["forening"] or ""))
    return {
        "tid": iso(idag), "fra": fra.isoformat(), "til": til.isoformat(), "dage": FREMAD_DAGE,
        "rekonstrueret": rekonstruer,
        # Før de ugentlige kørsler startede, kendes ingen planlagte arrangementer.
        "ufuldstaendig": idag < data.foerste_koersel, "kendt_fra": dansk(data.foerste_koersel).isoformat(),
        "kvartal": kvartal,
        "total": {
            "arrangementer": len(alle), "foreninger_med": sum(1 for f in data.lokale() if f["navn"] in kommende),
            "lokale": len(data.lokale()), "uden_planlagt": len(uden_planlagt),
            **{k: sum(1 for x in risici if x["niveau"] == k) for k in RISIKO_ORDEN},
        },
        "risici": risici,
        "kommende": kommende,
        "uden_planlagt": uden_planlagt,
    }


# ------------------------------------------------------------------ udskrift

def udskriv(r):
    t = r["total"]
    fra, til = date.fromisoformat(r["fra"]), date.fromisoformat(r["til"])
    slut = "i dag" if r["foreloebig"] else kort_dato(til)
    rek = [n for n in ("start", "slut") if r[n]["rekonstrueret"]]
    print(f"\nMånedsrapport for {maaned_navn(r['maaned'])}{' (foreløbig)' if r['foreloebig'] else ''}")
    fr = r.get("fremad")
    if fr:
        ft, kv = fr["total"], fr["kvartal"]
        print(f"\nFREMAD fra {kort_dato(date.fromisoformat(fr['fra']))} ({fr['dage']} dage)"
              + (f" – planlagte arrangementer kendes først fra {fr['kendt_fra']}" if fr["ufuldstaendig"] else ""))
        print(f"{ft['arrangementer']} arrangementer planlagt i {ft['foreninger_med']} af {ft['lokale']} lokalforeninger"
              f" · {kv['navn']} slutter {kv['sidste_dag']} ({dage_tekst(kv['dage'])})")
        print(f"Risici: {ft['kritisk']} kritiske, {ft['advarsel']} advarsler, {ft['opmaerksom']} hold øje")
        for x in fr["risici"]:
            print(f"  [{x['niveau']}] {x['forening'] or 'Alle'}: {x['tekst']} → {x['handling']}")
        print(f"Uden noget planlagt: {', '.join(x['forening'] for x in fr['uden_planlagt']) or '–'}")
    else:
        print("\n(Ingen fremadskuende del – genberegn med: scripts/rapport.py alle)")
    print(f"\nBAGUD {kort_dato(fra)} → {slut}" + (f"; {' og '.join(rek)} rekonstrueret" if rek else ""))
    moedt = f"{t['fremmoede']} (på {t['med_fremmoede']})" if t["fremmoede"] is not None else "–"
    print(f"Afholdt {t['afholdt']} · aflyst {t['aflyst']} · nye {t['nye']} · forsvundet {t['forsvundet']} · "
          f"fremmøde {moedt} · {t['aktive']} af {t['lokale']} lokalforeninger aktive")
    h = r["hoejdepunkter"]

    def skift(x):
        dele = []
        if x["momentum"]:
            dele.append(f"{MOM_IKON[x['momentum'][0]]} → {MOM_IKON[x['momentum'][1]]}")
        if x["hb"]:
            dele.append(f"HB {x['hb'][0]} → {x['hb'][1]}")
        return f"{x['forening']} ({', '.join(dele)})"
    for titel, lst in (("Faldet", [skift(x) for x in h["faldet"]]), ("Forbedret", [skift(x) for x in h["forbedret"]]),
                       ("Uden afholdt aktivitet", [x["forening"] for x in h["uden_aktivitet"]]),
                       ("Nye aflysninger", [f"{x['forening']}: {x['navn']} ({x['dato']})" for x in h["nye_aflysninger"]])):
        print(f"{titel}: {', '.join(lst) if lst else '–'}")
    print(f"{'Forening':16} Afh Afl Nye Fsv Mødt  Momentum  HB-prognose")
    for navn, f in sorted(r["foreninger"].items(), key=lambda x: (x[0] == "Landsforeningen", x[0])):
        mom = f.get("momentum") or {}
        hbp = f.get("hb") or {}
        mm = f"{MOM_IKON.get(mom.get('start'), '·')} → {MOM_IKON.get(mom.get('slut'), '·')}" if mom else ""
        hh = f"{hbp.get('start') or '–'} → {hbp.get('slut') or '–'}" if hbp else ""
        print(f"{navn:16} {len(f['afholdt']):3} {len(f['aflyst']):3} {len(f['nye']):3} {len(f['forsvundet']):3} "
              f"{f['fremmoede'] if f['fremmoede'] is not None else '–':>4}  {mm:9} {hh}")


# ------------------------------------------------------------------ hovedprogram

def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    if arg and arg != "alle" and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", arg):
        sys.exit("Brug: scripts/rapport.py [ÅÅÅÅ-MM | alle]")
    if not admin.har_noegle():
        print("Månedsrapporten er fortrolig og laves kun med ADMIN_KODE (se README: Adminlogin) – springes over.")
        return
    data = Data(datetime.now(timezone.utc))
    denne = maaned_af(data.nu)
    gemt = admin.laes("rapporter", {}) or {}
    snapshots, rapporter = dict(gemt.get("snapshots", {})), dict(gemt.get("rapporter", {}))

    if arg == "alle":
        # Fra den første måned, data dækker (den tidligste dækning for en forening), til og med sidste måned.
        m, maaneder = min(data.daekket(f["navn"]) for f in data.foreninger).strftime("%Y-%m"), []
        while m < denne:
            maaneder.append(m)
            m = naeste_maaned(m)
    elif arg:
        if arg > denne:
            sys.exit(f"{arg} ligger i fremtiden")
        maaneder = [arg]
    else:
        maaneder = [forrige_maaned(denne)]

    def snapshot(m, genberegn):
        """Månedens snapshot: det gemte, et nyt, eller et rekonstrueret igen (ved genberegning). Tidsstempler ignoreres."""
        gammel = snapshots.get(m)
        if gammel and not (genberegn and gammel.get("rekonstrueret")):
            return gammel
        ny = lav_snapshot(data, m)
        if gammel and uden(gammel, "taget") == uden(ny, "taget"):
            return gammel
        snapshots[m] = ny
        return ny

    snapshot(denne, False)  # den første kørsel i måneden tager månedens snapshot
    for m in maaneder:
        start = snapshot(m, bool(arg))
        foreloebig = m == denne
        slut = {**tilstand(data, data.nu, rekonstruer=False), "rekonstrueret": False} if foreloebig \
            else snapshot(naeste_maaned(m), bool(arg))
        ny = lav_rapport(data, m, start, slut, foreloebig)
        gammel = rapporter.get(m)
        if not gammel or uden(gammel, "beregnet") != uden(ny, "beregnet"):
            rapporter[m] = ny

    ud = {"snapshots": dict(sorted(snapshots.items())), "rapporter": dict(sorted(rapporter.items()))}
    skrevet = admin.skriv("rapporter", ud)  # skriver kun, når indholdet er ændret (ingen tomme commits)
    for m in maaneder[-1:] if arg == "alle" else maaneder:
        udskriv(rapporter[m])
    if arg == "alle":
        print(f"\nGenberegnede {len(maaneder)} måneder: {', '.join(maaneder)}")
    print(f"\n{'Skrevet til' if skrevet else 'Uændret:'} {admin.sti('rapporter').relative_to(hb.ROOT)} (krypteret)")


if __name__ == "__main__":
    main()
