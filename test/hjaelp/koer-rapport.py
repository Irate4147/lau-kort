# Kører scripts/rapport.py uden ADMIN_KODE på en fast dato (test/scripts.test.js og test/lav-rapport-facit.js):
# admin.py's læsning og skrivning erstattes, så de gemte rapporter kommer ind på stdin og det, der ville blive krypteret,
# kommer ud på stdout – sammen med scriptets egen udskrift.
#   python3 test/hjaelp/koer-rapport.py <datamappe> <nu (ISO)> [ÅÅÅÅ-MM | alle] < gemt.json   (tom stdin: intet gemt)
# Svar: {"udskrift": "...", "exit": null | "fejlbesked", "krypteres": "…" | null, "skrevet": bool}, hvor krypteres er
# præcis den JSON-tekst, admin.skriv ville kryptere (samme json.dumps som admin._krypter) – den kan gives ind igen.
import io
import json
import sys
from contextlib import redirect_stdout
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import admin  # noqa: E402
import hb  # noqa: E402
import rapport  # noqa: E402

data, nu, valg = Path(sys.argv[1]), datetime.fromisoformat(sys.argv[2].replace("Z", "+00:00")), sys.argv[3:]
ind = sys.stdin.read().strip()
gemt = json.loads(ind) if ind else None
ud = {"udskrift": "", "exit": None, "krypteres": None, "skrevet": False}


def skriv(navn, d):
    ud["krypteres"], ud["skrevet"] = json.dumps(d, ensure_ascii=False, separators=(",", ":")), d != gemt
    return ud["skrevet"]


admin.har_noegle = lambda: True
admin.laes = lambda navn, standard=None: gemt if gemt is not None else standard
admin.skriv = skriv
admin.rettelser = lambda: json.loads((data / "rettelser.json").read_text(encoding="utf-8"))["rettelser"]
hb.DATA = data


class FastDato(datetime):
    @classmethod
    def now(cls, tz=None):
        return nu.astimezone(tz) if tz else nu


rapport.datetime = FastDato
sys.argv = ["rapport.py", *valg]
buf = io.StringIO()
try:
    with redirect_stdout(buf):
        rapport.main()
except SystemExit as e:
    ud["exit"] = str(e.code)
ud["udskrift"] = buf.getvalue()
print(json.dumps(ud, ensure_ascii=False, separators=(",", ":")))
