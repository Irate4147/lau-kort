// Månedsrapportens regler: "Bagud" (hvad skete der i måneden indtil nu) og "Fremad" (kommende arrangementer og
// risici) for den indeværende måned. Samme opbygning og tekster som lav_rapport() og lav_fremad() i
// scripts/rapport.py, der laver de gemte rapporter – så browseren kan vise "Denne måned indtil nu" (se
// udvidelser/maanedsrapport.js). Rene funktioner over objektlageret: "nu" er lagerets.
// Tilbage i fase 1: scripts/rapport.py skal bruge disse (via Node) i stedet for sin egen kopi. Se docs/arkitektur.md.

import {DAG, TZ, dagNoegle, dagPlus, hbAar, kalenderdage, maanedNoegle} from './tid.js';
import {MOMENTUM_NIVEAUER} from './regler.js';

/** @typedef {import('./lager.js').Lager} Lager @typedef {import('./regler.js').Aktivitet} Aktivitet */

// Bedst først. HB som HB_ORDEN i scripts/rapport.py ('ukendt' sammenlignes ikke).
export const MOM_RAEKKE = ['godt', 'stabil', 'fremad', 'faldende', 'hjaelp', 'ukendt', 'ingenfb'];
export const HB_ORDEN = ['plus_naeste', 'alle', 'planlagt_nu', 'mangler_nu', 'ikke'];
// Fremad: som FREMAD_DAGE, RISIKO_ORDEN og RISIKO_TYPE i scripts/rapport.py.
export const FREMAD_DAGE = 35;
export const RISIKO_ORDEN = {kritisk: 0, advarsel: 1, opmaerksom: 2};
export const RISIKO_TYPE = ['aarsskifte', 'hb', 'hb_planlagt', 'hjaelp', 'faldende'];
// Momentum-niveauerne i rækkefølgen fra regler.js: dem, der kræver handling, først (lavere = værre).
const MOM_ORDEN = Object.fromEntries(Object.keys(MOMENTUM_NIVEAUER).map((k, i) => [k, i]));

