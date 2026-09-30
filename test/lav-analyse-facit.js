// Skriver test/fixtures/analyser.json: et fingeraftryk (SHA-256) af analysernes output (HTML, advarsler, kortlaget og
// LAU.hbRisiko) på de frosne data og faste datoer. test/analyser.test.js kræver, at udvidelserne stadig giver præcis
// det. Kør kun igen, når en analyse BEVIDST ændres:
//   node test/lav-analyse-facit.js            skriver facit
//   node test/lav-analyse-facit.js /tmp/ud    skriver desuden hele outputtet til /tmp/ud/<dato>/<navn>.html, så to
//                                             udgaver kan sammenlignes med diff -r
// Den første udgave blev lavet, før analysernes regler blev flyttet til kernen.
import {createHash} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {DATOER, FIXTURES, analyseOutput} from './hjaelp/app-vm.js';

export const fingeraftryk = s => createHash('sha256').update(s).digest('hex').slice(0, 16);

if (import.meta.url === `file://${process.argv[1]}`) {
  const mappe = process.argv[2], ud = {};
  for (const tid of DATOER) {
    const o = await analyseOutput(tid);
    ud[tid] = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fingeraftryk(v)]));
    if (mappe) {
      mkdirSync(`${mappe}/${tid}`, {recursive: true});
      for (const [k, v] of Object.entries(o)) writeFileSync(`${mappe}/${tid}/${k}.html`, v);
    }
  }
  writeFileSync(FIXTURES + 'analyser.json', JSON.stringify(ud, null, 1) + '\n');
  console.log(`Skrev ${FIXTURES}analyser.json (${DATOER.length} datoer)${mappe ? ` og outputtet i ${mappe}` : ''}`);
}
