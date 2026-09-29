// Foreningens forretningsregler: kategorier, status, dækning, HB-godkendelse og momentum – og analysernes regler
// (HB-risiko, hvide pletter og "Hvad virker?"), så de kun står ét sted. Rene funktioner: "nu" gives altid med.
// app.js og udvidelserne har ingen egne kopier; test/app.test.js og test/analyser.test.js sikrer, at flytningen hertil
// ikke ændrede noget.

import {DAG, dagNoegle, dagPlus, dageMellem, fmtDato, hbAar, kalenderdage, omEtKvartal, time} from './tid.js';

// ---------------------------------------------------------------- kategori og status for et arrangement

/** @type {[string, RegExp][]} */
export const KATEGORIER = [
  ['Foreningsmøde', /bestyrelsesm|generalforsamling|medlemsm|intro ?m|årsm|stiftende|velkomst|nye medlemmer|workshop|organisatorisk/i],
  ['Kampagne', /kampagne|\bstand\b|uddel|plakat|dør.til.dør|happening|valgkamp|flyer/i],
  ['Oplæg & debat', /oplæg|debat|keynote|foredrag|panel|ordfører|folketing|minister|besøg af|bogturn|webinar|diskussion|samtale|kursus|seminar|studiekreds|læsekreds|landsmøde/i],
  ['Socialt', /fredagsbar|fredagscaf|hygge|brætspil|\bfest|julefrokost|\bøl\b|\bbar\b|quiz|minigolf|\bspil|middag|bowling|grill|besøger|\btur\b|ekskursion|indvielse|reception|tag med|biograf|koncert|pizza/i],
];
/** @param {{navn?: string, beskrivelse?: string}} e */
export function kategori(e) {
  for (const tekst of [e.navn || '', e.beskrivelse || '']) {
    for (const [k, re] of KATEGORIER) if (re.test(tekst)) return k;
  }
  return 'Andet';
}

/**
 * Arrangementets status: planlagt / bekraeftet / afholdt / forsvundet / aflyst / ikke_afholdt / skjult.
 * @param {any} e rå arrangement med rettelser anvendt og slutD sat
 * @param {Date} nu
 */
export function arrStatus(e, nu) {
  if (e.skjult) return 'skjult';
  if (e.aflyst) return e.rettelse && e.rettelse.status === 'ikke_afholdt' ? 'ikke_afholdt' : 'aflyst';
  if (e.forsvundet) return 'forsvundet';
  if (e.slutD >= nu) return 'planlagt';
  return e.bekraeftet ? 'bekraeftet' : 'afholdt';
}

// ---------------------------------------------------------------- rettelser

/**
 * Anvender brugernes rettelser på de hentede arrangementer (samme regler som app.js og scripts/hb.py).
 * Rettelser: {"<id>": {status?, navn?, forening?, start?, slut?, sted?, deltagere?, note?, manuel?, rettet}}.
 * @param {any[]} events kopier – ændres
 * @param {Record<string, any>} rettelser
 */
export function anvendRettelser(events, rettelser) {
  const byId = new Map(events.map(e => [e.id, e]));
  for (const [id, r] of Object.entries(rettelser || {})) {
    let e = byId.get(id);
    if (!e) {
      if (!r.manuel || !r.start || !r.forening) continue; // Facebook-begivenheden findes ikke (længere)
      e = {id, manuel: true, url: '', navn: '', sted: '', lat: null, lng: null, kommune: null, online: false, aflyst: false,
        forsvundet: false, deltager: null, interesserede: null, svar: null, beskrivelse: '', foerst_set: r.rettet || r.start};
      events.push(e);
    }
    for (const k of ['navn', 'start', 'slut', 'sted']) if (r[k] != null && r[k] !== '') e[k] = r[k];
    if (r.forening && r.forening !== e.forening) { e.forening = r.forening; e.foreninger = [r.forening]; }
    if (r.status === 'afholdt') Object.assign(e, {aflyst: false, forsvundet: false, bekraeftet: true});
    else if (r.status === 'ikke_afholdt') e.aflyst = true;
    else if (r.status === 'skjult') e.skjult = true;
    if (r.deltagere != null) e.fremmoede = r.deltagere;
    if (r.note) e.note = r.note;
    e.rettelse = r;
  }
  return events;
}

