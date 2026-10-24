#!/usr/bin/env node
// Kommandolinjen på serveren. Læser samme miljøvariabler som serveren (LAU_VAR, LAU_ADRESSE … – se server/README.md).
//
//   node server/lau.js start                               start serveren (som systemd/Docker gør)
//   node server/lau.js opret-bruger <email> <navn> [rolle]  ny bruger (admin, udviklingsformand, udvalg) – udskriver login-linket
//   node server/lau.js login-link <email>                   nyt link til at vælge adgangskode (fx glemt kode)
//   node server/lau.js brugere                              list brugerne
//   node server/lau.js koer <job> [arg]                     kør sync, beregn, rapport, historik eller backup nu (venter)
//   node server/lau.js cron                                 kør de forfaldne planlagte kørsler og dem, serveren har lagt i kø
//                                                           (LAU_JOBS=cron – fx cPanel, hvor webprocessen ikke må køre dem)
//   node server/lau.js flyt-data                            flyt de krypterede filer fra repoet til databasen (spørger efter
//                                                           adminkoden, hvis ADMIN_KODE ikke er sat) og beregn bagefter
// På maskinen: sudo lau <kommando> (server/deploy/lau) – på cPanel: lau <kommando> (server/deploy/lau-cpanel).

import {Db} from './db.js';
import {gyldigRolle, ROLLER} from './adgang.js';
import {Jobs, JOBS} from './jobs.js';
import {konfiguration, start} from './server.js';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';

/** Spørger efter en kode uden at vise den. */
function spoerg(tekst) {
  return new Promise(ok => {
    const rl = createInterface({input: process.stdin, output: process.stdout, terminal: true});
    rl._writeToOutput = s => { if (s.includes(tekst)) process.stdout.write(s); };
    rl.question(tekst, svar => { rl.close(); process.stdout.write('\n'); ok(svar); });
  });
}

const [kommando, ...arg] = process.argv.slice(2);
const k = konfiguration();
const link = token => `${k.adresse || 'http://localhost:' + k.port + '/'}#invitation=${token}`;
const stop = besked => { console.error(besked); process.exit(1); };
const rod = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nyeJobs = db => new Jobs(db, {rod, data: k.data, kalender: k.kalender, backup: k.backup, adresse: k.adresse, python: k.python, env: k.jobEnv});

if (kommando === 'start') {
  start(k);
  console.log(`LAU-serveren kører på http://${k.host}:${k.port}/ (data: ${k.var})`);
} else {
  const db = new Db(k.db);
  if (kommando === 'opret-bruger') {
    const [email, navn, rolle = 'udvalg'] = arg;
    if (!email || !navn) stop('Brug: node server/lau.js opret-bruger <email> "<navn>" [admin|udviklingsformand|udvalg]');
    if (!gyldigRolle(rolle)) stop(`Ukendt rolle – vælg ${Object.keys(ROLLER).join(', ')}`);
    if (db.brugerMedEmail(email)) stop('Der findes allerede en bruger med den e-mail – brug login-link');
    const id = db.opretBruger({email, navn, rolle});
    db.log({af: 'kommandolinjen', handling: 'opret bruger', besked: `${navn} <${email}> (${rolle})`});
    console.log(`Oprettede ${navn} (${ROLLER[rolle].label}). Send dette link – det gælder i 14 dage og kan bruges én gang:\n${link(db.nyInvitation(id))}`);
  } else if (kommando === 'login-link') {
    const b = db.brugerMedEmail(arg[0] || '') || stop('Ingen bruger med den e-mail');
    db.log({af: 'kommandolinjen', handling: 'nyt login-link', besked: b.navn});
    console.log(`Link til ${b.navn} (gælder i 14 dage, én gang):\n${link(db.nyInvitation(b.id))}`);
  } else if (kommando === 'brugere') {
    for (const b of db.brugere()) console.log(`${b.aktiv ? ' ' : '✗'} ${b.navn} <${b.email}> – ${ROLLER[b.rolle]?.label || b.rolle}${b.harKode ? '' : ' (har ikke valgt kode)'}`);
  } else if (kommando === 'flyt-data') {
    const kode = process.env.ADMIN_KODE || await spoerg('Adminkode: ');
    const r = spawnSync(k.python, ['scripts/admin.py', 'til-db'], {cwd: rod, stdio: 'inherit',
      env: {...process.env, ADMIN_KODE: kode, LAU_DB: k.db, LAU_DATA: k.data}});
    if (r.status !== 0) process.exit(r.status || 1);
    console.log('Data er flyttet. Beregn HB, rapport og kalendere: lau koer beregn');
    process.exit(0);
  } else if (kommando === 'koer') {
    if (!JOBS[arg[0]]) stop(`Ukendt kørsel – vælg ${Object.keys(JOBS).join(', ')}`);
    const jobs = nyeJobs(db);
    jobs.planlaeg(arg[0], {arg: arg[1] || ''});
    const vent = setInterval(() => {
      if (jobs.koerer || jobs.koe.length) return;
      clearInterval(vent);
      const r = db.koersler(1)[0];
      console.log(r.log);
      process.exit(r.ok ? 0 : 1);
    }, 500);
  } else if (kommando === 'cron') {
    // Køres hvert andet minut af cron (med flock, så kun én ad gangen). Tager også det, der kommer i kø undervejs.
    const jobs = nyeJobs(db);
    const fyld = () => { jobs.forfaldne(); for (const o of db.tagOensker()) jobs.planlaeg(o.job, {arg: o.arg}); };
    fyld();
    const vent = setInterval(() => {
      if (jobs.koerer || jobs.koe.length) return;
      fyld();
      if (jobs.koerer || jobs.koe.length) return;
      clearInterval(vent);
      process.exit(0);
    }, 1000);
  } else {
    stop(`Brug: node server/lau.js start | opret-bruger | login-link | brugere | koer | cron | flyt-data\n(se server/README.md)`);
  }
}
