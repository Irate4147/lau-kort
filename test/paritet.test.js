// Paritet: kernen (kerne/) skal give præcis samme resultat som app.js, så længe app.js har sin egen kopi af reglerne.
// app.js køres i en isoleret Node-kontekst med de rigtige data og en fast dato; derefter sammenlignes de to for
// hver forening og hvert arrangement. Datoerne er valgt, så kvartalsskift og årsskifte er dækket.
// Når app.js er flyttet over på kernen, kan testen fjernes.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';
import * as topojson from 'topojson-client';
import {geoArea, geoBounds, geoCentroid, geoContains} from 'd3-geo';
import {bygFraJson} from '../kerne/index.js';

const ROD = new URL('..', import.meta.url).pathname;
const laes = p => JSON.parse(readFileSync(ROD + p, 'utf8'));
const APP = readFileSync(ROD + 'app.js', 'utf8');

/** Kører app.js med "nu" = tid og returnerer dens beregnede data. */
async function appVed(tid) {
  const FAST = +new Date(tid);
  class FastDato extends Date {
    constructor(...a) { if (a.length) super(...a); else super(FAST); }
    static now() { return FAST; }
  }
  const lager = {getItem: () => null, setItem() {}, removeItem() {}};
  const ctx = vm.createContext({
    Date: FastDato, console, Intl, URL, TextEncoder, structuredClone,
    window: {}, location: {hostname: 'localhost', href: 'http://localhost/'},
    localStorage: lager, sessionStorage: lager, matchMedia: () => ({matches: false}),
    document: {addEventListener() {}, getElementById: () => null},
    addEventListener() {},
    topojson, d3: {geoArea, geoBounds, geoCentroid, geoContains},
    fetch: async p => (existsSync(ROD + p) ? {ok: true, json: async () => laes(p)} : {ok: false, json: async () => null}),
  });
  vm.runInContext(APP, ctx, {filename: 'app.js'});
  await vm.runInContext('load()', ctx);
  return vm.runInContext(`({DATA, RAW, RET, NOW, arrStatus, HB_KVARTALER})`, ctx);
}

const DATOER = ['2026-09-29T10:00:00Z', '2026-09-30T21:30:00Z', '2026-10-01T08:00:00Z', '2026-12-31T12:00:00Z', '2027-01-02T12:00:00Z', '2026-06-15T12:00:00Z'];

for (const tid of DATOER) {
  test(`kernen giver samme resultat som app.js (${tid})`, async () => {
    const app = await appVed(tid);
    const L = bygFraJson({foreninger: app.RAW.foreninger, events: app.RAW.events, meta: app.RAW.meta, rettelser: app.RET.data,
      topo: app.RAW.topo, nu: app.NOW});
    const kun = x => JSON.parse(JSON.stringify(x));

    assert.equal(L.alle('Forening').length, app.DATA.foreninger.length);
    assert.equal(L.alle('Arrangement').length, app.DATA.events.length, 'antal arrangementer (uden skjulte)');

    for (const f of app.DATA.foreninger) {
      const o = L.hent('Forening', f.navn), v = id => L.vaerdi(o, id), navn = `${f.navn} @ ${tid}`;
      assert.ok(o, navn);
      assert.equal(v('status'), f.status, `status ${navn}`);
      assert.equal(v('planlagte'), f.planlagt.length, `planlagte ${navn}`);
      assert.equal(v('afholdtIAlt'), f.afholdt.length, `afholdt ${navn}`);
      assert.equal(v('afholdt90'), f.afholdt90.length, `afholdt90 ${navn}`);
      assert.equal(v('tilkendegivelser'), f.gnsSvar, `tilkendegivelser ${navn}`);
      assert.equal(v('varsel'), f.varsel, `varsel ${navn}`);
      assert.equal(+v('sidsteArrangement') || null, +f.sidste || null, `sidste ${navn}`);
      if (f.national) continue;
      assert.deepEqual(kun(v('momentumDetaljer')), kun(f.mom), `momentum ${navn}`);
      assert.equal(v('hb'), f.hb, `HB ${navn}`);
      assert.deepEqual(kun(v('hbDetaljer').kvartaler), kun(f.hbKv), `HB-kvartaler ${navn}`);
    }
    for (const e of app.DATA.events) {
      const o = L.hent('Arrangement', e.id);
      assert.equal(L.vaerdi(o, 'kategori'), e.kat, `kategori ${e.id}`);
      assert.equal(L.vaerdi(o, 'status'), app.arrStatus(e), `status ${e.id}`);
      assert.deepEqual(L.linkede(o, 'arrangeretAf').map(f => f.id).sort(), [...e.foreninger].sort(), `arrangører ${e.id}`);
    }
  });
}
