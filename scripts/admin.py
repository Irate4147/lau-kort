#!/usr/bin/env python3
"""Fortrolige admindata: krypteres med adminkoden, så de kan ligge i det offentlige repo.

Alt fortroligt ligger i data/admin/<navn>.krypt.json (AES-256-GCM). Nøglen udledes af adminkoden med
PBKDF2-SHA256 og saltet i data/admin/noegle.json – samme format som adminlogin'et på siden (app.js).
Koden læses fra miljøvariablen ADMIN_KODE (GitHub-secret af samme navn) og ligger aldrig i repoet.

    python3 scripts/admin.py klargoer             # opret nøglen, kryptér gamle klartekstfiler, skriv data/rettelser.json
    python3 scripts/admin.py vis hb               # udskriv data/admin/hb.krypt.json som JSON
    python3 scripts/admin.py dekrypter hb         # -> privat/hb.json (ignoreres af git) til redigering
    python3 scripts/admin.py krypter hb           # privat/hb.json -> data/admin/hb.krypt.json
    python3 scripts/admin.py skift-kode           # kryptér alt igen med ADMIN_KODE_NY (ny salt)

Andre scripts bruger laes(navn) og skriv(navn, data).
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
ADMIN = DATA / "admin"
NOEGLE = ADMIN / "noegle.json"
PRIVAT = ROOT / "privat"  # lokale klartekstkopier (i .gitignore)
ITERATIONER = 600_000
TJEK = "LAU-admin"
SKRIV = b"lau-skriv"

# Felter i en rettelse, der er fortrolige. Resten (status, titel, dato, sted, forening) er offentligt i
# data/rettelser.json, så det offentlige kort viser arrangementerne rigtigt.
FORTROLIGE_FELTER = ("note", "deltagere")
# Klartekstfiler fra før adminlogin'et, som klargoer krypterer og fjerner.
GAMLE_FILER = {"hb": DATA / "hb.json"}


class IngenKode(RuntimeError):
    pass


def _b64(b):
    return base64.b64encode(b).decode("ascii")


def _aesgcm(noegle):
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        sys.exit("Mangler pakken 'cryptography' (pip install cryptography)")
    return AESGCM(noegle)


def _udled(kode, salt, iterationer):
    return hashlib.pbkdf2_hmac("sha256", kode.encode("utf-8"), salt, iterationer, dklen=32)


def _krypter(noegle, navn, data):
    iv = secrets.token_bytes(12)
    tekst = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return {"v": 1, "iv": _b64(iv), "data": _b64(_aesgcm(noegle).encrypt(iv, tekst, navn.encode("utf-8")))}


def _dekrypter(noegle, navn, blob):
    from cryptography.exceptions import InvalidTag
    try:
        tekst = _aesgcm(noegle).decrypt(base64.b64decode(blob["iv"]), base64.b64decode(blob["data"]), navn.encode("utf-8"))
    except InvalidTag:
        raise IngenKode(f"Kan ikke dekryptere {navn} – forkert ADMIN_KODE?") from None
    return json.loads(tekst)


def _skriv_hash(noegle):
    """SHA-256 af skrivenøglen HMAC(nøgle, "lau-skriv"): kalender-server/worker.js lader kun den, der kender
    skrivenøglen (dvs. adminkoden), gemme. Samme udledning som skriveNoegle() i app.js."""
    return hashlib.sha256(hmac.new(noegle, SKRIV, hashlib.sha256).digest()).hexdigest()


def _ny_noegle(kode):
    salt = secrets.token_bytes(16)
    noegle = _udled(kode, salt, ITERATIONER)
    return noegle, {"v": 1, "kdf": "PBKDF2-SHA256", "iterationer": ITERATIONER, "salt": _b64(salt),
                    "tjek": _krypter(noegle, "tjek", TJEK), "skriv": _skriv_hash(noegle)}


_NOEGLE = None


def noegle(kode=None):
    """Nøglen ud fra ADMIN_KODE og data/admin/noegle.json. Fejler med IngenKode, hvis den ikke kan findes."""
    global _NOEGLE
    if _NOEGLE and kode is None:
        return _NOEGLE
    kode = kode or os.environ.get("ADMIN_KODE", "")
    if not kode:
        raise IngenKode("ADMIN_KODE er ikke sat")
    if not NOEGLE.exists():
        raise IngenKode(f"{NOEGLE.relative_to(ROOT)} findes ikke – kør 'scripts/admin.py klargoer'")
    n = json.loads(NOEGLE.read_text(encoding="utf-8"))
    k = _udled(kode, base64.b64decode(n["salt"]), n["iterationer"])
    if _dekrypter(k, "tjek", n["tjek"]) != TJEK:
        raise IngenKode("Forkert ADMIN_KODE")
    _NOEGLE = k
    return k


def har_noegle():
    try:
        noegle()
        return True
    except IngenKode:
        return False


def sti(navn):
    return ADMIN / f"{navn}.krypt.json"


def laes(navn, standard=None):
    """Dekrypterer data/admin/<navn>.krypt.json (standard, hvis filen ikke findes)."""
    p = sti(navn)
    if not p.exists():
        return standard
    return _dekrypter(noegle(), navn, json.loads(p.read_text(encoding="utf-8")))


def skriv(navn, data):
    """Krypterer data til data/admin/<navn>.krypt.json – kun hvis indholdet er ændret (ny iv giver ellers en ny commit)."""
    p = sti(navn)
    if p.exists():
        try:
            if laes(navn) == data:
                return False
        except (IngenKode, ValueError):
            pass
    ADMIN.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(_krypter(noegle(), navn, data)) + "\n", encoding="utf-8")
    return True


def offentlige_rettelser(rettelser):
    """Rettelserne uden de fortrolige felter (til data/rettelser.json)."""
    ud = {}
    for id_, r in sorted((rettelser or {}).items()):
        o = {k: v for k, v in r.items() if k not in FORTROLIGE_FELTER}
        if set(o) - {"rettet", "manuel"} or o.get("manuel"):
            ud[id_] = o
    return ud


def rettelser():
    """Alle rettelser: de fortrolige, hvis nøglen findes, ellers de offentlige."""
    if har_noegle() and sti("rettelser").exists():
        return laes("rettelser", {})
    fil = DATA / "rettelser.json"
    return json.loads(fil.read_text(encoding="utf-8")).get("rettelser", {}) if fil.exists() else {}


def klargoer():
    kode = os.environ.get("ADMIN_KODE", "")
    if not kode:
        print("ADMIN_KODE er ikke sat – fortrolige data springes over (se README: Adminlogin).")
        return
    global _NOEGLE
    if not NOEGLE.exists():
        ADMIN.mkdir(parents=True, exist_ok=True)
        _NOEGLE, n = _ny_noegle(kode)
        NOEGLE.write_text(json.dumps(n, indent=1) + "\n", encoding="utf-8")
        print(f"Oprettede {NOEGLE.relative_to(ROOT)}")
    n = json.loads(NOEGLE.read_text(encoding="utf-8"))
    if n.get("skriv") != _skriv_hash(noegle()):
        n["skriv"] = _skriv_hash(noegle())
        NOEGLE.write_text(json.dumps(n, indent=1) + "\n", encoding="utf-8")
        print(f"Skrev skrivenøglens hash i {NOEGLE.relative_to(ROOT)}")
    for navn, fil in GAMLE_FILER.items():
        if fil.exists():
            if not sti(navn).exists():
                skriv(navn, json.loads(fil.read_text(encoding="utf-8")))
                print(f"Krypterede {fil.relative_to(ROOT)} -> {sti(navn).relative_to(ROOT)}")
            fil.unlink()
    for fil in DATA.glob("hb_*.json"):  # beregnes igen af hb.py – krypteret
        fil.unlink()
        print(f"Fjernede {fil.relative_to(ROOT)}")
    # Rettelser: den fulde udgave er krypteret; data/rettelser.json er den offentlige del.
    offentlig = DATA / "rettelser.json"
    if not sti("rettelser").exists():
        gamle = json.loads(offentlig.read_text(encoding="utf-8")).get("rettelser", {}) if offentlig.exists() else {}
        skriv("rettelser", gamle)
        print(f"Oprettede {sti('rettelser').relative_to(ROOT)}")
    tekst = json.dumps({"rettelser": offentlige_rettelser(laes("rettelser", {}))}, ensure_ascii=False, indent=1) + "\n"
    if not offentlig.exists() or offentlig.read_text(encoding="utf-8") != tekst:
        offentlig.write_text(tekst, encoding="utf-8")
        print(f"Skrev {offentlig.relative_to(ROOT)} (uden {', '.join(FORTROLIGE_FELTER)})")


def skift_kode():
    ny = os.environ.get("ADMIN_KODE_NY", "")
    if len(ny) < 12:
        sys.exit("ADMIN_KODE_NY skal være sat og mindst 12 tegn")
    gammel = noegle()
    alle = {p.name[:-len(".krypt.json")]: p for p in ADMIN.glob("*.krypt.json")}
    klar = {navn: _dekrypter(gammel, navn, json.loads(p.read_text(encoding="utf-8"))) for navn, p in alle.items()}
    ny_noegle, n = _ny_noegle(ny)
    for navn, data in klar.items():
        alle[navn].write_text(json.dumps(_krypter(ny_noegle, navn, data)) + "\n", encoding="utf-8")
    NOEGLE.write_text(json.dumps(n, indent=1) + "\n", encoding="utf-8")
    print(f"Krypterede {len(klar)} filer med den nye kode. Sæt nu ADMIN_KODE til den nye kode og slet ADMIN_KODE_NY.")


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("klargoer", "vis", "dekrypter", "krypter", "skift-kode"):
        sys.exit(__doc__)
    handling, navn = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "")
    try:
        if handling == "klargoer":
            klargoer()
        elif handling == "skift-kode":
            skift_kode()
        elif not navn:
            sys.exit(f"Angiv et navn, fx: scripts/admin.py {handling} hb")
        elif handling == "vis":
            print(json.dumps(laes(navn), ensure_ascii=False, indent=1))
        elif handling == "dekrypter":
            PRIVAT.mkdir(exist_ok=True)
            ud = PRIVAT / f"{navn}.json"
            ud.write_text(json.dumps(laes(navn), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            print(f"Skrev {ud.relative_to(ROOT)} – ret den og kør 'scripts/admin.py krypter {navn}'")
        elif handling == "krypter":
            ind = PRIVAT / f"{navn}.json"
            print("Krypteret" if skriv(navn, json.loads(ind.read_text(encoding="utf-8"))) else "Uændret", "->", sti(navn).relative_to(ROOT))
    except IngenKode as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
