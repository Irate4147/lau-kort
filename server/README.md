# LAU-serveren (liberaleunge.dk)

Hele LAU-kortet på egen server – i stedet for GitHub Pages, krypterede filer i repoet, Cloudflare-workeren og GitHub Actions:

| I dag (GitHub) | På serveren |
|---|---|
| GitHub Pages | `server/server.js` serverer siden (samme `index.html`, `app.js`, `kerne/`, `udvidelser/`) |
| Fælles adminkode | **Personlige logins** (e-mail + adgangskode) med **roller** |
| Krypterede filer i `data/admin/` | **SQLite-database** (`lau.db`) – samme dokumenter, ukrypteret på serveren, aldrig i git |
| Ingen log over hvem der gjorde hvad | **Handlingslog** med hver ændring (hvem, hvad, hvornår) og alle tidligere udgaver |
| Cloudflare-workeren (gem for alle, flettede kalendere) | API'et og `/kal/aalborg+fyn.ics` |
| GitHub Actions (scraping, HB, rapport, kalendere) | Planlagte kørsler i serveren + **daglig sikkerhedskopi** |

Kun **Node 22.13+** og **Python 3** (med `cryptography` til flytningen) – ingen npm-pakker, ingen Docker, ingen database-server. Kode og data er adskilt: koden er en git-checkout (`/opt/lau-kort`), data ligger i `/var/lib/lau`.

## Sådan hænger det sammen

```
Internet ──HTTPS──▶ Caddy/nginx (:443) ──▶ node server/lau.js start (127.0.0.1:8080)
                                              │  /            siden (index.html får window.LAU_CONFIG = {backend: 'server'})
                                              │  /data, /kalender   offentlige data fra /var/lib/lau
                                              │  /kal/…ics    flettede kalendere
                                              │  /api/…       login, dokumenter, brugere, historik, kørsler
                                              ├─ lau.db (SQLite): dokumenter, handlinger, brugere, sessioner, kørsler
                                              └─ kørsler: python3 scripts/*.py med LAU_DB/LAU_DATA/LAU_KALENDER
```

- **Samme kode begge steder.** `app.js` kører i "pages"-tilstand på GitHub Pages og i "server"-tilstand, når serveren har sat `window.LAU_CONFIG.backend = 'server'` i `index.html`. I servertilstand er login personligt, og `LAU.admin.hent/gem` går til `/api/data/<navn>` i stedet for de krypterede filer – udvidelserne mærker ingen forskel.
- **Dokumenterne** har de samme navne og former som de krypterede filer (`hb`, `rettelser`, `noter`, `stamdata`, `medlemmer`, `rapporter`, `analyser`, `udvikling`, `hb_<år>`). Hver ændring får et nyt versionsnummer (samtidige ændringer giver 409, og browseren prøver igen) og logges med hele den nye udgave.
- **Python-scripts** (`sync.py`, `admin.py`, `hb.py`, `rapport.py`, `kalender.py`) er uændrede i logikken: med `LAU_DB` læser og skriver `admin.py` databasen i stedet for de krypterede filer, og `LAU_DATA`/`LAU_KALENDER` peger på serverens mapper.

## Roller

| Rolle | Ser | Må ændre |
|---|---|---|
| **Admin** | alt | alt – rettelser af arrangementer, HB, brugere, kørsler |
| **Udviklingsformand** | alt | udviklingsudvalget inkl. medlemmer og fordeling, noter, kontaktoplysninger, egne analyser; kan invitere og deaktivere udvalgsmedlemmer |
| **Udvalgsmedlem** | alt | kontakter (registrér, ret, opfølgninger), noter, kontaktoplysninger, egne analyser – ikke udvalget og fordelingen |

Rollerne står i `server/adgang.js` og håndhæves af serveren; brugerfladen skjuler det, man ikke må. Senere kan en rolle for lokale bestyrelser (kun egen forening) komme til samme sted.

**Brugere** oprettes under fanen **Konto → Brugere** (admin og udviklingsformanden) eller på kommandolinjen. Den nye bruger får et link (gyldigt i 14 dage, kan bruges én gang), hvor de selv vælger adgangskode – linket sendes af den, der opretter dem (mail, Messenger). **Glemt kode:** "Nyt login-link". **Stopper nogen:** "Deaktivér" (de logges ud med det samme; historikken bevares). Adgangskoder gemmes som scrypt-hash; sessioner er HttpOnly-cookies (1 dag, eller 30 med "Husk mig"); 10 forkerte forsøg på 15 minutter spærrer.

## Kørsler

| Kørsel | Hvornår (dansk tid) | Hvad |
|---|---|---|
| `sync` | man, ons, fre 07.00 | `sync.py --start` (Apify) → `admin.py klargoer` (offentlige rettelser) → `hb.py` → `rapport.py` → `kalender.py` |
| `beregn` | 15 sek. efter en ændring af rettelser eller HB | samme uden Apify |
| `rapport` | den 1. kl. 04.17 | `rapport.py` |
| `historik` | kun manuelt | `sync.py --historik [fra]` (koster Apify-kreditter) |
| `backup` | dagligt 03.30 | `lau.db` + `data/*.json` til `/var/lib/lau/backup/<dato>/`; de seneste 30 dage gemmes |

