// Foreningens forretningsregler: kategorier, status, dækning, HB-godkendelse og momentum.
// Ported fra app.js, der indtil videre har sin egen kopi. test/paritet.test.js sikrer, at de to giver samme resultat.

import {DAG, dagNoegle, dageMellem, fmtDato, hbAar} from './tid.js';

// ---------------------------------------------------------------- kategori og status for et arrangement

/** @type {[string, RegExp][]} */
export const KATEGORIER = [
  ['Foreningsmøde', /bestyrelsesm|generalforsamling|medlemsm|intro ?m|årsm|stiftende|velkomst|nye medlemmer|workshop|organisatorisk/i],
  ['Kampagne', /kampagne|\bstand\b|uddel|plakat|dør.til.dør|happening|valgkamp|flyer/i],
  ['Oplæg & debat', /oplæg|debat|keynote|foredrag|panel|ordfører|folketing|minister|besøg af|bogturn|webinar|diskussion|samtale|kursus|seminar|studiekreds|læsekreds|landsmøde/i],
  ['Socialt', /fredagsbar|fredagscaf|hygge|brætspil|\bfest|julefrokost|\bøl\b|\bbar\b|quiz|minigolf|\bspil|middag|bowling|grill|besøger|\btur\b|ekskursion|indvielse|reception|tag med|biograf|koncert|pizza/i],
];
/** @param {{navn?: string, beskrivelse?: string}} e */
export function kategori(e) {
  for (const tekst of [e.navn || '', e.beskrivelse || '']) {
    for (const [k, re] of KATEGORIER) if (re.test(tekst)) return k;
  }
  return 'Andet';
}

/**
 * Arrangementets status: planlagt / bekraeftet / afholdt / forsvundet / aflyst / ikke_afholdt / skjult.
 * @param {any} e rå arrangement med rettelser anvendt og slutD sat
 * @param {Date} nu
 */
export function arrStatus(e, nu) {
  if (e.skjult) return 'skjult';
  if (e.aflyst) return e.rettelse && e.rettelse.status === 'ikke_afholdt' ? 'ikke_afholdt' : 'aflyst';
  if (e.forsvundet) return 'forsvundet';
  if (e.slutD >= nu) return 'planlagt';
  return e.bekraeftet ? 'bekraeftet' : 'afholdt';
}

// ---------------------------------------------------------------- rettelser

/**
 * Anvender brugernes rettelser på de hentede arrangementer (samme regler som app.js og scripts/hb.py).
 * Rettelser: {"<id>": {status?, navn?, forening?, start?, slut?, sted?, deltagere?, note?, manuel?, rettet}}.
 * @param {any[]} events kopier – ændres
 * @param {Record<string, any>} rettelser
 */
export function anvendRettelser(events, rettelser) {
  const byId = new Map(events.map(e => [e.id, e]));
  for (const [id, r] of Object.entries(rettelser || {})) {
    let e = byId.get(id);
    if (!e) {
      if (!r.manuel || !r.start || !r.forening) continue; // Facebook-begivenheden findes ikke (længere)
      e = {id, manuel: true, url: '', navn: '', sted: '', lat: null, lng: null, kommune: null, online: false, aflyst: false,
        forsvundet: false, deltager: null, interesserede: null, svar: null, beskrivelse: '', foerst_set: r.rettet || r.start};
      events.push(e);
    }
    for (const k of ['navn', 'start', 'slut', 'sted']) if (r[k] != null && r[k] !== '') e[k] = r[k];
    if (r.forening && r.forening !== e.forening) { e.forening = r.forening; e.foreninger = [r.forening]; }
    if (r.status === 'afholdt') Object.assign(e, {aflyst: false, forsvundet: false, bekraeftet: true});
    else if (r.status === 'ikke_afholdt') e.aflyst = true;
    else if (r.status === 'skjult') e.skjult = true;
    if (r.deltagere != null) e.fremmoede = r.deltagere;
    if (r.note) e.note = r.note;
    e.rettelse = r;
  }
  return events;
}

// ---------------------------------------------------------------- dækning: hvor langt tilbage kendes data?

// Historikken henter højst så mange begivenheder pr. side (HISTORIK_MAX_PR_SIDE i scripts/sync.py).
export const HISTORIK_LOFT = 20;

