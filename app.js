'use strict';
/*
 * LAU-kortet. Opbygning:
 *  - CONFIG:          kan overskrives med window.LAU_CONFIG (fx af en privat adminversion).
 *  - PANEL_SECTIONS:  sektionerne i foreningspanelet. Nye sektioner tilføjes med LAU.registerSection().
 *  - MAP_LAYERS:      lag på kortet (med eller uden til/fra-knap). Nye lag tilføjes med LAU.registerLayer().
 *  - CONFIG.privat:   valgfri leverandør af fortrolige data (noter, stamdata, medlemstal) til adminversionen.
 * Kortet er MapLibre GL med OpenFreeMap-grundkort (OpenStreetMap-data). Se README.md.
 */

// ------------------------------------------------------------------ konfiguration

const CONFIG = Object.assign({
  mode: 'public',
  // Data læses fra GitHub-repoet, så de er friske, selv før Pages er genudgivet.
  dataBase: location.hostname.endsWith('github.io') ? 'https://raw.githubusercontent.com/Irate4147/lau-kort/main/' : '',
  assetBase: '',
  basemap: 'https://tiles.openfreemap.org/styles/liberty',
  privat: null,
}, window.LAU_CONFIG || {});

const TZ = 'Europe/Copenhagen';
const DAY = 864e5;
const NOW = new Date();
const H14 = new Date(NOW.getTime() + 14 * DAY);
const NEW_DAYS = 7;
const NATIONAL = 'Landsforeningen';
const DK_BOUNDS = [[8.05, 54.55], [15.2, 57.76]];
// Håndplacerede navne, hvor tyngdepunktet giver overlap (Frederiksberg ligger inde i København).
const LABEL_AT = {'København': [12.578, 55.643], 'Frederiksberg': [12.515, 55.692]};
const MAP_FILL = {snart: '#2a78d6', planlagt: '#86b6ef', ingen: '#b8b6ae', ingenfb: '#d9d7d0'};
const FILL_OPACITY = ['match', ['get', 'status'], 'snart', 0.55, 'planlagt', 0.55, 'ingen', 0.3, 0.25];
const STATUS = {
  snart:    {label: 'Aktivitet inden for 14 dage'},
  planlagt: {label: 'Aktiviteter planlagt senere'},
  ingen:    {label: 'Intet planlagt'},
  ingenfb:  {label: 'Ingen Facebook-side tilknyttet'},
};
const FONT_REG = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];
const FONT_ITALIC = ['Noto Sans Italic'];
const KATEGORIER = [
  ['Foreningsmøde', /bestyrelsesm|generalforsamling|medlemsm|intro ?m|årsm|stiftende|velkomst|nye medlemmer|workshop|organisatorisk/i],
  ['Kampagne', /kampagne|\bstand\b|uddel|plakat|dør.til.dør|happening|valgkamp|flyer/i],
  ['Oplæg & debat', /oplæg|debat|keynote|foredrag|panel|ordfører|folketing|minister|besøg af|bogturn|webinar|diskussion|samtale|kursus|seminar|studiekreds|læsekreds|landsmøde/i],
  ['Socialt', /fredagsbar|fredagscaf|hygge|brætspil|\bfest|julefrokost|\bøl\b|\bbar\b|quiz|minigolf|\bspil|middag|bowling|grill|besøger|\btur\b|ekskursion|indvielse|reception|tag med|biograf|koncert|pizza/i],
];
const KAT_NAVNE = [...KATEGORIER.map(k => k[0]), 'Andet'];
const UGEDAGE = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];
// Aktivitetsmærker på kortet: afstand til punktet, mellemrum og kant.
const CGAP = 7, CPAD = 3, CMARGIN = 8;

// ------------------------------------------------------------------ hjælpere

const fmtDay = new Intl.DateTimeFormat('da-DK', {weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ});
const fmtDate = new Intl.DateTimeFormat('da-DK', {day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ});
const fmtTime = new Intl.DateTimeFormat('da-DK', {hour: '2-digit', minute: '2-digit', timeZone: TZ});
const fmtMonth = new Intl.DateTimeFormat('da-DK', {month: 'short', timeZone: 'UTC'});
const fmtStamp = new Intl.DateTimeFormat('da-DK', {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ});
const num1 = n => n == null ? '–' : n.toLocaleString('da-DK', {maximumFractionDigits: 1});
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const median = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const dayKey = d => new Intl.DateTimeFormat('en-CA', {timeZone: TZ}).format(d); // YYYY-MM-DD i dansk tid
const monthKey = d => dayKey(d).slice(0, 7);
// Årets kvartaler til og med det indeværende (fx Q1–Q3 2026); det sidste er det indeværende.
const KVARTALER = (() => {
  const [y, m] = monthKey(NOW).split('-').map(Number), cur = Math.floor((m - 1) / 3);
  const start = q => (q < 4 ? `${y}-${String(q * 3 + 1).padStart(2, '0')}-01` : `${y + 1}-01-01`);
  return Array.from({length: cur + 1}, (_, q) => ({id: `Q${q + 1}`, kort: `Q${q + 1}`, navn: `${q + 1}. kvartal ${y}`, fra: start(q), til: start(q + 1)}));
})();
const KVARTAL = KVARTALER[KVARTALER.length - 1];
const KVARTAL_FILL = {ja: '#1f9d55', nej: '#e4572e', ukendt: '#9d9b94', ingenfb: '#d9d7d0'};
const kvartalStatus = k => ({
  ja:      {label: `Afholdt aktivitet i ${k.kort}`},
  nej:     {label: `Ingen afholdt aktivitet i ${k.kort}`},
  ukendt:  {label: 'Historik ikke hentet endnu'},
  ingenfb: {label: 'Ingen Facebook-side tilknyttet'},
});
// Foreninger, hvis tidligere begivenheder er hentet, og datoen, hvor de ugentlige kørsler startede (sættes i load()).
// fraFor: pr. forening den første dag, historikken dækker helt (senere end historik.fra, hvis hentningen ramte loftet).
const HISTORIK = {hentet: new Set(), ugentligFra: '', fra: '', fraFor: new Map()};
// Historikken henter højst så mange begivenheder pr. side (HISTORIK_MAX_PR_SIDE i scripts/sync.py).
const HISTORIK_LOFT = 20;
/** Første dag (YYYY-MM-DD), hvor foreningens afholdte aktiviteter kendes fuldt ud. */
function daekketFra(navn) {
  const h = HISTORIK.fraFor.get(navn);
  return h && h < HISTORIK.ugentligFra ? h : HISTORIK.ugentligFra;
}
/**
 * 'ja' / 'nej' / 'ukendt' / 'ingenfb' for en forening i et kvartal. 'ukendt', når kvartalet ligger før den dag,
 * foreningens data dækker fra – så ser den ikke inaktiv ud uden grund.
 */
function kvStatus(f, k) {
  if (f.kv[k.id]) return 'ja';
  if (!f.facebook) return 'ingenfb';
  return k.fra < daekketFra(f.navn) ? 'ukendt' : 'nej';
}
// HB-godkendelse næste år kræver mindst ét afholdt arrangement i hvert af årets fire kvartaler (Organisationshåndbogen 8.2).
// Egne farver (lilla/magenta), så farvningen ikke forveksles med aktivitetsfarvningerne (blå og grøn/rød).
const HB_AAR = +monthKey(NOW).slice(0, 4) + 1;
const HB_KVARTALER = Array.from({length: 4}, (_, q) => {
  const y = HB_AAR - 1, start = i => (i < 4 ? `${y}-${String(i * 3 + 1).padStart(2, '0')}-01` : `${y + 1}-01-01`);
  return {id: `Q${q + 1}`, kort: `Q${q + 1}`, fra: start(q), til: start(q + 1)};
});
// Det indeværende kvartal (indeks i HB_KVARTALER) og kvartalet efter (evt. 1. kvartal næste år).
const HB_NU = HB_KVARTALER.findIndex(k => dayKey(NOW) >= k.fra && dayKey(NOW) < k.til);
const HB_NAESTE = (() => {
  const fra = HB_KVARTALER[HB_NU].til, [y, m] = fra.split('-').map(Number);
  return {fra, til: m === 10 ? `${y + 1}-01-01` : `${y}-${String(m + 3).padStart(2, '0')}-01`};
})();
// Kategorierne, bedst først. 'ikke' er den eneste, der ikke kan godkendes; 'ukendt', når historikken mangler.
const HB_FILL = {plus_naeste: '#4b1f8f', alle: '#7b3fbf', planlagt_nu: '#a98ad8', mangler_nu: '#e39be3', ikke: '#8c1452', ukendt: '#d3cde0'};
const HB_STATUS = {
  plus_naeste: {label: 'Aktivitet i alle kvartaler inkl. det indeværende + planlagt i næste kvartal'},
  alle:        {label: 'Aktivitet i alle kvartaler inkl. det indeværende'},
  planlagt_nu: {label: 'Aktivitet i alle tidligere kvartaler – det indeværende har et planlagt arrangement'},
  mangler_nu:  {label: 'Aktivitet i alle tidligere kvartaler – intet planlagt i det indeværende endnu'},
  ikke:        {label: `Mangler aktivitet i et kvartal – kan ikke HB-godkendes i ${HB_AAR}`},
  ukendt:      {label: 'Historik mangler'},
};
const HB_KV = {
  ja:       {label: 'afholdt', farve: HB_FILL.alle},
  planlagt: {label: 'planlagt', farve: HB_FILL.planlagt_nu},
  mangler:  {label: 'intet endnu', farve: HB_FILL.mangler_nu},
  nej:      {label: 'intet afholdt', farve: HB_FILL.ikke},
  ukendt:   {label: 'ingen data', farve: HB_FILL.ukendt},
};
/** Kvartalets status for HB-kravet: 'ja' / 'planlagt' / 'mangler' (kvartalet er ikke slut) / 'nej' / 'ukendt' (ingen data). */
function hbKvartal(f, k) {
  const i = e => { const d = dayKey(e.startD); return d >= k.fra && d < k.til; };
  if (f.afholdt.some(i)) return 'ja';
  if (f.planlagt.some(i)) return 'planlagt';
  if (!f.facebook || k.fra < daekketFra(f.navn)) return 'ukendt';
  return dayKey(NOW) < k.til ? 'mangler' : 'nej';
}
/** Foreningens kategori (nøgle i HB_STATUS) ud fra de afsluttede kvartaler, det indeværende og det næste. */
function hbPrognose(f) {
  const s = HB_KVARTALER.map(k => hbKvartal(f, k)), foer = s.slice(0, HB_NU), nu = s[HB_NU];
  if (foer.includes('nej')) return 'ikke';
  if (foer.includes('ukendt') || nu === 'ukendt') return 'ukendt';
  if (nu === 'planlagt') return 'planlagt_nu';
  if (nu !== 'ja') return 'mangler_nu';
  const naeste = f.planlagt.some(e => { const d = dayKey(e.startD); return d >= HB_NAESTE.fra && d < HB_NAESTE.til; });
  return naeste ? 'plus_naeste' : 'alle';
}
const weekday = d => (new Date(dayKey(d) + 'T12:00:00Z').getUTCDay() + 6) % 7; // 0 = mandag
/** Foreningens Facebook-sider: hovedsiden og evt. ekstra/tidligere sider. */
const fbSider = f => [f.facebook, ...(f.facebook_ekstra || []).map(e => (typeof e === 'string' ? e : e.url))].filter(Boolean);
const visningsnavn = f => f.national ? 'Landsforeningen' : `LAU ${f.navn}`;
const $ = id => document.getElementById(id);

let DATA = null;
let selected = null;
// Kortets farvning: 'status' (aktivitet nu), et kvartals id ('Q1', 'Q2', …), 'hb' (HB-godkendelse næste år) eller 'ingen'.
let farvning = (() => {
  let v = 'status';
  try { v = localStorage.getItem('lau-farvning') || v; } catch (_) { /* fx privat vindue */ }
  if (v === 'kvartal') v = KVARTAL.id; // ældre gemt værdi
  return v === 'hb' || v === 'ingen' || KVARTALER.some(k => k.id === v) ? v : 'status';
})();
const valgtKvartal = () => KVARTALER.find(k => k.id === farvning) || null;
const MAP = {map: null, ready: false, items: [], cards: new Map()};

// ------------------------------------------------------------------ udvidelsespunkter

const PANEL_SECTIONS = [];
const MAP_LAYERS = [];
// Til/fra-tilstand for alt under "Visninger" (indbyggede elementer og lag), gemt i browseren.
const layerState = (() => {
  try { return JSON.parse(localStorage.getItem('lau-visning')) || {}; } catch (_) { return {}; }
})();
const gemVisning = () => { try { localStorage.setItem('lau-visning', JSON.stringify(layerState)); } catch (_) { /* fx privat vindue */ } };
/**
 * Indbyggede elementer, der kan slås til og fra under "Visninger". Lag med toggle: true kommer med automatisk
 * (i gruppen layer.gruppe, standard 'kort').
 */
