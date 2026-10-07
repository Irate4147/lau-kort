# LAU – lokalforeningernes aktiviteter

Kort over Liberal Alliances Ungdoms lokalforeninger og landsforeningen med kommende aktiviteter (det næste kvartal, regnet fra i dag, vises direkte på kortet). Klik på en forening for at zoome ind og åbne et panel med dens kommende og tidligere arrangementer. Panelet er en objektvisning bygget på [kernen](kerne/README.md): tallene er ontologiens egenskaber, og sektionerne "Egenskaber" og "Forbundne objekter" viser foreningens øvrige egenskaber og links (fx antal arrangementer pr. status og kommuner) – en ny egenskab eller et nyt link i `kerne/lau.js` kommer med automatisk (admin-egenskaber kun for admins). Tidligere arrangementer vises offentligt (panel, kortlaget "Afholdte aktiviteter", kalenderen og .ics-filerne) højst et år tilbage; admins ser alle. HB-godkendelse, rettelser, noter og statistik kræver [adminlogin](#adminlogin).

**Side:** https://irate4147.github.io/lau-kort/ – link direkte til en forening med `#Navn`, fx `#Næstved`.

## Sådan hænger det sammen

1. GitHub Action (`.github/workflows/sync.yml`) kører mandag morgen (én gang om ugen, ikke ved kodeændringer – ellers manuelt via Actions): `scripts/sync.py --start` starter Apifys Facebook Events Scraper på hovedsidernes `upcoming_hosted_events` fra `data/foreninger.json` (én kørsel, højst 150 begivenheder) og venter på den. Er der allerede startet en kørsel på kommende begivenheder inden for 3 dage (fx manuelt), bruges den i stedet, så der ikke scrapes to gange.
2. Derefter henter `scripts/sync.py` resultaterne af alle nye kørsler, fletter dem ind i `data/events.json` og committer dem.
3. Siden (`index.html`, `app.js` og kernen i `kerne/` – ontologien og alle regler; ret `?v=` i `index.html`, når `app.js`/`style.css` ændres, så browsere ikke blander gammel og ny kode) er et fuldskærmskort (MapLibre GL med OpenFreeMap/OpenStreetMap-grundkort, ingen API-nøgle) med et sidepanel til venstre. Den læser `data/` (direkte fra repoet via raw.githubusercontent.com, så data er friske) og beregner status og analyser i browseren.

Facebook viser kun kommende begivenheder i de ugentlige kørsler. Afholdte aktiviteter før 28. sep. 2026 hentes med en engangskørsel på foreningernes `past_hosted_events`:
Actions → "Hent historik" → *Run workflow* (standard fra 1. januar i år; højst 20 begivenheder pr. side, så Apify-forbruget er begrænset). Allerede hentede sider springes over. Ramte en side loftet, og lå alle de hentede i perioden (fx Roskilde og København), mangler der ældre begivenheder – så henter næste kørsel kun den side igen med dobbelt loft (20 → 40 → 80 …).
Lokalt: `APIFY_TOKEN=... python3 scripts/sync.py --historik [ÅÅÅÅ-MM-DD]`. Begivenheder hentet på den måde får `"historisk": true` og tæller ikke med i "varsel".

En forening kan have flere Facebook-sider: `"facebook_ekstra": ["…"]` i `data/foreninger.json` (fx Fyns tidligere Odense-side). Begivenheder derfra hører til foreningen, og "Hent historik" holder styr på hver side for sig – en ny side hentes, selvom foreningens hovedside allerede er hentet, og foreningen regnes først som dækket, når alle dens sider er hentet. De ugentlige kørsler scraper kun hovedsiden (`"facebook"`). En ekstra side kan også angives som `{"url": "…", "begivenheder": ["https://www.facebook.com/events/…/", …]}` – så henter historikken kun de begivenheder (én kørsel med `maxEvents` = antallet) i stedet for sidens tidligere begivenheder, hvilket sparer Apify-forbrug.

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
- **Visninger** – farvning (aktivitet nu, ingen farve; for admins også momentum, afholdt i et kvartal, HB-godkendelse og HB-risiko) og til/fra for næsten alt på kortet: begivenhedsbokse, aktivitetspunkter, landsforeningens og aflyste aktiviteter, afholdte aktiviteter, foreningsnavne, grænser, kommunenavne, grundkortets stednavne og tegnforklaringen. Valgene huskes i browseren. Farvningerne bygger på ontologien: enhver kategorisk egenskab på Forening i `kerne/lau.js` kan farve kortet og dukker automatisk op her (`adgang: 'admin'` = kun for admins). Farver, gennemsigtighed og tekster pr. værdi står i `FARVER` i `app.js`; en egenskab uden egne farver får en standardpalet.
- **HB** (kun admins) – alle HB-visninger (se nedenfor).
- **Arrangementer** (kun admins) – alle arrangementer med filtre og redigering (se "Rettelser").
- **Analyser** (kun admins) – listen over analyser; den valgte vises i et vindue over højre del af kortet (se [Analyser og advarsler](#analyser-og-advarsler)).
- **🔒 Log ind / Admin** – adminlogin; efter login: "Gem for alle" (se "Adminlogin").

## Momentum

Kun for admins. En tidlig sundhedsindikator for, om en lokalforening er godt på vej med at afholde arrangementer – og et tidligt varsel om, at den har brug for hjælp.

**Målet er det samme for alle lokalforeninger uanset størrelse: mindst ét arrangement om måneden.** Momentum ser på tre ting:

- **Dage siden sidste arrangement** – over 31 dage (en måned) er et varsel, over 45 dage er alvorligt.
- **Afholdt de seneste 3 måneder (90 dage)** – målet er 3. Fx "2 af 3".
- **Mod foreningens normale niveau** – snittet pr. 3 måneder i året før. Mindst 1 flere end normalt er et godt tegn (↑), mindst 1 færre er et tegn på, at foreningen er ved at tabe pusten (↓). Kræver mindst 3 måneders data før perioden.

| Niveau | Regel (d = dage siden sidste arrangement, kalender = noget planlagt de næste 30 dage) |
|---|---|
| ↗ Godt i gang | d ≤ 31 og mindst 3 afholdt de seneste 3 måneder |
| → På sporet | d ≤ 31, men under 3 afholdt de seneste 3 måneder |
| ⤴ Noget på vej | d > 31, men noget i kalenderen |
| ↘ Mister fart | 31 < d ≤ 45 og intet i kalenderen – eller d ≤ 31, under målet, færre end normalt og intet i kalenderen |
| ⚠ Brug for hjælp | d > 45 og intet i kalenderen |

(plus "historik mangler", når intet er afholdt, og data højst dækker 45 dage.) Advarslerne forklarer niveauet: dage siden sidste, antal af 3 de seneste 3 måneder, kalenderen, flere/færre end normalt og aflyste arrangementer.

Oversigten har antal pr. niveau, en tidslinje for alle foreninger (sidste og næste arrangement; grøn baggrund = inden for en måned, gul = 32–45 dage) og listen "Kræver opmærksomhed"; foreningspanelet har en Momentum-sektion; kortet kan farves efter momentum (Visninger), og foreningslisten kan sorteres efter det. Grænserne ligger i `MOMENTUM` i `kerne/regler.js` (`VINDUE`, `MAAL`, `MAANED`, `HJAELP`, `FREMAD` og `NORMAL`) – samme regel for siden og `scripts/rapport.py`.

## Rettelser af arrangementer

Under fanen **Arrangementer** kan man rette det, Facebook ikke ved: bekræfte at et arrangement blev afholdt (✓ Afholdt), markere det som ikke afholdt, skjule dubletter/ikke-LAU-arrangementer, rette titel, dato, sted og forening, notere faktisk fremmøde – og tilføje arrangementer, der aldrig lå på Facebook.

- Kun admins kan rette. Alle rettelser (`{"<id>": {status, navn, forening, start, slut, sted, deltagere, note, manuel, rettet}}`) ligger krypteret i `data/admin/rettelser.krypt.json` og går forud for de hentede data. `data/rettelser.json` er den offentlige del **uden `note` og `deltagere`** (skrives af `scripts/admin.py`), så det offentlige kort og kalenderne viser aflyste, skjulte, flyttede og manuelle arrangementer rigtigt. `scripts/sync.py` rører aldrig filerne; siden og scriptene (`hb.py`, `rapport.py`, `kalender.py`) anvender dem med kernens regel (`anvendRettelser()` i `kerne/regler.js`).
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
- `scripts/hb.py [ÅR]` (kræver `ADMIN_KODE`) sammenholder `data/events.json` med kvartalskravet (mindst ét afholdt arrangement pr. kvartal; om det er fagligt, vurderes ikke) og skriver `data/admin/hb_<ÅR+1>.krypt.json` med status pr. kvartal (`ja`, `nej`, `ukendt`, `planlagt`, `mangler`), en prognose og begrundelser. Kører automatisk efter den ugentlige sync. Reglerne er kernens (`hbKvartal()`/`hbPrognose()` i `kerne/regler.js`, de samme som siden): scriptet læser og krypterer filerne og kalder kernen med Node (`scripts/kerne.js`, se [Python-scripts og kernen](#python-scripts-og-kernen)). Et arrangement tæller som afholdt, når det er slut. I filen hedder prognoserne `alle_plus_naeste` og `ikke_godkendt` (på siden `plus_naeste` og `ikke`).
  Et kvartal bliver kun `nej`, når data dækker hele kvartalet (se `data_fra`, pr. forening: historikken tæller kun, hvor hentningen lykkedes, og ramte den loftet på 20 begivenheder, kun fra den ældste hentede), så manglende historik giver `ukendt` i stedet for et forkert nej.
- Fanen **HB**: farv kortet efter HB-godkendelse, skravér de foreninger magenta, der ikke kan godkendes (oven på enhver farvning), antal pr. kategori og en tabel med status pr. kvartal for hver forening. Kategorierne (bedst først):
  1. aktivitet i alle kvartaler indtil nu inkl. det indeværende + planlagt arrangement i næste kvartal
  2. aktivitet i alle kvartaler indtil nu inkl. det indeværende
  3. aktivitet i alle tidligere kvartaler; det indeværende har et planlagt arrangement
  4. aktivitet i alle tidligere kvartaler; intet planlagt i det indeværende endnu
  5. mangler aktivitet i et afsluttet kvartal – kan ikke godkendes
  
  (plus "historik mangler", når data ikke dækker et kvartal). Siden og `hb.py` bruger samme regel (kernen), og foreningspanelet har en sektion med status pr. kvartal og årets HB-status.

## Analyser og advarsler

Alt her er kun for admins. Fanen **Analyser** viser listen over analyser; klik på en for at vise den i vinduet til højre, og klik på en anden for at skifte. × i hjørnet (eller Esc) lukker vinduet. Vinduet og kalenderen deler pladsen: åbnes vinduet, lukkes kalenderen, og den kommer igen, når vinduet lukkes.

Tidskritiske ting, der skal reageres på, før det er for sent, står i den røde boks **Kræver handling nu** øverst i oversigten (over Momentum) og øverst i foreningspanelet. Lige under står den grønne boks **Godt gået** med det, der er værd at fejre (se "Hvad virker?"). Boksene er skjult, når de er tomme.

Analyserne ligger i `udvidelser/` (se [Udvidelser](#udvidelser)). Deres **regler** står i kernen (`kerne/regler.js` og `kerne/rapport.js`) og er egenskaber i ontologien (`kerne/lau.js`) – fx `hbRisiko` på en forening, `hvidPlet` på en kommune og `deltagerIndeks` på et arrangement – så de også kan bruges i filtre, grupperinger og på kortet i **Egen analyse**. Filerne i `udvidelser/` er kun brugerfladen (tekster, tabeller, diagrammer og advarsler). `test/analyser.test.js` sikrer, at analysernes output er uændret på faste datoer (facit: `node test/lav-analyse-facit.js`).

- **Aktivitet pr. forening** (indbygget) – sorterbar tabel med aktivitet, tilkendegivelser og fremmøde pr. forening.
- **Månedsrapport** (`scripts/rapport.py`, `udvidelser/maanedsrapport.js`) – se nedenfor.
- **HB-risiko** (`udvidelser/hb-risiko.js`) – viser på få sekunder, hvem der skal gøre noget – hvad og hvornår – for at nå HB-godkendelsen næste år (mindst ét afholdt arrangement i hvert kvartal), og hvem der er i sikkerhed. Øverst står, hvornår det indeværende kvartal slutter ("Q3 slutter onsdag 30. sep. – om 2 dage"), én sætning om, hvem der skal handle, og en tidslinje over året (Q1–Q4) med i dag markeret. Derunder er lokalforeningerne delt i spande i den rækkefølge, man skal handle:
  1. **Skal afholde et arrangement senest …** – intet afholdt eller planlagt i kvartalet (kritisk eller advarsel)
  2. **Afhænger af et planlagt arrangement** – intet afholdt endnu, kun noget i kalenderen, og kvartalet slutter snart
  3. **Hold øje – god tid endnu**
  4. **I hus** – mindst ét afholdt; med det, der er planlagt i næste kvartal ("intet planlagt i Q4 endnu" står først)
  5. **Kan ikke godkendes** – et afsluttet kvartal uden afholdt arrangement; det kan ikke rettes op bagefter
  6. **Mangler data** – data dækker ikke hele kvartalet

  Hver forening står på én linje med kvartalerne som små felter (afholdt, planlagt, intet endnu, intet afholdt, ingen data) og én konkret sætning om, hvad der skal gøres; klik åbner foreningen. Tomme spande skjules (de to første vises som en kort linje). De sidste tre uger af kvartalet vises også et fremadblik: hvem der allerede har noget planlagt i næste kvartal. "Sådan beregnes det" nederst forklarer reglerne i almindeligt sprog:

  | Niveau | Regel (d = dage tilbage til kvartalets sidste dag) |
  |---|---|
  | ! Kritisk | intet afholdt eller planlagt, og d ≤ 14 (to uger) |
  | ⏱ Advarsel | intet afholdt eller planlagt, og d ≤ 45 – eller kvartalet afhænger af planlagte arrangementer, og d ≤ 21 |
  | Hold øje | som ovenfor, men der er god tid |
  | Tabt | et afsluttet kvartal er uden afholdt arrangement – kan ikke HB-godkendes (ingen advarsel) |

  (plus "mangler data" og "i hus".) Kritiske og advarsler står i "Kræver handling nu" med korte titler som "Afhold et arrangement senest 30. sep." og "Q3 hviler på ét arrangement tirs. 29. sep." (højst én pr. forening, med kvartalets sidste dag som frist; i 4. kvartal er det også HB-fristen). Reglen står i kernen: `hbRisiko()`/`hbRisikoDetaljer()` i `kerne/regler.js` med niveauet i `hbRisikoNiveau()` og grænserne i `HB_RISIKO_GRAENSE` (som `scripts/rapport.py` også bruger); i ontologien er den egenskaberne `hbRisiko` (niveauet) og `hbRisikoSpand` på Forening. Med teksterne kan den genbruges som `LAU.hbRisiko(f)` (`{niveau, spand, dage, frist, forklaring, advarsel, …}`, hvor `forklaring` er den korte sætning med handlingen).
- **Kommuner uden aktivitet** (`udvidelser/hvide-pletter.js`) – kortlaget "Kommuner uden aktivitet (12 mdr.)" (Visninger → Kortet) skraverer okker de kommuner i en lokalforenings område, hvor foreningen hverken har afholdt arrangementer det seneste år eller har noget planlagt (via arrangementets kommune; aflyste og fjernede tæller ikke, landsforeningens heller ikke). Kendes medlemstallene (`medlemmer.krypt.json`), placeres hver by i sin kommune (punkt-i-polygon), og kommuner med medlemmer skraveres tættere med antallet. Analysen viser pr. forening kommunerne med og uden aktivitet og medlemmerne i dem uden, sorteret efter mest at hente; "Vis på kortet" slår laget til og zoomer ind på foreningen. Kun foreninger med Facebook-side er med. Arrangementer uden kendt sted (fx online) tæller ikke, men vises som "+ N uden kendt sted". Reglen er `kommuneAktivitet()` i `kerne/regler.js`; i ontologien er den `hvidPlet`, `egneAfholdt` og `egnePlanlagte` på Kommune og `hvidePletter` (antal) på Forening.
- **Hvad virker?** (`udvidelser/hvad-virker.js`) – sammenligner afholdte arrangementer pr. type, ugedag, starttidspunkt (dansk tid) og varsel. Vælg målet øverst: **deltagere** på Facebook ("deltager", standard), **tilkendegivelser** ("deltager" + "interesseret") eller registreret **fremmøde** (noteret under Arrangementer). Lokalforeningerne og landsforeningen beregnes hver for sig. For at store foreninger ikke dominerer, måles hvert arrangement mod sin forenings median (indeks = tal ÷ median; kun foreninger med mindst 3 arrangementer), og hver gruppe vises med sit medianindeks og n. Grupper med under 5 arrangementer nedtones og indgår ikke i konklusionerne. Varsel måles kun for arrangementer, der er opdaget efter indsamlingens start (som "Varsel" i nøgletallene). Datagrundlaget er lille – brug det som pejlemærke, ikke facit. Reglerne står i `kerne/regler.js` (`HVAD_VIRKER`, `normalniveau`, `starttid`, `varselGruppe` …); i ontologien er de `normaltDeltagere` på Forening og `starttid`, `varselGruppe` og `deltagerIndeks` på Arrangement.
  **Markant flere deltagere end normalt** vises øverst i analysen og i den grønne boks **Godt gået** i oversigten og foreningspanelet: et arrangement i en lokalforening med mindst 1,5 × og 5 flere deltagere end medianen af foreningens andre afholdte arrangementer (mindst 3), afholdt de seneste 30 dage – eller planlagt de næste 14 dage med så mange tilmeldte på Facebook allerede ("På vej"). Registreret fremmøde går forud for Facebook, når det kan sammenlignes. Højst ét pr. forening; reglen er `rekord()` i `kerne/regler.js` med grænserne i `REKORD` (egenskaben `rekord` på Forening).

- **Egen analyse (byg selv)** (`udvidelser/egne-analyser.js`, bygget på [kernen](kerne/README.md)) – en analysebygger inspireret af Palantirs Object Explorer, så admins selv kan stille spørgsmål til data uden at skrive kode. Øverst står **færdige spørgsmål** (fx "Gennemsnitligt antal deltagere pr. forening" og "Arrangementer mod deltagere pr. forening"), som fylder trinene ud og kan rettes til bagefter. Tre trin:
  1. **Hvad vil du tælle?** – foreninger, arrangementer eller kommuner (objekttyperne i ontologien).
  2. **Afgræns** (valgfrit) – filtre på enhver egenskab, også gennem links (fx arrangementer, hvis forening mister fart): type, status, dato (fx "seneste 90 dage", "i år" eller en egen periode), ugedag, tidspunkt, kommune, deltagere, fremmøde, varsel, momentum, HB-prognose … Et filter på en kategori viser antallet for hver værdi. "Har / har ingen … der" finder fx lokalforeninger **uden** arrangementer de næste 30 dage.
  3. **Vis resultatet som** søjler eller **punktdiagram**. Søjler: del op efter en egenskab (datoer pr. måned, kvartal eller år) og vis antal eller sum/gennemsnit/median/højeste af en talegenskab. Punktdiagram: ét punkt pr. gruppe med to tal (vandret og lodret akse), fx antal arrangementer mod deltagere i alt pr. forening. Er begge tal optællinger eller summer, viser en stiplet linje gennemsnittet (fx deltagere pr. arrangement), og tabellen under viser forholdet for hver gruppe.

  Over resultatet står analysen læst op i én sætning ("Du ser 226 arrangementer hvor dato: seneste år – delt op efter forening (arrangeret af)"). Klik på en søjle for at **bore ned** (gruppen bliver et filter; år → kvartal → måned). **Skift til** ("search around") følger et link fra hele sættet (fx fra foreningerne til deres kommuner) og kan filtreres igen. **Vis på kortet** tegner målet pr. forening på kortet (petrol, mørkere = højere; lag "Egen analyse" under Visninger → Kortet) og arrangementerne som punkter. **Hent som CSV** giver hele sættet med alle egenskaber (til Excel/Sheets). Analyser gemmes som en opskrift – i browseren eller **for alle admins** (krypteret i `data/admin/analyser.krypt.json`) – og står derefter i listen under Analyser. De regnes altid på de nyeste data. Nye egenskaber og objekttyper tilføjes i ontologien (`kerne/lau.js`) og dukker automatisk op i byggeren.

### Månedsrapport

Hvad skal vi handle på nu – og hvad skete der i måneden? Rapporten for en måned har to sektioner, **Fremad** øverst (det, man skal handle på) og **Bagud** under.

**Fremad** – set fra rapportens tidspunkt: for en afsluttet måned den 1. i måneden efter, for "Denne måned indtil nu" i dag. Den ser 35 dage frem (`FREMAD_DAGE`):

- **Risici – det skal der handles på**, sorteret efter alvor (kritisk, advarsel, hold øje) og samlet pr. forening, hver med en konkret handling:
  - HB-kvartalet uden afholdt eller planlagt arrangement med dage tilbage – kritisk eller advarsel efter samme regler og grænser som [HB-risiko](#analyser-og-advarsler) (`hbRisiko()` i kernen);
  - kvartaler, der kun hænger på planlagte arrangementer, når kvartalet slutter inden for perioden (advarsel de sidste 21 dage, ellers hold øje);
  - [momentum](#momentum) "Brug for hjælp" (advarsel) og "Mister fart" (hold øje);
  - årsskiftet, når perioden rammer 31. december: hvor mange lokalforeninger der stadig mangler et afholdt arrangement i Q4 før HB-fristen.
- **Kommende arrangementer** pr. forening (inkl. landsforeningen) med dato og navn, og **Intet planlagt**: lokalforeningerne uden noget i perioden med momentum, sidste afholdte og evt. næste arrangement efter perioden.

For afsluttede måneder gemmes "Fremad" i rapporten (`"fremad"`) og **rekonstrueres** som snapshots (se nedenfor): kun begivenheder, der var set på Facebook på tidspunktet, tæller som planlagte – så en gammel rapport viser, hvad man vidste dengang. Ligger tidspunktet før de ugentlige kørsler startede, kendes ingen planlagte arrangementer, og det står i rapporten. Rapporten laves ét sted, i kernen (`kerne/rapport.js`): "Denne måned indtil nu" beregnes i browseren (`maanedIndtilNu` og `fremad`), og `scripts/rapport.py` laver de gemte rapporter med de samme funktioner (`opdater`). HB-risikoen er kernens `hbRisiko`; forklaringen til hver HB-risiko (når musen holdes over) er i de gemte rapporter rapportens egen korte tekst og i "Denne måned indtil nu" teksten fra `LAU.hbRisiko(f)`. Risici med samme alvor, type og antal dage står i dansk alfabetisk rækkefølge (Aalborg og Aarhus sidst, som "Å").

**Bagud** – hvad der skete i måneden: afholdte, aflyste/ikke afholdte, nye og fra Facebook forsvundne arrangementer, registreret fremmøde (fra rettelserne), højdepunkterne (faldet i momentum eller HB, uden afholdt aktivitet og nye aflysninger til venstre; forbedret til højre), fordelingen af momentum og HB-prognose ved start og slut og en tabel pr. forening med månedens arrangementer. Ved et nyt kvartal starter HB-prognosen forfra, så der tæller kun et skift til "kan ikke godkendes" som et fald.

- `scripts/rapport.py` (kræver `ADMIN_KODE`) tager ved den første kørsel i måneden et **snapshot** af tilstanden ved månedens start: [momentum](#momentum)-niveau, afholdt de seneste 3 måneder og normalt niveau, HB-prognose og antal afholdte/planlagte arrangementer pr. forening. Hele rapporten – snapshots, Bagud, Fremad, hvornår et gemt snapshot eller en gemt rapport erstattes, og udskriften i loggen – laves af kernen (`opdater()` i `kerne/rapport.js`, med reglerne fra `kerne/regler.js`), de samme regler, grænser og tekster som siden. Scriptet kalder den med Node (`scripts/kerne.js`) og står kun for filerne, krypteringen og kommandolinjen.
- **Rapporten** for en måned sammenligner månedens snapshot med den næste måneds (Bagud) og beregner Fremad pr. den 1. i måneden efter.
- Alt ligger krypteret i `data/admin/rapporter.krypt.json` (`{"snapshots": {"ÅÅÅÅ-MM": …}, "rapporter": {"ÅÅÅÅ-MM": {"fremad": …, …}}}`). Filen skrives kun, når indholdet er ændret. Rapporter fra før "Fremad" fandtes, vises med en note; `python3 scripts/rapport.py alle` genberegner dem.
- **Automatisk:** "Månedsrapport" (`.github/workflows/rapport.yml`) kører den 1. i måneden tidligt om morgenen; `sync.yml` og `hb.yml` kører også `rapport.py`, så rapporten for sidste måned kommer med nye rettelser og fremmøde. Manuelt: Actions → "Månedsrapport" → *Run workflow* med en måned (`ÅÅÅÅ-MM`) eller `alle`.
- Mangler et snapshot (fx fordi den første kørsel i måneden ikke var den 1.), **rekonstrueres** det ud fra data pr. den 1. og markeres `"rekonstrueret": true`: kun begivenheder, der var set på Facebook den dag (`foerst_set`), tæller som planlagte, og senere aflysninger og forsvundne begivenheder regnes som ikke sket endnu (`tilstandVed()` i kernen).
- Analysen **Månedsrapport**: vælg måned (nyeste først) eller "Denne måned indtil nu", der beregnes i browseren og sammenlignes med månedens snapshot. Klik på en forening for at åbne den.

Lokalt:

```sh
export ADMIN_KODE='…'
npm ci                                # én gang: scriptene kører kernens regler med Node 22
python3 scripts/rapport.py            # snapshot af denne måned + rapport for sidste måned
python3 scripts/rapport.py 2026-08    # genberegn en bestemt måned (indeværende måned: foreløbig)
python3 scripts/rapport.py alle       # genberegn alle måneder, data dækker
python3 scripts/admin.py vis rapporter
```

## Ændringer

- **Foreninger, Facebook-sider og kommuner:** `data/foreninger.json`. Hovedsiden (`"facebook"`) scrapes automatisk hver uge.
- **Kort:** `geo/kommuner.topo.json` er DAWA's kommunegrænser, forenklet med mapshaper og påført en `forening`-egenskab.
- Secrets `APIFY_TOKEN` og `ADMIN_KODE` (se "Adminlogin") skal være sat i repoets indstillinger.

### Python-scripts og kernen

Forretningsreglerne findes kun ét sted: i kernen (`kerne/regler.js` og månedsrapporten i `kerne/rapport.js`). `scripts/hb.py`, `scripts/rapport.py` og `scripts/kalender.py` læser og skriver selv filerne (og krypterer), men alle regler – rettelser, dækning, momentum, HB-prognose, HB-risiko, rekonstruktion af "hvad vi vidste dengang" og hele månedsrapporten – beregnes af `scripts/kerne.js` (Node 22, kaldt via `scripts/kerne.py`: JSON ind på stdin, JSON ud på stdout). Derfor sætter workflowene Node op og kører `npm ci`, før scriptene kører; lokalt skal `node` findes. `test/scripts.test.js` tjekker, at `scripts/kerne.js` og `hb.py` giver det samme som siden (facit) på de frosne data, og at `rapport.py` giver præcis det samme som før (`test/fixtures/rapport.json`) på faste datoer ved måneds-, kvartals- og årsskifte.

## Udvidelser

**Kernen** (`kerne/`, se [kerne/README.md](kerne/README.md) og [docs/arkitektur.md](docs/arkitektur.md)) er det nye fundament: en ontologi over foreningens objekter (foreninger, arrangementer, kommuner – og i fase 2 personer og roller), et objektlager og ét forespørgselssprog (objektsæt). Nye funktioner bør bygges på den: forretningsregler lægges i kernen (`kerne/regler.js`, og som egenskab i `kerne/lau.js`, hvis de hører til et objekt), og udvidelserne læser dem fra objektlageret (`DATA.lager.vaerdi(DATA.lager.hent('Forening', navn), 'hbRisiko')`) – så står reglen ét sted og kan også bruges i Egen analyse, filtre og på kortet. Analyserne i `udvidelser/` er bygget sådan. `npm install && npm run tjek` kører typetjek og tests (også i GitHub Actions).

`app.js` er bygget op om registre, så nye funktioner kan tilføjes uden at ændre resten. Sektioner, lag og sorteringer med `admin: true` vises kun for admins:

- **Panelsektioner** – `LAU.registerSection({id, titel, viser, synlig(f, o), render(f, o), efter(el, f, o)}, {efter: 'kommende'})`.
  `f` er foreningen (`DATA.byName`), `o` dens objekt i objektlageret (`DATA.lager.vaerdi(o, 'momentum')`, `DATA.lager.linkede(o, 'kommuner')`).
  `viser` er de egenskaber og links fra ontologien, sektionen viser – de gentages så ikke i "Egenskaber" og "Forbundne objekter".
  Indbyggede: `kommende`, `tidligere`, `stamdata`, `egenskaber` og `links` (offentlige) samt `momentum`, `hb`, `aar`, `noegletal`, `typer`, `tilkendegivelser`, `geografi`, `ugedage` og `noter` (admin).
- **Kortlag** – `LAU.registerLayer({id, label, toggle, standard, gruppe, hint, tilgaengelig(), synlig(ctx), tegn(api, ctx)})`, hvor `api.source(navn, geojson)` og `api.layer(maplibre-lagspec)` tilføjer lag, der fjernes og tegnes igen automatisk, og `ctx = {selected, zoomed, map}`.
  Lag med `toggle: true` får automatisk en til/fra-knap under fanen Visninger (`gruppe: 'aktiviteter'` eller `'kort'`) eller HB (`gruppe: 'hb'`). Indbyggede: `kommunenavne`, `afholdte`, `hb` (admin), `medlemmer` (admin); `hvide-pletter` og `egen-analyse` (admin) kommer fra `udvidelser/`.
- **Analyser** (fanen **Analyser**, kun admins) – `LAU.registerAnalyse({id, titel, beskrivelse, render() → html, efter(el)})`. Fanen viser listen over analyser i sidepanelet; den valgte analyse vises i et stort vindue over højre del af kortet, og klik på en anden i listen skifter indholdet. Krydset i hjørnet (eller Esc) lukker vinduet. Vinduet og kalenderen deler pladsen: åbnes vinduet, lukkes kalenderen (og kommer igen, når vinduet lukkes). Tegn igen med `renderAnalyser()`; åbn en analyse med `LAU.aabnAnalyse(id)`. Indbygget: `foreninger` (sorterbar tabel med aktivitet, tilkendegivelser og fremmøde pr. forening); resten kommer fra `udvidelser/` (se [Analyser og advarsler](#analyser-og-advarsler)).
- **Advarsler** (kun admins) – `LAU.registerAdvarsel({id, hent() → [{niveau: 'kritisk' | 'advarsel' | 'positiv', titel, tekst?, forening?, frist?: Date, analyse?: id}]})`. Tidskritiske ting, der skal reageres på, før det er for sent, vises øverst i oversigten i den røde boks "Kræver handling nu" (over Momentum) og øverst i foreningspanelet for den forening, de gælder; `'positiv'` vises i den grønne boks "Godt gået" lige under. Boksene er skjult, når de er tomme.
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
| `analyser.krypt.json` | egne analyser gemt for alle admins (`udvidelser/egne-analyser.js`) |
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
