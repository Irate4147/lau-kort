// Månedsrapportens regler – den eneste kopi. Browseren viser "Denne måned indtil nu" med maanedIndtilNu og fremad (se
// udvidelser/maanedsrapport.js); scripts/rapport.py laver de gemte rapporter med opdater (via scripts/kerne.js):
// snapshots, "Bagud" (hvad skete der i måneden), "Fremad" (kommende arrangementer og risici) og udskriften i loggen.
// Rene funktioner over objektlageret: "nu" er lagerets. Afsluttede måneder rekonstrueres med et lager på et tidligere
// tidspunkt (bygFraJson med ved: {tid, rekonstruer}): kun det, man vidste dengang (tilstandVed i regler.js).

import {DAG, TZ, dagNoegle, dagPlus, hbAar, kalenderdage, maanedNoegle, time} from './tid.js';
import {MOMENTUM_NIVEAUER, daekketFra} from './regler.js';

/** @typedef {import('./lager.js').Lager} Lager @typedef {import('./regler.js').Aktivitet} Aktivitet */

// Bedst først (til visningen). HB-kategorierne med samme nøgler som HB_STATUS ('ukendt' sammenlignes ikke).
export const MOM_RAEKKE = ['godt', 'stabil', 'fremad', 'faldende', 'hjaelp', 'ukendt', 'ingenfb'];
export const HB_ORDEN = ['plus_naeste', 'alle', 'planlagt_nu', 'mangler_nu', 'ikke'];
// Fremad ser så mange dage frem fra rapportens tidspunkt (5 uger ≈ den næste måned). Risici sorteres efter niveau og
// derefter type (inden for samme niveau).
export const FREMAD_DAGE = 35;
export const RISIKO_ORDEN = {kritisk: 0, advarsel: 1, opmaerksom: 2};
export const RISIKO_TYPE = ['aarsskifte', 'hb', 'hb_planlagt', 'hjaelp', 'faldende'];
// Momentum-niveauerne i rækkefølgen fra regler.js: dem, der kræver handling, først (lavere = værre). Også nøglernes
// rækkefølge i fordelingen.
const MOM_ORDEN = Object.fromEntries(Object.keys(MOMENTUM_NIVEAUER).map((k, i) => [k, i]));
const MAANEDER = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];

