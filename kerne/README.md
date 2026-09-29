# Kernen

Fundamentet, som resten af systemet bygges på (se [docs/arkitektur.md](../docs/arkitektur.md)). Almindelige ES-moduler
uden build-trin: de kører direkte i browseren, i Node (tests og scripts) og senere i Supabase. Typerne tjekkes af
TypeScript via JSDoc (`npm run typetjek`).

| Fil | Indhold |
|---|---|
| `ontologi.js` | Frameworket: objekttyper, egenskaber, links, stier gennem links og adgang. Ved intet om LAU. |
| `lau.js` | **LAU's ontologi**: Forening, Arrangement, Kommune, Person, Rolle og deres links. Her tilføjes nye egenskaber og typer. |
| `regler.js` | Forretningsreglerne: kategorier, status, dækning, HB-godkendelse og momentum – og analysernes regler: HB-risiko, hvide pletter og "Hvad virker?". |
| `rapport.js` | Månedsrapporten for den indeværende måned: Bagud (`maanedIndtilNu`) og Fremad (`fremad`) – samme opbygning og tekster som `scripts/rapport.py`. |
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

## Analysernes egenskaber

Analyserne i `udvidelser/` læser deres regler herfra (`DATA.lager.vaerdi(o, id)`), så de samme værdier også kan bruges i
analysebyggeren, filtre, grupperinger og på kortet. Alle er `adgang: 'admin'`. `…Detaljer`/objekt-egenskaberne er interne
(bruges af analyserne og de andre egenskaber).

| Type | Egenskab | Indhold | Regel (`regler.js`) |
|---|---|---|---|
| Forening | `hbRisiko` (kat) | HB-risiko i det indeværende kvartal: kritisk, advarsel, opmaerksom, sikret, tabt, ukendt (kun lokalforeninger) | `hbRisiko`, `HB_RISIKO` |
| Forening | `hbRisikoSpand` (kat) | Hvad der skal gøres: handle, planlagt, hold, sikret, tabt, ukendt | `hbRisiko` |
| Forening | `hbRisikoDetaljer` (objekt) | `{niveau, spand, kvartal, status, sidsteDag, dage, afholdt, planlagt, naesteKv, tabte, ukendte}` | `hbRisiko` |
| Forening | `hvidePletter` (tal) | Kommuner i området uden aktivitet de seneste 12 mdr. (kun lokalforeninger med Facebook-side) | `kommuneAktivitet` |
| Forening | `kommuneAktivitet` (objekt) | `{kommuner: Map(navn → {afholdt, planlagt}), ukendt, udenfor}` | `kommuneAktivitet`, `HVIDE_PLETTER` |
| Kommune | `hvidPlet` (bool) | Områdets lokalforening har hverken afholdt (12 mdr.) eller planlagt noget i kommunen; null, hvis foreningen ikke er med | `kommuneAktivitet` |
| Kommune | `egneAfholdt`, `egnePlanlagte` (tal) | Områdets forenings afholdte (12 mdr.) og planlagte arrangementer i kommunen | `kommuneAktivitet` |
| Forening | `normaltDeltagere` (tal) | Foreningens normale antal deltagere (median; mindst 3 afholdte) | `normalniveau`, `HVAD_VIRKER` |
| Forening | `normalniveau` (objekt) | Pr. mål (`deltager`, `svar`, `fremmoede`): `{n, median, arrangementer: [{e, vaerdi, indeks}]}` | `afholdteMed`, `normalniveau` |
| Forening | `rekord` (bool), `rekordDetaljer` (objekt) | Markant flere deltagere end normalt (seneste 30 dage eller planlagt de næste 14) | `rekord`, `REKORD` |
| Arrangement | `deltagerIndeks` (tal) | Deltagere ÷ arrangørens normale antal (hos den første lokalforening blandt arrangørerne) | `normalniveau` |
| Arrangement | `starttid` (kat) | Før kl. 12, kl. 12–17, kl. 17–19, kl. 19 eller senere (dansk tid) | `starttid` |
| Arrangement | `varselGruppe` (kat) | Varsel under 7, 7–13, 14–27 eller 28+ dage (kun opdaget før afholdelse) | `varselDage`, `varselGruppe` |

Fx lokalforeninger, der skal afholde et arrangement nu: `{type: 'Forening', filtre: [{egenskab: 'hbRisikoSpand', er: ['handle']}]}`;
hvide pletter i Jylland: `{type: 'Kommune', filtre: [{egenskab: 'hvidPlet', er: [true]}], gruppering: {egenskab: 'forening.navn'}}`.

## Tilføj en egenskab

Tilføj den under typen i `lau.js`, fx på Forening:

```js
aktiveKommuner: {label: 'Kommuner med aktivitet', type: 'tal',
  beregn: (f, L) => L.linkede(f, 'kommuner').filter(k => L.vaerdi(k, 'aktivitetSenesteAar') > 0).length},
```

Den kan så straks bruges i analysebyggeren (filtre, gruppering, mål), gennem links (`arrangeretAf.aktiveKommuner`),
på kortet og i CSV-eksporten. Typer: `tekst`, `kat` (med `vaerdier`), `tal`, `dato`, `bool` og `objekt` (intern).
`adgang: 'admin'` skjuler den for offentligheden.

## Test

`npm run tjek` kører typetjek og tests (også i GitHub Actions ved hver pull request):

- `test/kerne.test.js` – kernen på et lille, fast datasæt, også analysernes regler på faste datoer.
- `test/app.test.js` – hele `app.js` (der bruger kernen) køres på frosne data (`test/fixtures/data/`) på seks datoer og
  skal give præcis det samme som facit (`test/fixtures/golden.json`). Facit blev lavet med `app.js`, før reglerne blev
  flyttet til kernen, så det beviser, at flytningen ikke ændrede noget. Ændres en regel **bevidst**, laves nyt facit med
  `node test/lav-golden.js` – og ændringen i `golden.json` viser præcis, hvad reglen ændrede.
- `test/analyser.test.js` – analyserne i `udvidelser/` køres på de samme frosne data og datoer, og deres output (HTML,
  advarsler, kortlaget og `LAU.hbRisiko`) skal have samme fingeraftryk som facit (`test/fixtures/analyser.json`, lavet
  før analysernes regler blev flyttet hertil). Ændres en analyse bevidst: `node test/lav-analyse-facit.js [mappe]` (med en
  mappe skrives hele outputtet ud, så før og efter kan sammenlignes med `diff -r`).