const VISNINGER = [
  {id: 'bokse', gruppe: 'aktiviteter', label: 'Begivenhedsbokse', hint: 'Dato og titel ved siden af stedet'},
  {id: 'punkter', gruppe: 'aktiviteter', label: 'Aktivitetspunkter'},
  {id: 'landsforeningen', gruppe: 'aktiviteter', label: 'Landsforeningens aktiviteter'},
  {id: 'aflyste', gruppe: 'aktiviteter', label: 'Aflyste aktiviteter'},
  {id: 'foreningsnavne', gruppe: 'kort', label: 'Foreningsnavne'},
  {id: 'foreningsgraenser', gruppe: 'kort', label: 'Grænser mellem foreninger'},
  {id: 'kommunegraenser', gruppe: 'kort', label: 'Kommunegrænser'},
  {id: 'stednavne', gruppe: 'kort', label: 'Stednavne på grundkortet'},
  {id: 'tegnforklaring', gruppe: 'kort', label: 'Tegnforklaring'},
];
for (const v of VISNINGER) if (!(v.id in layerState)) layerState[v.id] = v.standard !== false;
/** Sektion i foreningspanelet: {id, titel, synlig?(f), render(f) -> html, efter?(el, f)}. */
function registerSection(sec, {efter} = {}) {
  const i = efter ? PANEL_SECTIONS.findIndex(s => s.id === efter) : -1;
  PANEL_SECTIONS.splice(i >= 0 ? i + 1 : PANEL_SECTIONS.length, 0, sec);
}
/**
 * Kortlag: {id, label, toggle, standard, gruppe?, hint?, tilgaengelig?(), synlig?(ctx), tegn(api, ctx)}.
 * Lag med toggle: true får en til/fra-knap under "Visninger" (når tilgaengelig() er sand).
 * api.source(navn, geojson) og api.layer(maplibre-lagspec) – laget fjernes/tegnes igen automatisk.
 * ctx = {selected, zoomed, map}.
 */
function registerLayer(layer) {
  MAP_LAYERS.push(layer);
  if (!(layer.id in layerState)) layerState[layer.id] = layer.standard !== false;
}

// Private noter: gemmes i browseren, medmindre adminversionen leverer sin egen lagring.
const lokaleNoter = {
  titel: 'Private noter',
  forklaring: 'Gemmes kun i denne browser og deles ikke med andre.',
  hent: async f => localStorage.getItem('lau-note:' + f.navn) || '',
  gem: async (f, tekst) => localStorage.setItem('lau-note:' + f.navn, tekst),
};
const noteLager = () => (CONFIG.privat && CONFIG.privat.noter) || lokaleNoter;

// ------------------------------------------------------------------ data

// Rå data, som de er hentet (inden rettelser); DATA beregnes ud fra dem med beregn().
let RAW = null;

async function load() {
  const get = (base, p) => fetch(base + p, {cache: 'no-cache'}).then(r => { if (!r.ok) throw new Error(p); return r.json(); });
  const getData = p => get(CONFIG.dataBase, p).catch(() => get(CONFIG.assetBase, p));
  const [foreninger, events, meta, topo, hb, rettelser] = await Promise.all([
    getData('data/foreninger.json'), getData('data/events.json'), getData('data/meta.json'),
    get(CONFIG.assetBase, 'geo/kommuner.topo.json'), getData('data/hb.json').catch(() => null),
    hentRettelser(getData).catch(() => ({}))]);
  const firstRun = meta.koersler.length ? new Date(meta.koersler[0].tid) : NOW;
  // Afholdte aktiviteter kendes fra den første ugentlige kørsel, eller længere tilbage, hvis historikken er hentet.
  HISTORIK.hentet = new Set(((meta.historik && meta.historik.koersler) || []).filter(k => k.status === 'SUCCEEDED').map(k => k.forening));
  HISTORIK.ugentligFra = dayKey(firstRun);
  HISTORIK.fra = meta.historik && meta.historik.fra ? dayKey(new Date(meta.historik.fra)) : HISTORIK.ugentligFra;
  // Seneste vellykkede historik-kørsel pr. side (ældre kørsler uden "side" gjaldt hovedsiden). Ramte den loftet, og lå
  // alle hentede i perioden, kan der mangle ældre begivenheder – så dækker historikken kun fra den ældste hentede.
  // En forening er kun dækket, når alle dens sider er hentet. (Beregnes på de hentede data, uden rettelser.) Som hb.py.
  const prSide = new Map();
  for (const k of (meta.historik && meta.historik.koersler) || []) {
    if (k.status !== 'SUCCEEDED') continue;
    const aeldste = k.aeldste ? dayKey(new Date(k.aeldste))
      : events.filter(e => e.historisk && (e.foreninger || [e.forening]).includes(k.forening)).map(e => dayKey(new Date(e.start))).sort()[0];
    const loft = k.hentet >= HISTORIK_LOFT && k.begivenheder >= k.hentet;
    prSide.set(`${k.forening}|${k.side || ''}`, loft && aeldste ? aeldste : HISTORIK.fra);
  }
  for (const f of foreninger) {
    const s = fbSider(f).map((u, i) => prSide.get(`${f.navn}|${u}`) || (i === 0 ? prSide.get(`${f.navn}|`) : null));
    if (s.length && s.every(Boolean)) HISTORIK.fraFor.set(f.navn, s.sort()[s.length - 1]);
  }
  // historik_fra i foreninger.json: historikken er tjekket manuelt fra den dato (fx ingen arrangementer).
  for (const f of foreninger) if (f.historik_fra) HISTORIK.fraFor.set(f.navn, f.historik_fra);
  RAW ={foreninger, events, meta, topo, hb, firstRun, byId: new Map(events.map(e => [e.id, e])), geom: new Map()};
  RET.repo = rettelser;
  RET.data = flet(rettelser, RET.lokal);
  beregn();
}

/** Beregner DATA ud fra RAW og rettelserne. Kaldes igen, når en rettelse gemmes. */
function beregn() {
  const {meta, topo, hb, firstRun} = RAW;
  const foreninger = RAW.foreninger.map(f => ({...f}));
  const alle = anvendRettelser(RAW.events.map(e => ({...e})), RET.data);
  const hbNu = (hb && hb[`hb${HB_AAR - 1}`] && hb[`hb${HB_AAR - 1}`].foreninger) || {};
  const historik = !!(meta.historik && meta.historik.fra && HISTORIK.hentet.size);
  const dataFra = historik ? new Date(Math.min(firstRun, new Date(meta.historik.fra))) : firstRun;

  for (const e of alle) {
    e.startD = new Date(e.start);
    e.slutD = new Date(e.slut || e.start);
    e.firstD = new Date(e.foerst_set);
    e.kat = kategori(e);
    e.ny = !e.historisk && !e.manuel && NOW - e.firstD < NEW_DAYS * DAY;
    e.foreninger = e.foreninger || [e.forening];
    e.national = e.forening === NATIONAL;
    e.soon = !e.forsvundet && e.slutD >= NOW && e.startD <= H14;
  }
  const events = alle.filter(e => !e.skjult);
  const byName = new Map();
  for (const f of foreninger) {
    byName.set(f.navn, f);
    const ev = events.filter(e => e.foreninger.includes(f.navn)).sort((a, b) => a.startD - b.startD);
    const gyldige = ev.filter(e => !e.forsvundet && !e.aflyst);
    f.events = ev;
    f.gyldige = gyldige;
    f.upcoming = ev.filter(e => !e.forsvundet && e.slutD >= NOW);
    f.within14 = f.upcoming.filter(e => e.startD <= H14);
    f.planlagt = gyldige.filter(e => e.slutD >= NOW);
    f.afholdt = gyldige.filter(e => e.slutD < NOW);
    f.afholdt90 = f.afholdt.filter(e => NOW - e.startD <= 90 * DAY);
    f.kv = {}; // antal afholdte pr. kvartal
    for (const k of KVARTALER) f.kv[k.id] = f.afholdt.filter(e => { const d = dayKey(e.startD); return d >= k.fra && d < k.til; }).length;
    f.sidste = f.afholdt.length ? f.afholdt[f.afholdt.length - 1].startD : null;
    f.naeste = f.planlagt[0] || null;
    f.status = !f.facebook ? 'ingenfb'
      : f.within14.some(e => !e.aflyst) ? 'snart' : f.planlagt.length ? 'planlagt' : 'ingen';
    f.gnsSvar = mean(gyldige.filter(e => e.svar != null).map(e => e.svar));
    // Varsel kan kun måles for aktiviteter opdaget efter dataindsamlingen startede.
    f.varsel = median(gyldige.filter(e => !e.historisk && !e.manuel && e.firstD - firstRun > DAY).map(e => (e.startD - e.firstD) / DAY));
    if (!f.national) {
      f.hbKv = Object.fromEntries(HB_KVARTALER.map(k => [k.id, hbKvartal(f, k)]));
      f.hb = hbPrognose(f);
      f.hbNu = hbNu[f.navn] || null; // årets HB-status og mangler fra data/hb.json
      if (!RAW.geom.has(f.navn)) {
        const merged = topojson.merge(topo, topo.objects.kom.geometries.filter(g => g.properties.forening === f.navn));
        RAW.geom.set(f.navn, {merged, bounds: d3.geoBounds(merged)});
      }
      Object.assign(f, RAW.geom.get(f.navn));
    }
  }
  const features = topojson.feature(topo, topo.objects.kom).features;
  for (const feat of features) {
    const f = byName.get(feat.properties.forening);
    feat.properties.status = f.status;
    feat.properties.hb = f.hb;
    for (const k of KVARTALER) feat.properties['kv_' + k.id] = kvStatus(f, k);
  }
  const lokale = foreninger.filter(f => !f.national);
  const obj = topo.objects.kom;
  const geo = {
    kom: {type: 'FeatureCollection', features},
    inner: topojson.mesh(topo, obj, (a, b) => a !== b && a.properties.forening === b.properties.forening),
    border: topojson.mesh(topo, obj, (a, b) => a.properties.forening !== b.properties.forening),
    outlines: {type: 'FeatureCollection', features: lokale.map(f => ({type: 'Feature', properties: {forening: f.navn}, geometry: f.merged}))},
    flabels: {type: 'FeatureCollection', features: lokale.map(f => ({type: 'Feature', properties: {forening: f.navn},
      geometry: {type: 'Point', coordinates: LABEL_AT[f.navn] || d3.geoCentroid(largestPolygon(f.merged))}}))},
    klabels: {type: 'FeatureCollection', features: features.map(k => ({type: 'Feature',
      properties: {navn: k.properties.navn, forening: k.properties.forening},
      geometry: {type: 'Point', coordinates: d3.geoCentroid(largestPolygon(k.geometry))}}))},
    events: {type: 'FeatureCollection', features: events.filter(e => e.lat != null && e.lng != null).map(e => ({
      type: 'Feature', properties: {id: e.id, national: e.national}, geometry: {type: 'Point', coordinates: [e.lng, e.lat]}}))},
  };
  DATA = {foreninger, lokale, events, alle, meta, topo, features, byName, firstRun, dataFra, historik, geo, byId: new Map(alle.map(e => [e.id, e]))};
}

function kategori(e) {
  for (const text of [e.navn, e.beskrivelse || '']) {
    for (const [k, re] of KATEGORIER) if (re.test(text)) return k;
  }
  return 'Andet';
}

function largestPolygon(geom) {
  if (geom.type === 'Polygon') return geom;
  let best = null, bestA = -1;
  for (const coords of geom.coordinates) {
    const p = {type: 'Polygon', coordinates: coords}, a = d3.geoArea(p);
    if (a > bestA) { bestA = a; best = p; }
  }
  return best;
}

// ------------------------------------------------------------------ kort (MapLibre)

const calloutsEnabled = () => { const el = $('map'); return el.clientWidth >= 420 && el.clientHeight >= 280; };
const mapPadding = () => (calloutsEnabled() ? 48 : 20);

const STATUS_COLOR = ['match', ['get', 'status'], 'snart', MAP_FILL.snart, 'planlagt', MAP_FILL.planlagt, 'ingen', MAP_FILL.ingen, MAP_FILL.ingenfb];
const kvColor = k => ['match', ['get', 'kv_' + k.id], 'ja', KVARTAL_FILL.ja, 'nej', KVARTAL_FILL.nej, 'ukendt', KVARTAL_FILL.ukendt, KVARTAL_FILL.ingenfb];
const kvOpacity = k => ['match', ['get', 'kv_' + k.id], 'ja', 0.55, 'nej', 0.45, 'ukendt', 0.35, 0.25];
const HB_COLOR = ['match', ['get', 'hb'], ...Object.entries(HB_FILL).flat(), HB_FILL.ukendt];
const HB_OPACITY = ['match', ['get', 'hb'], 'ukendt', 0.35, 0.6];
/** Foreningens farve og forklaring i den valgte farvning. */
function farveFor(f) {
  if (farvning === 'ingen') return {farve: MAP_FILL[f.status], label: STATUS[f.status].label};
  if (farvning === 'hb') return f.hb ? {farve: HB_FILL[f.hb], label: HB_STATUS[f.hb].label} : {farve: MAP_FILL.ingenfb, label: 'Ikke omfattet af HB-kravet'};
  const k = valgtKvartal();
  if (!k) return {farve: MAP_FILL[f.status], label: STATUS[f.status].label};
  const s = kvStatus(f, k);
  return {farve: KVARTAL_FILL[s], label: kvartalStatus(k)[s].label};
}

function applyFill() {
  if (!MAP.ready) return;
  const f = selected && DATA.byName.get(selected);
  const local = f && !f.national ? f.navn : '';
  const k = valgtKvartal(), hb = farvning === 'hb', ingen = farvning === 'ingen';
  MAP.map.setPaintProperty('kom-fill', 'fill-color', hb ? HB_COLOR : k ? kvColor(k) : STATUS_COLOR);
  // Uden farvning er fladerne usynlige, men kan stadig klikkes på.
  MAP.map.setPaintProperty('kom-fill', 'fill-opacity', ingen ? (local ? ['case', ['==', ['get', 'forening'], local], 0.25, 0] : 0)
    : local ? ['case', ['==', ['get', 'forening'], local], 0.55, 0.12] : hb ? HB_OPACITY : k ? kvOpacity(k) : FILL_OPACITY);
}

function setFarvning(mode) {
  farvning = mode;
  try { localStorage.setItem('lau-farvning', mode); } catch (_) { /* fx privat vindue */ }
  applyFill();
  renderLegend();
  renderRank();
  renderVisninger();
  renderHB();
}

