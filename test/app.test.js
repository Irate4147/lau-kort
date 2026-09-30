// app.js skal give præcis det samme som facit (test/fixtures/golden.json) på de frosne data og faste datoer.
// Facit blev lavet med app.js, før reglerne blev flyttet til kernen – så testen beviser, at flytningen ikke ændrede
// noget, og fanger senere utilsigtede ændringer. Ændres en regel bevidst: node test/lav-golden.js (se filen).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DATOER, FIXTURES, koerApp, udtraek} from './hjaelp/app-vm.js';
import {LAU} from '../kerne/index.js';

const FACIT = JSON.parse(readFileSync(FIXTURES + 'golden.json', 'utf8'));

for (const tid of DATOER) {
  test(`app.js giver samme resultat som facit (${tid})`, async () => {
    const nu = udtraek(await koerApp(tid)), f = FACIT[tid];
    for (const k of ['historik', 'dataFra', 'antal', 'kvartaler', 'hbKvartaler', 'hbNu', 'hbAar']) assert.deepEqual(nu[k], f[k], k);
    assert.deepEqual(Object.keys(nu.foreninger), Object.keys(f.foreninger));
    for (const navn of Object.keys(f.foreninger)) assert.deepEqual(nu.foreninger[navn], f.foreninger[navn], `forening ${navn}`);
    assert.deepEqual(nu.events, f.events, 'arrangementer');
    assert.deepEqual(nu.kommuner, f.kommuner, 'kortets kommuner');
  });
}

// Kortets farvninger bygges af ontologien (kategoriske egenskaber på Forening) plus kvartalerne. De skal give de
// samme værdier som kommunernes egenskaber, som facit ovenfor låser – dvs. kortet farves som før.
for (const tid of DATOER) {
  test(`farvningerne bygger på ontologien og farver som før (${tid})`, async () => {
    const app = await koerApp(tid), liste = [...app.FARVNING_LISTE], fv = id => liste.find(x => x.id === id);
    assert.deepEqual(liste.map(x => x.id), ['status', 'momentum', ...app.KVARTALER.map(k => k.id), 'hb', 'hbRisiko', 'hbRisikoSpand', 'ingen']);
    for (const e of LAU.type('Forening').egenskabsliste.filter(e => e.type === 'kat' && !e.intern && e.id !== 'niveau')) {
      assert.equal(fv(e.id).admin, e.adgang !== 'offentlig', `${e.id}: adgang`);
      assert.deepEqual(Object.keys(fv(e.id).vaerdier), Object.keys(e.vaerdier), `${e.id}: værdier fra ontologien`);
    }
    for (const feat of app.DATA.features) {
      const f = app.DATA.byName.get(feat.properties.forening), p = feat.properties;
      assert.equal(fv('status').vaerdi(f), p.status);
      assert.equal(fv('momentum').vaerdi(f), p.mom);
      assert.equal(fv('hb').vaerdi(f), p.hb);
      for (const k of app.KVARTALER) assert.equal(fv(k.id).vaerdi(f), p['kv_' + k.id]);
    }
    const lands = app.DATA.byName.get('Landsforeningen');
    assert.equal(app.farveFor(lands, fv('momentum')).label, 'Landsforeningen');
    assert.equal(app.farveFor(lands, fv('hb')).label, 'Ikke omfattet af HB-kravet');
  });
}

test('en ny kategorisk egenskab får standardfarver og ontologiens adgang', async () => {
  const app = await koerApp(DATOER[0]);
  const fv = app.egenskabsFarvning({id: 'ny', label: 'Ny egenskab', type: 'kat', adgang: 'admin', vaerdier: {a: 'A', b: 'B'}});
  assert.equal(fv.label, 'Ny egenskab');
  assert.equal(fv.admin, true);
  assert.deepEqual(Object.keys(fv.farver), ['a', 'b']);
  assert.notEqual(fv.farver.a, fv.farver.b);
  assert.equal(app.egenskabsFarvning({id: 'offentlig', label: 'O', type: 'kat', adgang: 'offentlig', vaerdier: {x: 'X'}}).admin, false);
});
