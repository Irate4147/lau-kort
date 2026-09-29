// Kører app.js i en isoleret Node-kontekst med en fast dato og data fra en mappe (standard: test/fixtures).
// Bruges af test/app.test.js og test/lav-golden.js.
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';
import * as topojson from 'topojson-client';
import {geoArea, geoBounds, geoCentroid, geoContains} from 'd3-geo';
import * as KERNE from '../../kerne/index.js';

const ROD = new URL('../../', import.meta.url).pathname;
export const FIXTURES = ROD + 'test/fixtures/';
// Datoerne dækker en almindelig dag, kvartalsskift (sen aften og morgenen efter), årsskifte og midt i et kvartal.
export const DATOER = ['2026-09-29T10:00:00Z', '2026-09-30T21:30:00Z', '2026-10-01T08:00:00Z', '2026-12-31T12:00:00Z', '2027-01-02T12:00:00Z', '2026-06-15T12:00:00Z'];

/** @param {string} tid @param {{app?: string, data?: string}} [valg] app: kildekoden til app.js; data: mappen med data/ */
export async function koerApp(tid, {app = readFileSync(ROD + 'app.js', 'utf8'), data = FIXTURES} = {}) {
  const FAST = +new Date(tid);
  class FastDato extends Date {
    constructor(...a) { if (a.length) super(...a); else super(FAST); }
    static now() { return FAST; }
  }
  const lager = {getItem: () => null, setItem() {}, removeItem() {}};
  const fil = p => (p.startsWith('data/') ? data + p : ROD + p);
  const ctx = vm.createContext({
    Date: FastDato, console, Intl, URL, TextEncoder, structuredClone,
    window: {LAU_KERNE: KERNE}, location: {hostname: 'localhost', href: 'http://localhost/'},
    localStorage: lager, sessionStorage: lager, matchMedia: () => ({matches: false}),
    document: {addEventListener() {}, getElementById: () => null},
    addEventListener() {},
    topojson, d3: {geoArea, geoBounds, geoCentroid, geoContains},
    fetch: async p => (existsSync(fil(p)) ? {ok: true, json: async () => JSON.parse(readFileSync(fil(p), 'utf8'))} : {ok: false, json: async () => null}),
  });
  vm.runInContext(app, ctx, {filename: 'app.js'});
  await vm.runInContext('load()', ctx);
  return vm.runInContext('({DATA, RAW, RET, NOW, arrStatus, kvStatus, daekketFra, KVARTALER, HB_KVARTALER, HB_NU, HB_AAR})', ctx);
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
