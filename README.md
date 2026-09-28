# LAU – lokalforeningernes aktiviteter

Kort over Liberal Alliances Ungdoms lokalforeninger og landsforeningen med kommende aktiviteter (de næste 14 dage vises direkte på kortet). Klik på en forening for at zoome ind og åbne et panel med arrangementer, aktivitet det seneste år og nøgletal.

**Side:** https://irate4147.github.io/lau-kort/ – link direkte til en forening med `#Navn`, fx `#Næstved`.

## Sådan hænger det sammen

1. Google Apps Scriptet i regnearket "LAU – begivenheder" kører Apifys Facebook Events Scraper hver mandag på foreningernes `upcoming_hosted_events`.
2. GitHub Action (`.github/workflows/sync.yml`) kører mandag formiddag (én gang om ugen): `scripts/sync.py` henter resultaterne af nye kørsler fra Apify (ingen ekstra scraping), fletter dem ind i `data/events.json` og committer dem.
3. Siden (`index.html`, `app.js`) er et fuldskærmskort (MapLibre GL med OpenFreeMap/OpenStreetMap-grundkort, ingen API-nøgle) med et sidepanel til venstre. Den læser `data/` (direkte fra repoet via raw.githubusercontent.com, så data er friske) og beregner status og analyser i browseren.

Facebook viser kun kommende begivenheder i de ugentlige kørsler. Afholdte aktiviteter før 28. sep. 2026 hentes med en engangskørsel på foreningernes `past_hosted_events`:
Actions → "Hent historik" → *Run workflow* (standard 92 dage, dvs. ca. et kvartal; højst 25 begivenheder pr. side, så Apify-forbruget er begrænset).
Lokalt: `APIFY_TOKEN=... python3 scripts/sync.py --historik 92`. Begivenheder hentet på den måde får `"historisk": true` og tæller ikke med i "varsel".

På kortet kan "Afholdt i Q…" slås til over kortet: lokalforeningerne farves grønne, hvis de har afholdt mindst én aktivitet i indeværende kvartal, og røde, hvis ikke.

## Ændringer

- **Foreninger, Facebook-sider og kommuner:** `data/foreninger.json`. Nye Facebook-sider skal også tilføjes i fanen "Foreninger" i regnearket, ellers bliver de ikke scrapet.
- **Kort:** `geo/kommuner.topo.json` er DAWA's kommunegrænser, forenklet med mapshaper og påført en `forening`-egenskab.
- Secret `APIFY_TOKEN` skal være sat i repoets indstillinger.

## Udvidelser

`app.js` er bygget op om to registre, så nye funktioner kan tilføjes uden at ændre resten:

- **Panelsektioner** – `LAU.registerSection({id, titel, synlig(f), render(f), efter(el, f)}, {efter: 'kommende'})`.
  Indbyggede: `kommende`, `aar`, `noegletal`, `typer`, `tilkendegivelser`, `geografi`, `ugedage`, `stamdata`, `noter`.
- **Kortlag** – `LAU.registerLayer({id, label, toggle, standard, synlig(ctx), tegn(api, ctx)})`, hvor `api.source(navn, geojson)` og `api.layer(maplibre-lagspec)` tilføjer lag, der fjernes og tegnes igen automatisk, og `ctx = {selected, zoomed, map}`.
  Lag med `toggle: true` får automatisk en til/fra-knap over kortet. Indbyggede: `kommunenavne`, `afholdte`, `kommende`, `medlemmer`.

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
