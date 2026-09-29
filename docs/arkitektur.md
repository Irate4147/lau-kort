# Arkitektur: fra kort til foreningens operativsystem

Status: **forslag** – kræver tre beslutninger (se sidst).

## Kort fortalt

Målet er ét system, hvor alt kan forbindes med alt, hvor brugerne selv kan lave analyser, diagrammer og views, og hvor workflows ligger samme sted som data.

Det løses ikke ved at bygge flere funktioner oven på `app.js`. Det løses ved at lægge en **ontologi** (en typet objektgraf) i bunden, som alt andet bygges på:

> **Objekter** (Forening, Arrangement, Person …) med **egenskaber**, forbundet af **links**, ændret gennem **handlinger** og beriget af **beregninger**. Oven på det: **ét forespørgselssprog** (objektsæt), som alle views, analyser, kortlag, advarsler og workflows bruger.

Det er Palantirs model (Foundry Ontology), skaleret ned til en forening.

## Er det en knowledge graph?

Tæt på, men ikke helt – og forskellen betyder noget for valget af teknologi.

| | Klassisk knowledge graph (RDF, SPARQL, Neo4j) | Ontologi / typet objektgraf (Palantir) |
|---|---|---|
| Skema | Åbent, alt kan siges om alt | Fast, typet: en Forening *har* disse egenskaber |
| Formål | Viden, sammenhænge, slutninger | Drift: se, beslutte, handle |
| Skrivning | Tripler tilføjes | Gennem **handlinger** med regler, rettigheder og log |
| Passer til jer | Nej – for løst og for tungt | **Ja** |

Pointen: I skal have en **graf-formet datamodel**, ikke en **grafdatabase**. Ved jeres datamængde (tiere af foreninger, hundreder af arrangementer, tusinder af medlemmer) er "følg et link" bare et opslag. En almindelig database (Postgres) klarer det uden besvær.

## Hvor systemet er i dag

Prototypen virker og har gode idéer (registre, rettelser som lag oven på kildedata, krypterede admin-filer). Men den er bygget feature for feature:

