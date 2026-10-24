// LAU-serveren (server/): login og invitationer, rollerne, de fortrolige dokumenter (versioner og handlingslog), de
// statiske filer (kun det offentlige), den flettede kalender, planlægningen af kørsler – og at Python-scripts kan
// læse og skrive serverens database (scripts/admin.py med LAU_DB), herunder flytningen fra de krypterede filer.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {konfiguration, start} from '../server/server.js';
import {forfalden, Jobs} from '../server/jobs.js';
import {maaGemme} from '../server/adgang.js';

const ROD = new URL('../', import.meta.url).pathname;
const MAPPE = mkdtempSync(join(tmpdir(), 'lau-server-'));
let S, URL_;

before(async () => {
  cpSync(ROD + 'test/fixtures/data', join(MAPPE, 'data'), {recursive: true, filter: p => !p.includes('/admin')});
  cpSync(ROD + 'kalender', join(MAPPE, 'kalender'), {recursive: true});
  S = start(konfiguration({LAU_VAR: MAPPE, PORT: '0', LAU_JOBS: '0', LAU_ADRESSE: 'https://kort.example.dk/'}));
  await new Promise(ok => S.server.once('listening', ok));
  URL_ = `http://127.0.0.1:${S.server.address().port}`;
});
after(async () => { await S.luk(); rmSync(MAPPE, {recursive: true, force: true}); });

/** En "browser": husker cookien og sender X-LAU ved ændringer. */
function klient() {
  let cookie = '';
  return async (sti, {metode = 'GET', krop, header = true} = {}) => {
    const r = await fetch(URL_ + sti, {method: metode, headers: {...(cookie ? {cookie} : {}), ...(krop ? {'content-type': 'application/json'} : {}),
      ...(metode !== 'GET' && header ? {'x-lau': '1'} : {})}, body: krop ? JSON.stringify(krop) : undefined});
    const c = r.headers.get('set-cookie');
    if (c) cookie = c.split(';')[0];
    const tekst = await r.text();
    let json = null;
    try { json = JSON.parse(tekst); } catch (_) { /* ikke JSON */ }
    return {status: r.status, json, tekst, headers: r.headers};
  };
}
/** Opretter en bruger og logger ind via invitationen. */
async function bruger(email, navn, rolle) {
  const id = S.db.opretBruger({email, navn, rolle}), token = S.db.nyInvitation(id), k = klient();
  assert.equal((await k(`/api/invitation?token=${token}`)).json.navn, navn);
  assert.equal((await k('/api/invitation', {metode: 'POST', krop: {token, kode: 'kort'}})).status, 400, 'for kort kode');
  assert.equal((await k('/api/invitation', {metode: 'POST', krop: {token, kode: 'en-lang-nok-kode'}})).status, 200);
  assert.equal((await k('/api/invitation', {metode: 'POST', krop: {token, kode: 'en-lang-nok-kode'}})).status, 404, 'kun én gang');
  return k;
}

test('login: invitation, session, forkert kode, log ud', async () => {
  const k = await bruger('admin@example.dk', 'Admin', 'admin');
  const mig = (await k('/api/mig')).json;
  assert.equal(mig.bruger.navn, 'Admin');
  assert.equal(mig.rettigheder.skriv, '*');
  const ny = klient();
  assert.equal((await ny('/api/mig')).json.bruger, null);
  assert.equal((await ny('/api/login', {metode: 'POST', krop: {email: 'ADMIN@example.dk', kode: 'forkert'}})).status, 401);
  assert.equal((await ny('/api/login', {metode: 'POST', krop: {email: 'ADMIN@example.dk', kode: 'en-lang-nok-kode'}})).status, 200, 'e-mail uden store/små');
  assert.equal((await ny('/api/data/hb')).status, 200);
  assert.equal((await ny('/api/logud', {metode: 'POST'})).status, 200);
  assert.equal((await ny('/api/data/hb')).status, 401);
  assert.equal((await ny('/api/login', {metode: 'POST', krop: {email: 'admin@example.dk', kode: 'en-lang-nok-kode'}, header: false})).status, 403, 'X-LAU kræves');
});

test('dokumenter: versioner, samtidige ændringer, handlingslog', async () => {
  const k = await bruger('a2@example.dk', 'Anden admin', 'admin');
  assert.deepEqual((await k('/api/data/noter')).json.indhold, null);
  const v1 = (await k('/api/data/noter', {metode: 'PUT', krop: {indhold: {Fyn: {tekst: 'Hej'}}, version: null, besked: 'Note'}})).json.version;
  assert.equal(v1, 1);
  assert.equal((await k('/api/data/noter', {metode: 'PUT', krop: {indhold: {}, version: null}})).status, 409, 'forældet version');
  assert.equal((await k('/api/data/noter', {metode: 'PUT', krop: {indhold: {Fyn: {tekst: 'Hej igen'}}, version: 1}})).json.version, 2);
  assert.deepEqual((await k('/api/data/noter')).json.indhold, {Fyn: {tekst: 'Hej igen'}});
  const h = (await k('/api/historik?navn=noter')).json;
  assert.deepEqual(h.map(x => [x.version, x.af]), [[2, 'Anden admin'], [1, 'Anden admin']]);
  assert.deepEqual((await k(`/api/historik/${h[1].id}`)).json.indhold, {Fyn: {tekst: 'Hej'}}, 'den gamle udgave kan hentes');
  assert.equal((await k('/api/data/..%2Fx')).status, 404);
});