/** Slår et element under "Visninger" til eller fra. */
function setVisning(id, on) {
  layerState[id] = on;
  gemVisning();
  applyVisning();
  if (MAP_LAYERS.some(l => l.id === id)) drawLayers();
  if (id === 'landsforeningen' || id === 'aflyste') { if (MAP.ready) setMode(selected, {fit: false}); }
  if (id === 'bokse') layoutCallouts();
  renderLegend();
  renderVisninger();
  renderHB();
}

/** Anvender til/fra-tilstanden på grundlagene (lag, der ikke tegnes via registerLayer). */
function applyVisning() {
  $('legend').hidden = !layerState.tegnforklaring;
  if (!MAP.ready) return;
  const vis = (id, on) => { if (MAP.map.getLayer(id)) MAP.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
  vis('f-labels', layerState.foreningsnavne);
  vis('f-border', layerState.foreningsgraenser);
  vis('kom-inner', layerState.kommunegraenser);
  vis('ev-local', layerState.punkter);
  vis('ev-national', layerState.punkter);
  for (const id of MAP.stednavne) vis(id, layerState.stednavne);
}

function initMap() {
  const map = new maplibregl.Map({
    container: 'map', style: CONFIG.basemap, bounds: DK_BOUNDS, fitBoundsOptions: {padding: mapPadding()},
    attributionControl: {compact: true}, dragRotate: false, pitchWithRotate: false, maxZoom: 16, minZoom: 4,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({showCompass: false}), 'bottom-right');
  MAP.map = map;

  const overlay = document.createElement('div');
  overlay.className = 'callouts';
  overlay.innerHTML = '<svg aria-hidden="true"></svg><div class="more-note" hidden></div>';
  $('map').appendChild(overlay);
  MAP.overlay = overlay;
  MAP.leaders = overlay.querySelector('svg');

  map.on('load', () => {
    addBaseLayers();
    MAP.ready = true;
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash && DATA.byName.has(hash)) openForening(hash, {animate: false});
    else setMode(null, {animate: false});
  });
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; layoutCallouts(); }); };
  map.on('move', schedule);
  map.on('resize', schedule);
  // Mærkernes størrelse måles én gang; mål igen, når webfonten er indlæst.
  if (document.fonts) document.fonts.ready.then(() => { for (const c of MAP.cards.values()) c._w = 0; schedule(); });
  map.on('movestart', ev => { if (ev.originalEvent) closePopover(); });
}

function diamondImage(size = 22) {
  const c = document.createElement('canvas');
  c.width = c.height = size * 2;
  const g = c.getContext('2d');
  g.scale(2, 2);
  g.beginPath();
  g.moveTo(size / 2, 2); g.lineTo(size - 2, size / 2); g.lineTo(size / 2, size - 2); g.lineTo(2, size / 2); g.closePath();
  g.fillStyle = '#111827'; g.fill();
  g.lineWidth = 2.5; g.strokeStyle = '#ffffff'; g.stroke();
  return {width: c.width, height: c.height, data: g.getImageData(0, 0, c.width, c.height).data};
}

function addBaseLayers() {
  const map = MAP.map, g = DATA.geo;
  const layers = map.getStyle().layers;
  const firstSymbol = (layers.find(l => l.type === 'symbol') || {}).id;
  const firstRoad = (layers.find(l => /^(tunnel|road|bridge|highway)/.test(l.id)) || {}).id || firstSymbol;
  // Danske/lokale stednavne i stedet for engelske, og ingen lande-/delstatsnavne oven i foreningerne.
  MAP.stednavne = [];
  for (const l of layers) {
    if (l.type !== 'symbol') continue;
    if (/^label_(country|state)/.test(l.id)) { map.setLayoutProperty(l.id, 'visibility', 'none'); continue; }
    if (/^(label_|water_name|waterway_line_label)/.test(l.id)) {
      map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:da'], ['get', 'name']]);
    }
    MAP.stednavne.push(l.id);
  }

  map.addSource('kom', {type: 'geojson', data: g.kom});
  map.addSource('inner', {type: 'geojson', data: g.inner});
  map.addSource('border', {type: 'geojson', data: g.border});
  map.addSource('outlines', {type: 'geojson', data: g.outlines});
  map.addSource('flabels', {type: 'geojson', data: g.flabels});
  map.addSource('klabels', {type: 'geojson', data: g.klabels});
  map.addSource('events', {type: 'geojson', data: g.events});
  map.addImage('diamond', diamondImage(), {pixelRatio: 2});

  map.addLayer({id: 'kom-fill', type: 'fill', source: 'kom', paint: {'fill-color': STATUS_COLOR, 'fill-opacity': FILL_OPACITY}}, firstRoad);
  map.addLayer({id: 'kom-inner', type: 'line', source: 'inner', paint: {
    'line-color': '#ffffff', 'line-opacity': 0.7, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 10, 1.4]}}, firstSymbol);
  map.addLayer({id: 'f-border', type: 'line', source: 'border', paint: {
    'line-color': '#475569', 'line-opacity': 0.75, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 2]}}, firstSymbol);
  map.addLayer({id: 'f-hover', type: 'line', source: 'outlines', filter: ['==', ['get', 'forening'], ''],
    paint: {'line-color': '#1f2937', 'line-width': 2}}, firstSymbol);
  map.addLayer({id: 'f-selected', type: 'line', source: 'outlines', filter: ['==', ['get', 'forening'], ''],
    paint: {'line-color': '#0b0b0b', 'line-width': 3}}, firstSymbol);
  map.addLayer({id: 'f-labels', type: 'symbol', source: 'flabels', layout: {
    'text-field': ['get', 'forening'], 'text-font': FONT_BOLD, 'text-transform': 'uppercase',
    'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 9, 13], 'text-letter-spacing': 0.08, 'text-max-width': 8,
    'text-padding': 4}, paint: {
    'text-color': '#1f2937', 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.6, 'text-halo-blur': 0.4}});
  map.addLayer({id: 'ev-local', type: 'circle', source: 'events', filter: ['==', ['get', 'id'], ''], paint: {
    'circle-radius': 5.5, 'circle-color': '#111827', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2}});
  map.addLayer({id: 'ev-national', type: 'symbol', source: 'events', filter: ['==', ['get', 'id'], ''], layout: {
    'icon-image': 'diamond', 'icon-allow-overlap': true, 'icon-ignore-placement': true}});

  map.on('mousemove', 'kom-fill', ev => {
    map.getCanvas().style.cursor = 'pointer';
    hoverForening(ev.features[0].properties.forening, ev.originalEvent);
  });
  map.on('mouseleave', 'kom-fill', () => { map.getCanvas().style.cursor = ''; hoverForening(null); });
  map.on('click', 'kom-fill', ev => {
    if (map.queryRenderedFeatures(ev.point, {layers: ['ev-local', 'ev-national']}).length) return;
    openForening(ev.features[0].properties.forening);
  });
  for (const id of ['ev-local', 'ev-national']) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('click', id, ev => {
      const e = DATA.byId.get(ev.features[0].properties.id);
      if (e) openPopover(e, {x: ev.point.x + 12, y: ev.point.y - 12});
    });
  }
}

/** Hvilke aktiviteter vises (overblik: næste 14 dage; forening: dens kommende + landsforeningens i området). */
function eventsFor(navn) {
  const f = navn && DATA.byName.get(navn);
  let list;
  if (!f) list = DATA.events.filter(e => e.soon && DATA.byName.has(e.forening));
  else if (f.national) list = f.upcoming;
  else {
    const nat = DATA.byName.get(NATIONAL);
    const lands = nat ? nat.upcoming.filter(e => e.kommune && f.kommuner.includes(e.kommune) && !f.upcoming.includes(e)) : [];
    list = [...f.upcoming, ...lands];
  }
  return list.filter(e => (layerState.aflyste || !e.aflyst) && (layerState.landsforeningen || !e.national || (f && f.national)));
}

function setMode(navn, {animate = true, fit = true} = {}) {
  const map = MAP.map;
  const f = navn && DATA.byName.get(navn);
  const local = f && !f.national ? f.navn : '';
  map.setFilter('f-selected', ['==', ['get', 'forening'], local]);
  map.setFilter('f-labels', ['!=', ['get', 'forening'], local]);
  applyFill();

  const list = eventsFor(navn);
  const ids = list.map(e => e.id);
  map.setFilter('ev-local', ['all', ['in', ['get', 'id'], ['literal', ids]], ['!', ['get', 'national']]]);
  map.setFilter('ev-national', ['all', ['in', ['get', 'id'], ['literal', ids]], ['get', 'national']]);
  setCalloutItems(list);

  const bounds = local ? f.bounds : DK_BOUNDS;
  if (fit) map.fitBounds(bounds, {padding: mapPadding(), duration: animate ? 900 : 0, maxZoom: 11});
  applyVisning();
  drawLayers();
}

// ---- små aktivitetsmærker (dato + titel) placeret ved siden af stedet på kortet

function setCalloutItems(list) {
  MAP.items = [...list].sort((a, b) => a.startD - b.startD);
  for (const [id, card] of MAP.cards) if (!MAP.items.some(e => e.id === id)) { card.remove(); MAP.cards.delete(id); }
  for (const e of MAP.items) {
    if (MAP.cards.has(e.id)) continue;
    const card = document.createElement('div');
    card.className = 'callout' + (e.national ? ' national' : '') + (e.aflyst ? ' cancelled' : '');
    card.tabIndex = 0;
    card.hidden = true;
    card.setAttribute('role', 'button');
    card.innerHTML = `<div class="when">${e.national ? '◆ ' : ''}${esc(fmtDay.format(e.startD))}${e.aflyst ? ' · AFLYST' : ''}</div><div class="what">${esc(e.navn)}</div>`;
    const open = () => openPopover(e, {card});
    card.addEventListener('click', open);
    card.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
    card.addEventListener('mouseenter', () => { MAP.hoverId = e.id; layoutCallouts(); hoverForening(e.forening); });
    card.addEventListener('mouseleave', () => { MAP.hoverId = null; layoutCallouts(); hoverForening(null); });
    MAP.overlay.appendChild(card);
    MAP.cards.set(e.id, card);
  }
  layoutCallouts();
}

function layoutCallouts() {
  if (!MAP.map || !MAP.overlay) return;
  const W = MAP.overlay.clientWidth, H = MAP.overlay.clientHeight;
  const note = MAP.overlay.querySelector('.more-note');
  if (!calloutsEnabled() || !layerState.bokse) {
    for (const c of MAP.cards.values()) c.hidden = true;
    MAP.leaders.innerHTML = '';
    note.hidden = true;
    return;
  }
  const pts = [];
  let skjult = 0;
  for (const e of MAP.items) {
    if (e.lat == null || e.lng == null) { skjult++; continue; } // online/uden adresse: kun i listen
    const p = MAP.map.project([e.lng, e.lat]);
    if (p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H) pts.push({e, p}); // ellers uden for udsnittet
  }
  // Forhindringer: aktivitetspunkterne selv, zoomknapperne og de mærker, der allerede er placeret.
  const taken = pts.map(({p}) => ({x: p.x - 6, y: p.y - 6, w: 12, h: 12, pt: p}));
  taken.push({x: W - 46, y: H - 96, w: 46, h: 96});
  const free = (r, p) => r.x >= CMARGIN && r.y >= CMARGIN && r.x + r.w <= W - CMARGIN && r.y + r.h <= H - CMARGIN
    && !taken.some(t => !(t.pt && Math.abs(t.pt.x - p.x) < 3 && Math.abs(t.pt.y - p.y) < 3) // eget (eller samme) sted
      && r.x < t.x + t.w + CPAD && t.x < r.x + r.w + CPAD && r.y < t.y + t.h + CPAD && t.y < r.y + r.h + CPAD);

  const visible = new Set();
  let paths = '';
  for (const {e, p} of pts) {
    const card = MAP.cards.get(e.id);
    if (!card._w) { card.hidden = false; card._w = card.offsetWidth; card._h = card.offsetHeight; }
    const w = card._w, h = card._h;
    let spot = null;
    for (const [dx, dy] of calloutSpots(w, h)) {
      const r = {x: p.x + dx, y: p.y + dy, w, h};
      if (free(r, p)) { spot = r; break; }
    }
    if (!spot) { skjult++; continue; }
    taken.push(spot);
    visible.add(e.id);
    card.hidden = false;
    card.style.left = `${spot.x}px`;
    card.style.top = `${spot.y}px`;
    // Kort streg til stedet, når mærket ikke sidder lige op ad punktet.
    const cx = Math.max(spot.x, Math.min(p.x, spot.x + w)), cy = Math.max(spot.y, Math.min(p.y, spot.y + h));
    if (Math.hypot(cx - p.x, cy - p.y) > CGAP + 3) {
      paths += `<path class="leader${MAP.hoverId === e.id ? ' hover' : ''}" d="M${p.x.toFixed(1)},${p.y.toFixed(1)}L${cx.toFixed(1)},${cy.toFixed(1)}"/>`;
    }
  }
  for (const [id, card] of MAP.cards) if (!visible.has(id)) card.hidden = true;
  MAP.leaders.innerHTML = paths;
  note.hidden = !skjult;
  note.textContent = skjult ? `+ ${skjult} ${skjult === 1 ? 'aktivitet' : 'aktiviteter'} uden plads på kortet – se listen` : '';
}

/** Kandidatpladser for et mærke (forskydning fra punktet), bedste først: højre, venstre, over, under, derefter stablet. */
function calloutSpots(w, h) {
  const g = CGAP, s = h + CPAD + 1, out = [[g, -h / 2], [-g - w, -h / 2], [-w / 2, -g - h], [-w / 2, g]];
  for (let k = 1; k <= 6; k++) {
    for (const sgn of [1, -1]) out.push([g, -h / 2 + sgn * k * s], [-g - w, -h / 2 + sgn * k * s]);
  }
  for (let k = 1; k <= 3; k++) out.push([-w / 2, -g - h - k * s], [-w / 2, g + k * s]);
  return out;
}

