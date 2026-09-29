// app.js skal give præcis det samme som facit (test/fixtures/golden.json) på de frosne data og faste datoer.
// Facit blev lavet med app.js, før reglerne blev flyttet til kernen – så testen beviser, at flytningen ikke ændrede
// noget, og fanger senere utilsigtede ændringer. Ændres en regel bevidst: node test/lav-golden.js (se filen).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DATOER, FIXTURES, koerApp, udtraek} from './hjaelp/app-vm.js';

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
