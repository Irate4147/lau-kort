// Månedsrapporten fra scripts/rapport.py på faste datoer (uden ADMIN_KODE – se koer-rapport.py). Bruges af
// test/scripts.test.js, der sammenligner med facit (test/fixtures/rapport.json), og af test/lav-rapport-facit.js.
// To datasæt: de frosne data (test/fixtures/data) og et varieret datasæt, der laves ud fra dem (varieret()): ugentlige
// kørsler fra januar, aflyste, forsvundne og manuelle arrangementer, fremmøde, flyttede og skjulte, lange titler med emoji.
import {execFile} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {tid as T} from '../../kerne/index.js';

const ROD = new URL('../../', import.meta.url).pathname;
const FIXTURES = ROD + 'test/fixtures/';
// Sidste dag i en måned sent om aftenen (dansk tid), kvartals- og årsskifte og dagene efter.
export const RAPPORT_DATOER = ['2026-03-31T21:59:00Z', '2026-06-30T21:30:00Z', '2026-09-29T10:00:00Z', '2026-09-30T21:30:00Z',
  '2026-12-31T22:30:00Z', '2027-01-02T12:00:00Z'];

/**
 * Scenarierne: pr. datasæt og dato "alle" og den indeværende måned uden gemte data, og en kæde af kørsler, hvor hver
 * bygger videre på det, den forrige gemte: kørsler lige efter midnat den 1. (dansk tid) tager et levende snapshot, der
 * bevares; rekonstruerede genberegnes; en måned i fremtiden afvises.
 * @returns {{navn: string, data: string, tid: string, valg: string, efter?: string}[]}
 */
export function scenarier() {
  const ud = [];
  for (const data of ['fixtures', 'varieret']) {
    for (const tid of RAPPORT_DATOER) {
      for (const valg of ['alle', T.maanedNoegle(new Date(tid))]) ud.push({navn: `${data} ${tid} ${valg}`, data, tid, valg});
    }
    const k = n => `${data} kæde ${n}`;
    ud.push({navn: k(1), data, tid: '2026-09-30T22:30:00Z', valg: ''},
      {navn: k(2), data, tid: '2026-12-31T23:30:00Z', valg: '', efter: k(1)},
      {navn: k(3), data, tid: '2027-01-02T12:00:00Z', valg: 'alle', efter: k(2)},
      {navn: k(4), data, tid: '2027-01-02T12:00:00Z', valg: '2026-10', efter: k(3)},
      {navn: k(5), data, tid: '2027-01-02T12:00:00Z', valg: '2027-02', efter: k(3)},
      {navn: k(6), data, tid: '2027-02-01T06:00:00Z', valg: '', efter: k(3)});
  }
  return ud;
}