// ---- popover med detaljer for én aktivitet

function openPopover(e, {card, x, y}) {
  const pop = $('popover');
  const wrap = document.querySelector('.map-wrap').getBoundingClientRect();
  const f = DATA.byName.get(e.forening);
  const svar = e.svar != null ? `<div class="pop-meta">${e.deltager ?? 0} deltager · ${e.interesserede ?? 0} interesserede</div>` : '';
  const ret = (e.fremmoede != null ? `<div class="pop-meta">Faktisk fremmøde: ${esc(e.fremmoede)}</div>` : '')
    + (e.note ? `<div class="pop-meta pop-note">${esc(e.note)}</div>` : '');
  pop.innerHTML = `<button class="close-pop" aria-label="Luk">×</button>
    <div class="pop-title">${esc(e.navn)}${e.aflyst ? ' <span class="badge cancel">AFLYST</span>' : ''}${e.bekraeftet ? ' <span class="badge ok">✓</span>' : ''}</div>
    <div class="pop-meta">${esc(fmtDay.format(e.startD))} kl. ${esc(fmtTime.format(e.startD))}</div>
    <div class="pop-meta">${esc(e.sted || 'Sted ikke angivet')}</div>${svar}${ret}
    <div class="pop-actions">${f ? `<button class="chip" data-f="${esc(f.navn)}">${esc(visningsnavn(f))}</button>` : ''}
      ${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">Se på Facebook ↗</a>` : ''}
      <button class="linkbtn" data-ret="${esc(e.id)}">Ret</button></div>`;
  pop.hidden = false;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left, top;
  if (card) {
    const r = card.getBoundingClientRect();
    left = r.left - wrap.left < wrap.width / 2 ? r.right - wrap.left + 8 : r.left - wrap.left - pw - 8;
    top = r.top - wrap.top - 6;
    document.querySelectorAll('.callout.active').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
  } else {
    const mapTop = $('map').getBoundingClientRect().top - wrap.top;
    left = x;
    top = y + mapTop;
  }
  pop.style.left = `${Math.max(8, Math.min(wrap.width - pw - 8, left))}px`;
  pop.style.top = `${Math.max(8, Math.min(wrap.height - ph - 8, top))}px`;
  pop.querySelector('.close-pop').addEventListener('click', closePopover);
  pop.querySelector('[data-ret]').addEventListener('click', () => { closePopover(); retArrangement(e.id); });
  bindForeningLinks(pop);
}

function closePopover() {
  $('popover').hidden = true;
  document.querySelectorAll('.callout.active').forEach(c => c.classList.remove('active'));
}

// ---- lag

let layerIds = [], sourceIds = [];
function drawLayers() {
  const map = MAP.map;
  if (!map || !MAP.ready) return;
  for (const id of layerIds) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of sourceIds) if (map.getSource(id)) map.removeSource(id);
  layerIds = [];
  sourceIds = [];
  const f = selected && DATA.byName.get(selected);
  const ctx = {selected, zoomed: !!(f && !f.national), map};
  for (const layer of MAP_LAYERS) {
    if (layer.synlig && !layer.synlig(ctx)) continue;
    if (layer.toggle && !layerState[layer.id]) continue;
    const api = {
      source: (name, data) => {
        const id = `lay-${layer.id}-${name}`;
        map.addSource(id, {type: 'geojson', data});
        sourceIds.push(id);
        return id;
      },
      layer: spec => {
        const id = `lay-${layer.id}-${spec.id}`;
        map.addLayer({...spec, id}, spec.type === 'symbol' ? undefined : 'ev-local');
        layerIds.push(id);
        return id;
      },
    };
    layer.tegn(api, ctx);
  }
}

const pointsFC = list => ({type: 'FeatureCollection', features: list.filter(e => e.lat != null && e.lng != null)
  .map(e => ({type: 'Feature', properties: {id: e.id}, geometry: {type: 'Point', coordinates: [e.lng, e.lat]}}))});

// Indbyggede kortlag.
registerLayer({
  id: 'kommunenavne', label: 'Kommunenavne', hint: 'Når en forening er valgt', toggle: true, standard: true,
  synlig: ctx => ctx.zoomed,
  tegn(api, ctx) {
    api.layer({id: 'txt', type: 'symbol', source: 'klabels', filter: ['==', ['get', 'forening'], ctx.selected], layout: {
      'text-field': ['get', 'navn'], 'text-font': FONT_ITALIC, 'text-size': ['interpolate', ['linear'], ['zoom'], 7, 12, 11, 15],
      'text-letter-spacing': 0.04, 'text-max-width': 8}, paint: {
      'text-color': '#334155', 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.8, 'text-halo-blur': 0.3}});
  },
});
registerLayer({
  id: 'afholdte', label: 'Afholdte aktiviteter', gruppe: 'aktiviteter', hint: 'Hvide prikker', toggle: true, standard: false,
  tegn(api, ctx) {
    const list = ctx.selected ? DATA.byName.get(ctx.selected).afholdt : DATA.events.filter(e => !e.forsvundet && !e.aflyst && e.slutD < NOW);
    const src = api.source('pts', pointsFC(list));
    api.layer({id: 'dots', type: 'circle', source: src, paint: {
      'circle-radius': 4.5, 'circle-color': '#ffffff', 'circle-stroke-color': '#111827', 'circle-stroke-width': 1.8}});
  },
});
registerLayer({
  // Oven på den valgte farvning: skraverer de foreninger magenta, der ikke kan blive HB-godkendt næste år.
  id: 'hb', label: `Skravér foreninger, der ikke kan HB-godkendes ${HB_AAR}`, gruppe: 'hb', toggle: true, standard: false,
  tegn(api, ctx) {
    if (!ctx.map.hasImage('hb-skravering')) ctx.map.addImage('hb-skravering', skravering(HB_FILL.ikke));
    const feats = DATA.geo.outlines.features
      .filter(o => !ctx.zoomed || o.properties.forening === ctx.selected)
      .map(o => ({...o, properties: {...o.properties, hb: DATA.byName.get(o.properties.forening).hb}}));
    const src = api.source('omr', {type: 'FeatureCollection', features: feats});
    api.layer({id: 'skrav', type: 'fill', source: src, filter: ['==', ['get', 'hb'], 'ikke'],
      paint: {'fill-pattern': 'hb-skravering', 'fill-opacity': 0.9}});
    api.layer({id: 'kant', type: 'line', source: src, filter: ['==', ['get', 'hb'], 'ikke'],
      paint: {'line-color': HB_FILL.ikke, 'line-width': 2.5}});
  },
});
/** Diagonal skravering til fill-pattern. */
function skravering(farve, size = 10) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.strokeStyle = farve;
  g.lineWidth = 2.2;
  g.beginPath();
  for (const o of [-size, 0, size]) { g.moveTo(o, size); g.lineTo(o + size, 0); }
  g.stroke();
  return g.getImageData(0, 0, size, size);
}
registerLayer({
  // Eksempel på et privat lag: vises kun, hvis adminversionen leverer medlemstal pr. by.
  id: 'medlemmer', label: 'Medlemmer pr. by', toggle: true, standard: false,
  tilgaengelig: () => !!(CONFIG.privat && CONFIG.privat.medlemmer),
  synlig: () => !!(CONFIG.privat && CONFIG.privat.medlemmer),
  tegn(api, ctx) {
    const rows = CONFIG.privat.medlemmer.filter(r => !ctx.zoomed || r.forening === ctx.selected);
    const max = Math.max(1, ...rows.map(r => r.antal));
    const src = api.source('pts', {type: 'FeatureCollection', features: rows.map(r => ({type: 'Feature',
      properties: {by: r.by, antal: r.antal, r: 5 + 18 * Math.sqrt(r.antal / max)}, geometry: {type: 'Point', coordinates: [r.lng, r.lat]}}))});
    api.layer({id: 'bubbles', type: 'circle', source: src, paint: {
      'circle-radius': ['get', 'r'], 'circle-color': '#2a78d6', 'circle-opacity': 0.35, 'circle-stroke-color': '#2a78d6', 'circle-stroke-width': 1.5}});
    api.layer({id: 'antal', type: 'symbol', source: src, layout: {'text-field': ['to-string', ['get', 'antal']], 'text-font': FONT_BOLD, 'text-size': 11},
      paint: {'text-color': '#0b0b0b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2}});
  },
});

function hoverForening(navn, ev) {
  if (MAP.ready) MAP.map.setFilter('f-hover', ['==', ['get', 'forening'], navn && navn !== NATIONAL ? navn : '']);
  if (!navn || !ev) return hideTip();
  const f = DATA.byName.get(navn);
  const next = f.naeste ? `Næste: ${fmtDay.format(f.naeste.startD)} – ${f.naeste.navn}` : 'Ingen planlagte aktiviteter';
  if (farvning === 'hb' && f.hb) {
    const kv = HB_KVARTALER.map(q => `${q.kort}: ${HB_KV[f.hbKv[q.id]].label}`).join(' · ');
    return showTip(ev, [visningsnavn(f), HB_STATUS[f.hb].label, kv]);
  }
  const k = valgtKvartal();
  const linje = !k ? STATUS[f.status].label : f.kv[k.id] ? `Afholdt i ${k.kort}: ${f.kv[k.id]}` : kvartalStatus(k)[kvStatus(f, k)].label;
  showTip(ev, [visningsnavn(f), linje, next]);
}

// ------------------------------------------------------------------ tooltip

function showTip(ev, lines) {
  const t = $('tooltip');
  t.innerHTML = lines.map((l, i) => i ? `<div class="muted">${esc(l)}</div>` : `<b>${esc(l)}</b>`).join('');
  t.hidden = false;
  moveTip(ev);
}
function moveTip(ev) {
  const t = $('tooltip');
  if (t.hidden) return;
  const pad = 14, r = t.getBoundingClientRect();
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}
function hideTip() { $('tooltip').hidden = true; }
function bindTips(root) {
  root.querySelectorAll('[data-tip]').forEach(n => {
    n.addEventListener('mouseenter', ev => showTip(ev, n.dataset.tip.split('|')));
    n.addEventListener('mousemove', moveTip);
    n.addEventListener('mouseleave', hideTip);
  });
}

// ------------------------------------------------------------------ lister & små komponenter

function evList(list, showForening, emptyText = 'Ingen planlagte aktiviteter.') {
  if (!list.length) return `<p class="empty">${esc(emptyText)}</p>`;
  return '<ul class="evlist">' + list.map(e => {
    const f = DATA.byName.get(e.forening);
    return `<li>
    <div class="date">${esc(fmtDay.format(e.startD))}<br><span class="meta">kl. ${esc(fmtTime.format(e.startD))}</span></div>
    <div>${e.url ? `<a class="title" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.navn)}</a>` : `<span class="title">${esc(e.navn)}</span>`}${
      e.aflyst ? '<span class="badge cancel">AFLYST</span>' : ''}${e.ny && !e.aflyst ? '<span class="badge new">NY</span>' : ''}${
      e.bekraeftet && !e.aflyst ? '<span class="badge ok" title="Bekræftet">✓</span>' : ''}
      <div class="meta">${showForening && f ? `<button class="forening-link" data-f="${esc(f.navn)}">${esc(visningsnavn(f))}</button> · ` : ''}${esc(e.sted || 'Sted ikke angivet')}</div>
    </div></li>`;
  }).join('') + '</ul>';
}

function bindForeningLinks(root) {
  root.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { closePopover(); openForening(b.dataset.f); }));
}

function statusPill(status) {
  return `<span class="status"><span class="dot" style="background:${MAP_FILL[status]}"></span>${esc(STATUS[status].label)}</span>`;
}

function tile(label, value, delta, hero) {
  return `<div class="tile"><div class="label">${esc(label)}</div><div class="value${hero ? ' hero' : ''}">${esc(value)}</div>${
    delta ? `<div class="delta">${esc(delta)}</div>` : ''}</div>`;
}

// ------------------------------------------------------------------ diagrammer (SVG)

function barRight(x, y, w, h, r = 4) {
  if (w <= r) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - r)}z`;
}
function barUp(x, y, w, h, r = 4) {
  if (h <= r) return `M${x},${y + h}v${-h}h${w}v${h}z`;
  return `M${x},${y + h}v${-(h - r)}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z`;
}

/** Vandrette søjler med 1–2 stablede serier; rows: {label, values:[a,b], tip}. */
function hbars(rows, {width = 308, labelW = 110, colors = ['var(--accent)', 'var(--accent-light)'], aria = ''} = {}) {
  const barH = 12, rowH = 21;
  const max = Math.max(1, ...rows.map(r => r.values.reduce((a, b) => a + b, 0)));
  const plotW = width - labelW - 28;
  const h = rows.length * rowH + 2;
  let s = `<svg class="chart" viewBox="0 0 ${width} ${h}" role="img" aria-label="${esc(aria)}">`;
  s += `<line class="baseline" x1="${labelW}" x2="${labelW}" y1="0" y2="${h}"/>`;
  rows.forEach((r, i) => {
    const y = i * rowH + 5, total = r.values.reduce((a, b) => a + b, 0);
    s += `<text class="lbl" x="${labelW - 6}" y="${y + 10}" text-anchor="end">${esc(trunc(r.label, Math.round(labelW / 6.2)))}</text>`;
    let x = labelW;
    const segs = r.values.map((v, k) => ({v, k})).filter(d => d.v > 0);
    segs.forEach((d, j) => {
      const w = Math.max(2, d.v / max * plotW) - (j < segs.length - 1 ? 2 : 0);
      s += j === segs.length - 1
        ? `<path d="${barRight(x, y, w, barH)}" fill="${colors[d.k]}"/>`
        : `<rect x="${x}" y="${y}" width="${w}" height="${barH}" fill="${colors[d.k]}"/>`;
      x += w + 2;
    });
    s += `<text class="val" x="${(segs.length ? x - 2 : labelW) + 5}" y="${y + 10}">${esc(num1(total))}</text>`;
    s += `<rect class="hit" x="0" y="${y - 4}" width="${width}" height="${rowH}" data-tip="${esc(r.tip || `${r.label}|${num1(total)}`)}"/>`;
  });
  return s + '</svg>';
}

