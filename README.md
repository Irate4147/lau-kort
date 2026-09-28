# LAU – lokalforeningernes aktiviteter

Kort over Liberal Alliances Ungdoms lokalforeninger og landsforeningen med kommende aktiviteter (de næste 14 dage vises direkte på kortet). Klik på en forening for at zoome ind og åbne et panel med arrangementer, aktivitet det seneste år og nøgletal.

**Side:** https://irate4147.github.io/lau-kort/ – link direkte til en forening med `#Navn`, fx `#Næstved`.

## Sådan hænger det sammen

1. Google Apps Scriptet i regnearket "LAU – begivenheder" kører Apifys Facebook Events Scraper hver mandag på foreningernes `upcoming_hosted_events`.
2. GitHub Action (`.github/workflows/sync.yml`) kører mandag formiddag (én gang om ugen): `scripts/sync.py` henter resultaterne af nye kørsler fra Apify (ingen ekstra scraping), fletter dem ind i `data/events.json` og committer dem.
3. Siden (`index.html`, `app.js`) er et fuldskærmskort (MapLibre GL med OpenFreeMap/OpenStreetMap-grundkort, ingen API-nøgle) med et sidepanel til venstre. Den læser `data/` (direkte fra repoet via raw.githubusercontent.com, så data er friske) og beregner status og analyser i browseren.

Facebook viser kun kommende begivenheder i de ugentlige kørsler. Afholdte aktiviteter før 28. sep. 2026 hentes med en engangskørsel på foreningernes `past_hosted_events`:
Actions → "Hent historik" → *Run workflow* (standard fra 1. januar i år; højst 20 begivenheder pr. side, så Apify-forbruget er begrænset). Allerede hentede sider springes over. Ramte en side loftet, og lå alle de hentede i perioden (fx Roskilde og København), mangler der ældre begivenheder – så henter næste kørsel kun den side igen med dobbelt loft (20 → 40 → 80 …).
Lokalt: `APIFY_TOKEN=... python3 scripts/sync.py --historik [ÅÅÅÅ-MM-DD]`. Begivenheder hentet på den måde får `"historisk": true` og tæller ikke med i "varsel".

En forening kan have flere Facebook-sider: `"facebook_ekstra": ["…"]` i `data/foreninger.json` (fx Fyns tidligere Odense-side). Begivenheder derfra hører til foreningen, og "Hent historik" holder styr på hver side for sig – en ny side hentes, selvom foreningens hovedside allerede er hentet, og foreningen regnes først som dækket, når alle dens sider er hentet. Skal en ekstra side også med i de ugentlige kørsler, skal den tilføjes i regnearket. En ekstra side kan også angives som `{"url": "…", "begivenheder": ["https://www.facebook.com/events/…/", …]}` – så henter historikken kun de begivenheder (én kørsel med `maxEvents` = antallet) i stedet for sidens tidligere begivenheder, hvilket sparer Apify-forbrug.

Har en forening ikke brug for historikken (fx ingen arrangementer i år), kan `"historik_fra": "ÅÅÅÅ-MM-DD"` sættes i `data/foreninger.json`: så regnes dens data som komplette fra den dato, og "Hent historik" springer den over.

Sidepanelet har fire faner:

- **Oversigt** – nøgletal, de næste 14 dage og alle foreninger (klik for foreningspanelet).
- **Visninger** – farvning (aktivitet nu, afholdt i et kvartal, ingen farve) og til/fra for næsten alt på kortet: begivenhedsbokse, aktivitetspunkter, landsforeningens og aflyste aktiviteter, afholdte aktiviteter, foreningsnavne, grænser, kommunenavne, grundkortets stednavne og tegnforklaringen. Valgene huskes i browseren.
- **HB-godkendelse** – alle HB-visninger (se nedenfor).
- **Arrangementer** – alle arrangementer med filtre og redigering (se "Rettelser").

## Rettelser af arrangementer

Under fanen **Arrangementer** kan man rette det, Facebook ikke ved: bekræfte at et arrangement blev afholdt (✓ Afholdt), markere det som ikke afholdt, skjule dubletter/ikke-LAU-arrangementer, rette titel, dato, sted og forening, notere faktisk fremmøde – og tilføje arrangementer, der aldrig lå på Facebook.

- Rettelserne ligger i `data/rettelser.json` (`{"rettelser": {"<id>": {status, navn, forening, start, slut, sted, deltagere, note, manuel, rettet}}}`) og går forud for de hentede data. `scripts/sync.py` rører aldrig filen; siden og `scripts/hb.py` anvender dem med samme regler, så de tæller med i kort, nøgletal og HB-prognosen.
- **Gem for alle:** forbind GitHub i fanen med et fine-grained token (kun dette repo, *Contents: Read and write*). Tokenet gemmes kun i browseren; hver rettelse committes direkte til `main`, og en push af filen starter "Hent begivenheder", så `hb_<år>.json` beregnes igen. Uden token gemmes rettelserne kun i browseren, indtil man forbinder.
- Alt i repoet er offentligt – skriv ikke persondata i noter. Adminversionen kan i stedet levere `privat.rettelser = {hent: async () => ({…}), gem: async aendringer => {}}`.

