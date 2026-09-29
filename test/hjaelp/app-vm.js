// Kører app.js (og evt. udvidelserne) i en isoleret Node-kontekst med en fast dato og data fra en mappe (standard:
// test/fixtures). Bruges af test/app.test.js, test/analyser.test.js og scripts'ene test/lav-*.js.
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';
import * as topojson from 'topojson-client';
import {geoArea, geoBounds, geoCentroid, geoContains} from 'd3-geo';
import * as KERNE from '../../kerne/index.js';

const ROD = new URL('../../', import.meta.url).pathname;
export const FIXTURES = ROD + 'test/fixtures/';
// Datoerne dækker en almindelig dag, kvartalsskift (sen aften og morgenen efter), årsskifte og midt i et kvartal.
export const DATOER = ['2026-09-29T10:00:00Z', '2026-09-30T21:30:00Z', '2026-10-01T08:00:00Z', '2026-12-31T12:00:00Z', '2027-01-02T12:00:00Z', '2026-06-15T12:00:00Z'];

/**
 * @param {string} tid
 * @param {{app?: string, data?: string, udvidelser?: string[]}} [valg] app: kildekoden til app.js; data: mappen med
 *   data/; udvidelser: filer i udvidelser/, der indlæses efter app.js (som i index.html)
 */
export async function koerApp(tid, {app = readFileSync(ROD + 'app.js', 'utf8'), data = FIXTURES, udvidelser = []} = {}) {
  const FAST = +new Date(tid);
  class FastDato extends Date {
    constructor(...a) { if (a.length) super(...a); else super(FAST); }
    static now() { return FAST; }
  }
  const lager = {getItem: () => null, setItem() {}, removeItem() {}};
  const fil = p => (p.startsWith('data/') ? data + p : ROD + p);
  const ctx = vm.createContext({
    Date: FastDato, console, Intl, URL, TextEncoder, structuredClone,
    LAU_KERNE: KERNE, location: {hostname: 'localhost', href: 'http://localhost/'},
    localStorage: lager, sessionStorage: lager, matchMedia: () => ({matches: false}),
    document: {addEventListener() {}, getElementById: () => null},
    addEventListener() {},
    topojson, d3: {geoArea, geoBounds, geoCentroid, geoContains},
    fetch: async p => (existsSync(fil(p)) ? {ok: true, json: async () => JSON.parse(readFileSync(fil(p), 'utf8'))} : {ok: false, json: async () => null}),
  });
  ctx.window = ctx; // som i browseren: window er det globale objekt (udvidelserne bruger fx LAU direkte)
  vm.runInContext(app, ctx, {filename: 'app.js'});
  for (const u of udvidelser) vm.runInContext(readFileSync(ROD + 'udvidelser/' + u, 'utf8'), ctx, {filename: u});
  await vm.runInContext('load()', ctx);
  return {...vm.runInContext('({DATA, RAW, RET, NOW, arrStatus, kvStatus, daekketFra, KVARTALER, HB_KVARTALER, HB_NU, HB_AAR})', ctx), ctx};
}

export const ANALYSE_UDVIDELSER = ['maanedsrapport.js', 'hb-risiko.js', 'hvide-pletter.js', 'hvad-virker.js'];

/**
 * Analysernes output på en fast dato: HTML fra render(), advarslerne, kortlaget "hvide pletter" og LAU.hbRisiko(f) –
 * uden og med (opdigtede) medlemstal og et snapshot fra månedens start. Bruges af test/analyser.test.js.
 * @param {string} tid
 */