/** Lodrette (evt. stablede) søjler; cols: {label, values:[a,b], tip, nodata}. */
function columns(cols, {width = 308, height = 130, colors = ['var(--accent)', 'var(--accent-light)'], aria = ''} = {}) {
  const top = 16, bottom = 20, plotH = height - top - bottom;
  const max = Math.max(1, ...cols.map(c => c.values.reduce((a, b) => a + b, 0)));
  const band = width / cols.length, bw = Math.min(20, band * 0.62);
  let s = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(aria)}">`;
  cols.forEach((c, i) => {
    if (c.nodata) s += `<rect class="nodata" x="${i * band + 1}" y="${top}" width="${band - 2}" height="${plotH}"/>`;
  });
  s += `<line class="baseline" x1="0" x2="${width}" y1="${top + plotH}" y2="${top + plotH}"/>`;
  cols.forEach((c, i) => {
    const x = i * band + (band - bw) / 2, total = c.values.reduce((a, b) => a + b, 0);
    let y = top + plotH;
    const segs = c.values.map((v, k) => ({v, k})).filter(d => d.v > 0);
    segs.forEach((d, j) => {
      const hgt = Math.max(2, d.v / max * plotH) - (j < segs.length - 1 ? 2 : 0);
      y -= hgt;
      s += j === segs.length - 1
        ? `<path d="${barUp(x, y, bw, hgt)}" fill="${colors[d.k]}"/>`
        : `<rect x="${x}" y="${y}" width="${bw}" height="${hgt}" fill="${colors[d.k]}"/>`;
      y -= 2;
    });
    if (total) s += `<text class="val" x="${x + bw / 2}" y="${y - 3}" text-anchor="middle">${esc(num1(total))}</text>`;
    s += `<text class="tick" x="${x + bw / 2}" y="${height - 5}" text-anchor="middle">${esc(c.label)}</text>`;
    s += `<rect class="hit" x="${i * band}" y="0" width="${band}" height="${height}" data-tip="${esc(c.tip || `${c.label}|${num1(total)}`)}"/>`;
  });
  return s + '</svg>';
}

function legend2(a, b, extra = '') {
  return `<div class="chart-legend"><span><span class="swatch" style="background:var(--accent)"></span>${esc(a)}</span>`
    + `<span><span class="swatch" style="background:var(--accent-light)"></span>${esc(b)}</span>${extra}</div>`;
}

// ------------------------------------------------------------------ sidepanel: overblik

function renderOverview() {
  const {lokale, events, meta, dataFra, foreninger} = DATA;
  const soon = events.filter(e => e.soon && DATA.byName.has(e.forening)).sort((a, b) => a.startD - b.startD);
  const planlagt = events.filter(e => !e.forsvundet && !e.aflyst && e.slutD >= NOW).length;
  const medPlan = lokale.filter(f => f.planlagt.length).length;
  const afholdt = events.filter(e => !e.forsvundet && !e.aflyst && e.slutD < NOW).length;
  const aktive = k => lokale.filter(f => f.kv[k.id]).length;
  const tidligere = KVARTALER.slice(0, -1).map(k => `${k.kort}: ${aktive(k)}`).join(' · ');
  const dataKort = dataFra > new Date(KVARTALER[0].fra + 'T12:00:00Z') ? `Data kun fra ${fmtDate.format(dataFra)}` : '';

  $('tiles').innerHTML =
    tile('Aktiviteter de næste 14 dage', String(soon.filter(e => !e.aflyst).length), null, true)
    + tile('Planlagte aktiviteter', String(planlagt), 'Inkl. landsforeningens')
    + tile('Lokalforeninger med planer', `${medPlan} af ${lokale.length}`, `${lokale.filter(f => !f.facebook).length} uden Facebook-side`)
    + tile(`Aktive i ${KVARTAL.kort}`, `${aktive(KVARTAL)} af ${lokale.length}`,
      [tidligere, dataKort].filter(Boolean).join(' · ') || 'Lokalforeninger med afholdt aktivitet')
    + tile('Afholdte registreret', String(afholdt), `Siden ${fmtDate.format(dataFra)}`);

  const l14 = $('list-14');
  l14.innerHTML = evList(soon, true, 'Ingen aktiviteter de næste 14 dage.');
  bindForeningLinks(l14);

  renderRank();

  const rows = [...foreninger]
    .sort((a, b) => (b.afholdt90.length + b.planlagt.length) - (a.afholdt90.length + a.planlagt.length) || a.navn.localeCompare(b.navn, 'da'))
    .map(f => ({label: f.navn, values: [f.afholdt90.length, f.planlagt.length],
                tip: `${visningsnavn(f)}|Afholdt seneste 90 dage: ${f.afholdt90.length}|Planlagt: ${f.planlagt.length}`}));
  const act = $('chart-activity');
  act.innerHTML = legend2('Afholdt (90 dage)', 'Planlagt') + hbars(rows, {aria: 'Aktiviteter pr. forening'});
  bindTips(act);

  const last = meta.koersler[meta.koersler.length - 1];
  $('updated').textContent = last ? `Sidst hentet fra Facebook: ${fmtStamp.format(new Date(last.tid))}` : '';
  $('method').textContent =
    `Data hentes automatisk fra foreningernes offentlige Facebook-begivenheder én gang om ugen (${meta.koersler.length} kørsler indtil nu). `
    + (DATA.historik
      ? `Afholdte aktiviteter fra ${fmtDate.format(dataFra)} er hentet bagudrettet fra foreningernes tidligere begivenheder; derefter vokser historikken uge for uge. `
      : `Facebook viser kun kommende begivenheder, så afholdte aktiviteter tælles fra ${fmtDate.format(dataFra)}, og historikken vokser uge for uge. `)
    + '"Tilkendegivelser" er "deltager" + "interesseret" på Facebook ved seneste måling. Aktivitetstyper inddeles automatisk ud fra titel og beskrivelse. '
    + 'Kort: © OpenStreetMap-bidragydere, OpenFreeMap.';
}

const RANK = {
  naeste: {val: f => f.naeste ? +f.naeste.startD : Infinity, dir: 1, vis: f => f.planlagt.length},
  navn: {val: f => (f.national ? '0' : '1') + f.navn, dir: 1, vis: f => f.planlagt.length},
  planlagt: {val: f => f.planlagt.length, dir: -1, vis: f => f.planlagt.length},
  afholdt90: {val: f => f.afholdt90.length, dir: -1, vis: f => f.afholdt90.length},
  kvartal: {val: f => f.kv[(valgtKvartal() || KVARTAL).id], dir: -1, vis: f => `${(valgtKvartal() || KVARTAL).kort}: ${f.kv[(valgtKvartal() || KVARTAL).id]}`},
  svar: {val: f => f.gnsSvar ?? -1, dir: -1, vis: f => num1(f.gnsSvar)},
};

function renderRank() {
  const key = $('rank-sort').value, r = RANK[key];
  const list = [...DATA.foreninger].sort((a, b) => {
    const va = r.val(a), vb = r.val(b);
    const d = typeof va === 'string' ? va.localeCompare(vb, 'da') : va - vb;
    return d * r.dir || a.navn.localeCompare(b.navn, 'da');
  });
  const el = $('rank');
  el.innerHTML = list.map(f => `<li tabindex="0" data-f="${esc(f.navn)}">
    <span class="dot" style="background:${farveFor(f).farve}" title="${esc(farveFor(f).label)}"></span>
    <span class="name">${esc(f.national ? '◆ Landsforeningen' : f.navn)}</span>
    <span class="val">${esc(r.vis(f))}</span>
    <span class="sub">${f.naeste ? `${esc(fmtDay.format(f.naeste.startD))} – ${esc(f.naeste.navn)}` : esc(STATUS[f.status].label)}</span></li>`).join('');
  el.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => openForening(li.dataset.f));
    li.addEventListener('keydown', ev => { if (ev.key === 'Enter') openForening(li.dataset.f); });
  });
}

// ------------------------------------------------------------------ panelets sektioner

function monthsLastYear() {
  const [y, m] = monthKey(NOW).split('-').map(Number);
  const out = [];
  for (let i = -11; i <= 2; i++) out.push(new Date(Date.UTC(y, m - 1 + i, 15)));
  return out;
}

