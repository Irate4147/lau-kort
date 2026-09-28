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
- `<forening>-kun.ics` + `landsforeningen.ics` – byggesten til flere foreninger (flettes til én kalender, se nedenfor)
- `alle.ics` – alle arrangementer

Man får altid **én** kalender: ingen valgt → `alle.ics`, én forening → `<forening>.ics`, flere foreninger (vilkårlig kombination) → én flettet kalender med de valgte foreninger + landsforeningen, hvor fælles arrangementer kun kommer med én gang.

### Én kalender for flere foreninger

Pages kan kun levere faste filer, og 23 foreninger giver millioner af kombinationer. Derfor:

- **Uden server** (standard): knappen *Hent som én kalenderfil (.ics)* fletter filerne i browseren og gemmer én fil. Den importeres i kalenderen, men opdateres ikke af sig selv.
- **Med server** (anbefalet): `kalender-server/worker.js` er en lille Cloudflare Worker (gratis), der fletter filerne ved hvert opslag, fx `https://<worker>/aalborg+fyn.ics`. Så kan man abonnere på den ene kalender, og den opdateres automatisk. Samme worker bruges til "Gem for alle" (se "Rettelser").
  1. Opret en gratis konto på [cloudflare.com](https://dash.cloudflare.com) → *Workers & Pages* → *Create* → *Create Worker* → *Deploy*.
  2. *Edit code*: erstat koden med indholdet af `kalender-server/worker.js` → *Deploy*. Adressen er fx `https://lau-kalender.<konto>.workers.dev`.
  3. Sæt `kalenderServer: 'https://lau-kalender.<konto>.workers.dev'` i `CONFIG` øverst i `app.js`.

Linket er fx `https://irate4147.github.io/lau-kort/kalender/naestved.ics` (Pages, ikke raw.githubusercontent.com – den sender `Content-Type: text/plain`, som bl.a. Google Kalender afviser). Filerne skrives igen af alle tre workflows (også når rettelser eller `data/foreninger.json` ændres). Rettelser anvendes; skjulte og fra Facebook fjernede arrangementer udelades, aflyste markeres som aflyst.

Sidepanelet har disse faner:

- **Oversigt** – det næste kvartal og alle foreninger (klik for foreningspanelet). Admins ser også boksen "Kræver handling nu" øverst (se [Analyser og advarsler](#analyser-og-advarsler)) og statistik (aktive i kvartalet, afholdte, [momentum](#momentum), aktivitet pr. forening).
- **Visninger** – farvning (aktivitet nu, ingen farve; for admins også momentum og afholdt i et kvartal) og til/fra for næsten alt på kortet: begivenhedsbokse, aktivitetspunkter, landsforeningens og aflyste aktiviteter, afholdte aktiviteter, foreningsnavne, grænser, kommunenavne, grundkortets stednavne og tegnforklaringen. Valgene huskes i browseren.
- **HB** (kun admins) – alle HB-visninger (se nedenfor).
- **Arrangementer** (kun admins) – alle arrangementer med filtre og redigering (se "Rettelser").
- **Analyser** (kun admins) – listen over analyser; hver åbnes som en fane i et vindue over højre del af kortet (se [Analyser og advarsler](#analyser-og-advarsler)).
- **🔒 Log ind / Admin** – adminlogin; efter login: "Gem for alle" (se "Adminlogin").

## Momentum

Kun for admins. En tidlig sundhedsindikator for, om en lokalforening er godt på vej med at afholde arrangementer – og et tidligt varsel om, at den har brug for hjælp.

Hver forening måles mod **sin egen rytme**: hvor mange dage der normalt går mellem dens arrangementer. Rytmen er den gennemsnitlige afstand mellem afholdte arrangementer det seneste år (så langt data dækker), men mindst 31 dage (en stor forening skal holde mindst ét om måneden) og højst 61 dage (en lille kan nøjes med hver anden måned). Med under 120 dages historik bruges 61 dage. Rytmen kan sættes fast med `"momentum_rytme": 31` i `data/foreninger.json`.

| Niveau | Regel (d = dage siden sidste arrangement, R = rytmen) |
|---|---|
| ↗ Godt i gang | d ≤ R og noget i kalenderen de næste 60 dage |
| → Stabil | d ≤ R, intet i kalenderen endnu (begivenheder oprettes ofte sent) |
| ⤴ Går fremad | d > R, men noget i kalenderen |
| ↘ Mister fart | R < d ≤ 2R og intet i kalenderen |
| ⚠ Brug for hjælp | d > 2R og intet i kalenderen |

(plus "historik mangler", når intet er afholdt, og data højst dækker R dage.) Advarslerne forklarer niveauet: dage siden sidste mod rytmen, intet i kalenderen, færre afholdt end de 60 dage før og aflyste arrangementer.

Oversigten har antal pr. niveau, en tidslinje for alle foreninger (sidste og næste arrangement, med rytmen i baggrunden) og listen "Kræver opmærksomhed"; foreningspanelet har en Momentum-sektion; kortet kan farves efter momentum (Visninger), og foreningslisten kan sorteres efter det. Grænserne ligger i `MOM_RYTME_MIN`, `MOM_RYTME_MAX`, `MOM_BAGUD` og `MOM_FREMAD` i `app.js`.

## Rettelser af arrangementer

Under fanen **Arrangementer** kan man rette det, Facebook ikke ved: bekræfte at et arrangement blev afholdt (✓ Afholdt), markere det som ikke afholdt, skjule dubletter/ikke-LAU-arrangementer, rette titel, dato, sted og forening, notere faktisk fremmøde – og tilføje arrangementer, der aldrig lå på Facebook.

- Kun admins kan rette. Alle rettelser (`{"<id>": {status, navn, forening, start, slut, sted, deltagere, note, manuel, rettet}}`) ligger krypteret i `data/admin/rettelser.krypt.json` og går forud for de hentede data. `data/rettelser.json` er den offentlige del **uden `note` og `deltagere`** (skrives af `scripts/admin.py`), så det offentlige kort og kalenderne viser aflyste, skjulte, flyttede og manuelle arrangementer rigtigt. `scripts/sync.py` rører aldrig filerne; siden og `scripts/hb.py` anvender dem med samme regler.
- **Gem for alle:** går gennem LAU-serveren (`kalender-server/worker.js`, samme Cloudflare Worker som kalenderen), så admins hverken skal have en GitHub-konto eller et token – adminlogin'et er nok. Hver rettelse krypteres i browseren og committes af serveren direkte til `main`, og en push af filen starter "Beregn HB-prognose" (`.github/workflows/hb.yml`, ingen Apify), der skriver den offentlige del og beregner HB-prognosen igen. Er serveren ikke sat op, gemmes rettelserne kun i browseren.
- **Sådan virker adgangen:** af adminkoden udledes en skrivenøgle (HMAC af nøglen); `data/admin/noegle.json` indeholder kun dens SHA-256 (`skriv`, skrevet af `scripts/admin.py klargoer`). Serveren committer kun for den, der kender skrivenøglen, og kun krypterede filer i `data/admin/` – GitHub-tokenet ligger alene som secret i Cloudflare. Skiftes adminkoden, virker den gamle skrivenøgle ikke længere.
- **Opsætning (én gang):**
  1. GitHub → Settings → Developer settings → [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new): *Repository access* → *Only select repositories* → `lau-kort`; *Repository permissions* → **Contents: Read and write** (Metadata: Read-only følger automatisk). Vælg en udløbsdato, og husk at forny tokenet.
  2. Cloudflare → *Workers & Pages* → kalender-workeren → *Edit code*: erstat koden med `kalender-server/worker.js` → *Deploy*.
  3. Workeren → *Settings* → *Variables and Secrets* → *Add* → type **Secret**, navn `GITHUB_TOKEN`, værdi: tokenet fra trin 1.
  4. Actions → "Admin" → *Run workflow* (`klargoer`), så `skriv` kommer i `data/admin/noegle.json` (ellers sker det ved næste sync).
  5. `adminServer` i `CONFIG` øverst i `app.js` er workerens adresse (som `kalenderServer`).
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

## Analyser og advarsler

Alt her er kun for admins. Fanen **Analyser** viser listen over analyser; klik på en for at åbne den som en fane i vinduet til højre. Som i en browser kan flere være åbne, hver lukkes med sit ×, og × i hjørnet (eller Esc) lukker vinduet. Vinduet og kalenderen deler pladsen: åbnes vinduet, lukkes kalenderen, og den kommer igen, når vinduet lukkes.

Tidskritiske ting, der skal reageres på, før det er for sent, står i boksen **Kræver handling nu** øverst i oversigten (over Momentum) og øverst i foreningspanelet. Boksen er skjult, når intet haster.

Analyserne ligger i `udvidelser/` (se [Udvidelser](#udvidelser)):

- **Aktivitet pr. forening** (indbygget) – sorterbar tabel med aktivitet, tilkendegivelser, fremmøde og faktor pr. forening.
- **Månedsrapport** (`scripts/rapport.py`, `udvidelser/maanedsrapport.js`) – se nedenfor.
- **HB-risiko** (`udvidelser/hb-risiko.js`) – advarer, før det indeværende kvartal slutter uden et afholdt arrangement, så HB-godkendelsen næste år ikke går tabt. Hver lokalforening måles på kvartalet (afholdt, planlagt eller intet), dagene til kvartalets sidste dag og sin [rytme](#momentum):

  | Niveau | Regel (d = dage tilbage, R = rytmen) |
  |---|---|
  | ! Kritisk | intet afholdt eller planlagt, og d ≤ 14 eller d ≤ R/2 |
  | ⏱ Advarsel | intet afholdt eller planlagt, og d ≤ max(45, R) – eller kvartalet afhænger af planlagte arrangementer, og d ≤ 21 |
  | Hold øje | som ovenfor, men der er god tid |
  | Tabt | et afsluttet kvartal er uden afholdt arrangement – kan ikke HB-godkendes (ingen advarsel) |

  (plus "kan ikke vurderes", når data ikke dækker kvartalet, og "i hus".) Kritiske og advarsler står i "Kræver handling nu" (højst én pr. forening, med kvartalets sidste dag som frist; i 4. kvartal er det også HB-fristen). Analysen viser alle lokalforeninger sorteret efter risiko med status pr. kvartal, næste planlagte arrangement og en forklaring. Grænserne ligger i `GRAENSE` i filen; beregningen kan genbruges som `LAU.hbRisiko(f)`.
- **Fremmøde vs. tilkendegivelser** (`udvidelser/fremmoede.js`) – fra tilkendegivelser ("deltager" + "interesseret") til forventet fremmøde. Omregningsfaktoren er fremmøde ÷ tilkendegivelser for afholdte arrangementer, hvor fremmødet er noteret under Arrangementer: medianen af foreningens egne (mindst 2), ellers arrangementer i samme kategori på tværs af foreningerne (mindst 2), ellers alle. Forventet fremmøde = tilkendegivelser × faktor, som interval ud fra kvartilerne fra 4 målinger, ellers "ca."; grundlaget og antallet vises altid. Foreningspanelet har sektionen *Fremmøde* (efter Nøgletal) med registreret fremmøde, faktor, forventet fremmøde for de kommende arrangementer og et link til de afholdte arrangementer, der mangler fremmøde (filteret *Afholdte uden fremmøde* under Arrangementer). Analysen har tal pr. forening og kategori og de næste 30 dages arrangementer med forventet fremmøde. Tilkendegivelserne stiger typisk frem mod arrangementet, så forventningen for arrangementer langt ude er i underkanten.
- **Kommuner uden aktivitet** (`udvidelser/hvide-pletter.js`) – kortlaget "Kommuner uden aktivitet (12 mdr.)" (Visninger → Kortet) skraverer okker de kommuner i en lokalforenings område, hvor foreningen hverken har afholdt arrangementer det seneste år eller har noget planlagt (via arrangementets kommune; aflyste og fjernede tæller ikke, landsforeningens heller ikke). Kendes medlemstallene (`medlemmer.krypt.json`), placeres hver by i sin kommune (punkt-i-polygon), og kommuner med medlemmer skraveres tættere med antallet. Analysen viser pr. forening kommunerne med og uden aktivitet og medlemmerne i dem uden, sorteret efter mest at hente; "Vis på kortet" slår laget til og zoomer ind på foreningen. Kun foreninger med Facebook-side er med. Arrangementer uden kendt sted (fx online) tæller ikke, men vises som "+ N uden kendt sted".
- **Hvad virker?** (`udvidelser/hvad-virker.js`) – sammenligner tilkendegivelser for afholdte arrangementer i lokalforeningerne pr. type, ugedag, starttidspunkt (dansk tid) og varsel. For at store foreninger ikke dominerer, måles hvert arrangement mod sin forenings median (indeks = svar ÷ median; kun foreninger med mindst 3 arrangementer), og hver gruppe vises med sit medianindeks og n. Grupper med under 5 arrangementer nedtones og indgår ikke i konklusionerne. Varsel måles kun for arrangementer, der er opdaget efter indsamlingens start (som "Varsel" i nøgletallene). Tilkendegivelser er ikke fremmøde, og datagrundlaget er lille – brug det som pejlemærke, ikke facit.

### Månedsrapport

Hvad skete der i foreningerne i en måned – og hvem er faldet eller kommet op?

- `scripts/rapport.py` (kræver `ADMIN_KODE`) tager ved den første kørsel i måneden et **snapshot** af tilstanden ved månedens start: [momentum](#momentum)-niveau, rytme, HB-prognose og antal afholdte/planlagte arrangementer pr. forening. Momentum og HB-prognose beregnes med samme regler og konstanter som siden (`MOM_BAGUD`, `MOM_FREMAD`, `MOM_RYTME_MIN`, `MOM_RYTME_MAX`, dækning og rettelser).
- **Rapporten** for en måned sammenligner månedens snapshot med den næste måneds og lister pr. forening: afholdte arrangementer (dato og navn), aflyste/ikke afholdte, nye på Facebook, forsvundne fra Facebook, registreret fremmøde (fra rettelserne) samt momentum og HB-prognose fra start til slut. Øverst er totaler og højdepunkterne: faldet i momentum eller HB, uden afholdt aktivitet, nye aflysninger og forbedringer. Ved et nyt kvartal starter HB-prognosen forfra, så der tæller kun et skift til "kan ikke godkendes" som et fald.
- Alt ligger krypteret i `data/admin/rapporter.krypt.json` (`{"snapshots": {"ÅÅÅÅ-MM": …}, "rapporter": {"ÅÅÅÅ-MM": …}}`). Filen skrives kun, når indholdet er ændret.
- **Automatisk:** "Månedsrapport" (`.github/workflows/rapport.yml`) kører den 1. i måneden tidligt om morgenen; `sync.yml` og `hb.yml` kører også `rapport.py`, så rapporten for sidste måned kommer med nye rettelser og fremmøde. Manuelt: Actions → "Månedsrapport" → *Run workflow* med en måned (`ÅÅÅÅ-MM`) eller `alle`.
- Mangler et snapshot (fx fordi den første kørsel i måneden ikke var den 1.), **rekonstrueres** det ud fra data pr. den 1. og markeres `"rekonstrueret": true`: kun begivenheder, der var set på Facebook den dag (`foerst_set`), tæller som planlagte, og senere aflysninger og forsvundne begivenheder regnes som ikke sket endnu.
- Analysen **Månedsrapport**: vælg måned (nyeste først) eller "Denne måned indtil nu", der beregnes i browseren og sammenlignes med månedens snapshot. Klik på en forening for at åbne den.

Lokalt:

```sh
export ADMIN_KODE='…'
python3 scripts/rapport.py            # snapshot af denne måned + rapport for sidste måned
python3 scripts/rapport.py 2026-08    # genberegn en bestemt måned (indeværende måned: foreløbig)
python3 scripts/rapport.py alle       # genberegn alle måneder, data dækker
python3 scripts/admin.py vis rapporter
```

## Ændringer

- **Foreninger, Facebook-sider og kommuner:** `data/foreninger.json`. Nye Facebook-sider skal også tilføjes i fanen "Foreninger" i regnearket, ellers bliver de ikke scrapet.
- **Kort:** `geo/kommuner.topo.json` er DAWA's kommunegrænser, forenklet med mapshaper og påført en `forening`-egenskab.
- Secrets `APIFY_TOKEN` og `ADMIN_KODE` (se "Adminlogin") skal være sat i repoets indstillinger.

## Udvidelser

`app.js` er bygget op om registre, så nye funktioner kan tilføjes uden at ændre resten. Sektioner, lag og sorteringer med `admin: true` vises kun for admins:

- **Panelsektioner** – `LAU.registerSection({id, titel, synlig(f), render(f), efter(el, f)}, {efter: 'kommende'})`.
  Indbyggede: `kommende` og `stamdata` (offentlige) samt `momentum`, `hb`, `aar`, `noegletal`, `typer`, `tilkendegivelser`, `geografi`, `ugedage` og `noter` (admin).
- **Kortlag** – `LAU.registerLayer({id, label, toggle, standard, gruppe, hint, tilgaengelig(), synlig(ctx), tegn(api, ctx)})`, hvor `api.source(navn, geojson)` og `api.layer(maplibre-lagspec)` tilføjer lag, der fjernes og tegnes igen automatisk, og `ctx = {selected, zoomed, map}`.
  Lag med `toggle: true` får automatisk en til/fra-knap under fanen Visninger (`gruppe: 'aktiviteter'` eller `'kort'`) eller HB (`gruppe: 'hb'`). Indbyggede: `kommunenavne`, `afholdte`, `hb` (admin), `medlemmer` (admin); `hvide-pletter` (admin) kommer fra `udvidelser/`.
- **Analyser** (fanen **Analyser**, kun admins) – `LAU.registerAnalyse({id, titel, beskrivelse, render() → html, efter(el)})`. Fanen viser listen over analyser i sidepanelet; hver analyse åbnes som en fane i et stort vindue over højre del af kortet – som faner i en browser: flere kan være åbne, hver lukkes med sit ×, og krydset i hjørnet (eller Esc) lukker hele vinduet. Vinduet og kalenderen deler pladsen: åbnes vinduet, lukkes kalenderen (og kommer igen, når vinduet lukkes). Tegn igen med `renderAnalyser()`; åbn en analyse med `LAU.aabnAnalyse(id)`. Indbygget: `foreninger` (sorterbar tabel med aktivitet, tilkendegivelser og fremmøde pr. forening); resten kommer fra `udvidelser/` (se [Analyser og advarsler](#analyser-og-advarsler)).
- **Advarsler** (kun admins) – `LAU.registerAdvarsel({id, hent() → [{niveau: 'kritisk' | 'advarsel', titel, tekst?, forening?, frist?: Date, analyse?: id}]})`. Tidskritiske ting, der skal reageres på, før det er for sent: de vises øverst i oversigten i boksen "Kræver handling nu" (over Momentum; skjult, når intet haster) og øverst i foreningspanelet for den forening, de gælder.
- **Udvidelsesfiler** – `udvidelser/*.js` indlæses efter `app.js` (se `index.html`, husk `?v=`) og bruger registrene ovenfor. `app.js` starter først ved `DOMContentLoaded`, så alt er registreret, før der tegnes. Filerne kan bruge `app.js`' hjælpere (`esc`, `tile`, `hbars`, `DATA` …) direkte.
- **Fortrolige data** – `LAU.admin.erAdmin()`, `await LAU.admin.hent('navn')` (dekrypterer `data/admin/navn.krypt.json`) og `await LAU.admin.gem('navn', gammel => ny, 'commit-besked')` (krypterer og committer via LAU-serveren). I Python: `admin.laes('navn')` / `admin.skriv('navn', data)` fra `scripts/admin.py`.

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
| `rapporter.krypt.json` | månedsrapporter og snapshots fra `scripts/rapport.py` |
| `stamdata.krypt.json`, `medlemmer.krypt.json` | valgfrie (se ovenfor) |

**Opsætning (én gang):**
1. Vælg en lang adminkode (fx 5–6 tilfældige ord). Styrken af koden er hele beskyttelsen.
2. Settings → Secrets and variables → Actions → *New repository secret*: `ADMIN_KODE`.
3. Actions → "Admin" → *Run workflow* (`klargoer`). Den opretter nøglen, krypterer `data/hb.json`, fjerner klartekstfilerne (`data/hb.json`, `data/hb_<år>.json`), opretter de krypterede rettelser og beregner HB-prognosen.
4. Del koden med de andre admins. De logger ind under **🔒 Log ind** ("Husk mig" gemmer login'et i browseren; ellers glemmes det, når fanen lukkes). Rettelser og noter gemmes for alle via LAU-serveren (se "Rettelser") – der skal ikke forbindes noget.

**Skift kode** (fx når en admin stopper): opret secret `ADMIN_KODE_NY`, kør "Admin" med `skift-kode`, sæt `ADMIN_KODE` til den nye kode og slet `ADMIN_KODE_NY`. Alt krypteres igen, og alle logges ud.

**Lokalt** (kræver `pip install cryptography`):

```sh
export ADMIN_KODE='…'
python3 scripts/admin.py vis hb          # se indholdet
python3 scripts/admin.py dekrypter hb    # -> privat/hb.json (ignoreres af git)
python3 scripts/admin.py krypter hb      # privat/hb.json -> data/admin/hb.krypt.json
```

**Bemærk:** Git-historikken indeholder stadig de gamle klartekstudgaver af `data/hb.json` og `data/hb_2027.json` fra før adminlogin'et. Skal de væk, skal historikken omskrives (eller repoet gøres privat).