export async function analyseOutput(tid) {
  const app = await koerApp(tid, {udvidelser: ANALYSE_UDVIDELSER});
  return vm.runInContext(`(() => {
    ADMIN.noegle = 'test';
    const ud = {};
    const adv = () => JSON.stringify(advarsler().map(x => ({...x, frist: x.frist ? new Date(x.frist).toISOString() : x.frist})));
    const vis = id => ANALYSER.find(a => a.id === id).render();
    const lag = zoomed => {
      const kilder = {}, lagene = [];
      const api = {source: (id, d) => { kilder[id] = d.features.map(f => f.properties); return id; }, layer: l => lagene.push(l)};
      MAP_LAYERS.find(l => l.id === 'hvide-pletter').tegn(api, {map: {hasImage: () => true, addImage() {}}, zoomed, selected: zoomed ? 'Fyn' : null});
      return JSON.stringify({kilder, lagene});
    };
    ud.advarsler = adv();
    for (const id of ['hb-risiko', 'hvide-pletter', 'maanedsrapport', 'hvad-virker']) ud[id] = vis(id);
    // "Hvad virker?": vælg målet, som et klik på knappen gør.
    const klik = {};
    ANALYSER.find(a => a.id === 'hvad-virker').efter({querySelectorAll: s => (s === '[data-hv-maal]'
      ? ['deltager', 'svar', 'fremmoede'].map(m => ({dataset: {hvMaal: m}, addEventListener: (_, fn) => { klik[m] = fn; }})) : [])});
    for (const m of ['svar', 'fremmoede']) { klik[m](); ud['hvad-virker-' + m] = vis('hvad-virker'); }
    klik.deltager();
    ud.lag = lag(false);
    ud['lag-fyn'] = lag(true);
    ud.hbRisiko = JSON.stringify(DATA.lokale.map(f => { const r = LAU.hbRisiko(f); return [f.navn, r.niveau, r.spand, r.dage, r.forklaring,
      r.advarsel, r.afholdt.map(e => e.id), r.planlagt.map(e => e.id), r.naesteKv.map(e => e.id), r.tabte, r.ukendte, r.status, +r.frist,
      r.naeste && r.naeste.id]; }));
    // Opdigtede medlemstal (én by pr. kommune + to, der ikke kan placeres) og et snapshot fra månedens start.
    ADMIN.data.medlemmer = [...DATA.geo.klabels.features.map((k, i) => ({by: k.properties.navn, lat: k.geometry.coordinates[1],
      lng: k.geometry.coordinates[0], antal: i % 7})), {by: 'Ukendt', lat: null, lng: null, antal: 4}, {by: 'Havet', lat: 56.9, lng: 5.0, antal: 3}];
    const m = monthKey(NOW), mom = Object.keys(MOM_STATUS), hb = Object.keys(HB_STATUS);
    ADMIN.data.rapporter = {rapporter: {}, snapshots: {[m]: {tid: m + '-01T00:00:00Z', hb_aar: HB_AAR, foreninger: Object.fromEntries(
      DATA.foreninger.map((f, i) => [f.navn, {niveau: mom[i % mom.length], hb: hb[i % hb.length], aflyste: i % 3 ? [] : f.events.filter(e => e.aflyst).slice(1).map(e => e.id)}]))}}};
    for (const id of ['hvide-pletter', 'maanedsrapport']) ud[id + '-medl'] = vis(id);
    ud['lag-medl'] = lag(false);
    return ud;
  })()`, app.ctx);
}

/** Det, app.js har beregnet, i en form, der kan sammenlignes og gemmes som JSON. */
export function udtraek(app) {
  const d = x => (x ? new Date(+x).toISOString() : null), id = e => (e ? e.id : null), n = xs => xs.length;
  const D = app.DATA;
  return JSON.parse(JSON.stringify({
    historik: D.historik, dataFra: d(D.dataFra), antal: {alle: n(D.alle), events: n(D.events)},
    kvartaler: app.KVARTALER.map(k => [k.id, k.fra, k.til]), hbKvartaler: app.HB_KVARTALER.map(k => [k.id, k.fra, k.til]),
    hbNu: app.HB_NU, hbAar: app.HB_AAR,
    foreninger: Object.fromEntries(D.foreninger.map(f => [f.navn, {
      status: f.status, events: f.events.map(id), gyldige: n(f.gyldige), upcoming: f.upcoming.map(id), within14: f.within14.map(id),
      planlagt: f.planlagt.map(id), afholdt: f.afholdt.map(id), afholdt90: f.afholdt90.map(id), kv: f.kv, sidste: d(f.sidste),
      naeste: id(f.naeste), gnsSvar: f.gnsSvar, varsel: f.varsel, daekketFra: app.daekketFra(f.navn),
      kvStatus: Object.fromEntries(app.KVARTALER.map(k => [k.id, app.kvStatus(f, k)])),
      hb: f.hb ?? null, hbKv: f.hbKv ?? null, mom: f.mom ?? null,
    }])),
    events: Object.fromEntries(D.alle.map(e => [e.id, [e.kat, app.arrStatus(e), !!e.soon, !!e.ny, !!e.national, !!e.skjult]])),
    kommuner: Object.fromEntries(D.features.map(k => [k.properties.navn, k.properties])),
  }));
}