registerSection({
  id: 'kommende', titel: 'Kommende aktiviteter',
  render: f => evList(f.upcoming, false),
});
registerSection({
  id: 'hb', titel: `HB-godkendelse ${HB_AAR}`, synlig: f => !f.national,
  render(f) {
    const kv = HB_KVARTALER.map(k => {
      const s = HB_KV[f.hbKv[k.id]];
      return `<span class="status"><span class="dot" style="background:${s.farve}"></span>${esc(k.kort)}: ${esc(s.label)}</span>`;
    }).join('');
    const nu = f.hbNu;
    const nuTekst = !nu ? '' : `<p class="note"><b>HB ${HB_AAR - 1}:</b> ${esc({godkendt: 'Godkendt', ikke_godkendt: 'Ikke godkendt', uafklaret: 'Uafklaret'}[nu.status] || nu.status)}${
      nu.mangler && nu.mangler.length ? ` – mangler: ${esc(nu.mangler.join('; '))}` : ''}${nu.note ? `. ${esc(nu.note)}` : ''}</p>`;
    return `<div class="hb-prognose"><span class="dot" style="background:${HB_FILL[f.hb]}"></span>${esc(HB_STATUS[f.hb].label)}</div>
      <div class="kvartaler">${kv}</div>
      <p class="note">Krav: mindst ét afholdt arrangement i hvert kvartal ${HB_AAR - 1}.</p>${nuTekst}`;
  },
}, {efter: 'kommende'});
registerSection({
  id: 'aar', titel: 'Aktiviteter det seneste år',
  render(f) {
    const startKey = monthKey(DATA.dataFra);
    const cols = monthsLastYear().map(d => {
      const k = d.toISOString().slice(0, 7);
      const a = f.afholdt.filter(e => monthKey(e.startD) === k).length;
      const p = f.planlagt.filter(e => monthKey(e.startD) === k).length;
      const label = fmtMonth.format(d).replace('.', '');
      const nodata = k < startKey;
      return {label, values: [a, p], nodata,
              tip: nodata ? `${label} ${k.slice(0, 4)}|Før dataindsamlingen startede` : `${label} ${k.slice(0, 4)}|Afholdt: ${a}|Planlagt: ${p}`};
    });
    const extra = cols.some(c => c.nodata) ? '<span><span class="swatch nodata-swatch"></span>Ingen data endnu</span>' : '';
    return legend2('Afholdt', 'Planlagt', extra) + columns(cols, {aria: 'Aktiviteter pr. måned det seneste år'});
  },
});
registerSection({
  id: 'noegletal', titel: 'Nøgletal',
  render(f) {
    const all = DATA.lokale.filter(x => x.facebook);
    const gns90 = mean(all.map(x => x.afholdt90.length));
    const gnsSvar = mean(all.map(x => x.gnsSvar).filter(v => v != null));
    const dageSiden = f.sidste ? Math.floor((NOW - f.sidste) / DAY) : null;
    const cmp = f.national ? '' : 'Gns. for lokalforeninger: ';
    return `<div class="tiles">
      ${tile('Afholdt, seneste 90 dage', String(f.afholdt90.length), cmp ? cmp + num1(gns90) : null)}
      ${tile('Dage siden sidste aktivitet', dageSiden == null ? '–' : String(dageSiden),
        f.sidste ? `Senest ${fmtDate.format(f.sidste)}` : `Ingen afholdt siden ${fmtDate.format(DATA.dataFra)}`)}
      ${tile('Tilkendegivelser pr. aktivitet', num1(f.gnsSvar), cmp ? cmp + num1(gnsSvar) : null)}
      ${tile('Varsel (median)', f.varsel == null ? '–' : `${Math.round(f.varsel)} dage`,
        f.varsel == null ? 'Måles for aktiviteter, der dukker op efter indsamlingens start' : 'Fra aktiviteten dukker op, til den afholdes')}
    </div>`;
  },
});
registerSection({
  id: 'typer', titel: 'Typer af aktiviteter', synlig: f => f.gyldige.length > 0,
  render(f) {
    const rows = KAT_NAVNE.map(k => {
      const a = f.afholdt.filter(e => e.kat === k).length, p = f.planlagt.filter(e => e.kat === k).length;
      return {label: k, values: [a, p], tip: `${k}|Afholdt: ${a}|Planlagt: ${p}`};
    }).filter(r => r.values[0] + r.values[1] > 0);
    return legend2('Afholdt', 'Planlagt') + hbars(rows, {aria: 'Typer af aktiviteter', labelW: 100});
  },
});
registerSection({
  id: 'tilkendegivelser', titel: 'Tilkendegivelser pr. aktivitet', synlig: f => f.gyldige.some(e => e.svar != null),
  render(f) {
    const rows = f.gyldige.filter(e => e.svar != null).slice(-10).map(e => ({
      label: `${fmtDay.format(e.startD).replace(/^\S+ /, '')} ${e.navn}`,
      values: e.slutD < NOW ? [e.svar, 0] : [0, e.svar],
      tip: `${e.navn}|${fmtDate.format(e.startD)}|Deltager: ${e.deltager ?? '–'} · Interesseret: ${e.interesserede ?? '–'}`}));
    return `<p class="note">"Deltager" + "interesseret" på Facebook for de seneste ${rows.length} aktiviteter.</p>`
      + legend2('Afholdt', 'Planlagt') + hbars(rows, {aria: 'Tilkendegivelser pr. aktivitet', labelW: 150});
  },
});
registerSection({
  id: 'geografi', titel: 'Geografisk spredning', synlig: f => f.gyldige.length > 0,
  render(f) {
    const komCount = new Map(f.kommuner.map(k => [k, 0]));
    let andet = 0;
    for (const e of f.gyldige) {
      if (e.kommune && (f.national || komCount.has(e.kommune))) komCount.set(e.kommune, (komCount.get(e.kommune) || 0) + 1);
      else andet++;
    }
    const rows = [...komCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'da'))
      .map(([k, v]) => ({label: k, values: [v, 0], tip: `${k}|${v} aktiviteter`}));
    if (andet) rows.push({label: f.national ? 'Online/uden adresse' : 'Andet/ukendt sted', values: [andet, 0], tip: `Online, uden adresse eller uden for området|${andet}`});
    const medAkt = [...komCount.values()].filter(v => v > 0).length;
    const note = f.national ? `Aktiviteter i ${medAkt} kommuner.` : `${medAkt} af ${f.kommuner.length} kommuner i området har haft eller får aktiviteter.`;
    return `<p class="note">${esc(note)}</p>` + hbars(rows, {aria: 'Aktiviteter pr. kommune'});
  },
});
registerSection({
  id: 'ugedage', titel: 'Ugedage', synlig: f => f.gyldige.length > 0,
  render: f => columns(UGEDAGE.map((d, i) => ({label: d, values: [f.gyldige.filter(e => weekday(e.startD) === i).length, 0]})),
    {height: 110, aria: 'Aktiviteter pr. ugedag'}),
});
registerSection({
  // Stamdata (formand, kontakt osv.): offentlige felter fra foreninger.json, fortrolige fra adminversionen.
  id: 'stamdata', titel: 'Stamdata',
  synlig: f => !!(f.stamdata || (CONFIG.privat && CONFIG.privat.stamdata && CONFIG.privat.stamdata[f.navn])),
  render(f) {
    const d = Object.assign({}, f.stamdata || {}, (CONFIG.privat && CONFIG.privat.stamdata && CONFIG.privat.stamdata[f.navn]) || {});
    return `<dl class="stamdata">${Object.entries(d).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${
      /^\+?[\d ]{8,}$/.test(String(v)) ? `<a href="tel:${esc(String(v).replace(/ /g, ''))}">${esc(v)}</a>` : esc(v)}</dd>`).join('')}</dl>`;
  },
});
registerSection({
  id: 'noter', titel: 'Noter',
  render: () => `<p class="note" data-note-info></p><textarea class="notes" rows="5" placeholder="Skriv noter om foreningen …"></textarea><div class="note-status" aria-live="polite"></div>`,
  async efter(el, f) {
    const lager = noteLager();
    const ta = el.querySelector('textarea'), status = el.querySelector('.note-status');
    el.querySelector('h3').textContent = lager.titel;
    el.querySelector('[data-note-info]').textContent = lager.forklaring;
    ta.value = await lager.hent(f);
    let t;
    ta.addEventListener('input', () => {
      clearTimeout(t);
      status.textContent = 'Gemmer …';
      t = setTimeout(async () => { await lager.gem(f, ta.value); status.textContent = 'Gemt'; }, 600);
    });
  },
});

// ------------------------------------------------------------------ vælg / fravælg forening

function openForening(navn, {animate = true} = {}) {
  const f = DATA.byName.get(navn);
  if (!f) return;
  selected = navn;
  hideTip();
  closePopover();
  renderForening(f);
  visFane('oversigt');
  $('sidebar').scrollTop = 0;
  document.querySelectorAll('.chip[data-f]').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.f === navn)));
  $('zoom-reset').hidden = false;
  history.replaceState(null, '', '#' + encodeURIComponent(navn));
  if (MAP.ready) setMode(navn, {animate});
  renderHB();
}

function renderForening(f) {
  const body = $('forening-body');
  body.innerHTML = `
    <h2 class="fname">${esc(visningsnavn(f))}</h2>
    ${statusPill(f.status)}
    ${f.facebook || KVARTALER.some(k => f.kv[k.id]) ? `<div class="kvartaler" title="Afholdte aktiviteter pr. kvartal">${KVARTALER.map(k =>
      `<span class="status"><span class="dot" style="background:${KVARTAL_FILL[kvStatus(f, k)]}"></span>${esc(k.kort)}: ${f.kv[k.id]} afholdt</span>`).join('')}</div>` : ''}
    <div class="kommuner">${f.national ? 'Arrangementer i hele landet' : `Dækker ${esc(f.kommuner.join(', '))}`}</div>
    ${f.facebook ? `<a class="fb" href="${esc(f.facebook)}" target="_blank" rel="noopener">Facebook-side ↗</a>${fbSider(f).slice(1).map(u =>
      ` · <a class="fb" href="${esc(u)}" target="_blank" rel="noopener">Tidligere side ↗</a>`).join('')}`
      : '<p class="empty">Ingen Facebook-side tilknyttet endnu, så aktiviteter kan ikke hentes automatisk.</p>'}
    <button class="linkbtn arr-link" data-arr-forening="${esc(f.navn)}">Arrangementer og rettelser →</button>`;
  body.querySelector('[data-arr-forening]').addEventListener('click', () => {
    Object.assign(ARR, {forening: f.navn, filter: 'alle', q: '', aaben: null});
    visFane('arrangementer');
  });
  for (const sec of PANEL_SECTIONS) {
    if (sec.synlig && !sec.synlig(f)) continue;
    const el = document.createElement('section');
    el.className = 'panel-sec';
    el.dataset.sec = sec.id;
    el.innerHTML = `<h3>${esc(sec.titel)}</h3>${sec.render(f)}`;
    body.appendChild(el);
    if (sec.efter) sec.efter(el, f);
  }
  bindTips(body);
}

function closeForening() {
  selected = null;
  closePopover();
  visFane(FANE === 'oversigt' ? 'oversigt' : FANE);
  document.querySelectorAll('.chip[data-f]').forEach(c => c.setAttribute('aria-pressed', 'false'));
  $('zoom-reset').hidden = true;
  history.replaceState(null, '', location.pathname + location.search);
  if (MAP.ready) setMode(null);
  renderHB();
}

// ------------------------------------------------------------------ sidepanelets faner

let FANE = 'oversigt';
const FANER = {oversigt: 'Oversigt', visninger: 'Visninger', hb: 'HB-godkendelse', arrangementer: 'Arrangementer'};
function visFane(fane) {
  FANE = fane;
  document.querySelectorAll('.side-tabs [data-fane]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.fane === fane)));
  $('side-overview').hidden = fane !== 'oversigt' || !!selected;
  $('side-forening').hidden = fane !== 'oversigt' || !selected;
  $('side-visninger').hidden = fane !== 'visninger';
  $('side-hb').hidden = fane !== 'hb';
  $('side-arrangementer').hidden = fane !== 'arrangementer';
  if (fane === 'arrangementer') renderArrangementer();
  $('sidebar').scrollTop = 0;
}

// ------------------------------------------------------------------ fane: visninger

const FARVNINGER = () => [
  {id: 'status', label: 'Aktivitet nu', hint: 'Aktivitet inden for 14 dage / planlagt senere / intet'},
  ...KVARTALER.map(k => ({id: k.id, label: `Afholdt i ${k.kort}`, hint: `Grøn: mindst én afholdt aktivitet i ${k.navn}`})),
  {id: 'ingen', label: 'Ingen farve'},
];
const GRUPPER = {aktiviteter: 'Aktiviteter på kortet', kort: 'Kortet'};
const toggles = gruppe => [...VISNINGER, ...MAP_LAYERS.filter(l => l.toggle && (!l.tilgaengelig || l.tilgaengelig()))]
  .filter(v => (v.gruppe || 'kort') === gruppe);
const toggleHtml = v => `<label class="opt"><input type="checkbox" data-vis="${esc(v.id)}"${layerState[v.id] ? ' checked' : ''}>
  <span>${esc(v.label)}${v.hint ? `<span class="hint">${esc(v.hint)}</span>` : ''}</span></label>`;
function bindVisning(el) {
  el.querySelectorAll('[data-vis]').forEach(i => i.addEventListener('change', () => setVisning(i.dataset.vis, i.checked)));
  el.querySelectorAll('[data-farvning]').forEach(i => i.addEventListener('change', () => { if (i.checked) setFarvning(i.value); }));
}

function renderVisninger() {
  const el = $('side-visninger');
  if (!DATA) return;
  el.innerHTML = `<header class="side-head"><h1>Visninger</h1><p class="updated">Vælg, hvad kortet viser. Valgene huskes i denne browser.</p></header>
    <h2>Farv foreningerne efter</h2>
    <div class="opts">${FARVNINGER().map(v => `<label class="opt"><input type="radio" name="farvning" value="${esc(v.id)}" data-farvning${
      farvning === v.id ? ' checked' : ''}><span>${esc(v.label)}${v.hint ? `<span class="hint">${esc(v.hint)}</span>` : ''}</span></label>`).join('')}
      </div>${farvning === 'hb' ? `<p class="note">Kortet er farvet efter HB-godkendelse ${HB_AAR} (fanen <button class="linkbtn" data-til-hb>HB-godkendelse</button>).</p>` : ''}
    ${Object.entries(GRUPPER).map(([g, t]) => `<h2>${esc(t)}</h2><div class="opts">${toggles(g).map(toggleHtml).join('')}</div>`).join('')}
    <button class="linkbtn" data-nulstil>Nulstil visninger</button>`;
  bindVisning(el);
  const tilHB = el.querySelector('[data-til-hb]');
  if (tilHB) tilHB.addEventListener('click', () => visFane('hb'));
  el.querySelector('[data-nulstil]').addEventListener('click', () => {
    for (const v of VISNINGER) layerState[v.id] = v.standard !== false;
    for (const l of MAP_LAYERS) layerState[l.id] = l.standard !== false;
    gemVisning();
    setFarvning('status');
    applyVisning();
    if (MAP.ready) setMode(selected, {fit: false});
    renderLegend();
  });
}

// ------------------------------------------------------------------ fane: HB-godkendelse

function renderHB() {
  const el = $('side-hb');
  if (!DATA) return;
  const tael = Object.fromEntries(Object.keys(HB_STATUS).map(k => [k, DATA.lokale.filter(f => f.hb === k).length]));
  const orden = {ikke: 0, mangler_nu: 1, planlagt_nu: 2, ukendt: 3, alle: 4, plus_naeste: 5}; // dem, der kræver handling, først
  const rows = [...DATA.lokale].sort((a, b) => orden[a.hb] - orden[b.hb] || a.navn.localeCompare(b.navn, 'da'));
  const nuTekst = {godkendt: 'Godkendt', ikke_godkendt: 'Ikke godkendt', uafklaret: 'Uafklaret'};
  el.innerHTML = `<header class="side-head"><h1>HB-godkendelse ${HB_AAR}</h1>
      <p class="updated">Krav (Organisationshåndbogen 8.2): mindst ét afholdt arrangement i hvert kvartal ${HB_AAR - 1}. Om det er fagligt, vurderes ikke.</p></header>
    <h2>Visninger</h2>
    <div class="opts">
      <label class="opt"><input type="checkbox" data-hb-farve${farvning === 'hb' ? ' checked' : ''}><span>Farv kortet efter HB-godkendelse ${HB_AAR}<span class="hint">Lilla/magenta – slås fra igen til "Aktivitet nu"</span></span></label>
      ${MAP_LAYERS.filter(l => l.toggle && l.gruppe === 'hb').map(toggleHtml).join('')}
    </div>
    <h2>Kategorier (${esc(HB_KVARTALER[HB_NU].kort)} er det indeværende kvartal)</h2>
    <ol class="hb-kat">${Object.entries(HB_STATUS).map(([k, s]) =>
      `<li${k === 'ukendt' ? ' class="uden-nr"' : ''}><span class="dot-inline" style="background:${HB_FILL[k]}"></span><span>${esc(s.label)}</span><b>${tael[k]}</b></li>`).join('')}</ol>
    <h2>Status pr. forening</h2>
    <table class="hb-tabel"><thead><tr><th>Forening</th>${HB_KVARTALER.map(k => `<th>${esc(k.kort)}</th>`).join('')}<th title="HB-status ${HB_AAR - 1}">${HB_AAR - 1}</th></tr></thead>
    <tbody>${rows.map(f => `<tr tabindex="0" data-f="${esc(f.navn)}"${f.navn === selected ? ' class="valgt"' : ''}>
      <td><span class="dot-inline" style="background:${HB_FILL[f.hb]}" title="${esc(HB_STATUS[f.hb].label)}"></span>${esc(f.navn)}</td>
      ${HB_KVARTALER.map(k => { const s = HB_KV[f.hbKv[k.id]]; return `<td><span class="kv-dot" style="background:${s.farve}" title="${esc(`${k.kort}: ${s.label}`)}"></span></td>`; }).join('')}
      <td class="muted">${esc(f.hbNu ? (nuTekst[f.hbNu.status] || f.hbNu.status) : '–')}</td></tr>`).join('')}</tbody></table>
    <div class="chart-legend">${Object.values(HB_KV).map(s => `<span><span class="swatch" style="background:${s.farve}"></span>${esc(s.label)}</span>`).join('')}</div>
    <p class="note">Mangler et afholdt arrangement, fordi det ikke lå på Facebook? Tilføj eller bekræft det under <button class="linkbtn" data-til-arr>Arrangementer</button> – så tæller det med her.</p>`;
  bindVisning(el);
  el.querySelector('[data-hb-farve]').addEventListener('change', ev => setFarvning(ev.target.checked ? 'hb' : 'status'));
  el.querySelector('[data-til-arr]').addEventListener('click', () => visFane('arrangementer'));
  el.querySelectorAll('tr[data-f]').forEach(tr => {
    const aabn = () => { openForening(tr.dataset.f); visFane('hb'); };
    tr.addEventListener('click', aabn);
    tr.addEventListener('keydown', ev => { if (ev.key === 'Enter') aabn(); });
  });
}

function renderLegend() {
  const hbLag = !layerState.hb ? '' : `<span><svg width="14" height="12" aria-hidden="true"><rect x="1" y="1" width="12" height="10" fill="none" stroke="${HB_FILL.ikke}" stroke-width="2"/><path d="M1 9L7 3M5 11L13 3" stroke="${HB_FILL.ikke}" stroke-width="1.6"/></svg>${esc(HB_STATUS.ikke.label)}</span>`;
  const tegnforklaring = hbLag + (!layerState.punkter ? ''
    : '<span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="#111827"/></svg>Lokal aktivitet</span>'
    + (layerState.landsforeningen ? '<span><svg width="12" height="12" aria-hidden="true"><path d="M6 1L11 6L6 11L1 6Z" fill="#111827"/></svg>Landsforeningen</span>' : ''));
  if (farvning === 'ingen') { $('legend').innerHTML = tegnforklaring; return; }
  if (farvning === 'hb') {
    const brugt = new Set(DATA.lokale.map(f => f.hb));
    $('legend').innerHTML = Object.entries(HB_STATUS).filter(([k]) => brugt.has(k))
      .map(([k, s]) => `<span><span class="swatch" style="background:${HB_FILL[k]};opacity:.8"></span>${esc(s.label)}</span>`).join('')
      + `<span class="muted">Krav: mindst ét afholdt arrangement i hvert kvartal ${HB_AAR - 1}</span>` + tegnforklaring;
    return;
  }
  const kv = valgtKvartal();
  let [labels, fills] = kv ? [kvartalStatus(kv), KVARTAL_FILL] : [STATUS, MAP_FILL];
  if (kv && !DATA.foreninger.some(f => kvStatus(f, kv) === 'ukendt')) { labels = {...labels}; delete labels.ukendt; }
  // Advar, hvis dataindsamlingen ikke dækker hele kvartalet – ellers ser foreninger inaktive ud uden grund.
  let mangler = '';
  if (kv && DATA.dataFra >= new Date(kv.til + 'T00:00:00Z')) mangler = `Ingen data for ${kv.kort} endnu`;
  else if (kv && DATA.dataFra > new Date(kv.fra + 'T12:00:00Z')) mangler = `Data for ${kv.kort} kun fra ${fmtDate.format(DATA.dataFra)}`;
  $('legend').innerHTML = Object.entries(labels)
    .map(([k, s]) => `<span><span class="swatch" style="background:${fills[k]};opacity:.75"></span>${esc(s.label)}</span>`).join('')
    + (mangler ? `<span class="warn">⚠ ${esc(mangler)}</span>` : '')
    + tegnforklaring;
}

// ------------------------------------------------------------------ rettelser af arrangementer
/*
 * data/rettelser.json: {"rettelser": {"<id>": {status?, navn?, forening?, start?, slut?, sted?, deltagere?, note?, manuel?, rettet}}}
 * Rettelser går forud for de hentede Facebook-data (scriptet overskriver aldrig filen). status:
 *   'afholdt'       bekræftet afholdt (eller finder sted), også selvom Facebook siger aflyst/fjernet
 *   'ikke_afholdt'  blev ikke til noget (tælles som aflyst)
 *   'skjult'        ikke et LAU-arrangement / dublet – fjernes helt
 * manuel: true er et arrangement, der ikke ligger på Facebook (id 'm-…'). scripts/hb.py anvender samme regler.
 * Lagring: adminversionens CONFIG.privat.rettelser {hent(), gem(aendringer)}, ellers GitHub (med et token, så
 * rettelsen committes til repoet og ses af alle), ellers kun i denne browser.
 */
const RET = {repo: {}, lokal: {}, data: {}};
try { RET.lokal = JSON.parse(localStorage.getItem('lau-rettelser')) || {}; } catch (_) { /* fx privat vindue */ }
const GH_REPO = 'Irate4147/lau-kort', GH_BRANCH = 'main', GH_STI = 'data/rettelser.json';
const ghConf = () => { try { return JSON.parse(localStorage.getItem('lau-github')); } catch (_) { return null; } };
/** Fletter rettelser; null i b fjerner en rettelse fra a. */
function flet(a, b) {
  const out = {...a};
  for (const [id, r] of Object.entries(b || {})) { if (r) out[id] = r; else delete out[id]; }
  return out;
}

function anvendRettelser(events, rettelser) {
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

// ---- GitHub-lagring (Contents API)

const b64 = tekst => { let s = ''; for (const b of new TextEncoder().encode(tekst)) s += String.fromCharCode(b); return btoa(s); };
const fraB64 = data => new TextDecoder().decode(Uint8Array.from(atob(data.replace(/\s/g, '')), c => c.charCodeAt(0)));
async function gh(conf, sti, init = {}) {
  const r = await fetch('https://api.github.com' + sti, {...init, cache: 'no-store', headers: {
    Accept: 'application/vnd.github+json', Authorization: `Bearer ${conf.token}`, ...(init.headers || {})}});
  return r;
}
async function ghHent(conf) {
  const r = await gh(conf, `/repos/${GH_REPO}/contents/${GH_STI}?ref=${GH_BRANCH}`);
  if (r.status === 404) return {data: {}, sha: null};
  if (!r.ok) throw new Error(`GitHub svarede ${r.status}`);
  const j = await r.json();
  return {data: (JSON.parse(fraB64(j.content)).rettelser) || {}, sha: j.sha};
}
async function ghGem(conf, aendringer, besked) {
  for (let forsoeg = 0; forsoeg < 3; forsoeg++) {
    const {data, sha} = await ghHent(conf); // altid frisk, så samtidige rettelser ikke overskrives
    const ny = flet(data, aendringer);
    const sorteret = Object.fromEntries(Object.keys(ny).sort().map(k => [k, ny[k]]));
    const r = await gh(conf, `/repos/${GH_REPO}/contents/${GH_STI}`, {method: 'PUT', body: JSON.stringify({
      message: besked, branch: GH_BRANCH, ...(sha ? {sha} : {}),
      content: b64(JSON.stringify({rettelser: sorteret}, null, 1) + '\n')})});
    if (r.ok) return ny;
    if (r.status !== 409 && r.status !== 422) throw new Error(r.status === 403 || r.status === 401 ? 'Tokenet har ikke skriveadgang' : `GitHub svarede ${r.status}`);
  }
  throw new Error('Filen blev ændret samtidig – prøv igen');
}

/** Henter de fælles rettelser: fra adminversionen, frisk fra GitHub (hvis forbundet) eller fra data/. */
async function hentRettelser(getData) {
  if (CONFIG.privat && CONFIG.privat.rettelser) return (await CONFIG.privat.rettelser.hent()) || {};
  const conf = ghConf();
  if (conf) { try { return (await ghHent(conf)).data; } catch (_) { /* falder tilbage til data/ */ } }
  return ((await getData('data/rettelser.json')) || {}).rettelser || {};
}
const lagerType = () => (CONFIG.privat && CONFIG.privat.rettelser ? 'privat' : ghConf() ? 'github' : 'lokal');

/** Gemmer rettelser ({id: rettelse | null}) og tegner alt igen. */
async function gemRettelser(aendringer, besked) {
  const type = lagerType();
  if (type === 'lokal') {
    RET.lokal = {...RET.lokal, ...aendringer};
    localStorage.setItem('lau-rettelser', JSON.stringify(RET.lokal));
  } else {
    const alle = {...RET.lokal, ...aendringer}; // lokale rettelser kommer med op ved første fælles gem
    if (type === 'privat') await CONFIG.privat.rettelser.gem(alle);
    RET.repo = type === 'privat' ? flet(RET.repo, alle) : await ghGem(ghConf(), alle, besked);
    RET.lokal = {};
    try { localStorage.removeItem('lau-rettelser'); } catch (_) { /* ignorer */ }
  }
  RET.data = flet(RET.repo, RET.lokal);
  opdater();
}

/** Beregner og tegner alt igen efter en rettelse – uden at flytte kortet. */
function opdater() {
  beregn();
  if (selected && !DATA.byName.has(selected)) selected = null;
  if (MAP.ready) {
    MAP.map.getSource('kom').setData(DATA.geo.kom);
    MAP.map.getSource('events').setData(DATA.geo.events);
  }
  for (const c of MAP.cards.values()) c.remove();
  MAP.cards.clear();
  renderOverview();
  renderLegend();
  if (selected) renderForening(DATA.byName.get(selected));
  if (MAP.ready) setMode(selected, {fit: false});
  renderHB();
  if (FANE === 'arrangementer') renderArrangementer();
}

// ------------------------------------------------------------------ fane: arrangementer

const ARR = {forening: '', filter: 'alle', q: '', aaben: null};
const ARR_STATUS = {
  planlagt:     {label: 'Planlagt', farve: 'var(--accent-light)'},
  bekraeftet:   {label: 'Afholdt – bekræftet', farve: '#1f9d55'},
  afholdt:      {label: 'Afholdt ifølge Facebook', farve: 'var(--accent)'},
  forsvundet:   {label: 'Fjernet fra Facebook', farve: '#9d9b94'},
  aflyst:       {label: 'Aflyst', farve: 'var(--critical)'},
  ikke_afholdt: {label: 'Ikke afholdt', farve: 'var(--critical)'},
  skjult:       {label: 'Skjult', farve: 'var(--grid)'},
};
function arrStatus(e) {
  if (e.skjult) return 'skjult';
  if (e.aflyst) return e.rettelse && e.rettelse.status === 'ikke_afholdt' ? 'ikke_afholdt' : 'aflyst';
  if (e.forsvundet) return 'forsvundet';
  if (e.slutD >= NOW) return 'planlagt';
  return e.bekraeftet ? 'bekraeftet' : 'afholdt';
}
const ARR_FILTRE = {
  alle:        {label: 'Alle (uden skjulte)', vis: e => !e.skjult},
  ubekraeftet: {label: 'Afholdte, ikke bekræftet', vis: e => ['afholdt', 'forsvundet'].includes(arrStatus(e))},
  bekraeftet:  {label: 'Bekræftet afholdt', vis: e => arrStatus(e) === 'bekraeftet'},
  planlagt:    {label: 'Planlagte', vis: e => arrStatus(e) === 'planlagt'},
  ikke:        {label: 'Aflyst / ikke afholdt', vis: e => ['aflyst', 'ikke_afholdt'].includes(arrStatus(e))},
  rettet:      {label: 'Rettede', vis: e => !!e.rettelse},
  manuel:      {label: 'Tilføjet manuelt', vis: e => !!e.manuel},
  skjult:      {label: 'Skjulte', vis: e => !!e.skjult},
};

/** Åbner fanen Arrangementer med ét arrangement klar til redigering. */
function retArrangement(id) {
  Object.assign(ARR, {forening: '', filter: DATA.byId.get(id) && DATA.byId.get(id).skjult ? 'skjult' : 'alle', q: '', aaben: id});
  visFane('arrangementer');
  const li = document.querySelector(`#arr-list li[data-id="${CSS.escape(id)}"]`);
  if (li) li.scrollIntoView({block: 'start'});
}