test('roller: udvalget må registrere kontakter, men ikke ændre fordelingen, rettelser eller brugere', async () => {
  const admin = await bruger('a3@example.dk', 'Admin 3', 'admin');
  const formand = await bruger('f@example.dk', 'Formand', 'udviklingsformand');
  const udvalg = await bruger('u@example.dk', 'Udvalg', 'udvalg');
  const u0 = {udvalg: [{id: 'u1', navn: 'Udvalg'}], ansvar: {Fyn: 'u1'}, kontakter: []};
  assert.equal((await formand('/api/data/udvikling', {metode: 'PUT', krop: {indhold: u0, version: null}})).status, 200);
  const kontakt = {...u0, kontakter: [{id: 'k1', forening: 'Fyn', dato: '2026-10-01', af: 'u1'}]};
  assert.equal((await udvalg('/api/data/udvikling', {metode: 'PUT', krop: {indhold: kontakt, version: 1}})).status, 200);
  const r = await udvalg('/api/data/udvikling', {metode: 'PUT', krop: {indhold: {...kontakt, ansvar: {}}, version: 2}});
  assert.equal(r.status, 403);
  assert.match(r.json.fejl, /fordelingen/);
  assert.equal((await udvalg('/api/data/rettelser', {metode: 'PUT', krop: {indhold: {}, version: null}})).status, 403);
  assert.equal((await formand('/api/data/rettelser', {metode: 'PUT', krop: {indhold: {}, version: null}})).status, 403);
  assert.equal((await udvalg('/api/brugere')).status, 403);
  assert.equal((await udvalg('/api/koersler')).status, 403);
  // Udviklingsformanden kan invitere udvalgsmedlemmer – men ikke admins.
  assert.equal((await formand('/api/brugere', {metode: 'POST', krop: {email: 'ny@example.dk', navn: 'Ny', rolle: 'admin'}})).status, 403);
  const ny = await formand('/api/brugere', {metode: 'POST', krop: {email: 'ny@example.dk', navn: 'Ny', rolle: 'udvalg'}});
  assert.match(ny.json.invitation, /^https:\/\/kort\.example\.dk\/#invitation=[\w-]{43}$/);
  assert.equal((await formand('/api/brugere', {metode: 'POST', krop: {email: 'NY@example.dk', navn: 'Ny', rolle: 'udvalg'}})).status, 409);
  // Deaktiveret: sessionen virker ikke længere.
  const id = (await admin('/api/brugere')).json.find(b => b.email === 'u@example.dk').id;
  assert.equal((await formand(`/api/brugere/${id}`, {metode: 'PUT', krop: {aktiv: false}})).status, 200);
  assert.equal((await udvalg('/api/data/udvikling')).status, 401);
  // Unit: reglen selv.
  assert.equal(maaGemme({rolle: 'udvalg'}, 'udvikling', u0, {...u0, kontakter: [{}]}), null);
  assert.match(maaGemme({rolle: 'udvalg'}, 'udvikling', u0, {...u0, udvalg: []}), /fordelingen/);
  assert.equal(maaGemme({rolle: 'udviklingsformand'}, 'udvikling', u0, {...u0, udvalg: []}), null);
});

test('statiske filer: kun det offentlige, og index.html fortæller app.js, at den kører på serveren', async () => {
  const k = klient();
  const index = await k('/');
  assert.match(index.tekst, /window\.LAU_CONFIG = \{backend: 'server'/);
  assert.ok(index.tekst.indexOf('LAU_CONFIG') < index.tekst.indexOf('app.js'), 'før app.js');
  assert.equal((await k('/data/foreninger.json')).status, 200);
  assert.equal((await k('/kerne/lau.js')).status, 200);
  for (const sti of ['/data/admin/noegle.json', '/server/db.js', '/scripts/admin.py', '/.git/config', '/package.json', '/data/../server/db.js', '/lau.db']) {
    assert.equal((await k(sti)).status, 404, sti);
  }
  const ics = await k('/kal/fyn+aalborg.ics');
  assert.equal(ics.status, 200);
  assert.match(ics.tekst, /X-WR-CALNAME:LAU Aalborg\\, Fyn \+ Landsforeningen/);
  assert.equal((await k('/kal/.ics')).status, 400);
});

test('kørsler: planlagte tidspunkter i dansk tid', () => {
  const plan = {ugedage: [1, 3, 5], tid: '07:00'};
  assert.equal(forfalden(plan, new Date('2026-10-26T05:59:00Z')), null, 'mandag 06.59 dansk tid');
  assert.equal(forfalden(plan, new Date('2026-10-26T06:00:00Z')), '2026-10-26 07:00', 'mandag 07.00 (vintertid)');
  assert.equal(forfalden(plan, new Date('2026-10-27T06:00:00Z')), null, 'tirsdag');
  assert.equal(forfalden(plan, new Date('2026-10-26T12:30:00Z')), null, 'over 6 timer for sent');
  assert.equal(forfalden({dag: 1, tid: '04:17'}, new Date('2026-11-01T03:20:00Z')), '2026-11-01 04:17');
});

test('kørsler: med LAU_JOBS=cron lægges de i databasens kø, som "lau.js cron" tager', () => {
  const j = new Jobs(S.db, {rod: ROD, data: '', kalender: '', backup: '', cron: true});
  j.planlaeg('beregn', {forsinkelse: 60000});
  j.planlaeg('historik', {arg: '2026-01'});
  assert.deepEqual(j.status(), {koerer: null, koe: ['historik', 'beregn']});
  assert.deepEqual(S.db.tagOensker().map(o => ({...o})), [{job: 'historik', arg: '2026-01'}], 'beregn venter et minut');
  j.planlaeg('beregn');
  assert.deepEqual(S.db.tagOensker().map(o => o.job), ['beregn'], 'et nyt ønske erstatter det gamle');
  assert.deepEqual(j.status().koe, []);
  assert.equal(j.koerer, null, 'webprocessen kører intet selv');
});

// Python-delen: scripts/admin.py med LAU_DB læser og skriver de samme dokumenter, og til-db flytter de krypterede filer.
const harKrypto = spawnSync('python3', ['-c', 'import cryptography'], {encoding: 'utf8'}).status === 0;
test('scripts: admin.py til-db flytter de krypterede filer, og hb.py skriver i databasen', {skip: !harKrypto && 'kræver pip install cryptography'}, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lau-migrer-')), db = join(tmp, 'lau.db'), data = join(tmp, 'data');
  const py = `
import json, os, sys
sys.path.insert(0, ${JSON.stringify(ROD + 'scripts')})
import admin
from pathlib import Path
admin.ADMIN = Path(${JSON.stringify(tmp)}) / "admin"; admin.NOEGLE = admin.ADMIN / "noegle.json"
admin.ADMIN.mkdir()
admin._NOEGLE, n = admin._ny_noegle("test-kode-12345")
admin.NOEGLE.write_text(json.dumps(n))
admin.skriv("hb", {"hb2026": {"foreninger": {"Fyn": {"status": "godkendt"}}}})
admin.skriv("udvikling", {"udvalg": [{"id": "u1", "navn": "Æ"}], "ansvar": {}, "kontakter": []})
os.environ["LAU_DB"] = ${JSON.stringify(db)}
admin.til_db(); admin.til_db()
print(json.dumps([admin.laes("hb"), admin.laes("udvikling"), admin.har_noegle(), admin.hvor("hb")]))
`;
  const r = spawnSync('python3', ['-c', py], {encoding: 'utf8', env: {...process.env, LAU_DATA: data}});
  assert.equal(r.status, 0, r.stderr);
  const linjer = r.stdout.trim().split('\n');
  assert.deepEqual(linjer.filter(l => /^(hb|udvikling):/.test(l)), ['hb: flyttet', 'udvikling: flyttet', 'hb: uændret', 'udvikling: uændret']);
  const [hb, udv, noegle, hvor] = JSON.parse(linjer[linjer.length - 1]);
  assert.equal(hb.hb2026.foreninger.Fyn.status, 'godkendt');
  assert.equal(udv.udvalg[0].navn, 'Æ');
  assert.equal(noegle, true);
  assert.equal(hvor, `hb i ${db}`);
  assert.deepEqual(JSON.parse(readFileSync(join(data, 'foreninger.json'), 'utf8')), JSON.parse(readFileSync(ROD + 'data/foreninger.json', 'utf8')), 'offentlige data kopieret');

  // hb.py på faste data skriver HB-prognosen i databasen (som når serveren kører "beregn").
  const hbpy = spawnSync('python3', [ROD + 'scripts/hb.py', '2026'], {encoding: 'utf8', env: {...process.env, LAU_DB: db, LAU_DATA: ROD + 'test/fixtures/data'}});
  assert.equal(hbpy.status, 0, hbpy.stderr);
  assert.match(hbpy.stdout, new RegExp(`Skrevet til hb_2027 i ${db.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  const d = new DatabaseSync(db);
  const rk = d.prepare("SELECT version, af FROM dokumenter WHERE navn = 'hb_2027'").get();
  assert.deepEqual({...rk}, {version: 1, af: 'system:hb'});
  assert.ok(JSON.parse(d.prepare("SELECT indhold FROM dokumenter WHERE navn = 'hb_2027'").get().indhold).foreninger.Fyn);
  assert.equal(d.prepare("SELECT count(*) AS n FROM handlinger WHERE navn = 'hb_2027'").get().n, 1, 'logget');
  d.close();
  rmSync(tmp, {recursive: true, force: true});
});
