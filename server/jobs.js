// Kørsler på serveren – erstatter GitHub Actions: scraping (Apify), HB-prognose, månedsrapport, kalendere og
// sikkerhedskopier. Python-scripts køres med LAU_DB/LAU_DATA/LAU_KALENDER, så de læser og skriver serverens data i
// stedet for repoets. Én kørsel ad gangen (som "concurrency: sync" i workflowene).

import {spawn} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';

// plan: ugedage (1 = mandag … 7 = søndag) og/eller dag i måneden, tid i dansk tid. Uden plan: kun manuelt/efter ændringer.
export const JOBS = {
  sync: {label: 'Hent begivenheder (Apify) og beregn', plan: {ugedage: [1, 3, 5], tid: '07:00'},
    trin: [['scripts/sync.py', '--start'], ['scripts/admin.py', 'klargoer'], ['scripts/hb.py'], ['scripts/rapport.py'], ['scripts/kalender.py']]},
  beregn: {label: 'Beregn HB-prognose, rapport og kalendere',
    trin: [['scripts/admin.py', 'klargoer'], ['scripts/hb.py'], ['scripts/rapport.py'], ['scripts/kalender.py']]},
  rapport: {label: 'Månedsrapport', plan: {dag: 1, tid: '04:17'}, trin: [['scripts/rapport.py']]},
  historik: {label: 'Hent historik (Apify, koster kreditter)', trin: [['scripts/sync.py', '--historik', '$ARG'], ['scripts/kalender.py']]},
  backup: {label: 'Sikkerhedskopi', plan: {tid: '03:30'}},
};
const BACKUP_DAGE = 30;
const INDHENT_TIMER = 6; // en planlagt kørsel, serveren var nede til, køres, hvis den er under 6 timer forsinket

const fmt = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'});
const UGEDAG = {Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7};
/** Dato, tid og ugedag i dansk tid. @param {Date} d */
export function danskTid(d) {
  const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]));
  return {dato: `${p.year}-${p.month}-${p.day}`, tid: `${p.hour}:${p.minute}`, ugedag: UGEDAG[p.weekday], dag: +p.day};
}

/** Den planlagte kørsel, der skal køres nu (nøglen "dato tid"), eller null. @param {Date} d */
export function forfalden(plan, d) {
  const t = danskTid(d);
  if (plan.ugedage && !plan.ugedage.includes(t.ugedag)) return null;
  if (plan.dag && plan.dag !== t.dag) return null;
  const [h, m] = plan.tid.split(':').map(Number), [th, tm] = t.tid.split(':').map(Number);
  const min = th * 60 + tm - (h * 60 + m);
  return min >= 0 && min < INDHENT_TIMER * 60 ? `${t.dato} ${plan.tid}` : null;
}

export class Jobs {
  /**
   * @param {import('./db.js').Db} db
   * @param {{rod: string, data: string, kalender: string, backup: string, adresse?: string, python?: string, env?: object}} k
   */
  constructor(db, k) {
    this.db = db;
    this.k = k;
    this.koe = [];
    this.koerer = null;
    this.timere = new Map();
  }

  /** Sætter et job i kø (samme job kun én gang). forsinkelse: vent så mange ms (nye kald udskyder det – fx efter rettelser). */
  planlaeg(job, {noegle = null, arg = '', forsinkelse = 0} = {}) {
    if (!JOBS[job]) throw new Error(`Ukendt kørsel: ${job}`);
    if (forsinkelse) {
      clearTimeout(this.timere.get(job));
      this.timere.set(job, setTimeout(() => { this.timere.delete(job); this.planlaeg(job, {noegle, arg}); }, forsinkelse));
      return;
    }
    if (this.koe.some(x => x.job === job)) return; // kører det allerede, køres det igen bagefter (data kan være ændret)
    this.koe.push({job, noegle, arg});
    this.naeste();
  }

  status() { return {koerer: this.koerer, koe: this.koe.map(x => x.job)}; }

  async naeste() {
    if (this.koerer || !this.koe.length) return;
    this.koerer = this.koe.shift();
    const {job, noegle, arg} = this.koerer, id = this.db.startKoersel(job, noegle);
    let log = '', ok = true;
    try {
      if (job === 'backup') log = this.backup();
      else for (const trin of JOBS[job].trin) {
        const r = await this.python(trin.map(x => (x === '$ARG' ? arg : x)).filter(x => x !== ''));
        log += `$ ${trin.join(' ')}\n${r.ud}\n`;
        if (r.kode !== 0) { ok = false; log += `(fejlede med kode ${r.kode})\n`; break; }
      }
    } catch (err) { ok = false; log += String(err && err.stack || err); }
    this.db.slutKoersel(id, ok, log);
    if (!ok) console.error(`Kørslen ${job} fejlede:\n${log.slice(-2000)}`);
    this.koerer = null;
    this.naeste();
  }

  python(args) {
    const {rod, data, kalender, adresse, python = 'python3', env = {}} = this.k;
    return new Promise(ok => {
      const p = spawn(python, args, {cwd: rod, env: {...process.env, ...env, LAU_DB: this.db.sti, LAU_DATA: data, LAU_KALENDER: kalender,
        ...(adresse ? {LAU_ADRESSE: adresse} : {}), PYTHONUNBUFFERED: '1'}});
      let ud = '';
      p.stdout.on('data', b => { ud += b; });
      p.stderr.on('data', b => { ud += b; });
      p.on('error', err => ok({kode: -1, ud: ud + String(err)}));
      p.on('close', kode => ok({kode, ud: ud.slice(-50000)}));
    });
  }

  /** Databasen (VACUUM INTO) og de offentlige data (events.json m.fl.) i backup/<dato>/; de seneste 30 dage gemmes. */
  backup() {
    const dato = danskTid(new Date()).dato, mappe = join(this.k.backup, dato);
    rmSync(mappe, {recursive: true, force: true});
    mkdirSync(join(mappe, 'data'), {recursive: true});
    this.db.backup(join(mappe, 'lau.db'));
    for (const f of readdirSync(this.k.data)) if (f.endsWith('.json')) copyFileSync(join(this.k.data, f), join(mappe, 'data', f));
    const gamle = readdirSync(this.k.backup).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().slice(0, -BACKUP_DAGE);
    for (const g of gamle) rmSync(join(this.k.backup, g), {recursive: true, force: true});
    return `Sikkerhedskopi i ${mappe}${gamle.length ? ` (slettede ${gamle.join(', ')})` : ''}`;
  }

  /** Tjekker hvert halve minut, om en planlagt kørsel er forfalden. */
  start() {
    if (!existsSync(this.k.backup)) mkdirSync(this.k.backup, {recursive: true});
    const tjek = () => {
      for (const [job, def] of Object.entries(JOBS)) {
        const noegle = def.plan && forfalden(def.plan, new Date());
        if (noegle && !this.db.harKoersel(job, noegle) && !this.koe.some(x => x.job === job) && !(this.koerer && this.koerer.noegle === noegle)) {
          this.planlaeg(job, {noegle});
        }
      }
      this.db.ryd();
    };
    tjek();
    this.interval = setInterval(tjek, 30000);
    this.interval.unref();
  }
  stop() { clearInterval(this.interval); for (const t of this.timere.values()) clearTimeout(t); }
}