/**
 * @typedef {object} Daekning
 * @property {string} ugentligFra  første ugentlige kørsel (YYYY-MM-DD)
 * @property {string} fra          historikkens startdato (eller ugentligFra)
 * @property {Map<string, string>} fraFor  pr. forening den første dag, historikken dækker helt
 * @property {Date} forsteKoersel
 */

/** Facebook-siderne for en forening. @param {any} f */
export const fbSider = f => [f.facebook, ...(f.facebook_ekstra || []).map(e => (typeof e === 'string' ? e : e.url))].filter(Boolean);

/**
 * Beregnes på de hentede data uden rettelser – som load() i app.js og scripts/hb.py.
 * @param {any} meta data/meta.json @param {any[]} events data/events.json @param {any[]} foreninger data/foreninger.json
 * @param {Date} nu
 * @returns {Daekning}
 */
export function beregnDaekning(meta, events, foreninger, nu) {
  const forsteKoersel = meta.koersler.length ? new Date(meta.koersler[0].tid) : nu;
  const ugentligFra = dagNoegle(forsteKoersel);
  const fra = meta.historik && meta.historik.fra ? dagNoegle(new Date(meta.historik.fra)) : ugentligFra;
  const prSide = new Map();
  for (const k of (meta.historik && meta.historik.koersler) || []) {
    if (k.status !== 'SUCCEEDED') continue;
    const aeldste = k.aeldste ? dagNoegle(new Date(k.aeldste))
      : events.filter(e => e.historisk && (e.foreninger || [e.forening]).includes(k.forening)).map(e => dagNoegle(new Date(e.start))).sort()[0];
    const loft = k.hentet >= (k.max || HISTORIK_LOFT) && k.begivenheder >= k.hentet;
    prSide.set(`${k.forening}|${k.side || ''}`, loft && aeldste ? aeldste : fra);
  }
  /** @type {Map<string, string>} */
  const fraFor = new Map();
  for (const f of foreninger) {
    const s = fbSider(f).map((u, i) => prSide.get(`${f.navn}|${u}`) || (i === 0 ? prSide.get(`${f.navn}|`) : null));
    if (s.length && s.every(Boolean)) fraFor.set(f.navn, s.sort()[s.length - 1]);
  }
  for (const f of foreninger) if (f.historik_fra) fraFor.set(f.navn, f.historik_fra);
  return {ugentligFra, fra, fraFor, forsteKoersel};
}

/** Første dag (YYYY-MM-DD), hvor foreningens afholdte arrangementer kendes fuldt ud. @param {Daekning} d @param {string} navn */
export function daekketFra(d, navn) {
  const h = d.fraFor.get(navn);
  return h && h < d.ugentligFra ? h : d.ugentligFra;
}

// ---------------------------------------------------------------- foreningens aktivitet (grundlaget for resten)

/**
 * @typedef {object} Aktivitet
 * @property {any[]} events      alle (ikke skjulte), sorteret efter start
 * @property {any[]} gyldige     hverken aflyst eller fjernet
 * @property {any[]} planlagt    gyldige, der ikke er slut
 * @property {any[]} afholdt     gyldige, der er slut
 * @property {any[]} naesteKvartal  kommende (ikke fjernede) inden for et kvartal
 * @property {Date|null} sidste  start på sidste afholdte
 * @property {any|null} naeste   første planlagte
 * @property {string} daekketFra
 */

/** @param {any[]} events foreningens arrangementer @param {string} navn @param {Daekning} daekning @param {Date} nu @returns {Aktivitet} */
export function aktivitet(events, navn, daekning, nu) {
  const ev = [...events].sort((a, b) => a.startD - b.startD);
  const gyldige = ev.filter(e => !e.forsvundet && !e.aflyst);
  const planlagt = gyldige.filter(e => e.slutD >= nu);
  const afholdt = gyldige.filter(e => e.slutD < nu);
  const hKvartal = new Date(nu); hKvartal.setUTCMonth(hKvartal.getUTCMonth() + 3);
  return {events: ev, gyldige, planlagt, afholdt,
    naesteKvartal: ev.filter(e => !e.forsvundet && e.slutD >= nu && e.startD <= hKvartal),
    sidste: afholdt.length ? afholdt[afholdt.length - 1].startD : null, naeste: planlagt[0] || null,
    daekketFra: daekketFra(daekning, navn)};
}