## HB-godkendelse

- `data/hb.json`: kriterierne fra Organisationshåndbogen (8.2) og årets HB-status pr. forening (fra overblikket på Drive, og for de røde foreninger efter gennemgang af deres mappe). Indeholder kun status og mangler, ingen persondata.
- `scripts/hb.py [ÅR]` sammenholder `data/events.json` med kvartalskravet (mindst ét afholdt arrangement pr. kvartal; om det er fagligt, vurderes ikke) og skriver `data/hb_<ÅR+1>.json` med status pr. kvartal (`ja`, `nej`, `ukendt`, `planlagt`, `mangler`), en prognose og begrundelser. Kører automatisk efter den ugentlige sync.
  Et kvartal bliver kun `nej`, når data dækker hele kvartalet (se `data_fra`, pr. forening: historikken tæller kun, hvor hentningen lykkedes, og ramte den loftet på 20 begivenheder, kun fra den ældste hentede), så manglende historik giver `ukendt` i stedet for et forkert nej.
- Fanen **HB-godkendelse**: farv kortet efter HB-godkendelse, skravér de foreninger magenta, der ikke kan godkendes (oven på enhver farvning), antal pr. kategori og en tabel med status pr. kvartal for hver forening. Kategorierne (bedst først):
  1. aktivitet i alle kvartaler indtil nu inkl. det indeværende + planlagt arrangement i næste kvartal
  2. aktivitet i alle kvartaler indtil nu inkl. det indeværende
  3. aktivitet i alle tidligere kvartaler; det indeværende har et planlagt arrangement
  4. aktivitet i alle tidligere kvartaler; intet planlagt i det indeværende endnu
  5. mangler aktivitet i et afsluttet kvartal – kan ikke godkendes
  
  (plus "historik mangler", når data ikke dækker et kvartal). Siden beregner det selv med samme regel som `hb.py`, og foreningspanelet har en sektion med status pr. kvartal og årets HB-status fra `data/hb.json`.

## Ændringer

- **Foreninger, Facebook-sider og kommuner:** `data/foreninger.json`. Nye Facebook-sider skal også tilføjes i fanen "Foreninger" i regnearket, ellers bliver de ikke scrapet.
- **Kort:** `geo/kommuner.topo.json` er DAWA's kommunegrænser, forenklet med mapshaper og påført en `forening`-egenskab.
- Secret `APIFY_TOKEN` skal være sat i repoets indstillinger.

## Udvidelser

`app.js` er bygget op om to registre, så nye funktioner kan tilføjes uden at ændre resten:

- **Panelsektioner** – `LAU.registerSection({id, titel, synlig(f), render(f), efter(el, f)}, {efter: 'kommende'})`.
  Indbyggede: `kommende`, `aar`, `noegletal`, `typer`, `tilkendegivelser`, `geografi`, `ugedage`, `stamdata`, `noter`.
- **Kortlag** – `LAU.registerLayer({id, label, toggle, standard, gruppe, hint, tilgaengelig(), synlig(ctx), tegn(api, ctx)})`, hvor `api.source(navn, geojson)` og `api.layer(maplibre-lagspec)` tilføjer lag, der fjernes og tegnes igen automatisk, og `ctx = {selected, zoomed, map}`.
  Lag med `toggle: true` får automatisk en til/fra-knap under fanen Visninger (`gruppe: 'aktiviteter'` eller `'kort'`) eller HB-godkendelse (`gruppe: 'hb'`). Indbyggede: `kommunenavne`, `afholdte`, `hb`, `medlemmer`.

**Stamdata** (formand, telefon osv.) kan lægges i `data/foreninger.json` som `"stamdata": {"Formand": "…", "Telefon": "…"}` –
men alt i dette repo er **offentligt**, så kun oplysninger, der må være offentlige, hører hjemme her.

### Privat adminversion (fortrolige noter, medlemstal, analyser)

Fortrolige data må aldrig ligge i dette repo. Siden er i stedet forberedt på en privat udgave, der sætter
`window.LAU_CONFIG` før `app.js` indlæses:

```js
window.LAU_CONFIG = {
  mode: 'admin',
  assetBase: 'https://irate4147.github.io/lau-kort/',
  dataBase: 'https://raw.githubusercontent.com/Irate4147/lau-kort/main/',
  privat: {
    noter: {titel: 'Fortrolige noter', forklaring: 'Deles med administratorer.', hent: async f => '…', gem: async (f, tekst) => {}},
    stamdata: {'Næstved': {'Formand': '…', 'Telefon': '…'}},
    medlemmer: [{forening: 'Fyn', by: 'Odense', lat: 55.40, lng: 10.39, antal: 42}],
  },
};
```

Anbefalet opsætning: et **Google Apps Script-webapp** i et privat regneark, udrullet med adgang kun for bestemte
Google-konti. Webappen serverer en side, der indlæser `app.js`/`style.css` herfra, udfylder `privat` fra regnearket
og gemmer noter tilbage via `google.script.run`. Uden `privat` gemmes "Private noter" kun i brugerens egen browser.