function renderArrangementer() {
  const el = $('side-arrangementer');
  if (!DATA) return;
  const foreningOpt = sel => DATA.foreninger.map(f => `<option value="${esc(f.navn)}"${sel === f.navn ? ' selected' : ''}>${esc(visningsnavn(f))}</option>`).join('');
  el.innerHTML = `<header class="side-head"><h1>Arrangementer</h1>
      <p class="updated">Ret det, Facebook ikke ved – fx om et arrangement faktisk blev afholdt. Rettelser går forud for de hentede data og tæller med i kort, nøgletal og HB-godkendelse.</p></header>
    <div class="lager" id="lager"></div>
    <div class="arr-filtre">
      <select data-arr="forening" aria-label="Forening"><option value="">Alle foreninger</option>${foreningOpt(ARR.forening)}</select>
      <select data-arr="filter" aria-label="Vis">${Object.entries(ARR_FILTRE).map(([k, v]) => `<option value="${k}"${ARR.filter === k ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
      <input type="search" data-arr="q" placeholder="Søg i titel og sted …" value="${esc(ARR.q)}">
    </div>
    <button class="chip" data-arr-ny>+ Tilføj arrangement</button>
    <div id="arr-ny"></div>
    <p class="note" id="arr-antal"></p>
    <ul class="arrlist" id="arr-list"></ul>`;
  el.querySelectorAll('[data-arr]').forEach(i => i.addEventListener(i.tagName === 'INPUT' ? 'input' : 'change', () => {
    ARR[i.dataset.arr] = i.value;
    renderArrListe();
  }));
  el.querySelector('[data-arr-ny]').addEventListener('click', () => {
    const box = $('arr-ny');
    if (box.firstChild) { box.innerHTML = ''; return; }
    box.appendChild(arrForm(null));
  });
  renderLager();
  renderArrListe();
}

function renderLager() {
  const el = $('lager');
  if (!el) return;
  const type = lagerType(), conf = ghConf(), nLokal = Object.keys(RET.lokal).length;
  const lokalTekst = nLokal ? `<p class="warn">${nLokal} ${nLokal === 1 ? 'rettelse' : 'rettelser'} ligger kun i denne browser.${
    type !== 'lokal' ? ' <button class="linkbtn" data-upload>Gem for alle nu</button>' : ''}</p>` : '';
  if (type === 'privat') { el.innerHTML = '<p class="note">Rettelser gemmes i adminversionen.</p>' + lokalTekst; }
  else if (type === 'github') {
    el.innerHTML = `<p class="note">Gemmes for alle i repoet (<code>${GH_STI}</code>) som <b>${esc(conf.login || '?')}</b>. Andre ser rettelsen inden for få minutter.
      <button class="linkbtn" data-afbryd>Log ud</button></p>` + lokalTekst;
  } else {
    el.innerHTML = `<p class="note">Rettelser gemmes <b>kun i denne browser</b>, indtil du forbinder GitHub.</p>${lokalTekst}
      <details class="gh-forbind"><summary>Gem for alle (forbind GitHub)</summary>
        <p class="note">Opret et <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a>
          med adgang til <code>${GH_REPO}</code> og tilladelsen <i>Contents: Read and write</i>. Tokenet gemmes kun i denne browser.
          Rettelserne bliver offentlige ligesom resten af repoet – skriv ikke persondata i noter.</p>
        <form data-forbind><input type="password" name="token" placeholder="github_pat_…" autocomplete="off" required>
          <button class="chip" type="submit">Forbind</button></form>
        <div class="form-status" aria-live="polite"></div></details>`;
  }
  const up = el.querySelector('[data-upload]');
  if (up) up.addEventListener('click', async () => {
    up.disabled = true;
    try { await gemRettelser({}, 'Rettelser af arrangementer'); } catch (err) { up.disabled = false; alert(err.message); }
  });
  const af = el.querySelector('[data-afbryd]');
  if (af) af.addEventListener('click', () => { localStorage.removeItem('lau-github'); renderLager(); });
  const form = el.querySelector('[data-forbind]');
  if (form) form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const status = el.querySelector('.form-status'), conf = {token: form.token.value.trim()};
    status.textContent = 'Tjekker tokenet …';
    try {
      const r = await gh(conf, `/repos/${GH_REPO}`);
      if (!r.ok) throw new Error(r.status === 404 || r.status === 401 ? 'Tokenet har ikke adgang til repoet' : `GitHub svarede ${r.status}`);
      const repo = await r.json();
      if (!repo.permissions || !repo.permissions.push) throw new Error('Tokenet har ikke skriveadgang til repoet');
      const u = await gh(conf, '/user');
      conf.login = u.ok ? (await u.json()).login : '';
      localStorage.setItem('lau-github', JSON.stringify(conf));
      RET.repo = (await ghHent(conf)).data;
      RET.data = flet(RET.repo, RET.lokal);
      opdater();
    } catch (err) { status.textContent = err.message; }
  });
}

function renderArrListe() {
  const q = ARR.q.trim().toLowerCase();
  const list = DATA.alle
    .filter(e => ARR_FILTRE[ARR.filter].vis(e) && (!ARR.forening || e.foreninger.includes(ARR.forening))
      && (!q || `${e.navn} ${e.sted || ''}`.toLowerCase().includes(q)))
    .sort((a, b) => b.startD - a.startD);
  $('arr-antal').textContent = `${list.length} ${list.length === 1 ? 'arrangement' : 'arrangementer'}`;
  const ul = $('arr-list');
  ul.innerHTML = '';
  let maaned = '';
  for (const e of list) {
    const m = monthKey(e.startD);
    if (m !== maaned) {
      maaned = m;
      const h = document.createElement('li');
      h.className = 'arr-maaned';
      h.textContent = new Intl.DateTimeFormat('da-DK', {month: 'long', year: 'numeric', timeZone: TZ}).format(e.startD);
      ul.appendChild(h);
    }
    ul.appendChild(arrRaekke(e));
  }
}

function arrRaekke(e) {
  const li = document.createElement('li');
  li.dataset.id = e.id;
  const st = arrStatus(e), f = DATA.byName.get(e.forening), fortid = e.slutD < NOW, r = e.rettelse || {};
  const knap = (status, tekst) => `<button class="chip small${r.status === status ? ' on' : ''}" data-status="${status}" aria-pressed="${r.status === status}">${tekst}</button>`;
  li.innerHTML = `<div class="arr-row">
      <div class="date">${esc(fmtDay.format(e.startD))}<br><span class="meta">kl. ${esc(fmtTime.format(e.startD))}</span></div>
      <div>
        <div class="title">${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.navn)}</a>` : esc(e.navn)}${
          e.manuel ? '<span class="badge new">MANUEL</span>' : e.rettelse ? '<span class="badge new">RETTET</span>' : ''}</div>
        <div class="meta">${f ? esc(visningsnavn(f)) : esc(e.forening)} · ${esc(e.sted || 'Sted ikke angivet')}${
          e.fremmoede != null ? ` · ${esc(e.fremmoede)} mødte op` : e.svar != null ? ` · ${esc(e.svar)} tilkendegivelser` : ''}</div>
        ${e.note ? `<div class="meta arr-note">${esc(e.note)}</div>` : ''}
        <div class="arr-status"><span class="dot-inline" style="background:${ARR_STATUS[st].farve}"></span>${esc(ARR_STATUS[st].label)}</div>
        <div class="arr-actions">${fortid ? knap('afholdt', '✓ Afholdt') + knap('ikke_afholdt', '✗ Ikke afholdt') : ''}
          <button class="linkbtn" data-rediger>${ARR.aaben === e.id ? 'Luk' : 'Redigér'}</button></div>
      </div></div>`;
  li.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', async () => {
    const ny = {...r};
    if (ny.status === b.dataset.status) delete ny.status; else ny.status = b.dataset.status;
    b.disabled = true;
    try { await gemRettelser({[e.id]: rensRettelse(ny)}, `Rettelse: ${e.navn}`); }
    catch (err) { b.disabled = false; alert(err.message); }
  }));
  li.querySelector('[data-rediger]').addEventListener('click', () => {
    ARR.aaben = ARR.aaben === e.id ? null : e.id;
    li.replaceWith(arrRaekke(e));
  });
  if (ARR.aaben === e.id) li.appendChild(arrForm(e));
  return li;
}