/** Aktivitet nu: snart / planlagt / ingen / ingenfb. @param {Aktivitet} a @param {boolean} facebook */
export function aktivitetsStatus(a, facebook) {
  if (!facebook) return 'ingenfb';
  return a.naesteKvartal.some(e => !e.aflyst) ? 'snart' : a.planlagt.length ? 'planlagt' : 'ingen';
}

// ---------------------------------------------------------------- HB-godkendelse

/**
 * Kvartalets status for HB-kravet: ja / planlagt / mangler (kvartalet er ikke slut) / nej / ukendt (ingen data).
 * @param {Aktivitet} a @param {boolean} facebook @param {{fra: string, til: string}} k @param {Date} nu
 */
export function hbKvartal(a, facebook, k, nu) {
  const i = e => { const d = dagNoegle(e.startD); return d >= k.fra && d < k.til; };
  if (a.afholdt.some(i)) return 'ja';
  if (a.planlagt.some(i)) return 'planlagt';
  if (!facebook || k.fra < a.daekketFra) return 'ukendt';
  return dagNoegle(nu) < k.til ? 'mangler' : 'nej';
}

/**
 * HB-prognosen: plus_naeste / alle / planlagt_nu / mangler_nu / ikke / ukendt – og status pr. kvartal.
 * @param {Aktivitet} a @param {boolean} facebook @param {Date} nu
 */
export function hbPrognose(a, facebook, nu) {
  const hb = hbAar(nu);
  const s = hb.kvartaler.map(k => hbKvartal(a, facebook, k, nu)), foer = s.slice(0, hb.nuIndeks), nuS = s[hb.nuIndeks];
  const kvartaler = Object.fromEntries(hb.kvartaler.map((k, i) => [k.id, s[i]]));
  let status;
  if (foer.includes('nej')) status = 'ikke';
  else if (foer.includes('ukendt') || nuS === 'ukendt') status = 'ukendt';
  else if (nuS === 'planlagt') status = 'planlagt_nu';
  else if (nuS !== 'ja') status = 'mangler_nu';
  else {
    const naeste = a.planlagt.some(e => { const d = dagNoegle(e.startD); return d >= hb.naeste.fra && d < hb.naeste.til; });
    status = naeste ? 'plus_naeste' : 'alle';
  }
  return {status, kvartaler, aar: hb.aar};
}

// ---------------------------------------------------------------- momentum

export const MOMENTUM = {VINDUE: 90, MAAL: 3, MAANED: 31, HJAELP: 45, FREMAD: 30, NORMAL: 365};
export const MOMENTUM_NIVEAUER = {
  hjaelp: {ikon: '⚠', label: 'Brug for hjælp', hint: `Over ${MOMENTUM.HJAELP} dage siden sidste arrangement og intet i kalenderen`},
  faldende: {ikon: '↘', label: 'Mister fart', hint: 'Over en måned siden sidste arrangement og intet i kalenderen – eller færre arrangementer end normalt'},
  fremad: {ikon: '⤴', label: 'Noget på vej', hint: `Over en måned siden sidste arrangement, men noget i kalenderen de næste ${MOMENTUM.FREMAD} dage`},
  ukendt: {ikon: '?', label: 'Historik mangler', hint: `Intet afholdt, og data dækker højst ${MOMENTUM.HJAELP} dage`},
  stabil: {ikon: '→', label: 'På sporet', hint: `Arrangement inden for den seneste måned, men færre end ${MOMENTUM.MAAL} de seneste 3 måneder`},
  godt: {ikon: '↗', label: 'Godt i gang', hint: `Mindst ét arrangement om måneden (${MOMENTUM.MAAL} eller flere de seneste 3 måneder)`},
  ingenfb: {ikon: '–', label: 'Ingen Facebook-side', hint: 'Aktiviteter kan ikke hentes automatisk'},
};
const momTal = v => v.toLocaleString('da-DK', {maximumFractionDigits: 1});

/**
 * Momentum: en tidlig sundhedsindikator – holder foreningen mindst ét arrangement om måneden? Se README "Momentum".
 * @param {Aktivitet} a @param {boolean} facebook @param {Date} nu
 */
