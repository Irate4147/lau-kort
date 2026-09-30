// scripts/kerne.js (kernen for Python-scripts) skal give præcis det samme som siden: facit (test/fixtures/golden.json)
// blev lavet med app.js på de samme frosne data og datoer. Derefter køres scripts/hb.py og rapport.py (uden ADMIN_KODE:
// admin.py erstattes) for at vise, at Python-delen bruger kernens resultat uændret – og månedsrapporten fra rapport.py
// skal være præcis facit (test/fixtures/rapport.json) på faste datoer og det samme, som siden viser for måneden indtil nu.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {bygFraJson, rapport as RAP} from '../kerne/index.js';
import {DATOER, FIXTURES} from './hjaelp/app-vm.js';
import {koerScenarier} from './hjaelp/rapport-py.js';
import {rapportAftryk} from './lav-rapport-facit.js';

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

// Python på facit-datoerne: hb.py's prognose skal være kernens (= sidens).
const PYTHON = `
import json, sys
from datetime import datetime
from pathlib import Path
sys.path.insert(0, sys.argv[1] + "scripts")
import admin, hb
data = Path(sys.argv[2])
admin.laes = lambda navn, standard=None: standard
admin.rettelser = lambda: json.loads((data / "rettelser.json").read_text())["rettelser"]
hb.DATA = data
ud = {}
for tid in json.loads(sys.argv[3]):
    nu = datetime.fromisoformat(tid.replace("Z", "+00:00"))
    res = hb.vurder(nu.astimezone(hb.TZ).year, nu)
    ud[tid] = {navn: [r["prognose"], {q: k["status"] for q, k in r["kvartaler"].items()}] for navn, r in res["foreninger"].items()}
print(json.dumps(ud))
`;
const python = spawnSync('python3', ['--version']).status === 0;

test('scripts/hb.py bruger kernens regler', {skip: !python && 'python3 mangler'}, () => {
  const ud = JSON.parse(execFileSync('python3', ['-c', PYTHON, ROD, FIXTURES + 'data', JSON.stringify(DATOER)], {encoding: 'utf8'}));
  const FIL_NAVN = {plus_naeste: 'alle_plus_naeste', ikke: 'ikke_godkendt'}; // prognosens navne i hb_<år>.krypt.json
  for (const tid of DATOER) {
    for (const [navn, [prognose, kv]] of Object.entries(ud[tid])) {
      const f = FACIT[tid].foreninger[navn];
      assert.deepEqual([prognose, kv], [FIL_NAVN[f.hb] || f.hb, f.hbKv], `${tid} ${navn}`);
    }
  }
});

test('månedsrapportens snapshot (kerne/rapport.js) har sidens momentum og HB-prognose', () => {
  for (const tid of DATOER) {
    const snap = RAP.tilstand(bygFraJson({...KILDER, nu: new Date(tid)}));
    assert.equal(snap.tid, tid.replace('.000', ''));
    for (const [navn, f] of Object.entries(FACIT[tid].foreninger)) {
      const s = snap.foreninger[navn], hvor = `${tid} ${navn}`;
      assert.deepEqual([s.afholdt, s.planlagt], [f.afholdt.length, f.planlagt.length], hvor);
      if (f.mom) assert.deepEqual([s.niveau, s.hb, s.normalt, s.afholdt_3md], [f.mom.niveau, f.hb, f.mom.normalt, f.mom.afholdt], hvor);
    }
  }
});

// scripts/rapport.py i alle scenarier (test/hjaelp/rapport-py.js) – køres én gang og bruges af de to tests herunder.
const scenarier = python ? koerScenarier() : null;

test('scripts/rapport.py giver præcis facit på faste datoer (gemt JSON og udskrift)', {skip: !python && 'python3 mangler'}, async () => {
  const facit = JSON.parse(readFileSync(FIXTURES + 'rapport.json', 'utf8')), ud = await scenarier;
  assert.deepEqual(Object.keys(ud), Object.keys(facit));
  for (const [navn, r] of Object.entries(ud)) assert.deepEqual(rapportAftryk(r), facit[navn], `${navn} er ændret (se test/lav-rapport-facit.js)`);
});

test('scripts/rapport.py: den foreløbige rapport er den samme, som siden viser for måneden indtil nu', {skip: !python && 'python3 mangler'}, async () => {
  const ud = await scenarier;
  for (const [navn, tid, m] of [['fixtures 2026-09-29T10:00:00Z 2026-09', '2026-09-29T10:00:00Z', '2026-09'],
    ['fixtures 2026-12-31T22:30:00Z 2026-12', '2026-12-31T22:30:00Z', '2026-12'], ['fixtures 2027-01-02T12:00:00Z 2027-01', '2027-01-02T12:00:00Z', '2027-01']]) {
    const gemt = JSON.parse(ud[navn].krypteres), r = gemt.rapporter[m], L = bygFraJson({...KILDER, nu: new Date(tid)});
    const {fremad, ...bagud} = r;
    assert.equal(r.foreloebig, true);
    assert.deepEqual(bagud, RAP.maanedIndtilNu(L, gemt.snapshots[m]), `${navn}: Bagud`);
    assert.deepEqual(fremad, RAP.fremad(L, {gemt: true}), `${navn}: Fremad`);
  }
});