// ---------------------------------------------------------------- dækning: hvor langt tilbage kendes data?

// Historikken henter højst så mange begivenheder pr. side (HISTORIK_MAX_PR_SIDE i scripts/sync.py).
export const HISTORIK_LOFT = 20;

/**
 * @typedef {object} Daekning
 * @property {string} ugentligFra  første ugentlige kørsel (YYYY-MM-DD)
 * @property {string} fra          historikkens startdato (eller ugentligFra)
 * @property {Map<string, string>} fraFor  pr. forening den første dag, historikken dækker helt
 * @property {Set<string>} hentet   foreninger, hvis historik er hentet (mindst én vellykket kørsel)
 * @property {Date} forsteKoersel
 */

/** Facebook-siderne for en forening. @param {any} f */
export const fbSider = f => [f.facebook, ...(f.facebook_ekstra || []).map(e => (typeof e === 'string' ? e : e.url))].filter(Boolean);

/**
 * Beregnes på de hentede data uden rettelser – som load() i app.js og scripts/hb.py.
 * @param {any} meta data/meta.json @param {any[]} events data/events.json @param {any[]} foreninger data/foreninger.json
 * @param {Date} nu
 * @returns {Daekning}
 */
export function beregnDaekning(meta, events, foreninger, nu) {
  const forsteKoersel = meta.koersler.length ? new Date(meta.koersler[0].tid) : nu;
  const ugentligFra = dagNoegle(forsteKoersel);
  const fra = meta.historik && meta.historik.fra ? dagNoegle(new Date(meta.historik.fra)) : ugentligFra;
  const prSide = new Map();
  for (const k of (meta.historik && meta.historik.koersler) || []) {
    if (k.status !== 'SUCCEEDED') continue;
    const aeldste = k.aeldste ? dagNoegle(new Date(k.aeldste))
      : events.filter(e => e.historisk && (e.foreninger || [e.forening]).includes(k.forening)).map(e => dagNoegle(new Date(e.start))).sort()[0];
    const loft = k.hentet >= (k.max || HISTORIK_LOFT) && k.begivenheder >= k.hentet;
    prSide.set(`${k.forening}|${k.side || ''}`, loft && aeldste ? aeldste : fra);
  }
  /** @type {Map<string, string>} */
  const fraFor = new Map();
  for (const f of foreninger) {
    const s = fbSider(f).map((u, i) => prSide.get(`${f.navn}|${u}`) || (i === 0 ? prSide.get(`${f.navn}|`) : null));
    if (s.length && s.every(Boolean)) fraFor.set(f.navn, s.sort()[s.length - 1]);
  }
  for (const f of foreninger) if (f.historik_fra) fraFor.set(f.navn, f.historik_fra);
  const hentet = new Set(((meta.historik && meta.historik.koersler) || []).filter(k => k.status === 'SUCCEEDED').map(k => k.forening));
  return {ugentligFra, fra, fraFor, forsteKoersel, hentet};
}

/** Første dag (YYYY-MM-DD), hvor foreningens afholdte arrangementer kendes fuldt ud. @param {Daekning} d @param {string} navn */
export function daekketFra(d, navn) {
  const h = d.fraFor.get(navn);
  return h && h < d.ugentligFra ? h : d.ugentligFra;
}

// ---------------------------------------------------------------- foreningens aktivitet (grundlaget for resten)