const fmtKort = new Intl.DateTimeFormat('da-DK', {day: 'numeric', month: 'short', timeZone: TZ});
/** 'ÅÅÅÅ-MM-DD' -> "30. sep." (men "31. maj") @param {string} d */
export const kortDato = d => fmtKort.format(new Date(d + 'T12:00:00Z'));
/** @param {string} m 'ÅÅÅÅ-MM' */
const naesteMaaned = m => { const [y, mm] = m.split('-').map(Number); return `${y + (mm === 12 ? 1 : 0)}-${String(mm % 12 + 1).padStart(2, '0')}`; };
/** @param {string} m 'ÅÅÅÅ-MM' */
const forrigeMaaned = m => { const [y, mm] = m.split('-').map(Number); return `${y - (mm === 1 ? 1 : 0)}-${String((mm + 10) % 12 + 1).padStart(2, '0')}`; };
/** Den 1. i måneden kl. 0 dansk tid. @param {string} m 'ÅÅÅÅ-MM' */
export function maanedStart(m) {
  const midnat = Date.parse(`${m}-01T00:00:00Z`);
  // Dansk tid er UTC+1 eller +2: midnat er kl. 22 eller 23 UTC dagen før.
  for (const t of [2, 1]) { const d = new Date(midnat - t * 36e5); if (dagNoegle(d) === `${m}-01` && time(d) === 0) return d; }
  throw new Error(`Kan ikke finde midnat den ${m}-01`);
}
/** Kvartalet som 'ÅÅÅÅ-i' (i = 0–3). @param {Date} d */
const kvartalAf = d => `${dagNoegle(d).slice(0, 4)}-${Math.floor((+dagNoegle(d).slice(5, 7) - 1) / 3)}`;
/** Sekunder, som de gemte rapporter altid har haft dem. @param {Date} d */
const iso = d => d.toISOString().replace(/\.\d+Z$/, 'Z');
/** Afkort til n tegn (tegn, ikke UTF-16-enheder: en emoji deles ikke). @param {string} s @param {number} n */
const trunc = (s, n) => { const t = [...s]; return t.length > n ? t.slice(0, n - 1).join('').trimEnd() + '…' : s; };
/** @param {string[]} a */
const opremsning = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} og ${a[a.length - 1]}`);
/** @param {number} d */
export const dageTekst = d => (d <= 0 ? 'sidste dag i dag' : d === 1 ? '1 dag tilbage' : `${d} dage tilbage`);
/** @param {string} t */
const punktum = t => (t.endsWith('.') ? t : t + '.');
/** Er to JSON-værdier ens (nøglernes rækkefølge er ligegyldig)? @param {any} a @param {any} b @returns {boolean} */
const ens = (a, b) => a === b || (!!a && !!b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)
  && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && ens(a[k], b[k])));
/** @param {Record<string, any>} o @param {string} felt */
const uden = (o, felt) => { const {[felt]: _, ...rest} = o; return rest; };

/**
 * Er foreningen faldet eller forbedret i momentum eller HB-prognose?
 * @param {{momentum: {start: string|null, slut: string|null}, hb: {start: string|null, slut: string|null}}} rf
 * @param {boolean} hbSamme  start og slut gælder samme HB-år
 * @param {boolean} kvSamme  start og slut ligger i samme kvartal
 */
export function sammenlign(rf, hbSamme, kvSamme) {
  const [a, b] = [rf.momentum.start, rf.momentum.slut], [ha, hb] = [rf.hb.start, rf.hb.slut];
  const mom = a && b && a !== b && ![a, b].some(x => x === 'ukendt' || x === 'ingenfb') ? [a, b] : null;
  // Et nyt kvartal nulstiller HB-prognosen: så tæller kun et skift til "ikke" (kan ikke godkendes).
  const hbx = hbSamme && HB_ORDEN.includes(ha) && HB_ORDEN.includes(hb) && ha !== hb && (kvSamme || hb === 'ikke') ? [ha, hb] : null;
  const ned = (mom && MOM_ORDEN[b] < MOM_ORDEN[a]) || (hbx && HB_ORDEN.indexOf(hb) > HB_ORDEN.indexOf(ha));
  const op = (mom && MOM_ORDEN[b] > MOM_ORDEN[a]) || (hbx && HB_ORDEN.indexOf(hb) < HB_ORDEN.indexOf(ha));
  return {ned, op, mom, hb: hbx};
}

// ---------------------------------------------------------------- snapshots

/**
 * Tilstanden for alle foreninger på lagerets tidspunkt (et snapshot): antal afholdte og planlagte, aflyste (id'er,
 * sorteret) og for lokalforeninger momentum og HB-prognose.
 * @param {Lager} L
 */
export function tilstand(L) {
  /** @type {Record<string, any>} */
  const foreninger = {};
  for (const f of L.alle('Forening')) {
    /** @type {Aktivitet} */
    const a = L.vaerdi(f, 'aktivitet');
    /** @type {Record<string, any>} */
    const s = {afholdt: a.afholdt.length, planlagt: a.planlagt.length, aflyste: a.events.filter(e => e.aflyst).map(e => e.id).sort()};
    if (!f.v.national) {
      const m = L.vaerdi(f, 'momentumDetaljer');
      Object.assign(s, {niveau: m.niveau, sidste_dage: m.sidsteDage, naeste_dage: m.naesteDage, afholdt_3md: m.afholdt,
        normalt: m.normalt, fremad: m.fremad, hb: L.vaerdi(f, 'hb')});
    }
    foreninger[f.v.navn] = s;
  }
  return {tid: iso(L.nu), hb_aar: hbAar(L.nu).aar, foreninger};
}

/**
 * Snapshot for måned m: den 1. om morgenen med data, som de er (første kørsel i måneden), ellers rekonstrueret pr. den
 * 1. kl. 0 – kun det, man vidste dengang.
 * @param {Lager} L lageret nu @param {(tid: Date, rekonstruer: boolean) => Lager} ved lageret på et andet tidspunkt
 * @param {string} m 'ÅÅÅÅ-MM'
 */
export function snapshot(L, ved, m) {
  const live = m === maanedNoegle(L.nu) && dagNoegle(L.nu).endsWith('-01');
  return {...tilstand(live ? L : ved(maanedStart(m), true)), rekonstrueret: !live, taget: iso(L.nu)};
}

// ---------------------------------------------------------------- Bagud

/**
 * Rapporten for måned m (Bagud): hvad der skete i måneden ifølge data nu (lageret L), og hvordan momentum og
 * HB-prognose ændrede sig fra snapshottet ved månedens start til det ved slut (for indeværende måned: nu).
 * @param {Lager} L lageret nu
 * @param {string} m 'ÅÅÅÅ-MM'
 * @param {any} start snapshottet ved månedens start ({tid, hb_aar, rekonstrueret?, foreninger: {navn: {niveau, hb, aflyste}}}) eller null
 * @param {any} slut  snapshottet ved månedens slut (samme form)
 * @param {{foreloebig?: boolean, fremad?: any}} [valg] fremad: rapportens "Fremad" (gemmes med i rapporten)
 */
export function maanedsrapport(L, m, start, slut, {foreloebig = false, fremad: fr = null} = {}) {
  const fra = `${m}-01`, til = `${naesteMaaned(m)}-01`;
  const forsteKoersel = L.kontekst.daekning.forsteKoersel;
  const iMd = d => { const k = dagNoegle(d); return k >= fra && k < til; };
  const s0 = n => (start && start.foreninger[n]) || {}, s1 = n => slut.foreninger[n] || {};
  // Når et nyt kvartal begynder, starter HB-prognosen forfra (fx "alle" → "mangler_nu"): så tæller kun et skift til
  // "ikke" (kan ikke godkendes) som et fald. Ved nytår gælder prognosen et nyt HB-år og sammenlignes ikke.
  const hbSamme = !!start && start.hb_aar === slut.hb_aar;
  const kvSamme = !!start && kvartalAf(new Date(start.tid)) === kvartalAf(new Date(slut.tid));
  const kort = (e, x = {}) => ({id: e.id, dato: dagNoegle(e.startD), navn: e.navn || '', ...x});
  // Arrangementernes rækkefølge i lageret (til nye aflysninger: efter dato, som foreningens arrangementer).
  const plads = new Map(L.alle('Arrangement').map((o, i) => [o.id, i]));
  const alle = {afholdt: new Map(), aflyst: new Map(), nye: new Map(), forsvundet: new Map()};
  const hoejde = {faldet: [], forbedret: [], uden_aktivitet: [], nye_aflysninger: []};
  const foreninger = {}, lokale = L.alle('Forening').filter(f => !f.v.national);
  let udenData = 0;
  for (const f of L.alle('Forening')) {
    /** @type {Aktivitet} */
    const a = L.vaerdi(f, 'aktivitet'), navn = f.v.navn;
    const r = {
      afholdt: a.afholdt.filter(e => iMd(e.startD)),
      aflyst: a.events.filter(e => e.aflyst && iMd(e.startD)),
      // Nye på Facebook i måneden – ikke hentet bagudrettet, manuelle eller fundet ved den første kørsel (de har intet
      // varsel, se varsel() i regler.js).
      nye: a.events.filter(e => !e.historisk && !e.manuel && iMd(e.firstD) && +e.firstD - +forsteKoersel > DAG),
      forsvundet: a.events.filter(e => e.forsvundet && e.sidst_set && iMd(new Date(e.sidst_set))),
    };
    for (const [k, l] of Object.entries(r)) for (const e of l) alle[k].set(e.id, e);
    const moedt = r.afholdt.filter(e => e.fremmoede != null).map(e => e.fremmoede);
    const daekket = !!f.v.facebook && a.daekketFra <= fra;
    /** @type {any} */
    const rf = {
      afholdt: r.afholdt.map(e => kort(e, e.fremmoede != null ? {fremmoede: e.fremmoede} : {})),
      aflyst: r.aflyst.map(e => kort(e)), nye: r.nye.map(e => kort(e, {oprettet: dagNoegle(e.firstD)})),
      forsvundet: r.forsvundet.map(e => kort(e)), fremmoede: moedt.length ? moedt.reduce((x, y) => x + y, 0) : null, daekket,
    };
    // Nye aflysninger: aflyst ved slut, men ikke ved start (uanset arrangementets dato).
    if (start) {
      const foer = new Set(s0(navn).aflyste || []);
      const nye = (s1(navn).aflyste || []).filter(id => !foer.has(id)).map(id => L.hent('Arrangement', id)).filter(Boolean)
        .map(o => o.v.raw).sort((x, y) => x.startD - y.startD || plads.get(x.id) - plads.get(y.id));
      for (const e of nye) hoejde.nye_aflysninger.push({forening: navn, ...kort(e)});
    }
    if (!f.v.national) {
      const niveau = s1(navn).niveau ?? null;
      rf.momentum = {start: s0(navn).niveau ?? null, slut: niveau};
      rf.hb = {start: s0(navn).hb ?? null, slut: s1(navn).hb ?? null};
      // Faldet går forud; en forening kan kun stå ét sted.
      const s = sammenlign(rf, hbSamme, kvSamme);
      if (s.ned || s.op) hoejde[s.ned ? 'faldet' : 'forbedret'].push({forening: navn, momentum: s.mom, hb: s.hb});
      if (!r.afholdt.length && daekket) {
        const foer = a.afholdt.filter(e => dagNoegle(e.startD) < fra);
        hoejde.uden_aktivitet.push({forening: navn, niveau, sidste: foer.length ? dagNoegle(foer[foer.length - 1].startD) : null});
      } else if (!r.afholdt.length) udenData++;
    }
    foreninger[navn] = rf;
  }
  const moedt = [...alle.afholdt.values()].filter(e => e.fremmoede != null).map(e => e.fremmoede);
  const fordel = (keys, s, felt) => Object.fromEntries(keys.map(k => [k, lokale.filter(f => ((s.foreninger[f.v.navn] || {})[felt] ?? null) === k).length]));
  const fordeling = (keys, felt) => ({start: start ? fordel(keys, start, felt) : null, slut: fordel(keys, slut, felt)});
  const kant = s => ({tid: s.tid, rekonstrueret: !!s.rekonstrueret, hb_aar: s.hb_aar});
  return {
    maaned: m, fra, til, foreloebig, beregnet: iso(L.nu), ...(fr ? {fremad: fr} : {}),
    start: start ? kant(start) : null, slut: kant(slut),
    total: {
      afholdt: alle.afholdt.size, aflyst: alle.aflyst.size, nye: alle.nye.size, forsvundet: alle.forsvundet.size,
      fremmoede: moedt.length ? moedt.reduce((x, y) => x + y, 0) : null, med_fremmoede: moedt.length,
      lokale: lokale.length, aktive: lokale.filter(f => foreninger[f.v.navn].afholdt.length).length,
      uden_aktivitet: hoejde.uden_aktivitet.length, uden_data: udenData,
      faldet: hoejde.faldet.length, forbedret: hoejde.forbedret.length, nye_aflysninger: start ? hoejde.nye_aflysninger.length : null,
    },
    fordeling: {momentum: fordeling(Object.keys(MOM_ORDEN), 'niveau'), hb: fordeling([...HB_ORDEN, 'ukendt'], 'hb')},
    hoejdepunkter: hoejde, foreninger,
  };
}

/**
 * Bagud for den indeværende måned indtil nu (siden: "Denne måned indtil nu"). Momentum og HB-prognose sammenlignes med
 * snapshottet fra månedens start, hvis det findes.
 * @param {Lager} L
 * @param {any} [snap] snapshottet fra månedens start ({tid, hb_aar, rekonstrueret?, foreninger: {navn: {niveau, hb, aflyste}}})
 */
export function maanedIndtilNu(L, snap = null) {
  return maanedsrapport(L, maanedNoegle(L.nu), snap, tilstand(L), {foreloebig: true});
}

// ---------------------------------------------------------------- Fremad

/**
 * Fremad fra lagerets tidspunkt: kommende arrangementer de næste FREMAD_DAGE dage, lokalforeninger uden noget planlagt og
 * risici sorteret efter alvor, hver med en konkret handling. HB-risikoen er regler.js' hbRisiko (egenskaben
 * hbRisikoDetaljer); forklaring er rapportens korte forklaring på den. For en afsluttet måned er lageret rekonstrueret
 * pr. den 1. i måneden efter (rekonstrueret: true), så en gammel rapport viser, hvad man vidste dengang. Ligger
 * tidspunktet før den første ugentlige kørsel (kun i gemte rapporter – se valg.gemt), kendtes ingen planlagte arrangementer.
 * @param {Lager} L
 * @param {{rekonstrueret?: boolean, gemt?: boolean}} [valg] gemt: til en gemt rapport (scripts/rapport.py)
 */
export function fremad(L, {rekonstrueret = false, gemt = false} = {}) {
  const nu = L.nu, fra = dagNoegle(nu), til = dagPlus(fra, FREMAD_DAGE); // til: første dag efter perioden
  const hb = hbAar(nu), HB_AAR = hb.aar, KV = hb.kvartaler[hb.nuIndeks], sidste = dagPlus(KV.til, -1), kvDage = kalenderdage(fra, sidste);
  const forsteKoersel = L.kontekst.daekning.forsteKoersel;
  const iPeriode = e => { const d = dagNoegle(e.startD); return d >= fra && d < til; };
  const kort = e => ({id: e.id, dato: dagNoegle(e.startD), navn: e.navn || ''});
  const kommende = {}, udenPlanlagt = [], risici = [], alle = new Set(), manglerQ4 = [];
  const lokale = L.alle('Forening').filter(f => !f.v.national);
  // Q4 er årets sidste kvartal: dets sidste dag er også fristen for HB-godkendelsen.
  const fristQ4 = KV.id === 'Q4' ? ` Q4 er årets sidste kvartal: ${kortDato(sidste)} er også fristen for HB-godkendelsen.` : '';
  for (const f of L.alle('Forening')) {
    /** @type {Aktivitet} */
    const a = L.vaerdi(f, 'aktivitet'), navn = f.v.navn;
    const mine = a.planlagt.filter(iPeriode);
    if (mine.length) { kommende[navn] = mine.map(kort); mine.forEach(e => alle.add(e.id)); }
    if (f.v.national) continue;
    const m = L.vaerdi(f, 'momentumDetaljer'), r = L.vaerdi(f, 'hbRisikoDetaljer'), status = r.status, dage = r.dage;
    if (!mine.length) {
      const efter = a.planlagt.find(e => dagNoegle(e.startD) >= til);
      udenPlanlagt.push({forening: navn, niveau: m.niveau, facebook: !!f.v.facebook,
        sidste: a.sidste ? dagNoegle(a.sidste) : null, naeste: efter ? dagNoegle(efter.startD) : null});
    }
    if (status === 'mangler' && (r.niveau === 'kritisk' || r.niveau === 'advarsel')) {
      risici.push({forening: navn, niveau: r.niveau, type: 'hb', dage,
        tekst: `HB ${HB_AAR} i fare – intet afholdt eller planlagt i ${KV.id}, ${dageTekst(dage)}.`,
        handling: punktum(`Afhold et arrangement senest ${kortDato(sidste)}`),
        forklaring: `Intet afholdt eller planlagt i ${KV.id} – ${dageTekst(dage)}.${fristQ4}`});
    }
    const planlagt = r.planlagt;
    if (status === 'planlagt' && planlagt.length && (r.niveau === 'advarsel' || r.niveau === 'opmaerksom') && dage < FREMAD_DAGE) {
      const e = planlagt[0], dato = kortDato(dagNoegle(e.startD)), flere = `${planlagt.length} planlagte arrangementer (det første ${dato})`;
      const hvad = planlagt.length === 1 ? `ét planlagt arrangement: "${trunc(e.navn || 'uden titel', 50)}" ${dato}` : flere;
      risici.push({forening: navn, niveau: r.niveau, type: 'hb_planlagt', dage,
        tekst: `${KV.id} hænger på ${hvad} – ${dageTekst(dage)}.`,
        handling: 'Sørg for, at det bliver afholdt, og bekræft det bagefter (✓ Afholdt).',
        forklaring: `Intet afholdt i ${KV.id} endnu – kvartalet afhænger af ${planlagt.length === 1 ? `"${e.navn || ''}" (${dato})` : flere}.${fristQ4}`});
    }
    // Q4 er ikke i hus (og ikke tabt): mangler til årsskiftet.
    if (KV.id === 'Q4' && (status === 'mangler' || status === 'planlagt') && L.vaerdi(f, 'hb') !== 'ikke') manglerQ4.push(navn);
    if (m.niveau === 'hjaelp' || m.niveau === 'faldende') {
      const hjaelp = m.niveau === 'hjaelp';
      const siden = m.sidsteDage != null ? `${m.sidsteDage} dage siden sidste arrangement` : `intet afholdt siden ${kortDato(a.daekketFra)}`;
      const faerre = m.trend === 'ned' ? ', færre end normalt' : '';
      risici.push({forening: navn, niveau: hjaelp ? 'advarsel' : 'opmaerksom', type: m.niveau,
        tekst: `${hjaelp ? 'Brug for hjælp' : 'Mister fart'} – ${siden}${faerre}, intet i kalenderen.`,
        handling: hjaelp ? 'Kontakt foreningen, og hjælp med at planlægge næste arrangement.' : 'Spørg til næste arrangement, før foreningen går i stå.'});
    }
  }
  const aarFrist = `${fra.slice(0, 4)}-12-31`;
  if (fra <= aarFrist && aarFrist < til && manglerQ4.length) {
    risici.push({forening: null, niveau: 'advarsel', type: 'aarsskifte', dage: kalenderdage(fra, aarFrist),
      tekst: `Årsskiftet: 31. dec. er fristen for HB-godkendelse ${HB_AAR} – ${manglerQ4.length} ${manglerQ4.length === 1 ? 'lokalforening' : 'lokalforeninger'} mangler stadig et afholdt arrangement i Q4 (${opremsning(manglerQ4)}).`,
      handling: 'Sørg for, at de afholder et arrangement før jul, og at arrangementer uden for Facebook er tilføjet under Arrangementer.'});
  }
  // Alvor, type, færrest dage tilbage og foreningens navn (dansk: Aalborg og Aarhus står under "Å").
  risici.sort((a, b) => RISIKO_ORDEN[a.niveau] - RISIKO_ORDEN[b.niveau] || RISIKO_TYPE.indexOf(a.type) - RISIKO_TYPE.indexOf(b.type)
    || (a.dage ?? 999) - (b.dage ?? 999) || (a.forening || '').localeCompare(b.forening || '', 'da'));
  return {
    tid: iso(nu), fra, til, dage: FREMAD_DAGE, rekonstrueret,
    // Før de ugentlige kørsler startede, kendes ingen planlagte arrangementer.
    ufuldstaendig: gemt && +nu < +forsteKoersel, kendt_fra: dagNoegle(forsteKoersel),
    kvartal: {navn: KV.id, hb_aar: HB_AAR, sidste_dag: sidste, dage: kvDage},
    total: {arrangementer: alle.size, foreninger_med: lokale.filter(f => kommende[f.v.navn]).length, lokale: lokale.length,
      uden_planlagt: udenPlanlagt.length, ...Object.fromEntries(Object.keys(RISIKO_ORDEN).map(k => [k, risici.filter(x => x.niveau === k).length]))},
    risici, kommende, uden_planlagt: udenPlanlagt,
  };
}

// ---------------------------------------------------------------- de gemte rapporter (scripts/rapport.py)

/**
 * Opdaterer de gemte snapshots og rapporter (data/admin/rapporter.krypt.json). Den første kørsel i måneden tager
 * månedens snapshot. Et gemt snapshot bruges igen – et rekonstrueret dog beregnes igen, når en måned genberegnes (valg);
 * et nyt, der kun adskiller sig i tidsstemplet ("taget"), erstatter ikke det gamle. En rapport erstattes kun, når mere
 * end "beregnet" er ændret. Afsluttede måneder får "Fremad" pr. den 1. i måneden efter, rekonstrueret.
 * @param {Lager} L lageret nu
 * @param {(tid: Date, rekonstruer: boolean) => Lager} ved lageret på et andet tidspunkt (rekonstruer: tilstandVed)
 * @param {{snapshots?: Record<string, any>, rapporter?: Record<string, any>}} gemt
 * @param {string} [valg] '' (sidste måned), 'alle' (alle måneder, data dækker, til og med sidste måned) eller 'ÅÅÅÅ-MM'
 * @returns {{fejl?: string, maaneder?: string[], snapshots?: Record<string, any>, rapporter?: Record<string, any>, udskrift?: string}}
 *   snapshots og rapporter: kun de nye/ændrede; udskrift: rapporten(e) som tekst til loggen
 */
export function opdater(L, ved, gemt, valg = '') {
  const denne = maanedNoegle(L.nu);
  /** @type {string[]} */
  let maaneder = [];
  if (valg === 'alle') {
    // Fra den første måned, data dækker (den tidligste dækning for en forening), til og med sidste måned.
    let m = L.alle('Forening').map(f => daekketFra(L.kontekst.daekning, f.v.navn)).sort()[0].slice(0, 7);
    for (; m < denne; m = naesteMaaned(m)) maaneder.push(m);
  } else if (valg) {
    if (valg > denne) return {fejl: `${valg} ligger i fremtiden`};
    maaneder = [valg];
  } else maaneder = [forrigeMaaned(denne)];

  const snapshots = {...(gemt.snapshots || {})}, rapporter = {...(gemt.rapporter || {})};
  /** @type {Record<string, any>} */
  const nyeS = {}, nyeR = {};
  const snap = (m, genberegn) => {
    const gammel = snapshots[m];
    if (gammel && !(genberegn && gammel.rekonstrueret)) return gammel;
    const ny = snapshot(L, ved, m);
    if (gammel && ens(uden(gammel, 'taget'), uden(ny, 'taget'))) return gammel;
    return (snapshots[m] = nyeS[m] = ny);
  };
  snap(denne, false); // den første kørsel i måneden tager månedens snapshot
  for (const m of maaneder) {
    const start = snap(m, !!valg), foreloebig = m === denne;
    const slut = foreloebig ? {...tilstand(L), rekonstrueret: false} : snap(naesteMaaned(m), !!valg);
    const fr = fremad(foreloebig ? L : ved(maanedStart(naesteMaaned(m)), true), {rekonstrueret: !foreloebig, gemt: true});
    const ny = maanedsrapport(L, m, start, slut, {foreloebig, fremad: fr});
    const gammel = rapporter[m];
    if (!gammel || !ens(uden(gammel, 'beregnet'), uden(ny, 'beregnet'))) rapporter[m] = nyeR[m] = ny;
  }
  const vis = valg === 'alle' ? maaneder.slice(-1) : maaneder;
  return {maaneder, snapshots: nyeS, rapporter: nyeR, udskrift: vis.map(m => udskrift(rapporter[m])).join('')};
}

/** En gemt rapport som tekst (scripts/rapport.py skriver den i loggen). @param {any} r @returns {string} */
export function udskrift(r) {
  const t = r.total, ud = [], p = s => ud.push(s + '\n');
  const ikon = k => (MOMENTUM_NIVEAUER[k] ? MOMENTUM_NIVEAUER[k].ikon : '·');
  const rek = ['start', 'slut'].filter(n => r[n] && r[n].rekonstrueret);
  p(`\nMånedsrapport for ${MAANEDER[+r.maaned.slice(5) - 1]} ${r.maaned.slice(0, 4)}${r.foreloebig ? ' (foreløbig)' : ''}`);
  const fr = r.fremad;
  if (fr) {
    const ft = fr.total, kv = fr.kvartal;
    p(`\nFREMAD fra ${kortDato(fr.fra)} (${fr.dage} dage)` + (fr.ufuldstaendig ? ` – planlagte arrangementer kendes først fra ${fr.kendt_fra}` : ''));
    p(`${ft.arrangementer} arrangementer planlagt i ${ft.foreninger_med} af ${ft.lokale} lokalforeninger · ${kv.navn} slutter ${kv.sidste_dag} (${dageTekst(kv.dage)})`);
    p(`Risici: ${ft.kritisk} kritiske, ${ft.advarsel} advarsler, ${ft.opmaerksom} hold øje`);
    for (const x of fr.risici) p(`  [${x.niveau}] ${x.forening || 'Alle'}: ${x.tekst} → ${x.handling}`);
    p(`Uden noget planlagt: ${fr.uden_planlagt.map(x => x.forening).join(', ') || '–'}`);
  } else p('\n(Ingen fremadskuende del – genberegn med: scripts/rapport.py alle)');
  p(`\nBAGUD ${kortDato(r.fra)} → ${r.foreloebig ? 'i dag' : kortDato(r.til)}` + (rek.length ? `; ${rek.join(' og ')} rekonstrueret` : ''));
  const moedt = t.fremmoede != null ? `${t.fremmoede} (på ${t.med_fremmoede})` : '–';
  p(`Afholdt ${t.afholdt} · aflyst ${t.aflyst} · nye ${t.nye} · forsvundet ${t.forsvundet} · fremmøde ${moedt} · ${t.aktive} af ${t.lokale} lokalforeninger aktive`);
  const h = r.hoejdepunkter;
  const skift = x => `${x.forening} (${[x.momentum && `${ikon(x.momentum[0])} → ${ikon(x.momentum[1])}`, x.hb && `HB ${x.hb[0]} → ${x.hb[1]}`].filter(Boolean).join(', ')})`;
  for (const [titel, l] of [['Faldet', h.faldet.map(skift)], ['Forbedret', h.forbedret.map(skift)],
    ['Uden afholdt aktivitet', h.uden_aktivitet.map(x => x.forening)],
    ['Nye aflysninger', h.nye_aflysninger.map(x => `${x.forening}: ${x.navn} (${x.dato})`)]]) p(`${titel}: ${l.length ? l.join(', ') : '–'}`);
  p(`${'Forening'.padEnd(16)} Afh Afl Nye Fsv Mødt  Momentum  HB-prognose`);
  // Landsforeningen sidst; ellers efter navn (tegnkoder, ikke dansk sortering – som loggen altid har været).
  const navne = Object.keys(r.foreninger).sort((a, b) => Number(a === 'Landsforeningen') - Number(b === 'Landsforeningen') || (a < b ? -1 : a > b ? 1 : 0));
  for (const navn of navne) {
    const f = r.foreninger[navn], mom = f.momentum, hbp = f.hb, tal = n => String(n).padStart(3);
    const mm = mom ? `${ikon(mom.start)} → ${ikon(mom.slut)}` : '', hh = hbp ? `${hbp.start || '–'} → ${hbp.slut || '–'}` : '';
    p(`${navn.padEnd(16)} ${tal(f.afholdt.length)} ${tal(f.aflyst.length)} ${tal(f.nye.length)} ${tal(f.forsvundet.length)} ${String(f.fremmoede ?? '–').padStart(4)}  ${mm.padEnd(9)} ${hh}`);
  }
  return ud.join('');
}