/** Fjerner tomme felter; null, hvis der ikke er noget tilbage at rette. */
function rensRettelse(r) {
  const out = {};
  for (const [k, v] of Object.entries(r)) if (v != null && v !== '' && k !== 'rettet') out[k] = v;
  if (!Object.keys(out).length || (Object.keys(out).length === 1 && out.manuel)) return null;
  return {...out, rettet: new Date().toISOString().replace(/\.\d+Z$/, 'Z')};
}

// Dansk tid <-> UTC for dato- og tidsfelterne.
const fmtHM = new Intl.DateTimeFormat('en-GB', {hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ});
function tzOffsetMin(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit'}).formatToParts(d).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(d.getTime() / 6e4) * 6e4) / 6e4;
}
function fraDanskTid(dato, tid) {
  const [y, m, d] = dato.split('-').map(Number), [h, mi] = (tid || '12:00').split(':').map(Number);
  const gaet = Date.UTC(y, m - 1, d, h, mi);
  let t = gaet - tzOffsetMin(new Date(gaet)) * 6e4;
  t = gaet - tzOffsetMin(new Date(t)) * 6e4; // rigtig side af sommertidsskiftet
  return new Date(t);
}
const isoZ = d => d.toISOString().replace(/\.\d+Z$/, 'Z');

/** Redigeringsformular for et arrangement (e = null: nyt manuelt arrangement). */
function arrForm(e) {
  const ny = !e, orig = e && !e.manuel ? RAW.byId.get(e.id) : null, r = (e && e.rettelse) || {};
  const form = document.createElement('form');
  form.className = 'arr-form';
  const start = e ? e.startD : null;
  const statusOpt = [
    ...(orig ? [['', `Som på Facebook${orig.aflyst ? ' (aflyst)' : orig.forsvundet ? ' (fjernet)' : ''}`]] : []),
    ['afholdt', 'Afholdt / finder sted'], ['ikke_afholdt', 'Ikke afholdt / aflyst'], ['skjult', 'Skjul – ikke et LAU-arrangement / dublet']];
  const valgt = ny ? 'afholdt' : r.status || (orig ? '' : 'afholdt');
  form.innerHTML = `
    <label>Titel<input name="navn" required value="${esc(e ? e.navn : '')}"></label>
    <label>Forening<select name="forening" required>${ny ? '<option value="">Vælg …</option>' : ''}${DATA.foreninger.map(f =>
      `<option value="${esc(f.navn)}"${(e ? e.forening : ARR.forening) === f.navn ? ' selected' : ''}>${esc(visningsnavn(f))}</option>`).join('')}</select></label>
    <div class="row2"><label>Dato<input type="date" name="dato" required value="${start ? dayKey(start) : ''}"></label>
      <label>Kl.<input type="time" name="tid" value="${start ? fmtHM.format(start) : '19:00'}"></label></div>
    <label>Sted<input name="sted" value="${esc(e ? e.sted || '' : '')}"></label>
    <label>Status<select name="status">${statusOpt.map(([v, t]) => `<option value="${v}"${valgt === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
    <label>Faktisk fremmøde<input type="number" min="0" name="deltagere" value="${r.deltagere ?? ''}" placeholder="Antal"></label>
    <label>Note<textarea name="note" rows="2" placeholder="Offentlig – ingen persondata">${esc(r.note || '')}</textarea></label>
    ${orig ? `<p class="note">Facebook: ${esc(orig.navn)} · ${esc(fmtDate.format(new Date(orig.start)))} kl. ${esc(fmtTime.format(new Date(orig.start)))} · ${esc(orig.sted || 'intet sted')} · ${esc(orig.forening)}</p>` : ''}
    <div class="form-actions"><button class="chip primary" type="submit">Gem</button>
      <button class="linkbtn" type="button" data-annuller>Annullér</button>
      ${e && e.rettelse ? `<button class="linkbtn danger" type="button" data-nulstil>${e.manuel ? 'Slet arrangement' : 'Nulstil til Facebook'}</button>` : ''}</div>
    <div class="form-status" aria-live="polite"></div>`;
  const status = form.querySelector('.form-status');
  const luk = () => { if (ny) $('arr-ny').innerHTML = ''; else { ARR.aaben = null; renderArrListe(); } };
  const gem = async (aendring, besked) => {
    form.querySelectorAll('button').forEach(b => { b.disabled = true; });
    status.textContent = 'Gemmer …';
    try { ARR.aaben = null; await gemRettelser(aendring, besked); }
    catch (err) { status.textContent = err.message; form.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
  };
  form.querySelector('[data-annuller]').addEventListener('click', luk);
  const nulstil = form.querySelector('[data-nulstil]');
  if (nulstil) nulstil.addEventListener('click', () => {
    if (e.manuel && !confirm(`Slet "${e.navn}"?`)) return;
    gem({[e.id]: null}, `${e.manuel ? 'Slet' : 'Nulstil'}: ${e.navn}`);
  });
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    const startD = fraDanskTid(v.dato, v.tid);
    if (isNaN(startD)) { status.textContent = 'Ugyldig dato'; return; }
    const navn = v.navn.trim(), sted = v.sted.trim();
    const felter = {status: v.status || null, deltagere: v.deltagere === '' ? null : +v.deltagere, note: v.note.trim() || null};
    let rettelse, id;
    if (orig) {
      id = e.id;
      const origStart = new Date(orig.start), varighed = new Date(orig.slut || orig.start) - origStart;
      const flyttet = startD.getTime() !== origStart.getTime();
      rettelse = {...felter,
        navn: navn !== orig.navn ? navn : null,
        sted: sted !== (orig.sted || '') ? sted : null,
        forening: v.forening !== orig.forening ? v.forening : null,
        start: flyttet ? isoZ(startD) : null,
        slut: flyttet ? isoZ(new Date(startD.getTime() + varighed)) : null};
    } else {
      id = e ? e.id : 'm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const varighed = e ? e.slutD - e.startD : 2 * 36e5;
      rettelse = {manuel: true, ...felter, navn, sted, forening: v.forening, start: isoZ(startD), slut: isoZ(new Date(startD.getTime() + varighed))};
    }
    gem({[id]: rensRettelse(rettelse)}, `${ny ? 'Nyt arrangement' : 'Rettelse'}: ${navn}`);
  });
  return form;
}

// ------------------------------------------------------------------ start

window.LAU = {registerSection, registerLayer, openForening, closeForening, visFane, CONFIG, get data() { return DATA; }, get map() { return MAP.map; }};

async function main() {
  try {
    await load();
  } catch (err) {
    $('map').innerHTML = `<p class="empty" style="padding:16px">Kunne ikke indlæse data (${esc(err.message)}).</p>`;
    return;
  }
  renderLegend();
  const nat = DATA.byName.get(NATIONAL);
  $('map-actions').innerHTML = (nat ? `<button class="chip" data-f="${NATIONAL}" aria-pressed="false">◆ Landsforeningen</button>` : '')
    + '<button class="chip" id="zoom-reset" hidden>← Hele landet</button>';
  bindForeningLinks($('map-actions'));
  $('zoom-reset').addEventListener('click', closeForening);
  $('back').addEventListener('click', closeForening);
  $('rank-sort').addEventListener('change', renderRank);
  renderOverview();
  addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    if (!$('popover').hidden) closePopover(); else if (selected) closeForening();
  });
  document.querySelectorAll('.side-tabs [data-fane]').forEach(b => b.addEventListener('click', () => visFane(b.dataset.fane)));
  renderVisninger();
  renderHB();
  applyVisning();
  initMap();
}

main();
