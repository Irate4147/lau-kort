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
// Aktivitetsbokse på kortet.
const CW = 184, CH = 56, CGAP = 6, CMARGIN = 10;

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
const weekday = d => (new Date(dayKey(d) + 'T12:00:00Z').getUTCDay() + 6) % 7; // 0 = mandag
const visningsnavn = f => f.national ? 'Landsforeningen' : `LAU ${f.navn}`;
const $ = id => document.getElementById(id);

let DATA = null;
let selected = null;
const MAP = {map: null, ready: false, items: [], cards: new Map()};

// ------------------------------------------------------------------ udvidelsespunkter

const PANEL_SECTIONS = [];
const MAP_LAYERS = [];
const layerState = {};
/** Sektion i foreningspanelet: {id, titel, synlig?(f), render(f) -> html, efter?(el, f)}. */
function registerSection(sec, {efter} = {}) {
  const i = efter ? PANEL_SECTIONS.findIndex(s => s.id === efter) : -1;
  PANEL_SECTIONS.splice(i >= 0 ? i + 1 : PANEL_SECTIONS.length, 0, sec);
}
/**
 * Kortlag: {id, label, toggle, standard, synlig?(ctx), tegn(api, ctx)}.
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

async function load() {
  const get = (base, p) => fetch(base + p, {cache: 'no-cache'}).then(r => { if (!r.ok) throw new Error(p); return r.json(); });
  const getData = p => get(CONFIG.dataBase, p).catch(() => get(CONFIG.assetBase, p));
  const [foreninger, events, meta, topo] = await Promise.all([
    getData('data/foreninger.json'), getData('data/events.json'), getData('data/meta.json'),
    get(CONFIG.assetBase, 'geo/kommuner.topo.json')]);
  const firstRun = meta.koersler.length ? new Date(meta.koersler[0].tid) : NOW;

  for (const e of events) {
    e.startD = new Date(e.start);
    e.slutD = new Date(e.slut || e.start);
    e.firstD = new Date(e.foerst_set);
    e.kat = kategori(e);
    e.ny = NOW - e.firstD < NEW_DAYS * DAY;
    e.foreninger = e.foreninger || [e.forening];
    e.national = e.forening === NATIONAL;
    e.soon = !e.forsvundet && e.slutD >= NOW && e.startD <= H14;
  }
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
    f.sidste = f.afholdt.length ? f.afholdt[f.afholdt.length - 1].startD : null;
    f.naeste = f.planlagt[0] || null;
    f.status = !f.facebook ? 'ingenfb'
      : f.within14.some(e => !e.aflyst) ? 'snart' : f.planlagt.length ? 'planlagt' : 'ingen';
    f.gnsSvar = mean(gyldige.filter(e => e.svar != null).map(e => e.svar));
    // Varsel kan kun måles for aktiviteter opdaget efter dataindsamlingen startede.
    f.varsel = median(gyldige.filter(e => e.firstD - firstRun > DAY).map(e => (e.startD - e.firstD) / DAY));
    if (!f.national) {
      f.merged = topojson.merge(topo, topo.objects.kom.geometries.filter(g => g.properties.forening === f.navn));
      f.bounds = d3.geoBounds(f.merged);
    }
  }
  const features = topojson.feature(topo, topo.objects.kom).features;
  for (const feat of features) feat.properties.status = byName.get(feat.properties.forening).status;
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
  DATA = {foreninger, lokale, events, meta, topo, features, byName, firstRun, geo, byId: new Map(events.map(e => [e.id, e]))};
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

const calloutsEnabled = () => { const el = $('map'); return el.clientWidth >= 820 && el.clientHeight >= 380; };
function mapPadding() {
  const side = calloutsEnabled() ? CW + CMARGIN + 26 : 20;
  return {top: 20, bottom: 20, left: side, right: side};
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
  for (const l of layers) {
    if (l.type !== 'symbol') continue;
    if (/^label_(country|state)/.test(l.id)) map.setLayoutProperty(l.id, 'visibility', 'none');
    else if (/^(label_|water_name|waterway_line_label)/.test(l.id)) {
      map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:da'], ['get', 'name']]);
    }
  }

  map.addSource('kom', {type: 'geojson', data: g.kom});
  map.addSource('inner', {type: 'geojson', data: g.inner});
  map.addSource('border', {type: 'geojson', data: g.border});
  map.addSource('outlines', {type: 'geojson', data: g.outlines});
  map.addSource('flabels', {type: 'geojson', data: g.flabels});
  map.addSource('klabels', {type: 'geojson', data: g.klabels});
  map.addSource('events', {type: 'geojson', data: g.events});
  map.addImage('diamond', diamondImage(), {pixelRatio: 2});

  map.addLayer({id: 'kom-fill', type: 'fill', source: 'kom', paint: {
    'fill-color': ['match', ['get', 'status'], 'snart', MAP_FILL.snart, 'planlagt', MAP_FILL.planlagt, 'ingen', MAP_FILL.ingen, MAP_FILL.ingenfb],
    'fill-opacity': FILL_OPACITY,
  }}, firstRoad);
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
  if (!f) return DATA.events.filter(e => e.soon && DATA.byName.has(e.forening));
  if (f.national) return f.upcoming;
  const nat = DATA.byName.get(NATIONAL);
  const lands = nat ? nat.upcoming.filter(e => e.kommune && f.kommuner.includes(e.kommune) && !f.upcoming.includes(e)) : [];
  return [...f.upcoming, ...lands];
}

function setMode(navn, {animate = true} = {}) {
  const map = MAP.map;
  const f = navn && DATA.byName.get(navn);
  const local = f && !f.national ? f.navn : '';
  map.setFilter('f-selected', ['==', ['get', 'forening'], local]);
  map.setFilter('f-labels', ['!=', ['get', 'forening'], local]);
  map.setPaintProperty('kom-fill', 'fill-opacity', local ? ['case', ['==', ['get', 'forening'], local], 0.55, 0.12] : FILL_OPACITY);

  const list = eventsFor(navn);
  const ids = list.map(e => e.id);
  map.setFilter('ev-local', ['all', ['in', ['get', 'id'], ['literal', ids]], ['!', ['get', 'national']]]);
  map.setFilter('ev-national', ['all', ['in', ['get', 'id'], ['literal', ids]], ['get', 'national']]);
  setCalloutItems(list);

  const bounds = local ? f.bounds : DK_BOUNDS;
  map.fitBounds(bounds, {padding: mapPadding(), duration: animate ? 900 : 0, maxZoom: 11});
  renderLayerToggles();
  drawLayers();
}

// ---- aktivitetsbokse (dato + titel) med streger til stedet

function setCalloutItems(list) {
  MAP.items = [...list].sort((a, b) => a.startD - b.startD);
  for (const [id, card] of MAP.cards) if (!MAP.items.some(e => e.id === id)) { card.remove(); MAP.cards.delete(id); }
  for (const e of MAP.items) {
    if (MAP.cards.has(e.id)) continue;
    const card = document.createElement('div');
    card.className = 'callout' + (e.national ? ' national' : '') + (e.aflyst ? ' cancelled' : '');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.style.width = `${CW}px`;
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
  if (!calloutsEnabled()) {
    for (const c of MAP.cards.values()) c.hidden = true;
    MAP.leaders.innerHTML = '';
    note.hidden = true;
    return;
  }
  const items = [];
  for (const e of MAP.items) {
    let p = null;
    if (e.lat != null && e.lng != null) {
      p = MAP.map.project([e.lng, e.lat]);
      if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue; // uden for udsnittet
    }
    items.push({e, p});
  }
  const cap = Math.max(1, Math.floor((H - 2 * CMARGIN + CGAP) / (CH + CGAP)));
  const shown = items.slice(0, cap * 2);
  let left = shown.filter(i => i.p && i.p.x < W / 2), right = shown.filter(i => i.p && i.p.x >= W / 2);
  for (const it of shown.filter(i => !i.p)) (left.length <= right.length ? left : right).push(it);
  const move = (from, to, pick) => { from.sort(pick); to.push(from.pop()); };
  while (left.length > cap) move(left, right, (a, b) => (a.p ? a.p.x : 0) - (b.p ? b.p.x : 0));
  while (right.length > cap) move(right, left, (a, b) => (b.p ? b.p.x : W) - (a.p ? a.p.x : W));

  const place = col => {
    col.forEach(i => { i.sy = i.p ? i.p.y : H * Math.min(1, (i.e.startD - NOW) / (14 * DAY)); });
    col.sort((a, b) => a.sy - b.sy);
    let y = CMARGIN;
    for (const it of col) { it.y = Math.max(it.sy - CH / 2, y); y = it.y + CH + CGAP; }
    let bottom = H - CMARGIN;
    for (let k = col.length - 1; k >= 0; k--) {
      if (col[k].y + CH > bottom) col[k].y = bottom - CH;
      bottom = col[k].y - CGAP;
    }
  };
  place(left);
  place(right);

  const visible = new Set();
  let paths = '';
  for (const [col, side] of [[left, 'l'], [right, 'r']]) {
    for (const it of col) {
      const x = side === 'l' ? CMARGIN : W - CMARGIN - CW;
      const card = MAP.cards.get(it.e.id);
      card.hidden = false;
      card.style.left = `${x}px`;
      card.style.top = `${it.y}px`;
      card.style.height = `${CH}px`;
      visible.add(it.e.id);
      if (it.p) {
        const edge = side === 'l' ? x + CW : x, elbow = side === 'l' ? edge + 10 : edge - 10, my = it.y + CH / 2;
        paths += `<path class="leader${MAP.hoverId === it.e.id ? ' hover' : ''}" d="M${edge},${my}H${elbow}L${it.p.x.toFixed(1)},${it.p.y.toFixed(1)}"/>`;
      }
    }
  }
  for (const [id, card] of MAP.cards) if (!visible.has(id)) card.hidden = true;
  MAP.leaders.innerHTML = paths;
  const skjult = items.length - shown.length;
  note.hidden = !skjult;
  note.textContent = skjult ? `+ ${skjult} flere – se listen til venstre` : '';
}

// ---- popover med detaljer for én aktivitet

function openPopover(e, {card, x, y}) {
  const pop = $('popover');
  const wrap = document.querySelector('.map-wrap').getBoundingClientRect();
  const f = DATA.byName.get(e.forening);
  const svar = e.svar != null ? `<div class="pop-meta">${e.deltager ?? 0} deltager · ${e.interesserede ?? 0} interesserede</div>` : '';
  pop.innerHTML = `<button class="close-pop" aria-label="Luk">×</button>
    <div class="pop-title">${esc(e.navn)}${e.aflyst ? ' <span class="badge cancel">AFLYST</span>' : ''}</div>
    <div class="pop-meta">${esc(fmtDay.format(e.startD))} kl. ${esc(fmtTime.format(e.startD))}</div>
    <div class="pop-meta">${esc(e.sted || 'Sted ikke angivet')}</div>${svar}
    <div class="pop-actions">${f ? `<button class="chip" data-f="${esc(f.navn)}">${esc(visningsnavn(f))}</button>` : ''}
      <a href="${esc(e.url)}" target="_blank" rel="noopener">Se på Facebook ↗</a></div>`;
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

function renderLayerToggles() {
  const el = $('layer-toggles');
  const f = selected && DATA.byName.get(selected);
  const ctx = {selected, zoomed: !!(f && !f.national)};
  const toggles = MAP_LAYERS.filter(l => l.toggle && (!l.synlig || l.synlig(ctx)));
  el.innerHTML = toggles.map(l => `<label><input type="checkbox" data-layer="${esc(l.id)}"${layerState[l.id] ? ' checked' : ''}> ${esc(l.label)}</label>`).join('');
  el.querySelectorAll('input').forEach(i => i.addEventListener('change', () => { layerState[i.dataset.layer] = i.checked; drawLayers(); }));
}

const pointsFC = list => ({type: 'FeatureCollection', features: list.filter(e => e.lat != null && e.lng != null)
  .map(e => ({type: 'Feature', properties: {id: e.id}, geometry: {type: 'Point', coordinates: [e.lng, e.lat]}}))});

// Indbyggede kortlag.
registerLayer({
  id: 'kommunenavne', label: 'Kommunenavne', toggle: true, standard: true,
  synlig: ctx => ctx.zoomed,
  tegn(api, ctx) {
    api.layer({id: 'txt', type: 'symbol', source: 'klabels', filter: ['==', ['get', 'forening'], ctx.selected], layout: {
      'text-field': ['get', 'navn'], 'text-font': FONT_ITALIC, 'text-size': ['interpolate', ['linear'], ['zoom'], 7, 12, 11, 15],
      'text-letter-spacing': 0.04, 'text-max-width': 8}, paint: {
      'text-color': '#334155', 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.8, 'text-halo-blur': 0.3}});
  },
});
registerLayer({
  id: 'afholdte', label: 'Afholdte aktiviteter', toggle: true, standard: false,
  tegn(api, ctx) {
    const list = ctx.selected ? DATA.byName.get(ctx.selected).afholdt : DATA.events.filter(e => !e.forsvundet && !e.aflyst && e.slutD < NOW);
    const src = api.source('pts', pointsFC(list));
    api.layer({id: 'dots', type: 'circle', source: src, paint: {
      'circle-radius': 4.5, 'circle-color': '#ffffff', 'circle-stroke-color': '#111827', 'circle-stroke-width': 1.8}});
  },
});
registerLayer({
  // Eksempel på et privat lag: vises kun, hvis adminversionen leverer medlemstal pr. by.
  id: 'medlemmer', label: 'Medlemmer pr. by', toggle: true, standard: false,
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
  showTip(ev, [visningsnavn(f), STATUS[f.status].label, next]);
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
    <div><a class="title" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.navn)}</a>${
      e.aflyst ? '<span class="badge cancel">AFLYST</span>' : ''}${e.ny && !e.aflyst ? '<span class="badge new">NY</span>' : ''}
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
  const {lokale, events, meta, firstRun, foreninger} = DATA;
  const soon = events.filter(e => e.soon && DATA.byName.has(e.forening)).sort((a, b) => a.startD - b.startD);
  const planlagt = events.filter(e => !e.forsvundet && !e.aflyst && e.slutD >= NOW).length;
  const medPlan = lokale.filter(f => f.planlagt.length).length;
  const afholdt = events.filter(e => !e.forsvundet && !e.aflyst && e.slutD < NOW).length;

  $('tiles').innerHTML =
    tile('Aktiviteter de næste 14 dage', String(soon.filter(e => !e.aflyst).length), null, true)
    + tile('Planlagte aktiviteter', String(planlagt), 'Inkl. landsforeningens')
    + tile('Lokalforeninger med planer', `${medPlan} af ${lokale.length}`, `${lokale.filter(f => !f.facebook).length} uden Facebook-side`)
    + tile('Afholdte registreret', String(afholdt), `Siden ${fmtDate.format(firstRun)}`);

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
    + `Facebook viser kun kommende begivenheder, så afholdte aktiviteter tælles fra ${fmtDate.format(firstRun)}, og historikken vokser uge for uge. `
    + '"Tilkendegivelser" er "deltager" + "interesseret" på Facebook ved seneste måling. Aktivitetstyper inddeles automatisk ud fra titel og beskrivelse. '
    + 'Kort: © OpenStreetMap-bidragydere, OpenFreeMap.';
}

const RANK = {
  naeste: {val: f => f.naeste ? +f.naeste.startD : Infinity, dir: 1, vis: f => f.planlagt.length},
  navn: {val: f => (f.national ? '0' : '1') + f.navn, dir: 1, vis: f => f.planlagt.length},
  planlagt: {val: f => f.planlagt.length, dir: -1, vis: f => f.planlagt.length},
  afholdt90: {val: f => f.afholdt90.length, dir: -1, vis: f => f.afholdt90.length},
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
    <span class="dot" style="background:${MAP_FILL[f.status]}" title="${esc(STATUS[f.status].label)}"></span>
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
  id: 'aar', titel: 'Aktiviteter det seneste år',
  render(f) {
    const startKey = monthKey(DATA.firstRun);
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
        f.sidste ? `Senest ${fmtDate.format(f.sidste)}` : `Ingen afholdt siden ${fmtDate.format(DATA.firstRun)}`)}
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

  const body = $('forening-body');
  body.innerHTML = `
    <h2 class="fname">${esc(visningsnavn(f))}</h2>
    ${statusPill(f.status)}
    <div class="kommuner">${f.national ? 'Arrangementer i hele landet' : `Dækker ${esc(f.kommuner.join(', '))}`}</div>
    ${f.facebook ? `<a class="fb" href="${esc(f.facebook)}" target="_blank" rel="noopener">Facebook-side ↗</a>`
      : '<p class="empty">Ingen Facebook-side tilknyttet endnu, så aktiviteter kan ikke hentes automatisk.</p>'}`;
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
  $('side-overview').hidden = true;
  $('side-forening').hidden = false;
  $('sidebar').scrollTop = 0;
  document.querySelectorAll('.chip[data-f]').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.f === navn)));
  $('zoom-reset').hidden = false;
  history.replaceState(null, '', '#' + encodeURIComponent(navn));
  if (MAP.ready) setMode(navn, {animate});
}

function closeForening() {
  selected = null;
  closePopover();
  $('side-forening').hidden = true;
  $('side-overview').hidden = false;
  document.querySelectorAll('.chip[data-f]').forEach(c => c.setAttribute('aria-pressed', 'false'));
  $('zoom-reset').hidden = true;
  history.replaceState(null, '', location.pathname + location.search);
  if (MAP.ready) setMode(null);
}

function renderLegend() {
  $('legend').innerHTML = Object.entries(STATUS)
    .map(([k, s]) => `<span><span class="swatch" style="background:${MAP_FILL[k]};opacity:.75"></span>${esc(s.label)}</span>`).join('')
    + '<span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="#111827"/></svg>Lokal aktivitet</span>'
    + '<span><svg width="12" height="12" aria-hidden="true"><path d="M6 1L11 6L6 11L1 6Z" fill="#111827"/></svg>Landsforeningen</span>';
}

// ------------------------------------------------------------------ start

window.LAU = {registerSection, registerLayer, openForening, closeForening, CONFIG, get data() { return DATA; }, get map() { return MAP.map; }};

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
  initMap();
  renderLayerToggles();
}

main();