Én kørsel ad gangen. Var serveren nede, indhentes en planlagt kørsel, hvis den er under 6 timer forsinket. Status, log og "Kør nu" står under **Konto → Kørsler** (admin), eller `sudo lau koer <kørsel>`.

## Installation (når der er SSH-adgang)

1. **Tjek maskinen:** `sh server/deploy/tjek.sh` – viser styresystem, Node/Python, hvad der allerede kører på port 80/443 (fx WordPress på liberaleunge.dk), og om DNS peger rigtigt. Ændrer intet.
2. **DNS:** en A-post (og evt. AAAA) for `kort.liberaleunge.dk` → serverens IP. (Et andet navn kan bruges – ret `LAU_ADRESSE` og Caddy/nginx.)
3. **Installér:** `sudo sh server/deploy/installer.sh` – opretter brugeren `lau`, `/opt/lau-kort` (koden), `/var/lib/lau` (data), `/etc/lau/lau.env` (fra `lau.env.eksempel`), systemd-tjenesten `lau` og kommandoen `lau` (`/usr/local/bin/lau`). Udfyld `APIFY_TOKEN` i `/etc/lau/lau.env` og `sudo systemctl restart lau`.
4. **HTTPS:** findes der ingen webserver, installeres Caddy (`server/deploy/Caddyfile` – henter selv certifikatet). Kører nginx allerede (fx for liberaleunge.dk), bruges `server/deploy/nginx.conf` + `certbot --nginx`.
5. **Flyt data** (én gang – spørger efter adminkoden):
   ```sh
   sudo lau flyt-data      # scripts/admin.py til-db
   sudo lau koer beregn    # HB, rapport, kalendere
   ```
   `flyt-data` dekrypterer alle `data/admin/*.krypt.json` ind i databasen og kopierer `data/*.json` (begivenheder, foreninger, meta) til `/var/lib/lau/data`. Den kan køres igen (uændrede dokumenter springes over).
6. **Første admin:** `sudo lau opret-bruger emil@… "Emil" admin` – åbn linket, vælg adgangskode, og opret resten under Konto → Brugere.
7. **Test** på `https://kort.liberaleunge.dk/` (log ind, åbn en forening, registrér en kontakt, se Konto → Kørsler).

## Skiftet (når alt virker)

1. **Stop GitHub Actions' kørsler:** GitHub → Settings → Secrets and variables → Actions → *Variables* → `LAU_SERVER` = `1`. Workflowene (sync, hb, rapport, historik, admin) springer så over – ellers scrapes der to gange. Kør `sync` på serveren lige bagefter.
2. **Send Pages videre:** sæt `flyttetTil: 'https://kort.liberaleunge.dk/'` i `CONFIG` i `app.js` – den gamle adresse (også `#Næstved`-links) sender så videre.
3. **Kalenderabonnementer** på den gamle adresse (`irate4147.github.io/lau-kort/kalender/…`) opdateres ikke længere – del de nye links (kalenderen på siden laver dem). Cloudflare-workeren kan slettes, når ingen bruger den.
4. **Ryd op i repoet:** slet `data/admin/*.krypt.json` og `ADMIN_KODE`-secret'en; overvej at gøre repoet privat, fordi historikken stadig indeholder de krypterede filer (og de gamle klartekstfiler, se README: Adminlogin). Fra nu af er repoet kun kode.

**Fortryd:** sæt `LAU_SERVER` til `0` og fjern `flyttetTil` – GitHub-udgaven kører videre med sine egne (krypterede) data. Ændringer lavet på serveren i mellemtiden kommer ikke med tilbage.

## Drift

- **Opdatér koden:** `sudo sh /opt/lau-kort/server/deploy/installer.sh` (henter `main` og genstarter).
- **Log:** `journalctl -u lau -f`. **Status:** `systemctl status lau`.
- **Sikkerhedskopier** ligger på samme maskine – kopiér `/var/lib/lau/backup` jævnligt et andet sted hen (fx `rsync` til en anden maskine eller et cloud-drev). **Gendan:** stop tjenesten, kopiér `backup/<dato>/lau.db` til `/var/lib/lau/lau.db` (og evt. `data/`), start igen.
- **Kommandolinjen:** `sudo lau opret-bruger <email> "<navn>" [rolle]`, `sudo lau login-link <email>`, `sudo lau brugere`, `sudo lau koer <kørsel> [arg]`, `sudo lau flyt-data`.
- **Lokalt** (udvikling): `LAU_VAR=./var LAU_JOBS=0 npm start` → `http://localhost:8080/` (kopiér `data/*.json` og `kalender/` til `./var` først; `var/` er i `.gitignore`).

## Persondata

Med serveren er de krav, [docs/arkitektur.md](../docs/arkitektur.md#persondata-vigtigt) stiller, opfyldt for så vidt angår teknikken: data er ude af git, der er personlige logins, adgang efter rolle og en log over ændringer. Tilbage står det organisatoriske: hvem er dataansvarlig, en databehandleraftale med den, der hoster maskinen (hvis det ikke er jer selv), at maskinen står i EU, og at den holdes opdateret (sikkerhedsopdateringer, `unattended-upgrades`). Noterne bør stadig handle om foreningerne, ikke om enkeltpersoner.