const fmtKort = new Intl.DateTimeFormat('da-DK', {day: 'numeric', month: 'short', timeZone: TZ});
/** 'ÅÅÅÅ-MM-DD' -> "30. sep." @param {string} d */
const kortDato = d => fmtKort.format(new Date(d + 'T12:00:00Z'));
/** @param {string} m 'ÅÅÅÅ-MM' */
const naesteMaaned = m => { const [y, mm] = m.split('-').map(Number); return `${y + (mm === 12 ? 1 : 0)}-${String(mm % 12 + 1).padStart(2, '0')}`; };
/** Kvartalet som 'ÅÅÅÅ-i' (i = 0–3). @param {Date} d */
const kvartalAf = d => `${dagNoegle(d).slice(0, 4)}-${Math.floor((+dagNoegle(d).slice(5, 7) - 1) / 3)}`;
/** @param {Date} d */
const iso = d => d.toISOString().replace(/\.\d+Z$/, 'Z');
/** @param {string} s @param {number} n */
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
/** @param {string[]} a */
const opremsning = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} og ${a[a.length - 1]}`);
/** @param {number} d */
const dageTekst = d => (d <= 0 ? 'sidste dag i dag' : d === 1 ? '1 dag tilbage' : `${d} dage tilbage`);
/** @param {string} t */
const punktum = t => (t.endsWith('.') ? t : t + '.');

/**
 * Er foreningen faldet eller forbedret i momentum eller HB-prognose? Samme regel som lav_rapport() i scripts/rapport.py.
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

/**
 * Bagud for den indeværende måned indtil nu – samme opbygning som rapporterne fra scripts/rapport.py. Momentum og
 * HB-prognose sammenlignes med snapshottet fra månedens start, hvis det findes.
 * @param {Lager} L
 * @param {any} [snap] snapshottet fra månedens start ({tid, hb_aar, rekonstrueret?, foreninger: {navn: {niveau, hb, aflyste}}})
 */
export function maanedIndtilNu(L, snap = null) {
  const nu = L.nu, m = maanedNoegle(nu), fra = `${m}-01`, til = `${naesteMaaned(m)}-01`, HB_AAR = hbAar(nu).aar;
  const forsteKoersel = L.kontekst.daekning.forsteKoersel;
  const iMd = d => { const k = dagNoegle(d); return k >= fra && k < til; };
  const s0 = n => (snap && snap.foreninger[n]) || {};
  const hbSamme = !!snap && snap.hb_aar === HB_AAR, kvSamme = !!snap && kvartalAf(new Date(snap.tid)) === kvartalAf(nu);
  const kort = (e, x = {}) => ({id: e.id, dato: dagNoegle(e.startD), navn: e.navn || '', ...x});
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
      // Nye på Facebook i måneden – ikke hentet bagudrettet, manuelle eller fundet ved den første kørsel.
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
    if (snap) for (const e of a.events) if (e.aflyst && !(s0(navn).aflyste || []).includes(e.id)) hoejde.nye_aflysninger.push({forening: navn, ...kort(e)});
    if (!f.v.national) {
      const niveau = L.vaerdi(f, 'momentum');
      rf.momentum = {start: s0(navn).niveau || null, slut: niveau};
      rf.hb = {start: s0(navn).hb || null, slut: L.vaerdi(f, 'hb')};
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
  const fordel = (keys, v) => Object.fromEntries(keys.map(k => [k, lokale.filter(f => v(f) === k).length]));
  return {
    maaned: m, fra, til, foreloebig: true, beregnet: iso(nu),
    start: snap ? {tid: snap.tid, rekonstrueret: !!snap.rekonstrueret, hb_aar: snap.hb_aar} : null,
    slut: {tid: iso(nu), rekonstrueret: false, hb_aar: HB_AAR},
    total: {
      afholdt: alle.afholdt.size, aflyst: alle.aflyst.size, nye: alle.nye.size, forsvundet: alle.forsvundet.size,
      fremmoede: moedt.length ? moedt.reduce((x, y) => x + y, 0) : null, med_fremmoede: moedt.length,
      lokale: lokale.length, aktive: lokale.filter(f => foreninger[f.v.navn].afholdt.length).length,
      uden_aktivitet: hoejde.uden_aktivitet.length, uden_data: udenData,
      faldet: hoejde.faldet.length, forbedret: hoejde.forbedret.length, nye_aflysninger: snap ? hoejde.nye_aflysninger.length : null,
    },
    fordeling: {
      momentum: {start: snap ? fordel(MOM_RAEKKE, f => s0(f.v.navn).niveau) : null, slut: fordel(MOM_RAEKKE, f => L.vaerdi(f, 'momentum'))},
      hb: {start: snap ? fordel([...HB_ORDEN, 'ukendt'], f => s0(f.v.navn).hb) : null, slut: fordel([...HB_ORDEN, 'ukendt'], f => L.vaerdi(f, 'hb'))},
    },
    hoejdepunkter: hoejde, foreninger,
  };
}

/**
 * Fremad fra i dag: kommende arrangementer de næste FREMAD_DAGE dage, lokalforeninger uden noget planlagt og risici
 * sorteret efter alvor, hver med en konkret handling – samme opbygning og tekster som lav_fremad() i
 * scripts/rapport.py. HB-risikoen er kernens hbRisiko (egenskaben hbRisikoDetaljer).
 * @param {Lager} L
 */
export function fremad(L) {
  const nu = L.nu, fra = dagNoegle(nu), til = dagPlus(fra, FREMAD_DAGE); // til: første dag efter perioden
  const hb = hbAar(nu), HB_AAR = hb.aar, KV = hb.kvartaler[hb.nuIndeks], sidste = dagPlus(KV.til, -1), kvDage = kalenderdage(fra, sidste);
  const iPeriode = e => { const d = dagNoegle(e.startD); return d >= fra && d < til; };
  const kort = e => ({id: e.id, dato: dagNoegle(e.startD), navn: e.navn || ''});
  const kommende = {}, udenPlanlagt = [], risici = [], alle = new Set(), manglerQ4 = [];
  const lokale = L.alle('Forening').filter(f => !f.v.national);
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
        handling: punktum(`Afhold et arrangement senest ${kortDato(sidste)}`)});
    }
    const planlagt = r.planlagt;
    if (status === 'planlagt' && planlagt.length && (r.niveau === 'advarsel' || r.niveau === 'opmaerksom') && dage < FREMAD_DAGE) {
      const e = planlagt[0];
      const hvad = planlagt.length === 1 ? `ét planlagt arrangement: "${trunc(e.navn || 'uden titel', 50)}" ${kortDato(dagNoegle(e.startD))}`
        : `${planlagt.length} planlagte arrangementer (det første ${kortDato(dagNoegle(e.startD))})`;
      risici.push({forening: navn, niveau: r.niveau, type: 'hb_planlagt', dage,
        tekst: `${KV.id} hænger på ${hvad} – ${dageTekst(dage)}.`,
        handling: 'Sørg for, at det bliver afholdt, og bekræft det bagefter (✓ Afholdt).'});
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
  risici.sort((a, b) => RISIKO_ORDEN[a.niveau] - RISIKO_ORDEN[b.niveau] || RISIKO_TYPE.indexOf(a.type) - RISIKO_TYPE.indexOf(b.type)
    || (a.dage ?? 999) - (b.dage ?? 999) || (a.forening || '').localeCompare(b.forening || '', 'da'));
  return {
    tid: iso(nu), fra, til, dage: FREMAD_DAGE, rekonstrueret: false, ufuldstaendig: false, kendt_fra: dagNoegle(L.kontekst.daekning.forsteKoersel),
    kvartal: {navn: KV.id, hb_aar: HB_AAR, sidste_dag: sidste, dage: kvDage},
    total: {arrangementer: alle.size, foreninger_med: lokale.filter(f => kommende[f.v.navn]).length, lokale: lokale.length,
      uden_planlagt: udenPlanlagt.length, ...Object.fromEntries(Object.keys(RISIKO_ORDEN).map(k => [k, risici.filter(x => x.niveau === k).length]))},
    risici, kommende, uden_planlagt: udenPlanlagt,
  };
}
