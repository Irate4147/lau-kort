# Overdragelse – udviklingsudvalget og LAU-serveren

Status pr. 24. oktober 2026. PR [#44](https://github.com/Irate4147/lau-kort/pull/44) er merget; cPanel-tilpasningen
ligger på grenen `claude/awesome-hamilton-ks5fay` i en ny draft-PR. Detaljerne står i
[README.md](README.md#udviklingsudvalget), [server/README.md](server/README.md) og [docs/arkitektur.md](docs/arkitektur.md).

## Mål

1. **Udviklingsudvalget** (dem, der nationalt hjælper lokalforeningerne) skal nemt kunne se de lokalforeninger, de har
   ansvaret for, have konteksten klar før en samtale, kontakte hver forening **mindst én gang i kvartalet**, skrive ned
   hvordan det går og hvad de har brug for – så en anden kan tage over. Værktøjet skal kunne bruges i mange år:
   **udviklingsformanden** skal selv kunne ændre, hvem der har ansvaret for hvad.
2. Andre data (kontaktoplysninger, "hvem har foreningens logins" osv.) skal kunne skrives ind og ændres med tiden.
3. **Flyt det hele til egen server på liberaleunge.dk** (ejet af foreningen) i stedet for GitHub + Supabase, så
   fortrolige data ikke ligger i git, og hver bruger har sit eget login med en rolle.

## Hvad er gjort

### 1. Udviklingsudvalget (commit `39c55f9`)

- **Fanen "Udvikling"** (`udvidelser/udvikling.js`): "Jeg er …", kvartalets fremdrift, *Mine / Alle / Uden ansvarlig*
  sorteret efter hvem der skal kontaktes først, åbne opfølgninger, og **Udvalg og fordeling** (medlemmer, rolle,
  inaktiv i stedet for slet, fordeling af foreningerne).
- **Sektionen "Udviklingsudvalget"** øverst i foreningspanelet: ansvarlig, kvartalets kontakt, *Registrér kontakt*
  (dato, form, talte med, stemning, behov, noter, opfølgning + frist), **Forbered samtalen** (momentum, seneste/næste
  arrangement, HB-kvartal, hvide pletter, sidste kontakt, kontaktoplysninger + spørgsmål) og kontakthistorik med Ret/Slet.
- **Kontaktoplysninger** (fortrolige stamdata, frie felter) kan rettes i panelet ("Stamdata og kontaktoplysninger").
- **Advarsler** i "Kræver handling nu": overskredne opfølgninger og – de sidste 21 dage af kvartalet – foreninger uden kontakt.
- **Kernen**: `kontaktStatus()`, `KONTAKT`, `KONTAKT_STATUS`, `STEMNINGER`, `BEHOV` i `kerne/regler.js`; egenskaberne
  `kontakt`, `sidsteKontakt`, `dageSidenKontakt`, `stemning`, `aabneOpfoelgninger` på Forening og objekttyperne
  `Udvalgsmedlem` og `Kontakt` med links (`ansvarlig`, `kontakter`) i `kerne/lau.js`; adapteren i `kerne/kilder/json.js`
  tager `udvikling`. Derfor kan kortet farves efter kontakt/stemning, og Egen analyse kan bruge felterne.
- **app.js**: fane-register `LAU.registerFane`, "←" tilbage til fanen, farver for `kontakt`/`stemning`.
- **Data**: dokumentet `udvikling` = `{udvalg: [{id, navn, rolle, aktiv}], ansvar: {forening: id}, kontakter: [...]}`
  (i Pages-tilstand krypteret i `data/admin/udvikling.krypt.json`, på serveren i databasen).

### 2. LAU-serveren (commit `04ab0a3`, cPanel: `ca98cf3`) – installeret, ikke taget i brug

- `server/`: én Node 22.13+-proces med SQLite (`node:sqlite`), ingen npm-pakker, ingen Docker.
  - `server.js` – siden, offentlige data, `/kal/…ics` (flettede kalendere) og API'et (login, invitation, dokumenter,
    historik, brugere, kørsler). Indsætter `window.LAU_CONFIG = {backend: 'server'}` i `index.html`.
  - `db.js` + `skema.sql` – dokumenter med versioner, handlingslog med alle udgaver, brugere (scrypt), sessioner,
    invitationer, kørsler, backup (`VACUUM INTO`).
  - `adgang.js` – rollerne **admin**, **udviklingsformand**, **udvalg** (håndhæves i serveren).
  - `jobs.js` – planlagte kørsler: sync (man/ons/fre 07.00), beregn (15 sek. efter ændring af rettelser/HB),
    rapport (den 1. kl. 04.17), historik (manuelt), backup (dagligt 03.30, 30 dage).
  - `lau.js` – kommandolinje: `start`, `opret-bruger`, `login-link`, `brugere`, `koer`, `flyt-data`.
  - `deploy/` – `tjek.sh` (preflight, ændrer intet), `installer.sh`, `lau.service` (systemd), `lau` (wrapper →
    `/usr/local/bin/lau`), `lau.env.eksempel`, `Caddyfile`, `nginx.conf`.
- **app.js** kører både på Pages og på serveren (`CONFIG.backend`). I servertilstand: e-mail-login, invitation,
  fanen Konto (skift kode, Brugere, Kørsler, Seneste ændringer). `CONFIG.flyttetTil` sender Pages videre efter skiftet.
- **Python-scripts**: `admin.py` læser/skriver databasen, når `LAU_DB` er sat, og har `til-db` (flytning fra de
  krypterede filer); `LAU_DATA`, `LAU_KALENDER`, `LAU_ADRESSE` i `sync.py`, `hb.py`, `kalender.py`.
- **Workflows**: alle Apify/beregnings-workflows springer over, når repository variable `LAU_SERVER = 1`.
  `kerne.yml` installerer `cryptography`, så `test/server.test.js` kan teste flytningen.
- **Kalender-workeren** eksporterer `flettIcs` og `flettetKalender`, som serveren genbruger (samme fletteregel).

### Testet

- `npm run tjek`: typetjek + 67 tests (bl.a. `test/kerne.test.js` for kontaktreglen og `test/server.test.js` for login,
  roller, versioner/409, handlingslog, kun offentlige filer, kalender, planlægning og `admin.py til-db` + `hb.py` mod databasen).
- I Chromium (Playwright): Pages-tilstanden med falsk adminserver, og servertilstanden end-to-end (invitation → kode →
  udvalg/fordeling → udvalgsmedlem registrerer kontakt → API-forsøg på fordeling/rettelser/brugere giver 403 → log ud/ind
  → offentlig visning). `lau koer beregn` kørt mod databasen (HB, rapport, 48 kalendere).
- **Ikke testet**: installation på den rigtige maskine, HTTPS, rigtig Apify-kørsel fra serveren, flytning af de rigtige
  data (kræver adminkoden).

## Hvad mangler

### Installeret (24. oktober 2026)

Serveren kører på **https://kort.liberaleunge.dk/** – delt cPanel/CloudLinux-hosting hos nordicway (LiteSpeed, ingen
sudo/systemd), så planen er tilpasset (se [server/README.md](server/README.md#installation-på-cpanel-hosting-liberaleungedk-hos-nordicway)):
cPanel-Node-app (Node 22, `server/app.cjs`), kørsler via cron (`LAU_JOBS=cron`, `lau cron` hvert andet minut), kode i
`~/lau-kort` (grenen `claude/awesome-hamilton-ks5fay` – skift til `main` efter merge), data i `~/lau`, indstillinger i
`~/lau/lau.env` (chmod 600). SSH: `ssh -p 33 liberale@cp13.nordicway.dk`.

- ✅ Subdomænet + AutoSSL, Node-appen, `flyt-data` (hb, hb_2027, rapporter, rettelser), `lau koer beregn` (48 kalendere),
  cron, admin-bruger til Emil (invitationslink givet). Private filer (`data/admin`, `.git`, `lau.db`, `server/`) giver 403/404.
- ⏳ Emil: log ind via linket, opret resten under Konto → Brugere, test (registrér en kontakt, Konto → Kørsler → "Kør nu").

### Tilbage – kræver Emils ja (kan ikke fortrydes uden videre)

1. **Skiftet**: repository variable `LAU_SERVER = 1` (stopper workflows – ellers scrapes der to gange), kør `lau koer sync`
   på serveren, sæt `flyttetTil: 'https://kort.liberaleunge.dk/'` i `CONFIG` i `app.js` og merge. Indtil da kører
   GitHub videre, og serverens data bliver ikke opdateret af GitHub (data skal evt. flyttes igen lige før skiftet).
2. Efter skiftet: backup et andet sted end `~/lau/backup` (samme disk); slet `data/admin/*.krypt.json` og
   `ADMIN_KODE`-secret'en; overvej at gøre repoet privat; del nye kalenderlinks; slet Cloudflare-workeren.
3. Ny SSH-nøgle (den nuværende har været i en Claude-session) og slet den gamle i cPanel → SSH Access.

### Senere (ikke påbegyndt)

- Skjul redigering under Arrangementer for roller, der ikke må rette (serveren afviser med 403, men knapperne vises).
- Udvalgsmedlem ↔ bruger kobles i dag på navn ("Jeg er" vælges ud fra brugerens navn); et eksplicit link (bruger-id
  på udvalgsmedlemmet) er mere robust.
- `data/foreninger.json` kan kun rettes i filen (på serveren: `/var/lib/lau/data/foreninger.json`) – evt. en redigeringsside.
- Fase 2 fortsat (docs/arkitektur.md "Revideret: egen server"): objekter i stedet for dokumenter, rolle for lokale
  bestyrelser med adgang pr. række, derefter personer.
- Mails (invitationer, påmindelser om kvartalets kontakt) – kræver SMTP på serveren.

### Åbne spørgsmål til Emil

- "Logins" i det oprindelige ønske: foreningernes egne logins (dækket som frie felter i kontaktoplysninger – men skriv
  ikke adgangskoder der) eller personlige logins til værktøjet (dækket af serveren)?
- Hosting: nordicway (delt cPanel). Databehandleraftale med nordicway, og står maskinen i EU?

## Regler

**Arkitektur og kode**
- Forretningsregler står **kun i kernen** (`kerne/regler.js`, og som egenskab i `kerne/lau.js`, hvis de hører til et
  objekt). `app.js`, udvidelserne og Python-scripts læser dem – ingen kopier.
- Nye funktioner bygges som **udvidelser** (`udvidelser/*.js`) via registrene (`registerSection`, `registerLayer`,
  `registerAnalyse`, `registerAdvarsel`, `registerFane`). Filerne er pakket ind i `(() => { … })()`.
- **Samme kode kører på Pages og på serveren.** Fortrolige data hentes/gemmes kun via `LAU.admin.hent/gem` (=
  `hentAdmin`/`gemAdmin`), der vælger backend. Rør ikke de krypterede filer eller API'et direkte fra udvidelser.
- Rollerne håndhæves i **`server/adgang.js`**; brugerfladen skjuler blot det, man ikke må (`LAU.admin.rettigheder`, `maaRette`).
- Dokumentnavne og -former er de samme som de krypterede filer – ændres en form, skal både Pages og serveren kunne læse den.
- Udvalgsmedlemmer har **stabile id'er** og slettes aldrig (gøres inaktive), så historikken bevares.
- `server/` bruger **ingen npm-pakker** (kun Node-indbygget); scripts kun Python-standardbiblioteket (+ `cryptography` til flytningen).
- Ret `?v=` i `index.html`, når `app.js`, `style.css`, kernen eller en udvidelse ændres.
- Navne, kommentarer, commit-beskeder og UI er på **dansk** og følger stilen i den omgivende kode.

**Test og levering**
- Kør `npm run tjek` (typetjek + alle tests) før hver push. Facit-testene (`test/app.test.js`, `test/analyser.test.js`,
  `test/scripts.test.js`) skal holdes grønne; facit genereres kun igen, når en ændring er tilsigtet og forklaret.
- Lokalt: `LAU_VAR=./var LAU_JOBS=0 npm start` (kopiér `data/*.json` og `kalender/` til `./var` først) → `http://localhost:8080/`.

**Data og sikkerhed**
- **Ingen persondata i git** – heller ikke krypteret. Noter handler om foreningen ("formanden"), ikke enkeltpersoner.
- **Ingen adgangskoder** i stamdata/kontaktoplysninger; skriv hvem der har dem.
- **Adminkoden, APIFY_TOKEN og GitHub-tokens** skrives aldrig i repoet, i commits, i chat eller i HANDOFF – kun som
  secrets (GitHub/Cloudflare) eller i `/etc/lau/lau.env` på serveren.
- **Dobbelt scraping koster Apify-kreditter**: når serveren kører `sync`, skal `LAU_SERVER = 1` være sat i GitHub.
- Skiftet skal kunne **fortrydes** (`LAU_SERVER = 0`, fjern `flyttetTil`) – men ændringer på serveren kommer ikke tilbage til git.

**Arbejdsgang (Claude)**
- Udvikl på den tildelte gren, commit med klare danske beskeder, push, og hold PR'en grøn (draft indtil Emil siger andet).
- Efter 3 runder med "virker stadig ikke": stop, navngiv den antagelse der kan være forkert, og stil ét diagnostisk spørgsmål.
- Ved reel tvetydighed: ét kort afklarende spørgsmål. Når der bedes om muligheder: 2–4 rangerede med anbefaling først.
- Svar kortfattet.
