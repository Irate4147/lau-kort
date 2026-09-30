#!/usr/bin/env node
// Kernens regler for Python-scripts (hb.py, rapport.py, kalender.py): læser JSON på stdin og skriver resultatet som
// JSON på stdout. Scripts kalder den via scripts/kerne.py, så hver regel kun findes ét sted – i kerne/.
//
//   node scripts/kerne.js < forespørgsel.json
//
// Forespørgsel:
//   {foreninger, events, meta, rettelser}   data/foreninger.json, data/events.json, data/meta.json og rettelserne
//   nu                                      kørslens tidspunkt (ISO); dækning uden kørsler regnes fra nu
//   tidspunkter: [{tid, rekonstruer?, hbAar?}]
//                                           beregn foreningerne på tidspunktet tid. rekonstruer: kun det, man vidste
//                                           dengang (tilstandVed). hbAar: året, HB-kvartalerne vurderes for.
//   rapport: {valg, gemt}                   månedsrapporten (scripts/rapport.py): opdater() i kerne/rapport.js med de
//                                           gemte {snapshots, rapporter} og valg '' | 'alle' | 'ÅÅÅÅ-MM'
// Svar:
//   {nu, foersteKoersel, daekketFra: {forening: 'ÅÅÅÅ-MM-DD'},
//    arrangementer: [...]               med rettelser, uden skjulte; + kendt (ISO) og varsel (dage eller null)
//    tidspunkter: [{tid, foreninger: {forening: {arrangementer, afholdt, planlagt, aflyste (id'er sorteret efter start),
//                   sidste (ISO), naeste (id); for lokalforeninger også momentum, hb og hbRisiko}}}],
//    rapport: {maaneder, snapshots, rapporter, udskrift} | {fejl}   kun de nye/ændrede snapshots og rapporter}

import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {bygFraJson, rapport, regler, tid as T} from '../kerne/index.js';

/** @param {any} f */
const harFb = f => !!f.facebook;
/** @param {any[]} xs */
const ids = xs => xs.map(e => e.id);
/** @param {Date|null} d */
const iso = d => (d ? d.toISOString() : null);

/**
 * @param {{foreninger: any[], events: any[], meta: any, rettelser?: Record<string, any>, nu: string,
 *   tidspunkter?: {tid: string, rekonstruer?: boolean, hbAar?: number}[], rapport?: {valg?: string, gemt?: any}}} ind
 */
export function beregn(ind) {
  const nu = new Date(ind.nu);
  const kilder = {foreninger: ind.foreninger, events: ind.events, meta: ind.meta, rettelser: ind.rettelser || {}, nu};
  const L = bygFraJson(kilder);
  const daekning = L.kontekst.daekning;
  // Samme arrangementer som foreningernes (lau.js): med rettelser og uden skjulte.
  const alle = L.kontekst.alleArrangementer.filter(e => !e.skjult);

  /** Foreningerne på tidspunktet tid. @param {{tid: string, rekonstruer?: boolean, hbAar?: number}} t */
  const ved = t => {
    const tid = new Date(t.tid);
    const ev = t.rekonstruer ? alle.map(e => regler.tilstandVed(e, tid)).filter(Boolean) : alle;
    /** @type {Record<string, any>} */
    const ud = {};
    for (const f of ind.foreninger) {
      const a = regler.aktivitet(ev.filter(e => e.foreninger.includes(f.navn)), f.navn, daekning, tid);
      const r = {arrangementer: ids(a.events), afholdt: ids(a.afholdt), planlagt: ids(a.planlagt),
        aflyste: ids(a.events.filter(e => e.aflyst)), sidste: iso(a.sidste), naeste: a.naeste ? a.naeste.id : null};
      if (!f.national) {
        const {grund, signaler, ...momentum} = regler.momentum(a, harFb(f), tid);
        const hb = regler.hbPrognose(a, harFb(f), tid, t.hbAar);
        const aar = t.hbAar ?? hb.aar - 1;
        const kvartaler = Object.fromEntries(T.kvartaler(aar).map(k => [k.id, {status: hb.kvartaler[k.id], fra: k.fra,
          til: k.til, afholdt: ids(a.afholdt.filter(e => regler.iKvartal(e, k))), planlagt: ids(a.planlagt.filter(e => regler.iKvartal(e, k)))}]));
        const risiko = regler.hbRisiko(a, harFb(f), tid);
        Object.assign(r, {momentum, hb: {status: hb.status, aar: hb.aar, kvartaler},
          hbRisiko: {...risiko, afholdt: ids(risiko.afholdt), planlagt: ids(risiko.planlagt)}});
      }
      ud[f.navn] = r;
    }
    return {tid: t.tid, rekonstruer: !!t.rekonstruer, foreninger: ud};
  };

  return {
    nu: iso(nu),
    foersteKoersel: iso(daekning.forsteKoersel),
    daekketFra: Object.fromEntries(ind.foreninger.map(f => [f.navn, regler.daekketFra(daekning, f.navn)])),
    arrangementer: alle.map(e => {
      const {startD, slutD, firstD, rettelse, ...data} = e; // kun kildedata; Python laver selv datoerne
      return {...data, kendt: iso(regler.kendtFra(e)), varsel: regler.varsel(e, daekning.forsteKoersel)};
    }),
    tidspunkter: (ind.tidspunkter || []).map(ved),
    ...(ind.rapport ? {rapport: maanedsrapport(L, kilder, ind.rapport)} : {}),
  };
}

/**
 * Månedsrapporten: kernens opdater() med lageret nu og – til snapshots og "Fremad" for afsluttede måneder – lagre på
 * tidligere tidspunkter med det, man vidste dengang (bygges én gang pr. tidspunkt).
 * @param {import('../kerne/lager.js').Lager} L @param {any} kilder @param {{valg?: string, gemt?: any}} ind
 */
function maanedsrapport(L, kilder, ind) {
  /** @type {Map<string, import('../kerne/lager.js').Lager>} */
  const lagre = new Map();
  /** @param {Date} tid @param {boolean} rekonstruer */
  const ved = (tid, rekonstruer) => {
    const k = `${tid.toISOString()} ${rekonstruer}`;
    if (!lagre.has(k)) lagre.set(k, bygFraJson({...kilder, ved: {tid, rekonstruer}}));
    return lagre.get(k);
  };
  return rapport.opdater(L, ved, ind.gemt || {}, ind.valg || '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(beregn(JSON.parse(readFileSync(0, 'utf8')))));
}