export function momentum(a, facebook, nu) {
  const M = MOMENTUM;
  const fra = new Date(nu.getTime() - M.VINDUE * DAG), til = new Date(nu.getTime() + M.FREMAD * DAG);
  const daekketD = new Date(a.daekketFra + 'T00:00:00Z');
  const afholdt = a.afholdt.filter(e => e.startD >= fra).length;
  const fremad = a.planlagt.filter(e => e.startD <= til).length;
  const daekket = daekketD <= fra;
  const nFra = new Date(Math.max(+daekketD, +fra - M.NORMAL * DAG)), nDage = dageMellem(nFra, fra);
  const normalt = nDage >= M.VINDUE
    ? Math.round(a.afholdt.filter(e => e.startD >= nFra && e.startD < fra).length / nDage * M.VINDUE * 10) / 10 : null;
  const trend = normalt == null ? null : afholdt >= normalt + 1 ? 'op' : afholdt <= normalt - 1 ? 'ned' : 'som';
  const aflyst = a.events.filter(e => e.aflyst && e.startD >= fra && e.startD < nu).length;
  const sidsteDage = a.sidste ? dageMellem(a.sidste, nu) : null;
  const naesteDage = a.naeste ? Math.max(0, dageMellem(nu, a.naeste.startD)) : null;
  const d = sidsteDage ?? dageMellem(daekketD, nu);
  const niveau = !facebook && !a.gyldige.length ? 'ingenfb'
    : sidsteDage == null && d <= M.HJAELP ? 'ukendt'
    : d > M.MAANED ? (fremad ? 'fremad' : d > M.HJAELP ? 'hjaelp' : 'faldende')
    : afholdt >= M.MAAL ? 'godt'
    : trend === 'ned' && !fremad ? 'faldende' : 'stabil';
  const grund = niveau === 'faldende' && d <= M.MAANED
    ? `Færre arrangementer end normalt (${afholdt} de seneste 3 måneder, normalt ${momTal(normalt)}) og intet i kalenderen`
    : niveau === 'faldende' ? 'Over en måned siden sidste arrangement og intet i kalenderen' : MOMENTUM_NIVEAUER[niveau].hint;
  /** @type {[string, string][]} */
  const signaler = [];
  if (niveau !== 'ingenfb') {
    if (sidsteDage == null) signaler.push(['-', `Intet afholdt siden ${fmtDato.format(daekketD)}`]);
    else if (sidsteDage > M.MAANED) signaler.push(['-', `${sidsteDage} dage siden sidste arrangement – over en måned`]);
    else signaler.push(['+', `Sidste arrangement for ${sidsteDage} dage siden`]);
    if (!daekket) signaler.push(['i', `Data dækker kun ${dageMellem(daekketD, nu)} af de seneste ${M.VINDUE} dage`]);
    else signaler.push([afholdt >= M.MAAL ? '+' : '-', `${afholdt} af ${M.MAAL} arrangementer de seneste 3 måneder`]);
    if (!a.planlagt.length) signaler.push(['-', 'Intet i kalenderen endnu']);
    else if (naesteDage > M.FREMAD) signaler.push(['-', `Næste arrangement først om ${naesteDage} dage`]);
    else signaler.push(['+', naesteDage === 0 ? 'Arrangement i dag' : `Næste arrangement om ${naesteDage} dage`]);
    if (trend === 'ned') signaler.push(['-', `Færre end normalt (normalt ${momTal(normalt)} pr. 3 måneder)`]);
    if (trend === 'op') signaler.push(['+', `Flere end normalt (normalt ${momTal(normalt)} pr. 3 måneder)`]);
    if (aflyst) signaler.push(['-', `${aflyst} aflyst de seneste 3 måneder`]);
  }
  return {niveau, grund, sidsteDage, naesteDage, afholdt, daekket, normalt, trend, fremad, aflyst, signaler};
}

/**
 * Varsel i dage: fra arrangementet blev opdaget, til det fandt sted. null for historiske og manuelle, og for dem, der
 * blev opdaget ved første kørsel (de kan have ligget der længe). @param {any} e @param {Date} forsteKoersel
 */
export function varsel(e, forsteKoersel) {
  return !e.historisk && !e.manuel && +e.firstD - +forsteKoersel > DAG ? (+e.startD - +e.firstD) / DAG : null;
}
