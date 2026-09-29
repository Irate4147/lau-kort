// Skriver test/fixtures/golden.json: det, app.js beregner på de frosne data (test/fixtures/data) på faste datoer.
// test/app.test.js kræver, at app.js stadig giver præcis det. Kør kun igen, når en regel BEVIDST ændres:
//   node test/lav-golden.js
// Den første udgave blev lavet med app.js, før reglerne blev flyttet til kernen (commit d232f40).
import {writeFileSync} from 'node:fs';
import {DATOER, FIXTURES, koerApp, udtraek} from './hjaelp/app-vm.js';

const ud = {};
for (const tid of DATOER) ud[tid] = udtraek(await koerApp(tid));
writeFileSync(FIXTURES + 'golden.json', JSON.stringify(ud) + '\n');
console.log(`Skrev ${FIXTURES}golden.json (${DATOER.length} datoer)`);