/**
 * @typedef {object} Aktivitet
 * @property {any[]} events      alle (ikke skjulte), sorteret efter start
 * @property {any[]} gyldige     hverken aflyst eller fjernet
 * @property {any[]} planlagt    gyldige, der ikke er slut
 * @property {any[]} afholdt     gyldige, der er slut
 * @property {any[]} afholdt90   afholdte de seneste 90 dage
 * @property {any[]} kommende    ikke fjernede, der ikke er slut (også aflyste – de vises som aflyst)
 * @property {any[]} naesteKvartal  kommende inden for et kvartal
 * @property {Date|null} sidste  start på sidste afholdte
 * @property {any|null} naeste   første planlagte
 * @property {string} daekketFra
 */

/** @param {any[]} events foreningens arrangementer @param {string} navn @param {Daekning} daekning @param {Date} nu @returns {Aktivitet} */
export function aktivitet(events, navn, daekning, nu) {
  const ev = [...events].sort((a, b) => a.startD - b.startD);
  const gyldige = ev.filter(e => !e.forsvundet && !e.aflyst);
  const planlagt = gyldige.filter(e => e.slutD >= nu);
  const afholdt = gyldige.filter(e => e.slutD < nu);
  const kommende = ev.filter(e => !e.forsvundet && e.slutD >= nu), hKvartal = omEtKvartal(nu);
  return {events: ev, gyldige, planlagt, afholdt, afholdt90: afholdt.filter(e => +nu - +e.startD <= 90 * DAG),
    kommende, naesteKvartal: kommende.filter(e => e.startD <= hKvartal),
    sidste: afholdt.length ? afholdt[afholdt.length - 1].startD : null, naeste: planlagt[0] || null,
    daekketFra: daekketFra(daekning, navn)};
}

/** Aktivitet nu: snart / planlagt / ingen / ingenfb. @param {Aktivitet} a @param {boolean} facebook */
export function aktivitetsStatus(a, facebook) {
  if (!facebook) return 'ingenfb';
  return a.naesteKvartal.some(e => !e.aflyst) ? 'snart' : a.planlagt.length ? 'planlagt' : 'ingen';
}

/** Antal afholdte i et kvartal. @param {Aktivitet} a @param {{fra: string, til: string}} k */
export function afholdtI(a, k) {
  return a.afholdt.filter(e => { const d = dagNoegle(e.startD); return d >= k.fra && d < k.til; }).length;
}

/**
 * Kvartalets status for kortets farvning "Afholdt i Qx": ja / nej / ukendt / ingenfb. 'ukendt', når kvartalet
 * ligger før den dag, foreningens data dækker fra – så ser den ikke inaktiv ud uden grund.
 * @param {number} antal afholdte i kvartalet @param {boolean} facebook @param {{fra: string}} k @param {string} daekketFraDag
 */
export function kvartalStatus(antal, facebook, k, daekketFraDag) {
  if (antal) return 'ja';
  if (!facebook) return 'ingenfb';
  return k.fra < daekketFraDag ? 'ukendt' : 'nej';
}

// ---------------------------------------------------------------- HB-godkendelse

/**
 * Kvartalets status for HB-kravet: ja / planlagt / mangler (kvartalet er ikke slut) / nej / ukendt (ingen data).
 * @param {Aktivitet} a @param {boolean} facebook @param {{fra: string, til: string}} k @param {Date} nu
 */
export function hbKvartal(a, facebook, k, nu) {
  const i = e => { const d = dagNoegle(e.startD); return d >= k.fra && d < k.til; };
  if (a.afholdt.some(i)) return 'ja';
  if (a.planlagt.some(i)) return 'planlagt';
  if (!facebook || k.fra < a.daekketFra) return 'ukendt';
  return dagNoegle(nu) < k.til ? 'mangler' : 'nej';
}

/**
 * HB-prognosen: plus_naeste / alle / planlagt_nu / mangler_nu / ikke / ukendt – og status pr. kvartal.
 * @param {Aktivitet} a @param {boolean} facebook @param {Date} nu
 */
