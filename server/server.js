// LAU-serveren: siden, de offentlige data og et API med personlige logins, roller og handlingslog – erstatter GitHub
// Pages, de krypterede filer i repoet, Cloudflare-workeren og GitHub Actions. Kun Node 22 (ingen npm-pakker) og Python 3
// til scripts/. Se server/README.md.
//
//   /                          index.html (med window.LAU_CONFIG = {backend: 'server', …}), app.js, kerne/, udvidelser/ …
//   /data/*.json               de offentlige data (LAU_DATA) – aldrig data/admin/
//   /kalender/*.ics            kalenderne (LAU_KALENDER, skrevet af scripts/kalender.py)
//   /kal/aalborg+fyn.ics       flettet kalender for flere foreninger (samme regel som kalender-server/worker.js)
//   /api/…                     login, fortrolige data (dokumenter), brugere, historik og kørsler – se ROUTES nedenfor

import {createServer} from 'node:http';
import {existsSync, mkdirSync, readFileSync, statSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {dirname, extname, join, normalize, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {Db, hashKode, tjekKode} from './db.js';
import {erAdmin, gyldigRolle, kanLaese, maaGemme, maaStyreBruger, rettigheder, ROLLER} from './adgang.js';
import {Jobs, JOBS} from './jobs.js';
import {flettetKalender} from '../kalender-server/worker.js';

const ROD = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Det, siden består af (alt andet i repoet – scripts/, server/, .git … – serveres ikke).
const OFFENTLIGE = ['index.html', 'app.js', 'style.css', 'fonts.css'];
const OFFENTLIGE_MAPPER = ['kerne', 'udvidelser', 'geo'];
const TYPER = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.ics': 'text/calendar; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2'};
const DOKUMENT = /^[a-z0-9_-]{1,40}$/;
// Efter en ændring af disse beregnes HB-prognosen, rapporten og kalenderne igen (som workflowet hb.yml).
const BEREGN_EFTER = ['rettelser', 'hb'];
const COOKIE = 'lau_session';
const MAKS_KROP = 10 * 1024 * 1024;
const LOGIN_FORSOEG = {antal: 10, minutter: 15};
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_KODE = 10;

/**
 * Konfiguration fra miljøvariabler (se server/README.md og deploy/lau.env.eksempel).
 * @param {Record<string, string|undefined>} env
 */
export function konfiguration(env = process.env) {
  const varMappe = resolve(env.LAU_VAR || join(ROD, 'var'));
  const adresse = (env.LAU_ADRESSE || '').replace(/\/*$/, '/');
  return {
    port: +(env.PORT || 8080), host: env.HOST || '127.0.0.1', adresse: adresse === '/' ? '' : adresse,
    var: varMappe, db: env.LAU_DB || join(varMappe, 'lau.db'), data: env.LAU_DATA || join(varMappe, 'data'),
    kalender: env.LAU_KALENDER || join(varMappe, 'kalender'), backup: env.LAU_BACKUP || join(varMappe, 'backup'),
    sikkerCookie: env.LAU_SIKKER_COOKIE ? env.LAU_SIKKER_COOKIE === '1' : adresse.startsWith('https://'),
    bagProxy: env.LAU_BAG_PROXY !== '0', jobs: env.LAU_JOBS === 'cron' ? 'cron' : env.LAU_JOBS !== '0', python: env.LAU_PYTHON || 'python3',
    jobEnv: env.APIFY_TOKEN ? {APIFY_TOKEN: env.APIFY_TOKEN} : {},
  };
}

class Fejl extends Error {
  constructor(status, besked) { super(besked); this.status = status; }
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

/**
 * Starter serveren. Returnerer {server, db, jobs, k, luk()}.
 * @param {ReturnType<typeof konfiguration>} k
 */
export function start(k = konfiguration()) {
  for (const m of [k.var, k.data, k.kalender]) mkdirSync(m, {recursive: true});
  const db = new Db(k.db);
  const jobs = new Jobs(db, {rod: ROD, data: k.data, kalender: k.kalender, backup: k.backup, adresse: k.adresse, python: k.python, env: k.jobEnv,
    cron: k.jobs === 'cron'});
  if (k.jobs === true) jobs.start();
  const forsoeg = new Map(); // ip → tidspunkter for mislykkede login

  const ip = req => (k.bagProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  const saetCookie = (res, token, dage) => res.setHeader('Set-Cookie', `${COOKIE}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax${
    k.sikkerCookie ? '; Secure' : ''}${token == null ? '; Max-Age=0' : dage ? `; Max-Age=${dage * 86400}` : ''}`);
  const offentligBruger = b => b && {id: b.id, email: b.email, navn: b.navn, rolle: b.rolle};
  const navneMap = () => new Map(db.brugere().map(b => [b.id, b.navn]));
  const invitationLink = token => `${k.adresse || '/'}#invitation=${token}`;

  function kraev(b, ok = kanLaese(b)) {
    if (!b) throw new Fejl(401, 'Log ind først');
    if (!ok) throw new Fejl(403, 'Det har du ikke adgang til');
  }
  function login(res, b, husk) {
    const dage = husk ? 30 : 1; // uden "husk mig": en dag, og cookien glemmes, når browseren lukkes
    saetCookie(res, db.nySession(b.id, dage), husk ? dage : 0);
    db.log({bruger: b.id, af: b.navn, handling: 'login'});
  }

  /** @type {Record<string, (ctx: {req: any, res: any, b: any, krop: any, del: string[], url: URL}) => any>} */
  const ROUTES = {
    'GET mig': ({b}) => ({bruger: offentligBruger(b), rettigheder: b ? rettigheder(b) : null, roller: ROLLER}),

    async 'POST login'({req, res, krop}) {
      const nu = Date.now(), vindue = LOGIN_FORSOEG.minutter * 6e4, n = (forsoeg.get(ip(req)) || []).filter(t => nu - t < vindue);
      if (n.length >= LOGIN_FORSOEG.antal) throw new Fejl(429, `For mange forsøg – vent ${LOGIN_FORSOEG.minutter} minutter`);
      const b = db.brugerMedEmail(krop.email || '');
      if (!b || !b.aktiv || !(await tjekKode(String(krop.kode || ''), b.hash))) {
        if (forsoeg.size > 10000) forsoeg.clear(); // husk ikke uendeligt mange adresser
        forsoeg.set(ip(req), [...n, nu]);
        throw new Fejl(401, 'Forkert e-mail eller adgangskode');
      }
      forsoeg.delete(ip(req));
      login(res, b, !!krop.husk);
      return {bruger: offentligBruger(b)};
    },
    'POST logud'({req, res, b}) {
      db.slutSession(cookies(req)[COOKIE]);
      saetCookie(res, null);
      if (b) db.log({bruger: b.id, af: b.navn, handling: 'logud'});
      return {ok: true};
    },
    'GET invitation'({url}) {
      const b = db.invitation(url.searchParams.get('token') || '');
      if (!b) throw new Fejl(404, 'Linket er udløbet eller allerede brugt – bed om et nyt');
      return {navn: b.navn, email: b.email};
    },
    async 'POST invitation'({res, krop}) {
      const kode = String(krop.kode || '');
      if (kode.length < MIN_KODE) throw new Fejl(400, `Adgangskoden skal være mindst ${MIN_KODE} tegn`);
      const b = db.brugInvitation(krop.token || '');
      if (!b) throw new Fejl(404, 'Linket er udløbet eller allerede brugt – bed om et nyt');
      db.saetKode(b.id, await hashKode(kode));
      db.log({bruger: b.id, af: b.navn, handling: 'ny adgangskode'});
      login(res, b, !!krop.husk);
      return {bruger: offentligBruger(b)};
    },
    async 'POST kode'({b, krop, res}) {
      kraev(b);
      if (!(await tjekKode(String(krop.gammel || ''), b.hash))) throw new Fejl(400, 'Den nuværende adgangskode er forkert');
      if (String(krop.ny || '').length < MIN_KODE) throw new Fejl(400, `Adgangskoden skal være mindst ${MIN_KODE} tegn`);
      db.saetKode(b.id, await hashKode(String(krop.ny)));
      db.log({bruger: b.id, af: b.navn, handling: 'ny adgangskode'});
      login(res, b, true);
      return {ok: true};
    },

    // De fortrolige data: samme navne og former som data/admin/<navn>.krypt.json. version: til samtidige ændringer.
    'GET data'({b}) { kraev(b); return db.dokumentnavne(); },
    'GET data/:navn'({b, del}) {
      kraev(b);
      const d = db.dokument(del[1]);
      return {indhold: d ? d.indhold : null, version: d ? d.version : null, rettet: d && d.rettet, af: d && d.af};
    },
    'PUT data/:navn'({b, del, krop}) {
      kraev(b);
      const navn = del[1], d = db.dokument(navn);
      if (krop.indhold === undefined) throw new Fejl(400, 'Mangler indhold');
      const nej = maaGemme(b, navn, d && d.indhold, krop.indhold);
      if (nej) throw new Fejl(403, nej);
      const version = db.gemDokument(navn, krop.indhold, krop.version ?? null, {bruger: b.id, af: b.navn, besked: String(krop.besked || '').slice(0, 200)});
      if (version == null) throw new Fejl(409, 'Data er ændret samtidig – prøv igen');
      if (BEREGN_EFTER.includes(navn)) jobs.planlaeg('beregn', {forsinkelse: 15000});
      return {version};
    },
    'GET historik'({b, url}) {
      kraev(b);
      const navne = navneMap();
      return db.historik({navn: url.searchParams.get('navn'), graense: Math.min(500, +url.searchParams.get('graense') || 100)})
        .map(h => ({...h, af: h.af || navne.get(h.bruger) || null}));
    },
    'GET historik/:id'({b, del}) {
      kraev(b);
      const h = db.db.prepare('SELECT * FROM handlinger WHERE id = ?').get(+del[1]);
      if (!h) throw new Fejl(404, 'Findes ikke');
      return {...h, indhold: h.indhold ? JSON.parse(h.indhold) : null};
    },

    // Brugere: admins styrer alle; udviklingsformanden kan invitere og deaktivere udvalgsmedlemmer.
    'GET brugere'({b}) { kraev(b, rettigheder(b || {}).brugere); return db.brugere(); },
    'POST brugere'({b, krop}) {
      kraev(b, rettigheder(b || {}).brugere);
      const email = String(krop.email || '').trim(), navn = String(krop.navn || '').trim(), rolle = krop.rolle || 'udvalg';
      if (!EMAIL.test(email) || !navn) throw new Fejl(400, 'Angiv navn og en gyldig e-mail');
      if (!maaStyreBruger(b, rolle)) throw new Fejl(403, 'Du må ikke oprette brugere med den rolle');
      if (db.brugerMedEmail(email)) throw new Fejl(409, 'Der findes allerede en bruger med den e-mail');
      const id = db.opretBruger({email, navn, rolle});
      db.log({bruger: b.id, af: b.navn, handling: 'opret bruger', besked: `${navn} <${email}> (${rolle})`});
      return {id, invitation: invitationLink(db.nyInvitation(id))};
    },
    'PUT brugere/:id'({b, del, krop}) {
      kraev(b, rettigheder(b || {}).brugere);
      const m = db.bruger(+del[1]);
      if (!m) throw new Fejl(404, 'Findes ikke');
      const rolle = krop.rolle ?? m.rolle;
      if (!gyldigRolle(rolle) || !maaStyreBruger(b, rolle, m.rolle)) throw new Fejl(403, 'Du må ikke ændre den bruger');
      if (m.id === b.id && (krop.aktiv === false || rolle !== m.rolle)) throw new Fejl(400, 'Du kan ikke deaktivere dig selv eller ændre din egen rolle');
      db.retBruger(m.id, {navn: krop.navn ? String(krop.navn).trim() : undefined, rolle, aktiv: krop.aktiv});
      db.log({bruger: b.id, af: b.navn, handling: 'ret bruger', besked: `${m.navn}: ${JSON.stringify(krop)}`});
      return {ok: true};
    },
    'POST brugere/:id/invitation'({b, del}) {
      kraev(b, rettigheder(b || {}).brugere);
      const m = db.bruger(+del[1]);
      if (!m || !maaStyreBruger(b, m.rolle, m.rolle)) throw new Fejl(403, 'Du må ikke ændre den bruger');
      db.log({bruger: b.id, af: b.navn, handling: 'nyt login-link', besked: m.navn});
      return {invitation: invitationLink(db.nyInvitation(m.id))};
    },

    // Kørsler (scraping, HB, rapport, kalendere, backup) – kun admins.
    'GET koersler'({b}) {
      kraev(b, erAdmin(b));
      return {jobs: Object.fromEntries(Object.entries(JOBS).map(([id, j]) => [id, {label: j.label, plan: j.plan || null}])),
        status: jobs.status(), seneste: db.koersler(40)};
    },
    'POST koersler/:job'({b, del, krop}) {
      kraev(b, erAdmin(b));
      if (!JOBS[del[1]]) throw new Fejl(404, 'Ukendt kørsel');
      jobs.planlaeg(del[1], {arg: String(krop.arg || '').replace(/[^0-9-]/g, '')});
      db.log({bruger: b.id, af: b.navn, handling: 'start kørsel', besked: del[1]});
      return {ok: true};
    },
  };

  /** Finder ruten: "METODE sti", hvor :x matcher én del. */
  function rute(metode, del) {
    for (const [noegle, fn] of Object.entries(ROUTES)) {
      const [m, sti] = noegle.split(' '), mønster = sti.split('/');
      if (m === metode && mønster.length === del.length && mønster.every((p, i) => p.startsWith(':') || p === del[i])) return fn;
    }
    return null;
  }

  async function api(req, res, url) {
    const del = url.pathname.slice(5).split('/').filter(Boolean);
    if (del[0] === 'data' && del[1] && !DOKUMENT.test(del[1])) throw new Fejl(404, 'Ukendt dokument');
    // Ændringer kræver en egen header: en anden side kan ikke sende den uden CORS (beskytter mod CSRF).
    if (req.method !== 'GET' && req.headers['x-lau'] !== '1') throw new Fejl(403, 'Mangler X-LAU-header');
    const fn = rute(req.method, del);
    if (!fn) throw new Fejl(404, 'Ukendt API-kald');
    let krop = {};
    if (req.method !== 'GET') {
      const bidder = [];
      let n = 0;
      for await (const c of req) { n += c.length; if (n > MAKS_KROP) throw new Fejl(413, 'For stor'); bidder.push(c); }
      try { krop = bidder.length ? JSON.parse(Buffer.concat(bidder).toString('utf8')) : {}; } catch (_) { throw new Fejl(400, 'Ugyldig JSON'); }
      if (!krop || typeof krop !== 'object') throw new Fejl(400, 'Ugyldig JSON');
    }
    const b = db.session(cookies(req)[COOKIE]);
    return fn({req, res, b, krop, del, url});
  }

  // ---------------------------------------------------------------- statiske filer

  // index.html fortæller app.js, at den kører på serveren (login, data og kalendere herfra – se CONFIG i app.js).
  const LAU_CONFIG = `<script>window.LAU_CONFIG = {backend: 'server', dataBase: '', adminServer: '', kalenderServer: location.origin + '/kal'};</script>\n`;
  function fil(sti) {
    const p = normalize(sti).replace(/^([/\\])+/, '');
    if (p.split(/[/\\]/).some(x => x.startsWith('.'))) return null;
    if (OFFENTLIGE.includes(p) || OFFENTLIGE_MAPPER.some(m => p.startsWith(m + sep))) return join(ROD, p);
    if (p.startsWith('data' + sep) && !p.startsWith(join('data', 'admin'))) return join(k.data, p.slice(5));
    if (p.startsWith('kalender' + sep)) return join(k.kalender, p.slice(9));
    return null;
  }
  async function statisk(req, res, url) {
    let sti = decodeURIComponent(url.pathname);
    if (sti === '/' || sti === '/index.html') sti = '/index.html';
    const p = fil(sti);
    let st;
    try { st = p && statSync(p); } catch (_) { st = null; }
    if (!st || !st.isFile()) { res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'}); return res.end('Findes ikke\n'); }
    const sidst = st.mtime.toUTCString();
    if (req.headers['if-modified-since'] === sidst && !p.endsWith('index.html')) { res.writeHead(304); return res.end(); }
    let indhold = await readFile(p);
    if (p === join(ROD, 'index.html')) indhold = Buffer.from(indhold.toString('utf8').replace(/<script/, LAU_CONFIG + '<script'));
    const type = TYPER[extname(p)] || 'application/octet-stream';
    const hoveder = {'Content-Type': type, 'Cache-Control': 'no-cache', 'Last-Modified': sidst};
    if (p.endsWith('.ics')) hoveder['Access-Control-Allow-Origin'] = '*';
    if (/text|json|javascript|calendar|svg/.test(type) && indhold.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      indhold = gzipSync(indhold);
      hoveder['Content-Encoding'] = 'gzip';
      hoveder.Vary = 'Accept-Encoding';
    }
    res.writeHead(200, hoveder);
    res.end(req.method === 'HEAD' ? undefined : indhold);
  }

  async function kalender(res, url) {
    const hent = async f => { try { return readFileSync(join(k.kalender, f), 'utf8'); } catch (_) { return null; } };
    const r = await flettetKalender(url.pathname.slice(4), hent, k.adresse || url.origin + '/');
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  }

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        const svar = await api(req, res, url);
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
        return res.end(JSON.stringify(svar));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new Fejl(405, 'Metoden understøttes ikke');
      if (url.pathname.startsWith('/kal/')) return await kalender(res, url);
      return await statisk(req, res, url);
    } catch (err) {
      const status = err instanceof Fejl ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
      res.end(JSON.stringify({fejl: status === 500 ? 'Serverfejl' : err.message}));
    }
  });
  server.listen(k.port, k.host);
  return {server, db, jobs, k, luk: () => new Promise(ok => { jobs.stop(); server.close(() => { db.db.close(); ok(); }); server.closeAllConnections(); })};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {k} = start();
  console.log(`LAU-serveren kører på http://${k.host}:${k.port}/ (data: ${k.var})`);
  if (!existsSync(join(k.data, 'foreninger.json'))) console.warn(`Ingen data i ${k.data} endnu – se server/README.md (Flyt data).`);
}
