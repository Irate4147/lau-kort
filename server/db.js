// LAU-serverens database: SQLite via Nodes indbyggede node:sqlite (ingen npm-pakker). Skemaet står i skema.sql og
// bruges også af scripts/admin.py (LAU_DB), så Python-scripts (hb.py, rapport.py …) læser og skriver de samme dokumenter.

import {createHash, randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {mkdirSync, readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const SKEMA = readFileSync(new URL('./skema.sql', import.meta.url), 'utf8');
export const nu = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
export const sha256 = t => createHash('sha256').update(t).digest('hex');
export const nytToken = () => randomBytes(32).toString('base64url');

// scrypt: N = 2^15, r = 8, p = 1 (ca. 32 MB og 50–100 ms pr. forsøg).
const SCRYPT = {N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024};
const scryptP = (kode, salt) => new Promise((ok, fejl) => scrypt(kode, salt, 32, SCRYPT, (e, k) => (e ? fejl(e) : ok(k))));
export async function hashKode(kode) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${(await scryptP(kode, salt)).toString('base64')}`;
}
export async function tjekKode(kode, hash) {
  const [type, salt, k] = String(hash || '').split('$');
  if (type !== 'scrypt' || !salt || !k) return false;
  const a = await scryptP(kode, Buffer.from(salt, 'base64')), b = Buffer.from(k, 'base64');
  return a.length === b.length && timingSafeEqual(a, b);
}

export class Db {
  /** @param {string} sti stien til SQLite-filen (':memory:' i tests) */
  constructor(sti) {
    this.sti = sti;
    if (sti !== ':memory:') mkdirSync(dirname(sti), {recursive: true});
    this.db = new DatabaseSync(sti);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 30000; PRAGMA foreign_keys = ON;');
    this.db.exec(SKEMA);
  }

  /** Kører fn i en transaktion (BEGIN IMMEDIATE, så samtidige skrivninger venter). */
  transaktion(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (err) { this.db.exec('ROLLBACK'); throw err; }
  }

  log({bruger = null, af = null, handling, navn = null, version = null, besked = null, indhold = null}) {
    this.db.prepare('INSERT INTO handlinger (tid, bruger, af, handling, navn, version, besked, indhold) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(nu(), bruger, af, handling, navn, version, besked, indhold);
  }

  // ---------------------------------------------------------------- dokumenter (de fortrolige data)

  /** {indhold, version, rettet, af} eller null. */
  dokument(navn) {
    const r = this.db.prepare('SELECT indhold, version, rettet, af FROM dokumenter WHERE navn = ?').get(navn);
    return r ? {indhold: JSON.parse(r.indhold), version: r.version, rettet: r.rettet, af: r.af} : null;
  }

  dokumentnavne() { return this.db.prepare('SELECT navn, version, rettet, af FROM dokumenter ORDER BY navn').all(); }

  /**
   * Gemmer et dokument, hvis version er den nuværende (null: dokumentet må ikke findes). Returnerer den nye version,
   * eller null ved en samtidig ændring (409).
   */
  gemDokument(navn, indhold, version, {bruger = null, af = null, besked = null} = {}) {
    const tekst = JSON.stringify(indhold);
    return this.transaktion(() => {
      const r = this.db.prepare('SELECT version FROM dokumenter WHERE navn = ?').get(navn);
      if ((r ? r.version : null) !== (version ?? null)) return null;
      const ny = (r ? r.version : 0) + 1, tid = nu();
      this.db.prepare(`INSERT INTO dokumenter (navn, indhold, version, rettet, af) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(navn) DO UPDATE SET indhold = excluded.indhold, version = excluded.version, rettet = excluded.rettet, af = excluded.af`)
        .run(navn, tekst, ny, tid, af);
      this.log({bruger, af, handling: 'gem', navn, version: ny, besked, indhold: tekst});
      return ny;
    });
  }

  /** De seneste ændringer (uden indhold). */
  historik({navn = null, graense = 100} = {}) {
    const sql = `SELECT id, tid, bruger, af, handling, navn, version, besked FROM handlinger ${navn ? 'WHERE navn = ?' : ''} ORDER BY id DESC LIMIT ?`;
    return navn ? this.db.prepare(sql).all(navn, graense) : this.db.prepare(sql).all(graense);
  }

  // ---------------------------------------------------------------- brugere, sessioner og invitationer

  brugere() {
    return this.db.prepare('SELECT id, email, navn, rolle, aktiv, oprettet, sidst_inde, hash IS NOT NULL AS harKode FROM brugere ORDER BY navn').all()
      .map(b => ({...b, aktiv: !!b.aktiv, harKode: !!b.harKode}));
  }
  bruger(id) { return this.db.prepare('SELECT * FROM brugere WHERE id = ?').get(id) || null; }
  brugerMedEmail(email) { return this.db.prepare('SELECT * FROM brugere WHERE email = ?').get(String(email).trim()) || null; }

  opretBruger({email, navn, rolle}) {
    const r = this.db.prepare('INSERT INTO brugere (email, navn, rolle, oprettet) VALUES (?, ?, ?, ?)').run(String(email).trim(), navn, rolle, nu());
    return Number(r.lastInsertRowid);
  }
  retBruger(id, {navn, rolle, aktiv}) {
    const b = this.bruger(id);
    if (!b) return false;
    this.db.prepare('UPDATE brugere SET navn = ?, rolle = ?, aktiv = ? WHERE id = ?')
      .run(navn ?? b.navn, rolle ?? b.rolle, aktiv == null ? b.aktiv : aktiv ? 1 : 0, id);
    if (aktiv === false) this.db.prepare('DELETE FROM sessioner WHERE bruger = ?').run(id);
    return true;
  }
  saetKode(id, hash) {
    this.db.prepare('UPDATE brugere SET hash = ? WHERE id = ?').run(hash, id);
    this.db.prepare('DELETE FROM sessioner WHERE bruger = ?').run(id); // log ud alle steder
  }

  /** Ny session; returnerer tokenet (kun dets hash gemmes). */
  nySession(bruger, dage) {
    const token = nytToken(), udloeber = new Date(Date.now() + dage * 864e5).toISOString();
    this.db.prepare('INSERT INTO sessioner (token, bruger, udloeber, oprettet) VALUES (?, ?, ?, ?)').run(sha256(token), bruger, udloeber, nu());
    this.db.prepare('UPDATE brugere SET sidst_inde = ? WHERE id = ?').run(nu(), bruger);
    return token;
  }
  /** Brugeren bag en gyldig session (aktiv) eller null. */
  session(token) {
    if (!token) return null;
    const r = this.db.prepare(`SELECT b.* FROM sessioner s JOIN brugere b ON b.id = s.bruger
      WHERE s.token = ? AND s.udloeber > ? AND b.aktiv = 1`).get(sha256(token), new Date().toISOString());
    return r || null;
  }
  slutSession(token) { if (token) this.db.prepare('DELETE FROM sessioner WHERE token = ?').run(sha256(token)); }

  /** Invitation (eller ny kode): et link, der er gyldigt i 14 dage. Tidligere invitationer til brugeren annulleres. */
  nyInvitation(bruger, dage = 14) {
    const token = nytToken();
    this.db.prepare('DELETE FROM invitationer WHERE bruger = ?').run(bruger);
    this.db.prepare('INSERT INTO invitationer (token, bruger, udloeber) VALUES (?, ?, ?)')
      .run(sha256(token), bruger, new Date(Date.now() + dage * 864e5).toISOString());
    return token;
  }
  /** Brugeren bag en gyldig invitation (uden at bruge den), eller null. */
  invitation(token) {
    const r = this.db.prepare('SELECT bruger FROM invitationer WHERE token = ? AND udloeber > ?').get(sha256(String(token)), new Date().toISOString());
    const b = r && this.bruger(r.bruger);
    return b && b.aktiv ? b : null;
  }
  /** Bruger invitationen (én gang) og returnerer brugeren, eller null. */
  brugInvitation(token) {
    return this.transaktion(() => {
      const r = this.db.prepare('SELECT bruger FROM invitationer WHERE token = ? AND udloeber > ?').get(sha256(String(token)), new Date().toISOString());
      if (!r) return null;
      this.db.prepare('DELETE FROM invitationer WHERE bruger = ?').run(r.bruger);
      const b = this.bruger(r.bruger);
      return b && b.aktiv ? b : null;
    });
  }

  ryd() {
    const t = new Date().toISOString();
    this.db.prepare('DELETE FROM sessioner WHERE udloeber <= ?').run(t);
    this.db.prepare('DELETE FROM invitationer WHERE udloeber <= ?').run(t);
  }

  // ---------------------------------------------------------------- kørsler

  startKoersel(job, noegle = null) {
    return Number(this.db.prepare('INSERT INTO koersler (job, noegle, start) VALUES (?, ?, ?)').run(job, noegle, nu()).lastInsertRowid);
  }
  slutKoersel(id, ok, log) {
    this.db.prepare('UPDATE koersler SET slut = ?, ok = ?, log = ? WHERE id = ?').run(nu(), ok ? 1 : 0, String(log).slice(-20000), id);
  }
  /** Lægger en kørsel i kø til cron (samme job kun én gang; et nyt ønske udskyder det). */
  oensk(job, arg = '', tid = nu()) {
    this.db.prepare('INSERT INTO koe (job, arg, tid) VALUES (?, ?, ?) ON CONFLICT (job) DO UPDATE SET arg = excluded.arg, tid = excluded.tid')
      .run(job, arg, tid);
  }
  /** Tager kørslerne i køen, der skal køres nu. */
  tagOensker() {
    return this.transaktion(() => {
      const t = nu(), r = this.db.prepare('SELECT job, arg FROM koe WHERE tid <= ? ORDER BY tid').all(t);
      this.db.prepare('DELETE FROM koe WHERE tid <= ?').run(t);
      return r;
    });
  }
  oensker() { return this.db.prepare('SELECT job FROM koe ORDER BY tid').all().map(r => r.job); }
  /** Den kørsel, der er i gang (i en anden proces). ponytail: en kørsel, der blev afbrudt, ses som i gang i 6 timer. */
  koererNu() {
    const fra = new Date(Date.now() - 6 * 3600e3).toISOString();
    return this.db.prepare('SELECT job, noegle FROM koersler WHERE slut IS NULL AND start > ? ORDER BY id DESC LIMIT 1').get(fra) || null;
  }
  harKoersel(job, noegle) { return !!this.db.prepare('SELECT 1 FROM koersler WHERE job = ? AND noegle = ?').get(job, noegle); }
  koersler(graense = 30) {
    return this.db.prepare('SELECT id, job, noegle, start, slut, ok, substr(log, -2000) AS log FROM koersler ORDER BY id DESC LIMIT ?').all(graense);
  }

  /** Sikkerhedskopi af hele databasen til en ny fil (konsistent, også mens serveren kører). */
  backup(fil) { this.db.prepare('VACUUM INTO ?').run(fil); }
}