export function hbPrognose(a, facebook, nu) {
  const hb = hbAar(nu);
  const s = hb.kvartaler.map(k => hbKvartal(a, facebook, k, nu)), foer = s.slice(0, hb.nuIndeks), nuS = s[hb.nuIndeks];
  const kvartaler = Object.fromEntries(hb.kvartaler.map((k, i) => [k.id, s[i]]));
  let status;
  if (foer.includes('nej')) status = 'ikke';
  else if (foer.includes('ukendt') || nuS === 'ukendt') status = 'ukendt';
  else if (nuS === 'planlagt') status = 'planlagt_nu';
  else if (nuS !== 'ja') status = 'mangler_nu';
  else {
    const naeste = a.planlagt.some(e => { const d = dagNoegle(e.startD); return d >= hb.naeste.fra && d < hb.naeste.til; });
    status = naeste ? 'plus_naeste' : 'alle';
  }
  return {status, kvartaler, aar: hb.aar};
}

// ---------------------------------------------------------------- HB-risiko: hvem skal handle i det indeværende kvartal?

// Dage tilbage af kvartalet (d), hvor intet afholdt eller planlagt er kritisk / en advarsel, og hvor et kvartal, der
// kun reddes af planlagte arrangementer, er en advarsel. Se README: HB-risiko.
export const HB_RISIKO = {KRITISK_DAGE: 14, ADVARSEL_DAGE: 45, PLANLAGT_DAGE: 21};
export const HB_RISIKO_NIVEAUER = {
  kritisk: 'Kritisk – intet afholdt eller planlagt, og kvartalet slutter snart',
  advarsel: 'Advarsel – intet afholdt, og kort tid tilbage',
  opmaerksom: 'Hold øje – intet afholdt endnu, men god tid',
  sikret: 'Kvartalet er i hus',
  tabt: 'Kan ikke HB-godkendes (et afsluttet kvartal uden afholdt arrangement)',
  ukendt: 'Mangler data for kvartalet',
};
// Grupperne i analysen "HB-risiko", i den rækkefølge man skal handle.
export const HB_RISIKO_SPANDE = {
  handle: 'Skal afholde et arrangement', planlagt: 'Afhænger af et planlagt arrangement', hold: 'Hold øje – god tid endnu',
  sikret: 'I hus for kvartalet', tabt: 'Kan ikke godkendes', ukendt: 'Mangler data',
};

/**
 * @typedef {object} HbRisiko
 * @property {string} niveau    kritisk / advarsel / opmaerksom / sikret / tabt / ukendt (HB_RISIKO_NIVEAUER)
 * @property {string} spand     handle / planlagt / hold / sikret / tabt / ukendt (HB_RISIKO_SPANDE)
 * @property {string} kvartal   det indeværende kvartal ('Q1' … 'Q4')
 * @property {string} status    kvartalets HB-status (hbKvartal): ja / planlagt / mangler / nej / ukendt
 * @property {string} sidsteDag kvartalets sidste dag (YYYY-MM-DD) – fristen
 * @property {number} dage      kalenderdage fra i dag til kvartalets sidste dag
 * @property {any[]} afholdt    afholdte i kvartalet
 * @property {any[]} planlagt   planlagte i kvartalet
 * @property {any[]} naesteKv   planlagte i det næste kvartal samme år (tomt i Q4)
 * @property {string[]} tabte   afsluttede kvartaler uden afholdt arrangement
 * @property {string[]} ukendte afsluttede kvartaler uden data
 */

/**
 * Risikoen for, at foreningen mister HB-godkendelsen på grund af det indeværende kvartal. Bruges af analysen og
 * advarslerne (udvidelser/hb-risiko.js) og månedsrapportens "Fremad".
 * @param {Aktivitet} a @param {{kvartaler: Record<string, string>}} hb hbPrognose() @param {Date} nu @returns {HbRisiko}
 */
