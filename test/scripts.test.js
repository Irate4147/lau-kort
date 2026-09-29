// scripts/kerne.js (kernen for Python-scripts) skal give præcis det samme som siden: facit (test/fixtures/golden.json)
// blev lavet med app.js på de samme frosne data og datoer. Derefter køres scripts/hb.py og rapport.py (uden ADMIN_KODE:
// admin.py erstattes) for at vise, at Python-delen bruger kernens resultat uændret.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {DATOER, FIXTURES} from './hjaelp/app-vm.js';

const ROD = new URL('../', import.meta.url).pathname;
const FACIT = JSON.parse(readFileSync(FIXTURES + 'golden.json', 'utf8'));
const laes = navn => JSON.parse(readFileSync(FIXTURES + 'data/' + navn, 'utf8'));
const KILDER = {foreninger: laes('foreninger.json'), events: laes('events.json'), meta: laes('meta.json'), rettelser: laes('rettelser.json').rettelser};

/** Kør CLI'en som Python-scripts gør: JSON ind på stdin, JSON ud på stdout. */
const kerne = ind => JSON.parse(execFileSync('node', [ROD + 'scripts/kerne.js'], {input: JSON.stringify(ind), encoding: 'utf8', maxBuffer: 1 << 28}));

test('scripts/kerne.js giver samme resultat som siden (facit) på alle datoer', () => {
  const svar = kerne({...KILDER, nu: DATOER[0], tidspunkter: DATOER.map(tid => ({tid}))});
  DATOER.forEach((tid, i) => {
    const ved = svar.tidspunkter[i].foreninger;
    for (const [navn, f] of Object.entries(FACIT[tid].foreninger)) {
      const k = ved[navn], hvor = `${tid} ${navn}`;
      assert.deepEqual([k.arrangementer, k.afholdt, k.planlagt, k.sidste, k.naeste], [f.events, f.afholdt, f.planlagt, f.sidste, f.naeste], hvor);
      assert.equal(svar.daekketFra[navn], f.daekketFra, hvor);
      if (!f.mom) { assert.equal(k.momentum, undefined, hvor); continue; }
      const {grund, signaler, ...mom} = f.mom;
      assert.deepEqual(k.momentum, mom, `${hvor}: momentum`);
      assert.equal(k.hb.status, f.hb, `${hvor}: HB-prognose`);
      assert.deepEqual(Object.fromEntries(Object.entries(k.hb.kvartaler).map(([q, x]) => [q, x.status])), f.hbKv, `${hvor}: HB-kvartaler`);
    }
  });
});

test('scripts/kerne.js: rekonstruerede tidspunkter kender kun det, der var set på Facebook', () => {
  // De ugentlige kørsler begyndte 28. september, så den 1. september kendtes ingen kommende arrangementer.
  const svar = kerne({...KILDER, nu: DATOER[0], tidspunkter: [{tid: '2026-09-01T00:00:00Z', rekonstruer: true}, {tid: '2026-09-01T00:00:00Z'}]});
  const antal = t => Object.values(t.foreninger).reduce((s, f) => s + f.planlagt.length, 0);
  assert.equal(antal(svar.tidspunkter[0]), 0);
  assert.ok(antal(svar.tidspunkter[1]) > 0, 'uden rekonstruktion tæller alt, vi kender nu');
});

// Python-scripts på facit-datoerne: hb.py's prognose og rapport.py's snapshot skal være kernens (= sidens).
const PYTHON = `
import json, sys
from datetime import datetime
from pathlib import Path
sys.path.insert(0, sys.argv[1] + "scripts")
import admin, hb, rapport
data = Path(sys.argv[2])
admin.laes, admin.har_noegle = (lambda navn, standard=None: standard), (lambda: True)
admin.rettelser = lambda: json.loads((data / "rettelser.json").read_text())["rettelser"]
hb.DATA = data
ud = {}
for tid in json.loads(sys.argv[3]):
    nu = datetime.fromisoformat(tid.replace("Z", "+00:00"))
    res = hb.vurder(nu.astimezone(hb.TZ).year, nu)
    snap = rapport.tilstand(rapport.Data(nu), nu, False)["foreninger"]
    ud[tid] = {navn: [r["prognose"], snap[navn]["hb"], snap[navn]["niveau"], {q: k["status"] for q, k in r["kvartaler"].items()}]
               for navn, r in res["foreninger"].items()}
print(json.dumps(ud))
`;
const python = spawnSync('python3', ['--version']).status === 0;

test('scripts/hb.py og rapport.py bruger kernens regler', {skip: !python && 'python3 mangler'}, () => {
  const ud = JSON.parse(execFileSync('python3', ['-c', PYTHON, ROD, FIXTURES + 'data', JSON.stringify(DATOER)], {encoding: 'utf8'}));
  const FIL_NAVN = {plus_naeste: 'alle_plus_naeste', ikke: 'ikke_godkendt'}; // prognosens navne i hb_<år>.krypt.json
  for (const tid of DATOER) {
    for (const [navn, [prognose, hbSnap, niveau, kv]] of Object.entries(ud[tid])) {
      const f = FACIT[tid].foreninger[navn];
      assert.deepEqual([prognose, hbSnap, niveau, kv], [FIL_NAVN[f.hb] || f.hb, f.hb, f.mom.niveau, f.hbKv], `${tid} ${navn}`);
    }
  }
});