/** Et varieret datasæt i en midlertidig mappe (deterministisk: samme data hver gang). */
export function varieret() {
  const laes = n => JSON.parse(readFileSync(FIXTURES + 'data/' + n, 'utf8'));
  const [foreninger, meta, events, rettelser] = [laes('foreninger.json'), laes('meta.json'), laes('events.json'), laes('rettelser.json').rettelser];
  let x = 7;
  const tal = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; // fast talrække
  const vaelg = xs => xs[Math.floor(tal() * xs.length)];
  const iso = ms => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
  const DAG = 864e5, FOERSTE = Date.parse('2026-01-05T09:00:00Z'), SIDST = Date.parse('2026-09-28T09:42:02Z');
  const navne = foreninger.filter(f => !f.national).map(f => f.navn), EMOJI = ['🎅🏻🌲', '💙', '🔷️', '🔥', '📚'];
  meta.koersler = [{id: 'x0', tid: iso(FOERSTE), foreninger: navne, begivenheder: 5}, ...meta.koersler];
  for (const e of events) {
    const s = Date.parse(e.start);
    if (e.historisk && s > FOERSTE + 10 * DAG && tal() < 0.7) {
      Object.assign(e, {historisk: false, foerst_set: iso(Math.max(FOERSTE + vaelg([0, 3, 9]) * DAG, s - Math.ceil(tal() * 70) * DAG)),
        sidst_set: iso(Math.min(s, SIDST))});
      const r = tal();
      if (r < 0.08) e.aflyst = true;
      else if (r < 0.13) Object.assign(e, {forsvundet: true, sidst_set: iso(Math.max(Date.parse(e.foerst_set), s - Math.ceil(tal() * 20) * DAG))});
    }
    if (tal() < 0.15) e.navn = `${vaelg(EMOJI)} ${e.navn} ${Array.from({length: 6}, () => vaelg(EMOJI)).join('')} med en ekstra lang titel`;
  }
  for (let i = 0; i < 120; i++) {
    const f = vaelg([...navne, 'Landsforeningen']), s = Date.parse('2026-09-20T16:00:00Z') + Math.floor(tal() * 170) * DAG;
    events.push({id: String(900000000000000 + i), forening: f, foreninger: tal() < 0.9 ? [f] : [f, vaelg(navne)],
      navn: `${i % 3 ? '' : '🔥 '}${vaelg(['Bestyrelsesmøde', 'Fredagsbar', 'Oplæg med ordfører', 'Stand på torvet'])}${i % 4 ? '' : ' – ' + 'x'.repeat(10 + i % 50)}`,
      url: '', start: iso(s), slut: iso(s + 2 * 36e5), sted: '', lat: null, lng: null, kommune: null, online: false, aflyst: tal() < 0.07,
      deltager: Math.floor(tal() * 40), interesserede: 3, svar: 10, beskrivelse: '', foerst_set: iso(Math.max(FOERSTE, s - Math.ceil(tal() * 80) * DAG)),
      sidst_set: iso(Math.min(s, SIDST)), forsvundet: tal() < 0.05, historisk: false});
  }
  const fortid = events.filter(e => Date.parse(e.start) < Date.parse('2026-09-25T00:00:00Z'));
  for (let i = 0; i < 50; i++) { const e = vaelg(fortid); rettelser[e.id] = {deltagere: 3 + Math.floor(tal() * 28), rettet: iso(Date.parse(e.start) + 2 * DAG)}; }
  for (let i = 0; i < 25; i++) {
    const e = vaelg(events);
    rettelser[e.id] = {status: 'ikke_afholdt', ...(tal() < 0.8 ? {rettet: iso(Date.parse(e.start) - Math.floor(tal() * 25 - 5) * DAG)} : {})};
  }
  for (let i = 0; i < 5; i++) rettelser[vaelg(fortid).id] = {status: 'skjult', rettet: '2026-09-01T10:00:00Z'};
  for (let i = 0; i < 5; i++) rettelser[vaelg(fortid).id] = {forening: vaelg(navne), rettet: '2026-09-01T10:00:00Z'};
  for (let i = 0; i < 8; i++) rettelser[vaelg(fortid).id] = {status: 'afholdt', rettet: '2026-09-29T10:00:00Z'};
  for (let i = 0; i < 12; i++) {
    const s = Date.parse('2026-02-01T17:00:00Z') + Math.floor(tal() * 330) * DAG;
    rettelser[`m-test${i}`] = {manuel: true, navn: `Manuelt ${i}`, forening: vaelg(navne), start: iso(s), slut: iso(s + 2 * 36e5),
      ...(s < SIDST ? {status: 'afholdt'} : {}), ...(i % 4 ? {rettet: iso(s - Math.floor(tal() * 33 - 3) * DAG)} : {}), ...(i % 3 ? {} : {deltagere: 12})};
  }
  const dir = mkdtempSync(join(tmpdir(), 'lau-rapport-'));
  for (const [n, d] of [['foreninger.json', foreninger], ['meta.json', meta], ['events.json', events], ['rettelser.json', {rettelser}]]) {
    writeFileSync(join(dir, n), JSON.stringify(d));
  }
  return dir + '/';
}

/**
 * Kør alle scenarier (uafhængige samtidig, kæderne i rækkefølge).
 * @param {string} [rod] mappen med scripts/ og test/hjaelp/koer-rapport.py (standard: dette repo)
 * @returns {Promise<Record<string, {udskrift: string, exit: string|null, krypteres: string|null, skrevet: boolean}>>}
 */
export async function koerScenarier(rod = ROD) {
  const mapper = {fixtures: FIXTURES + 'data/', varieret: varieret()};
  const ud = {}, alle = scenarier(), venter = new Map();
  const koer = s => new Promise((ok, fejl) => {
    const p = execFile('python3', [rod + 'test/hjaelp/koer-rapport.py', mapper[s.data], s.tid, ...(s.valg ? [s.valg] : [])],
      {maxBuffer: 1 << 28, encoding: 'utf8'}, (err, stdout) => (err ? fejl(err) : ok(JSON.parse(stdout))));
    p.stdin.end(s.efter ? ud[s.efter].krypteres : '');
  });
  const start = s => {
    if (!venter.has(s.navn)) {
      const foer = s.efter ? start(alle.find(x => x.navn === s.efter)) : Promise.resolve();
      venter.set(s.navn, foer.then(() => koer(s)).then(r => { ud[s.navn] = r; }));
    }
    return venter.get(s.navn);
  };
  try { await Promise.all(alle.map(start)); } finally { rmSync(mapper.varieret, {recursive: true, force: true}); }
  return Object.fromEntries(alle.map(s => [s.navn, ud[s.navn]]));
}