export function hbRisiko(a, hb, nu) {
  const aar = hbAar(nu), kv = aar.kvartaler[aar.nuIndeks], naeste = aar.kvartaler[aar.nuIndeks + 1] || null;
  const i = k => e => { const d = dagNoegle(e.startD); return d >= k.fra && d < k.til; };
  const sidsteDag = dagPlus(kv.til, -1), dage = kalenderdage(dagNoegle(nu), sidsteDag), status = hb.kvartaler[kv.id];
  const foer = aar.kvartaler.slice(0, aar.nuIndeks);
  const tabte = foer.filter(k => hb.kvartaler[k.id] === 'nej').map(k => k.id);
  const ukendte = foer.filter(k => hb.kvartaler[k.id] === 'ukendt').map(k => k.id);
  const R = HB_RISIKO;
  let niveau, spand;
  if (tabte.length) niveau = spand = 'tabt';
  else if (status === 'ja') niveau = spand = 'sikret';
  else if (status === 'planlagt') {
    niveau = dage <= R.PLANLAGT_DAGE ? 'advarsel' : 'opmaerksom';
    spand = niveau === 'advarsel' ? 'planlagt' : 'hold';
  } else if (status === 'mangler') {
    niveau = dage <= R.KRITISK_DAGE ? 'kritisk' : dage <= R.ADVARSEL_DAGE ? 'advarsel' : 'opmaerksom';
    spand = niveau === 'opmaerksom' ? 'hold' : 'handle';
  } else niveau = spand = 'ukendt';
  return {niveau, spand, kvartal: kv.id, status, sidsteDag, dage, afholdt: a.afholdt.filter(i(kv)), planlagt: a.planlagt.filter(i(kv)),
    naesteKv: naeste ? a.planlagt.filter(i(naeste)) : [], tabte, ukendte};
}

// ---------------------------------------------------------------- hvide pletter: kommuner uden aktivitet

export const HVIDE_PLETTER = {DAGE: 365};

/**
 * Foreningens aktivitet pr. kommune i dens område ("hvide pletter" er kommunerne uden nogen): gyldige arrangementer, der
 * er slut inden for de seneste HVIDE_PLETTER.DAGE dage eller er planlagt, fordelt efter arrangementets kommune
 * (e.kommune). Arrangementer uden kendt kommune (fx online) og uden for området tælles for sig.
 * @param {Aktivitet} a @param {string[]} kommuner foreningens kommuner @param {Date} nu
 * @returns {{kommuner: Map<string, {afholdt: number, planlagt: number}>, ukendt: number, udenfor: number}}
 */
export function kommuneAktivitet(a, kommuner, nu) {
  const fra = new Date(+nu - HVIDE_PLETTER.DAGE * DAG);
  const ud = new Map(kommuner.map(k => [k, {afholdt: 0, planlagt: 0}]));
  let ukendt = 0, udenfor = 0;
  for (const e of a.gyldige) {
    if (e.slutD < fra) continue;
    const k = e.kommune ? ud.get(e.kommune) : null;
    if (!k) { if (e.kommune) udenfor++; else ukendt++; continue; }
    if (e.slutD < nu) k.afholdt++; else k.planlagt++;
  }
  return {kommuner: ud, ukendt, udenfor};
}

// ---------------------------------------------------------------- "Hvad virker?": deltagere målt mod det normale

