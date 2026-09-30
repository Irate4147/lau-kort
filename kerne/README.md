# Kernen

Fundamentet, som resten af systemet bygges på (se [docs/arkitektur.md](../docs/arkitektur.md)). Almindelige ES-moduler
uden build-trin: de kører direkte i browseren, i Node (tests og scripts) og senere i Supabase. Typerne tjekkes af
TypeScript via JSDoc (`npm run typetjek`).

| Fil | Indhold |
|---|---|
| `ontologi.js` | Frameworket: objekttyper, egenskaber, links, stier gennem links og adgang. Ved intet om LAU. |
| `lau.js` | **LAU's ontologi**: Forening, Arrangement, Kommune, Person, Rolle og deres links. Her tilføjes nye egenskaber og typer. |
| `regler.js` | Forretningsreglerne: kategorier, status, dækning, HB-godkendelse og momentum. |
| `lager.js` | Objektlageret: objekter, links og beregnede egenskaber. Håndhæver adgang. |
| `objektsaet.js` | Forespørgselssproget: filtrér, følg links (search around), gruppér, mål, bor ned. |
| `kilder/json.js` | Adapter fra de nuværende JSON-filer. Fase 2: en Supabase-adapter med samme resultat. |
| `tid.js` | Dansk tid, kvartaler og HB-året. |

## Sådan bruges den

```js
import {bygFraJson, koer} from './kerne/index.js';

const lager = bygFraJson({foreninger, events, meta, rettelser});
const res = koer(lager, {
  type: 'Forening',
  filtre: [
    {egenskab: 'niveau', er: ['lokal']},
    {link: 'arrangementer', ingen: true, filtre: [{egenskab: 'start', periode: 'naeste30'}]},
  ],
  gruppering: {egenskab: 'momentum'},
});
// res.objekter: lokalforeninger uden noget de næste 30 dage; res.grupper: fordelt på momentum
```

I browseren ligger kernen på `window.LAU_KERNE` (indlæses i `index.html`). `app.js` bruger den til alle regler (`DATA.lager` er
objektlageret). Husk at hæve `?v=` i `index.html`, når kernen ændres: det gælder `kerne/index.js`, og de filer, den
importerer, caches højst 10 minutter af GitHub Pages.

## Tilføj en egenskab

Tilføj den under typen i `lau.js`, fx på Forening:

```js
aktiveKommuner: {label: 'Kommuner med aktivitet', type: 'tal',
  beregn: (f, L) => L.linkede(f, 'kommuner').filter(k => L.vaerdi(k, 'aktivitetSenesteAar') > 0).length},
```

Den kan så straks bruges i analysebyggeren (filtre, gruppering, mål), gennem links (`arrangeretAf.aktiveKommuner`),
på kortet og i CSV-eksporten. Typer: `tekst`, `kat` (med `vaerdier`), `tal`, `dato`, `bool` og `objekt` (intern).
`adgang: 'admin'` skjuler den for offentligheden. En `kat`-egenskab på Forening bliver også en farvning af kortet
(Visninger); egne farver pr. værdi kan sættes i `FARVER` i `app.js`.

## Test

`npm run tjek` kører typetjek og tests (også i GitHub Actions ved hver pull request):

- `test/kerne.test.js` – kernen på et lille, fast datasæt.
- `test/app.test.js` – hele `app.js` (der bruger kernen) køres på frosne data (`test/fixtures/data/`) på seks datoer og
  skal give præcis det samme som facit (`test/fixtures/golden.json`). Facit blev lavet med `app.js`, før reglerne blev
  flyttet til kernen, så det beviser, at flytningen ikke ændrede noget. Ændres en regel **bevidst**, laves nyt facit med
  `node test/lav-golden.js` – og ændringen i `golden.json` viser præcis, hvad reglen ændrede.
