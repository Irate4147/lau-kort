// Analyserne (udvidelser/hb-risiko.js, hvide-pletter.js, hvad-virker.js og maanedsrapport.js) skal give præcis det
// samme output som facit (test/fixtures/analyser.json) på de frosne data og faste datoer. Facit blev lavet, før
// analysernes regler blev flyttet til kernen – så testen beviser, at flytningen ikke ændrede noget. Ændres en analyse
// bevidst: node test/lav-analyse-facit.js (se filen – den kan også skrive hele outputtet ud til sammenligning).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DATOER, FIXTURES, analyseOutput} from './hjaelp/app-vm.js';
import {fingeraftryk} from './lav-analyse-facit.js';

const FACIT = JSON.parse(readFileSync(FIXTURES + 'analyser.json', 'utf8'));

for (const tid of DATOER) {
  test(`analyserne giver samme output som facit (${tid})`, async () => {
    const o = await analyseOutput(tid);
    assert.deepEqual(Object.keys(o).sort(), Object.keys(FACIT[tid]).sort());
    for (const [k, v] of Object.entries(o)) assert.equal(fingeraftryk(v), FACIT[tid][k], `${k} er ændret`);
  });
}