// MIN_FORENING: færre afholdte med et tal, og foreningens normale niveau kan ikke bestemmes. MIN_N: grupper med færre
// arrangementer bruges ikke i konklusionerne. FORSKEL: mindste forskel i medianindeks, der kaldes en forskel.
export const HVAD_VIRKER = {MIN_FORENING: 3, MIN_N: 5, FORSKEL: 0.2};
// "Markant flere deltagere end normalt": mindst GANGE × foreningens median og mindst PLUS flere, målt mod mindst
// MIN_ANDRE andre afholdte. Afholdt de seneste BAGUD dage eller planlagt de næste FREMAD dage. Se rekord().
export const REKORD = {GANGE: 1.5, PLUS: 5, MIN_ANDRE: 3, BAGUD: 30, FREMAD: 14};
// Målene: deltagere på Facebook, tilkendegivelser ("deltager" + "interesseret") og registreret fremmøde.
/** @type {Record<string, (e: any) => number|null>} */
export const DELTAGER_MAAL = {deltager: e => e.deltager, svar: e => e.svar, fremmoede: e => e.fremmoede};
// Starttidspunkt og varsel i grupper (til "Hvad virker?" og analysebyggeren).
export const STARTTID = {foer12: 'Før kl. 12', kl12: 'Kl. 12–17', kl17: 'Kl. 17–19', kl19: 'Kl. 19 eller senere'};
export const VARSEL_GRUPPER = {u7: 'Under 7 dage', d7: '7–13 dage', d14: '14–27 dage', d28: '28 dage eller mere'};

/** Medianen (null for ingen). @param {number[]} xs */
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Starttidspunktets gruppe (dansk tid). @param {Date} d */
export function starttid(d) {
  const h = time(d);
  return h < 12 ? 'foer12' : h < 17 ? 'kl12' : h < 19 ? 'kl17' : 'kl19';
}

/**
 * Varsel i dage, som "Hvad virker?" måler det: som varsel(), men kun når arrangementet blev opdaget, før det fandt sted.
 * @param {any} e @param {Date} forsteKoersel
 */
export function varselDage(e, forsteKoersel) {
  const v = varsel(e, forsteKoersel);
  return v != null && e.startD >= e.firstD ? v : null;
}
/** @param {number|null} d varselDage() */
export const varselGruppe = d => (d == null ? null : d < 7 ? 'u7' : d < 14 ? 'd7' : d < 28 ? 'd14' : 'd28');

/**
 * Foreningens afholdte arrangementer med et tal for målet – hvert arrangement kun én gang: hos den første af
 * arrangørerne, der er en lokalforening. Landsforeningen får alle sine (den måles for sig).
 * @param {Aktivitet} a @param {string} navn @param {boolean} national @param {string} maal DELTAGER_MAAL
 * @param {Set<string>} lokale lokalforeningernes navne
 */
export function afholdteMed(a, navn, national, maal, lokale) {
  const v = DELTAGER_MAAL[maal];
  return a.afholdt.filter(e => v(e) != null && (national || e.foreninger.find(n => lokale.has(n)) === navn));
}

/**
 * @typedef {object} Normalniveau
 * @property {number} n                antal afholdte med et tal for målet
 * @property {number|null} median      foreningens normale niveau; null, hvis det ikke kan bestemmes
 * @property {{e: any, vaerdi: number, indeks: number}[]} arrangementer  med indeks = tal ÷ median (tom uden median)
 */

/**
 * Foreningens normale niveau: medianen af dens afholdte med et tal for målet – kun med mindst HVAD_VIRKER.MIN_FORENING
 * og en median over 0. Hvert arrangement måles mod det (indeks), så store foreninger ikke dominerer.
 * @param {any[]} liste afholdteMed() @param {string} maal @returns {Normalniveau}
 */
export function normalniveau(liste, maal) {
  const v = DELTAGER_MAAL[maal], m = median(liste.map(v));
  const ok = liste.length >= HVAD_VIRKER.MIN_FORENING && !!m;
  return {n: liste.length, median: ok ? m : null, arrangementer: ok ? liste.map(e => ({e, vaerdi: v(e), indeks: v(e) / m})) : []};
}

