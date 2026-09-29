// Tid og kalender i dansk tid. Rene funktioner: "nu" gives altid med, så reglerne kan testes på enhver dato.

export const TZ = 'Europe/Copenhagen';
export const DAG = 864e5;

const fmtDag = new Intl.DateTimeFormat('en-CA', {timeZone: TZ});
const fmtTime = new Intl.DateTimeFormat('en-GB', {hour: '2-digit', hourCycle: 'h23', timeZone: TZ});
export const fmtDato = new Intl.DateTimeFormat('da-DK', {day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ});

/** YYYY-MM-DD i dansk tid. @param {Date} d */
export const dagNoegle = d => fmtDag.format(d);
/** YYYY-MM i dansk tid. @param {Date} d */
export const maanedNoegle = d => dagNoegle(d).slice(0, 7);
/** Hele dage fra a til b. @param {Date} a @param {Date} b */
export const dageMellem = (a, b) => Math.floor((+b - +a) / DAG);
/** 0 = mandag … 6 = søndag (dansk tid). @param {Date} d */
export const ugedag = d => (new Date(dagNoegle(d) + 'T12:00:00Z').getUTCDay() + 6) % 7;
/** Timen (0–23) i dansk tid. @param {Date} d */
export const time = d => +fmtTime.format(d);
/** @param {Date} nu @param {number} dage */
export const plusDage = (nu, dage) => new Date(+nu + dage * DAG);
/** Datoen n kalenderdage efter dag (YYYY-MM-DD; n kan være negativ). @param {string} dag @param {number} n */
export function dagPlus(dag, n) {
  const d = new Date(dag + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Kalenderdage fra dag a til dag b (YYYY-MM-DD). @param {string} a @param {string} b */
export const kalenderdage = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAG);

/**
 * @typedef {object} Kvartal
 * @property {string} id   'Q1' … 'Q4'
 * @property {string} fra  første dag (YYYY-MM-DD)
 * @property {string} til  første dag efter kvartalet (YYYY-MM-DD)
 */

/** Årets fire kvartaler. @param {number} aar @returns {Kvartal[]} */
export function kvartaler(aar) {
  const start = q => (q < 4 ? `${aar}-${String(q * 3 + 1).padStart(2, '0')}-01` : `${aar + 1}-01-01`);
  return Array.from({length: 4}, (_, q) => ({id: `Q${q + 1}`, fra: start(q), til: start(q + 1)}));
}

/** Årets kvartaler til og med det indeværende. @param {Date} nu @returns {Kvartal[]} */
export function kvartalerIndtilNu(nu) {
  const aar = +maanedNoegle(nu).slice(0, 4), d = dagNoegle(nu), ks = kvartaler(aar);
  return ks.slice(0, ks.findIndex(k => d >= k.fra && d < k.til) + 1);
}

/** Samme tidspunkt tre måneder frem ("inden for det næste kvartal"). @param {Date} nu */
export function omEtKvartal(nu) {
  const d = new Date(+nu);
  d.setUTCMonth(d.getUTCMonth() + 3);
  return d;
}

/**
 * HB-året set fra "nu": godkendelsen næste år kræver aktivitet i hvert af årets fire kvartaler.
 * @param {Date} nu
 * @returns {{aar: number, kvartaler: Kvartal[], nuIndeks: number, naeste: {fra: string, til: string}}}
 *   aar er godkendelsesåret (året efter), nuIndeks det indeværende kvartal, naeste kvartalet efter det indeværende.
 */
export function hbAar(nu) {
  const i = +maanedNoegle(nu).slice(0, 4), ks = kvartaler(i), d = dagNoegle(nu);
  const nuIndeks = ks.findIndex(k => d >= k.fra && d < k.til);
  const fra = ks[nuIndeks].til, [y, m] = fra.split('-').map(Number);
  return {aar: i + 1, kvartaler: ks, nuIndeks, naeste: {fra, til: m === 10 ? `${y + 1}-01-01` : `${y}-${String(m + 3).padStart(2, '0')}-01`}};
}
