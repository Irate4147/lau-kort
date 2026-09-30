// Skriver test/fixtures/rapport.json: et fingeraftryk (SHA-256) af det, scripts/rapport.py gemmer (præcis den JSON, der
// krypteres) og skriver i loggen, i scenarierne fra test/hjaelp/rapport-py.js (faste datoer, to datasæt, en kæde af
// kørsler). test/scripts.test.js kræver, at scriptet stadig giver præcis det. Kør kun igen, når rapporten BEVIDST ændres:
//   node test/lav-rapport-facit.js            skriver facit
//   node test/lav-rapport-facit.js /tmp/ud    skriver desuden hele outputtet til /tmp/ud/<scenarie>.json og .txt, så to
//                                             udgaver kan sammenlignes med diff -r
// Den første udgave svarer til rapport.py, før rapportens regler blev flyttet til kernen (kerne/rapport.js): identisk,
// bortset fra to rækkefølger, siden allerede brugte – se docs/arkitektur.md, "Status for fase 1".
import {mkdirSync, writeFileSync} from 'node:fs';
import {koerScenarier} from './hjaelp/rapport-py.js';
import {fingeraftryk} from './lav-analyse-facit.js';

/** @param {{udskrift: string, exit: string|null, krypteres: string|null, skrevet: boolean}} r */
export const rapportAftryk = r => ({gemt: r.krypteres == null ? null : fingeraftryk(r.krypteres), udskrift: fingeraftryk(r.udskrift),
  exit: r.exit, skrevet: r.skrevet});

if (import.meta.url === `file://${process.argv[1]}`) {
  const mappe = process.argv[2], ud = await koerScenarier();
  if (mappe) {
    mkdirSync(mappe, {recursive: true});
    for (const [navn, r] of Object.entries(ud)) {
      const fil = `${mappe}/${navn.replace(/ /g, '_')}`;
      writeFileSync(fil + '.txt', r.udskrift + (r.exit ? `\n[exit] ${r.exit}\n` : ''));
      if (r.krypteres != null) writeFileSync(fil + '.json', r.krypteres);
    }
  }
  writeFileSync(new URL('fixtures/rapport.json', import.meta.url), JSON.stringify(Object.fromEntries(Object.entries(ud).map(([n, r]) => [n, rapportAftryk(r)])), null, 1) + '\n');
  console.log(`Skrev test/fixtures/rapport.json (${Object.keys(ud).length} scenarier)${mappe ? ` og outputtet i ${mappe}` : ''}`);
}