/**
 * Markant flere deltagere end normalt: foreningens arrangement – afholdt de seneste REKORD.BAGUD dage eller planlagt de
 * næste REKORD.FREMAD dage – med mindst REKORD.GANGE × og REKORD.PLUS flere end medianen af foreningens andre afholdte
 * med samme mål (mindst REKORD.MIN_ANDRE). Registreret fremmøde går forud for deltagere på Facebook, når det kan
 * sammenlignes; planlagte måles på Facebook-deltagere. Højst ét (det største) pr. forening; null, hvis der ikke er noget.
 * @param {Aktivitet} a @param {(maal: string) => any[]} afholdteMedMaal foreningens afholdteMed() for et mål @param {Date} nu
 * @returns {{e: any, maal: string, x: number, m: number, gange: number, afholdt: boolean}|null}  gange: Infinity, når m er 0
 */
export function rekord(a, afholdteMedMaal, nu) {
  const R = REKORD, fra = new Date(nu.getTime() - R.BAGUD * DAG), til = new Date(nu.getTime() + R.FREMAD * DAG);
  let bedst = null;
  for (const e of a.gyldige) {
    const afholdt = e.slutD < nu;
    if (afholdt ? e.slutD < fra : e.startD > til) continue;
    for (const maal of afholdt ? ['fremmoede', 'deltager'] : ['deltager']) {
      const v = DELTAGER_MAAL[maal], x = v(e);
      if (x == null) continue;
      const andre = afholdteMedMaal(maal).filter(o => o !== e).map(v);
      if (andre.length < R.MIN_ANDRE) continue;
      const m = median(andre);
      if (x >= R.GANGE * m && x - m >= R.PLUS && (!bedst || x / m > bedst.gange)) bedst = {e, maal, x, m, gange: m ? x / m : Infinity, afholdt};
      break; // fremmøde går forud for Facebook, når det kan sammenlignes
    }
  }
  return bedst;
}

// ---------------------------------------------------------------- momentum

export const MOMENTUM = {VINDUE: 90, MAAL: 3, MAANED: 31, HJAELP: 45, FREMAD: 30, NORMAL: 365};
export const MOMENTUM_NIVEAUER = {
  hjaelp: {ikon: '⚠', label: 'Brug for hjælp', hint: `Over ${MOMENTUM.HJAELP} dage siden sidste arrangement og intet i kalenderen`},
  faldende: {ikon: '↘', label: 'Mister fart', hint: 'Over en måned siden sidste arrangement og intet i kalenderen – eller færre arrangementer end normalt'},
  fremad: {ikon: '⤴', label: 'Noget på vej', hint: `Over en måned siden sidste arrangement, men noget i kalenderen de næste ${MOMENTUM.FREMAD} dage`},
  ukendt: {ikon: '?', label: 'Historik mangler', hint: `Intet afholdt, og data dækker højst ${MOMENTUM.HJAELP} dage`},
  stabil: {ikon: '→', label: 'På sporet', hint: `Arrangement inden for den seneste måned, men færre end ${MOMENTUM.MAAL} de seneste 3 måneder`},
  godt: {ikon: '↗', label: 'Godt i gang', hint: `Mindst ét arrangement om måneden (${MOMENTUM.MAAL} eller flere de seneste 3 måneder)`},
  ingenfb: {ikon: '–', label: 'Ingen Facebook-side', hint: 'Aktiviteter kan ikke hentes automatisk'},
};
const momTal = v => v.toLocaleString('da-DK', {maximumFractionDigits: 1});

/**
 * Momentum: en tidlig sundhedsindikator – holder foreningen mindst ét arrangement om måneden? Se README "Momentum".
 * @param {Aktivitet} a @param {boolean} facebook @param {Date} nu
 */
