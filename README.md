# LAU – lokalforeningernes aktiviteter

Kort over Liberal Alliances Ungdoms lokalforeninger og landsforeningen med kommende aktiviteter (det næste kvartal, regnet fra i dag, vises direkte på kortet). Klik på en forening for at zoome ind og åbne et panel med dens kommende og tidligere arrangementer. Tidligere arrangementer vises offentligt (panel, kortlaget "Afholdte aktiviteter", kalenderen og .ics-filerne) højst et år tilbage; admins ser alle. HB-godkendelse, rettelser, noter og statistik kræver [adminlogin](#adminlogin).

**Side:** https://irate4147.github.io/lau-kort/ – link direkte til en forening med `#Navn`, fx `#Næstved`.

## Sådan hænger det sammen

1. Google Apps Scriptet i regnearket "LAU – begivenheder" kører Apifys Facebook Events Scraper hver mandag på foreningernes `upcoming_hosted_events`.
2. GitHub Action (`.github/workflows/sync.yml`) kører mandag formiddag (én gang om ugen, ikke ved kodeændringer – ellers manuelt via Actions): `scripts/sync.py` henter resultaterne af nye kørsler fra Apify (ingen ekstra scraping), fletter dem ind i `data/events.json` og committer dem.
3. Siden (`index.html`, `app.js`; ret `?v=` i `index.html`, når `app.js`/`style.css` ændres, så browsere ikke blander gammel og ny kode) er et fuldskærmskort (MapLibre GL med OpenFreeMap/OpenStreetMap-grundkort, ingen API-nøgle) med et sidepanel til venstre. Den læser `data/` (direkte fra repoet via raw.githubusercontent.com, så data er friske) og beregner status og analyser i browseren.

Facebook viser kun kommende begivenheder i de ugentlige kørsler. Afholdte aktiviteter før 28. sep. 2026 hentes med en engangskørsel på foreningernes `past_hosted_events`:
Actions → "Hent historik" → *Run workflow* (standard fra 1. januar i år; højst 20 begivenheder pr. side, så Apify-forbruget er begrænset). Allerede hentede sider springes over. Ramte en side loftet, og lå alle de hentede i perioden (fx Roskilde og København), mangler der ældre begivenheder – så henter næste kørsel kun den side igen med dobbelt loft (20 → 40 → 80 …).
Lokalt: `APIFY_TOKEN=... python3 scripts/sync.py --historik [ÅÅÅÅ-MM-DD]`. Begivenheder hentet på den måde får `"historisk": true` og tæller ikke med i "varsel".

En forening kan have flere Facebook-sider: `"facebook_ekstra": ["…"]` i `data/foreninger.json` (fx Fyns tidligere Odense-side). Begivenheder derfra hører til foreningen, og "Hent historik" holder styr på hver side for sig – en ny side hentes, selvom foreningens hovedside allerede er hentet, og foreningen regnes først som dækket, når alle dens sider er hentet. Skal en ekstra side også med i de ugentlige kørsler, skal den tilføjes i regnearket. En ekstra side kan også angives som `{"url": "…", "begivenheder": ["https://www.facebook.com/events/…/", …]}` – så henter historikken kun de begivenheder (én kørsel med `maxEvents` = antallet) i stedet for sidens tidligere begivenheder, hvilket sparer Apify-forbrug.

Har en forening ikke brug for historikken (fx ingen arrangementer i år), kan `"historik_fra": "ÅÅÅÅ-MM-DD"` sættes i `data/foreninger.json`: så regnes dens data som komplette fra den dato, og "Hent historik" springer den over.

## Kalender

Knappen **📅 Kalender** over kortet (eller *Kalender* under Visninger) viser/skjuler en månedskalender øverst til højre. Vælg en eller flere lokalforeninger (valget huskes i browseren) – landsforeningens arrangementer er altid med. Klik på en dag for dens arrangementer.

**Tilføj til din kalender:** `scripts/kalender.py` skriver offentlige iCalendar-filer til `kalender/`, som man kan abonnere på (Google Kalender, Apple Kalender, Outlook – de opdateres automatisk):

- `<forening>.ics` – foreningen + landsforeningen (fx `naestved.ics`; æ/ø/å → ae/oe/aa)
- `<forening>-kun.ics` + `landsforeningen.ics` – til flere foreninger, så landsforeningen ikke kommer med flere gange
- `alle.ics` – alle arrangementer

Linket er fx `https://irate4147.github.io/lau-kort/kalender/naestved.ics` (Pages, ikke raw.githubusercontent.com – den sender `Content-Type: text/plain`, som bl.a. Google Kalender afviser). Filerne skrives igen af alle tre workflows (også når rettelser eller `data/foreninger.json` ændres). Rettelser anvendes; skjulte og fra Facebook fjernede arrangementer udelades, aflyste markeres som aflyst.

Sidepanelet har disse faner:

- **Oversigt** – det næste kvartal og alle foreninger (klik for foreningspanelet). Admins ser også statistik (aktive i kvartalet, afholdte, aktivitet pr. forening).
- **Visninger** – farvning (aktivitet nu, ingen farve; for admins også afholdt i et kvartal) og til/fra for næsten alt på kortet: begivenhedsbokse, aktivitetspunkter, landsforeningens og aflyste aktiviteter, afholdte aktiviteter, foreningsnavne, grænser, kommunenavne, grundkortets stednavne og tegnforklaringen. Valgene huskes i browseren.
- **HB** (kun admins) – alle HB-visninger (se nedenfor).
- **Arrangementer** (kun admins) – alle arrangementer med filtre og redigering (se "Rettelser").
- **🔒 Log ind / Admin** – adminlogin; efter login: GitHub-forbindelse og analyser (se "Adminlogin").

## Rettelser af arrangementer

Under fanen **Arrangementer** kan man rette det, Facebook ikke ved: bekræfte at et arrangement blev afholdt (✓ Afholdt), markere det som ikke afholdt, skjule dubletter/ikke-LAU-arrangementer, rette titel, dato, sted og forening, notere faktisk fremmøde – og tilføje arrangementer, der aldrig lå på Facebook.

- Kun admins kan rette. Alle rettelser (`{"<id>": {status, navn, forening, start, slut, sted, deltagere, note, manuel, rettet}}`) ligger krypteret i `data/admin/rettelser.krypt.json` og går forud for de hentede data. `data/rettelser.json` er den offentlige del **uden `note` og `deltagere`** (skrives af `scripts/admin.py`), så det offentlige kort og kalenderne viser aflyste, skjulte, flyttede og manuelle arrangementer rigtigt. `scripts/sync.py` rører aldrig filerne; siden og `scripts/hb.py` anvender dem med samme regler.
- **Gem for alle:** forbind GitHub (fanen Admin eller Arrangementer) med et fine-grained token (kun dette repo, *Contents: Read and write*). Tokenet gemmes kun i browseren; hver rettelse krypteres og committes direkte til `main`, og en push af filen starter "Beregn HB-prognose" (`.github/workflows/hb.yml`, ingen Apify), der skriver den offentlige del og beregner HB-prognosen igen. Uden token gemmes rettelserne kun i browseren, indtil man forbinder.
- Titel, dato, sted, forening og status bliver offentlige; noter og fremmøde kan kun admins se.

## HB-godkendelse

Alt om HB er fortroligt og kun for admins.

- `data/admin/hb.krypt.json` (krypteret): kriterierne fra Organisationshåndbogen (8.2) og årets HB-status pr. forening (fra overblikket på Drive, og for de røde foreninger efter gennemgang af deres mappe). Ret den med `scripts/admin.py dekrypter hb` → ret `privat/hb.json` → `scripts/admin.py krypter hb` (se "Adminlogin").
- `scripts/hb.py [ÅR]` (kræver `ADMIN_KODE`) sammenholder `data/events.json` med kvartalskravet (mindst ét afholdt arrangement pr. kvartal; om det er fagligt, vurderes ikke) og skriver `data/admin/hb_<ÅR+1>.krypt.json` med status pr. kvartal (`ja`, `nej`, `ukendt`, `planlagt`, `mangler`), en prognose og begrundelser. Kører automatisk efter den ugentlige sync.
  Et kvartal bliver kun `nej`, når data dækker hele kvartalet (se `data_fra`, pr. forening: historikken tæller kun, hvor hentningen lykkedes, og ramte den loftet på 20 begivenheder, kun fra den ældste hentede), så manglende historik giver `ukendt` i stedet for et forkert nej.
- Fanen **HB**: farv kortet efter HB-godkendelse, skravér de foreninger magenta, der ikke kan godkendes (oven på enhver farvning), antal pr. kategori og en tabel med status pr. kvartal for hver forening. Kategorierne (bedst først):
  1. aktivitet i alle kvartaler indtil nu inkl. det indeværende + planlagt arrangement i næste kvartal
  2. aktivitet i alle kvartaler indtil nu inkl. det indeværende
  3. aktivitet i alle tidligere kvartaler; det indeværende har et planlagt arrangement
  4. aktivitet i alle tidligere kvartaler; intet planlagt i det indeværende endnu
  5. mangler aktivitet i et afsluttet kvartal – kan ikke godkendes
  
  (plus "historik mangler", når data ikke dækker et kvartal). Siden beregner det selv med samme regel som `hb.py`, og foreningspanelet har en sektion med status pr. kvartal og årets HB-status.

## Ændringer

- **Foreninger, Facebook-sider og kommuner:** `data/foreninger.json`. Nye Facebook-sider skal også tilføjes i fanen "Foreninger" i regnearket, ellers bliver de ikke scrapet.
- **Kort:** `geo/kommuner.topo.json` er DAWA's kommunegrænser, forenklet med mapshaper og påført en `forening`-egenskab.
- Secrets `APIFY_TOKEN` og `ADMIN_KODE` (se "Adminlogin") skal være sat i repoets indstillinger.

## Udvidelser

`app.js` er bygget op om registre, så nye funktioner kan tilføjes uden at ændre resten. Sektioner, lag og sorteringer med `admin: true` vises kun for admins:

- **Panelsektioner** – `LAU.registerSection({id, titel, synlig(f), render(f), efter(el, f)}, {efter: 'kommende'})`.
  Indbyggede: `kommende` og `stamdata` (offentlige) samt `hb`, `aar`, `noegletal`, `typer`, `tilkendegivelser`, `geografi`, `ugedage` og `noter` (admin).
- **Kortlag** – `LAU.registerLayer({id, label, toggle, standard, gruppe, hint, tilgaengelig(), synlig(ctx), tegn(api, ctx)})`, hvor `api.source(navn, geojson)` og `api.layer(maplibre-lagspec)` tilføjer lag, der fjernes og tegnes igen automatisk, og `ctx = {selected, zoomed, map}`.
  Lag med `toggle: true` får automatisk en til/fra-knap under fanen Visninger (`gruppe: 'aktiviteter'` eller `'kort'`) eller HB (`gruppe: 'hb'`). Indbyggede: `kommunenavne`, `afholdte`, `hb` (admin), `medlemmer` (admin).
- **Analyser** (fanen Admin, kun admins) – `LAU.registerAnalyse({id, titel, beskrivelse, render() → html, efter(el)})`. Indbygget: `foreninger` (sorterbar tabel med aktivitet, tilkendegivelser og fremmøde pr. forening).
- **Fortrolige data** – `LAU.admin.erAdmin()`, `await LAU.admin.hent('navn')` (dekrypterer `data/admin/navn.krypt.json`) og `await LAU.admin.gem('navn', gammel => ny, 'commit-besked')` (krypterer og committer; kræver GitHub-forbindelse). I Python: `admin.laes('navn')` / `admin.skriv('navn', data)` fra `scripts/admin.py`.

**Stamdata** (formand, telefon osv.) er offentlige og kan lægges i `data/foreninger.json` som `"stamdata": {"Formand": "…", "Telefon": "…"}`.
Fortrolige stamdata (kun for admins) lægges i `data/admin/stamdata.krypt.json` som `{"Næstved": {"Telefon": "…"}}`, og medlemstal pr. by (kortlaget "Medlemmer pr. by") i `data/admin/medlemmer.krypt.json` som `[{"forening": "Fyn", "by": "Odense", "lat": 55.40, "lng": 10.39, "antal": 42}]`.

## Adminlogin

Alt i repoet er offentligt (også via GitHub Pages), så fortrolige data ligger **krypteret** i `data/admin/<navn>.krypt.json` (AES-256-GCM). Nøglen udledes af adminkoden (PBKDF2-SHA256, 600.000 runder, saltet i `data/admin/noegle.json`). Koden ligger aldrig i repoet – kun som GitHub-secret og hos admins. Uden login kan ingen læse filerne, heller ikke ved at hente dem direkte.

**Offentligt:** aktiviteterne, farvningen "Aktivitet nu", aktiviteter på kortet, kortet, kalenderen og stamdata.
**Kun admins:** HB-godkendelse, arrangementer og rettelser (inkl. noter og fremmøde), noter om foreningerne, nøgletal, statistik og analyser.

| Fil i `data/admin/` | Indhold |
|---|---|
| `noegle.json` | salt og kontrolværdi (ikke hemmelig) |
| `hb.krypt.json` | årets HB-status og kriterier (tidligere `data/hb.json`) |
| `hb_<år>.krypt.json` | HB-prognosen fra `scripts/hb.py` |
| `rettelser.krypt.json` | alle rettelser inkl. noter og fremmøde |
| `noter.krypt.json` | noter pr. forening |
| `stamdata.krypt.json`, `medlemmer.krypt.json` | valgfrie (se ovenfor) |

**Opsætning (én gang):**
1. Vælg en lang adminkode (fx 5–6 tilfældige ord). Styrken af koden er hele beskyttelsen.
2. Settings → Secrets and variables → Actions → *New repository secret*: `ADMIN_KODE`.
3. Actions → "Admin" → *Run workflow* (`klargoer`). Den opretter nøglen, krypterer `data/hb.json`, fjerner klartekstfilerne (`data/hb.json`, `data/hb_<år>.json`), opretter de krypterede rettelser og beregner HB-prognosen.
4. Del koden med de andre admins. De logger ind under **🔒 Log ind** ("Husk mig" gemmer login'et i browseren; ellers glemmes det, når fanen lukkes). For at gemme rettelser og noter for alle skal de også forbinde GitHub (se "Rettelser").

**Skift kode** (fx når en admin stopper): opret secret `ADMIN_KODE_NY`, kør "Admin" med `skift-kode`, sæt `ADMIN_KODE` til den nye kode og slet `ADMIN_KODE_NY`. Alt krypteres igen, og alle logges ud.

**Lokalt** (kræver `pip install cryptography`):

```sh
export ADMIN_KODE='…'
python3 scripts/admin.py vis hb          # se indholdet
python3 scripts/admin.py dekrypter hb    # -> privat/hb.json (ignoreres af git)
python3 scripts/admin.py krypter hb      # privat/hb.json -> data/admin/hb.krypt.json
```

**Bemærk:** Git-historikken indeholder stadig de gamle klartekstudgaver af `data/hb.json` og `data/hb_2027.json` fra før adminlogin'et. Skal de væk, skal historikken omskrives (eller repoet gøres privat).