1. **Logikken er skrevet flere gange.** Momentum og HB-reglerne findes både i `app.js` og i `scripts/hb.py` / `scripts/rapport.py`. De to kopier kan komme ud af trit.
2. **Links er implicitte.** Et arrangement peger på en forening med et navn (`"forening": "Fyn"`). Omdøbes en forening, knækker sammenhængen.
3. **Hver visning har sin egen kode.** Momentum, HB, hvide pletter og "Hvad virker?" har hver deres beregning og tegning. En ny egenskab bliver ikke automatisk tilgængelig i filtre, kort og tabeller.
4. **Udvidelsespunkterne ligger i brugerfladen** (`registerSection`, `registerLayer`). Den nye type data kan ikke registreres, kun nye måder at vise den på.
5. **Adgang er én fælles kode.** Alle admins ser alt. Der er ingen roller og ingen personlig log over, hvem der gjorde hvad.
6. **Git er databasen.** Det fungerer til offentlige arrangementer, men ikke til persondata (se [Persondata](#persondata-vigtigt)).

## Målarkitekturen

```mermaid
flowchart TB
  subgraph Kilder
    FB[Facebook via Apify]
    MS[Medlemssystem / CSV]
    DR[Drive / Sheets]
    MAN[Manuel indtastning]
  end
  subgraph Kerne["Kerne (ét framework)"]
    CON[Connectors] --> ACT
    ACT[Handlinger<br/>validering, rettigheder, log] --> STORE[(Objektlager<br/>objekter + links + handlingslog)]
    ONT[Ontologi<br/>typer, egenskaber, links,<br/>beregninger, roller] -.styrer.-> ACT
    ONT -.styrer.-> Q
    STORE --> Q[Objektsæt-motor<br/>filtrér, search around, gruppér, mål]
  end
  subgraph Brugerflade["Én brugerflade"]
    W[Widgets: tabel, søjler, tidslinje,<br/>kort, kalender, liste, nøgletal]
    V[Views og objektsider<br/>sat sammen af widgets]
    R[Regler og opgaver<br/>advarsler, indbakke, notifikationer]
  end
  Kilder --> CON
  Q --> W --> V
  Q --> R --> ACT
  V -- knapper --> ACT
```

### 1. Ontologi – ét skema, der styrer alt

Én deklarativ definition (fx `ontologi/*.ts`) af:

- **Objekttyper og egenskaber:** Forening, Kommune, Arrangement, Person, Rolle (Person er formand i Forening fra–til), Opgave, Note, HB-vurdering, senere Kampagne, Budget …
- **Links:** Arrangement → arrangeret af → Forening (mange-til-mange), Forening → dækker → Kommune, Person → medlem af → Forening, Opgave → handler om → hvad som helst.
- **Beregnede egenskaber (functions):** momentum, HB-status, dage siden sidste arrangement, varsel. De skrives **én gang** i TypeScript og bruges overalt: i filtre, på kortet, i tabeller og i regler. Python-kopierne forsvinder.
- **Roller:** hvem må se og ændre hvilke typer og egenskaber.

Alt, der står i ontologien, dukker automatisk op i analysebyggeren, på kortet, i CSV-eksport og i objektsiderne. Det er det, der gør, at "alt kan forbindes med alt".

### 2. Objektlager med handlingslog

- Hvert objekt har et stabilt id. Links er rigtige referencer, ikke navne.
- **Kildedata og brugerrettelser holdes adskilt.** Det, I allerede gør med `rettelser`, gøres generelt: Facebook siger X, en admin retter til Y, og Y vinder – for alle objekttyper.
- **Alle ændringer er handlinger** i en log, der kun kan skrives til (hvem, hvad, hvornår, hvorfor). Det giver historik, fortryd og "hvad vidste vi den 1. september?" gratis. Månedsrapportens snapshots bliver bare en forespørgsel på loggen.

### 3. Objektsæt – ét forespørgselssprog

Én serialiserbar beskrivelse (JSON), som alle dele af systemet bruger:

```json
{
  "type": "Arrangement",
  "filtre": [{"egenskab": "dato", "periode": "seneste365"}],
  "searchAround": [{"link": "arrangeretAf", "filtre": [{"egenskab": "momentum", "er": ["Mister fart"]}]}],
  "gruppering": {"egenskab": "dato", "pr": "maaned"},
  "maal": {"funktion": "median", "egenskab": "deltagere"}
}
```

Den samme beskrivelse kan vises som søjlediagram, tabel eller kort, gemmes som view, bruges som betingelse i en regel ("hvis sættet ikke er tomt, opret en opgave") eller deles som link. Analysebyggeren i denne PR er en første, simpel udgave af netop det.

### 4. Widgets og views – brugerne bygger selv

- **Widgets** tager et objektsæt og tegner det: tabel, søjler, tidslinje, kort, kalender, liste, nøgletal, kanban.
- **Views** er gemte sider med widgets, der deler variabler: vælg en forening i kortet, og tabellen og diagrammet ved siden af filtrerer med.
- **Objektsider** genereres ud fra ontologien: foreningspanelet bliver "objektsiden for Forening", konfigureret i stedet for kodet. Samme for Person, Arrangement osv.
- Det offentlige kort er bare et view med den offentlige rolle.

### 5. Workflows – handling samme sted som data

- **Handlinger** er knapper på objekter: "Bekræft afholdt", "Tildel opgave", "Registrér fremmøde". De har regler for, hvem der må, og felter, der skal udfyldes.
- **Regler** er objektsæt med en betingelse og en effekt, der kører på skema eller ved ændringer. "Kræver handling nu" bliver en regel i stedet for hårdkodet logik. Eksempel: "Lokalforeninger uden noget afholdt eller planlagt i kvartalet, 14 dage før kvartalsslut → opret en opgave til regionsansvarlig og send en mail."
- **Opgaver** er selv objekter med links, så de kan ses på kortet, filtreres og analyseres som alt andet.

### 6. Udvidelser på dataniveau

En udvidelse registrerer **objekttyper, beregninger, handlinger, widgets og connectors** mod det samme register. En ny datakilde – fx medlemstal eller kampagner – bliver dermed straks brugbar i alle views og analyser, uden ny UI-kode.

## Teknologivalg (anbefaling)

| Lag | Anbefaling | Hvorfor |
|---|---|---|
| Objektlager, login, rettigheder | **Postgres hos Supabase (EU-region)** | Rigtige personlige logins, rettigheder pr. række (en lokalformand ser kun sin egen forening), handlingslog, gratis til jeres størrelse. Links er bare tabeller – ingen grafdatabase nødvendig. |
| Datamodel i databasen | Generisk: `objekter(id, type, egenskaber jsonb)`, `links(fra, til, type)`, `handlinger(...)` + validering ud fra ontologien | Nye objekttyper kræver ingen databasemigrering. Ved jeres datamængde er ydelsen ikke et problem. |
| Ontologi, beregninger, objektsæt-motor | **TypeScript**, delt mellem browser og server | Én implementering af hver regel. Typerne genereres ud fra ontologien, så fejl fanges tidligt. |
| Analyse | I browseren på det sæt, brugeren har adgang til (evt. DuckDB-WASM senere) | Hurtigt og enkelt ved hundreder–tusinder af objekter. Serveren håndhæver adgangen. |
| Brugerflade | Vite + TypeScript, MapLibre som i dag, lille UI-framework (fx Svelte) | Kan bygges gradvist ved siden af det nuværende. |
| Connectors | De nuværende Python-scripts, men de skriver via handlings-API'et (kilde: "facebook") i stedet for til filer | Genbrug af det, der virker. |
| Hosting | GitHub Pages til frontend som nu; Cloudflare-workeren kan udfases | Ingen ny drift ud over Supabase. |

**Alternativ, der skal nævnes:** NocoDB eller Baserow (open source, kan hostes i EU) giver tabeller, links, views, formularer og automatiseringer færdigt. Kortet og jeres analyser skulle så bygges oven på deres API. Hurtigere start, men mindre kontrol over oplevelsen, og ikke ét samlet interface. Det giver mening, hvis I hellere vil bruge tid på foreningen end på et system.

## Persondata (vigtigt)

Medlemskab af et politisk ungdomsparti afslører politisk overbevisning. Det er **særlige kategorier af personoplysninger** efter GDPR art. 9. Foreningen må godt behandle sine egne medlemmers data (art. 9, stk. 2, litra d), men det stiller krav:

- Persondata må **ikke ligge i git** – heller ikke krypteret. Historikken kan ikke slettes, og alle deler én nøgle.
- Personlige logins, adgang efter rolle og log over, hvem der har set og ændret hvad.
- Databehandleraftale med hostingudbyderen og hosting i EU.

Det er det stærkeste argument for at flytte objektlageret ud af repoet, før personer kommer ind i systemet. (Dette er ikke juridisk rådgivning – tjek med landsorganisationens dataansvarlige.)

## Vej derhen – uden big bang

Hver fase kan tages i brug, før den næste starter.

| Fase | Indhold | Resultat |
|---|---|---|
| **0. Beslut** | De tre beslutninger nedenfor. Skriv ontologien for det, der findes i dag (Forening, Kommune, Arrangement, rettelser, HB, momentum). | Et fælles sprog |
| **1. Kerne i browseren** | Ontologi + objektsæt-motor i TypeScript oven på de nuværende JSON-filer (en adapter). Momentum og HB flyttes ind som beregnede egenskaber. Kort, panel og analysebyggeren bygges om til at bruge motoren. | Én implementering af hver regel. Alle egenskaber virker overalt. Ingen ny server. |
| **2. Rigtigt objektlager** | Supabase, migrering af foreninger, arrangementer og rettelser (rettelser → handlingslog). Personlige logins og roller. Python-sync skriver via API. | Sikker adgang, historik, klar til persondata |
| **3. Views** | Generiske widgets, gemte views med delte variabler, konfigurerbare objektsider. | Brugerne bygger selv |
| **4. Workflows** | Handlinger med formularer, regler på skema/ændring, opgaver og indbakke, mail. | "Kræver handling nu" bliver til opgaver med en ansvarlig |
| **5. Nye objekttyper** | Personer og roller (efter GDPR-afklaring), kampagner, økonomi, frivillige … | Hele foreningen i ét system |

Fase 1 er den vigtigste og kan laves uden at vælge backend. Den giver den grundlæggende struktur, som resten hviler på.

## Beslutninger, der skal træffes

1. **Skal personer (medlemmer, frivillige, bestyrelser) ind i systemet?** Hvis ja, er en rigtig backend med personlige logins et krav, ikke et valg.
2. **Hvem er brugerne?** Kun landsledelsen/admins, eller også lokale bestyrelser med adgang til egen forening? Det afgør rollemodellen.
3. **Bygge selv eller bygge på NocoDB/Baserow?** Anbefalingen er at bygge selv på Postgres (Supabase), fordi kortet og ét samlet interface er kernen i jeres idé.

## Forholdet til analysebyggeren i denne PR

`udvidelser/egne-analyser.js` er en **spike**: en hurtig afprøvning af objektsæt-idéen på det nuværende system. Dens `spec` (type, filtre, gruppering, mål) er et første udkast til objektsæt-sproget ovenfor. I fase 1 flyttes den ind i kernen, og dens hårdkodede feltliste (`TYPER`) erstattes af ontologien.