export function momentum(a, facebook, nu) {
  const M = MOMENTUM;
  const fra = new Date(nu.getTime() - M.VINDUE * DAG), til = new Date(nu.getTime() + M.FREMAD * DAG);
  const daekketD = new Date(a.daekketFra + 'T00:00:00Z');
  const afholdt = a.afholdt.filter(e => e.startD >= fra).length;
  const fremad = a.planlagt.filter(e => e.startD <= til).length;
  const daekket = daekketD <= fra;
  const nFra = new Date(Math.max(+daekketD, +fra - M.NORMAL * DAG)), nDage = dageMellem(nFra, fra);
  const normalt = nDage >= M.VINDUE
    ? Math.round(a.afholdt.filter(e => e.startD >= nFra && e.startD < fra).length / nDage * M.VINDUE * 10) / 10 : null;
  const trend = normalt == null ? null : afholdt >= normalt + 1 ? 'op' : afholdt <= normalt - 1 ? 'ned' : 'som';
  const aflyst = a.events.filter(e => e.aflyst && e.startD >= fra && e.startD < nu).length;
  const sidsteDage = a.sidste ? dageMellem(a.sidste, nu) : null;
  const naesteDage = a.naeste ? Math.max(0, dageMellem(nu, a.naeste.startD)) : null;
  const d = sidsteDage ?? dageMellem(daekketD, nu);
  const niveau = !facebook && !a.gyldige.length ? 'ingenfb'
    : sidsteDage == null && d <= M.HJAELP ? 'ukendt'
    : d > M.MAANED ? (fremad ? 'fremad' : d > M.HJAELP ? 'hjaelp' : 'faldende')
    : afholdt >= M.MAAL ? 'godt'
    : trend === 'ned' && !fremad ? 'faldende' : 'stabil';
  const grund = niveau === 'faldende' && d <= M.MAANED
    ? `Færre arrangementer end normalt (${afholdt} de seneste 3 måneder, normalt ${momTal(normalt)}) og intet i kalenderen`
    : niveau === 'faldende' ? 'Over en måned siden sidste arrangement og intet i kalenderen' : MOMENTUM_NIVEAUER[niveau].hint;
  /** @type {[string, string][]} */
  const signaler = [];
  if (niveau !== 'ingenfb') {
    if (sidsteDage == null) signaler.push(['-', `Intet afholdt siden ${fmtDato.format(daekketD)}`]);
    else if (sidsteDage > M.MAANED) signaler.push(['-', `${sidsteDage} dage siden sidste arrangement – over en måned`]);
    else signaler.push(['+', `Sidste arrangement for ${sidsteDage} dage siden`]);
    if (!daekket) signaler.push(['i', `Data dækker kun ${dageMellem(daekketD, nu)} af de seneste ${M.VINDUE} dage`]);
    else signaler.push([afholdt >= M.MAAL ? '+' : '-', `${afholdt} af ${M.MAAL} arrangementer de seneste 3 måneder`]);
    if (!a.planlagt.length) signaler.push(['-', 'Intet i kalenderen endnu']);
    else if (naesteDage > M.FREMAD) signaler.push(['-', `Næste arrangement først om ${naesteDage} dage`]);
    else signaler.push(['+', naesteDage === 0 ? 'Arrangement i dag' : `Næste arrangement om ${naesteDage} dage`]);
    if (trend === 'ned') signaler.push(['-', `Færre end normalt (normalt ${momTal(normalt)} pr. 3 måneder)`]);
    if (trend === 'op') signaler.push(['+', `Flere end normalt (normalt ${momTal(normalt)} pr. 3 måneder)`]);
    if (aflyst) signaler.push(['-', `${aflyst} aflyst de seneste 3 måneder`]);
  }
  return {niveau, grund, sidsteDage, naesteDage, afholdt, daekket, normalt, trend, fremad, aflyst, signaler};
}

/**
 * Varsel i dage: fra arrangementet blev opdaget, til det fandt sted. null for historiske og manuelle, og for dem, der
 * blev opdaget ved første kørsel (de kan have ligget der længe). @param {any} e @param {Date} forsteKoersel
 */
export function varsel(e, forsteKoersel) {
  return !e.historisk && !e.manuel && +e.firstD - +forsteKoersel > DAG ? (+e.startD - +e.firstD) / DAG : null;
}
