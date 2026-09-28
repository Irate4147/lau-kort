'use strict';
/*
 * LAU-kortet. Opbygning:
 *  - CONFIG:          kan overskrives med window.LAU_CONFIG (fx af en privat adminversion).
 *  - PANEL_SECTIONS:  sektionerne i foreningspanelet. Nye sektioner tilføjes med LAU.registerSection().
 *  - MAP_LAYERS:      lag på kortet (med eller uden til/fra-knap). Nye lag tilføjes med LAU.registerLayer().
 *  - CONFIG.privat:   valgfri leverandør af fortrolige data (noter, stamdata, medlemstal) til adminversionen.
 * Se README.md for detaljer.
 */

// ------------------------------------------------------------------ konfiguration

const CONFIG = Object.assign({
  mode: 'public',
  // Data læses fra GitHub-repoet, så de er friske, selv før Pages er genudgivet.
  dataBase: location.hostname.endsWith('github.io') ? 'https://raw.githubusercontent.com/Irate4147/lau-kort/main/' : '',
  assetBase: '',
  privat: null,
}, window.LAU_CONFIG || {});

const TZ = 'Europe/Copenhagen';
const DAY = 864e5;
const NOW = new Date();
const H14 = new Date(NOW.getTime() + 14 * DAY);
const NEW_DAYS = 7;
const NATIONAL = 'Landsforeningen';
// Foreninger der vises i Storkøbenhavn-indsatsen i oversigten.
const KBH_FORENINGER = new Set(['København', 'Frederiksberg', 'Vestegnen', 'Nordkøbenhavn']);
const KBH_BOX = [[12.24, 55.565], [12.65, 55.815]]; // lon/lat
// Håndplacerede navne, hvor tyngdepunktet giver overlap (Frederiksberg ligger inde i København).
const LABEL_AT = {'København': [12.578, 55.643], 'Frederiksberg': [12.515, 55.692]};
const STATUS = {
  snart:    {label: 'Aktivitet inden for 14 dage', fill: 'var(--accent)'},
  planlagt: {label: 'Aktiviteter planlagt senere', fill: 'var(--accent-light)'},
  ingen:    {label: 'Intet planlagt', fill: 'var(--none)'},
  ingenfb:  {label: 'Ingen Facebook-side tilknyttet', fill: 'var(--nofb)'},
};
const KATEGORIER = [
  ['Foreningsmøde', /bestyrelsesm|generalforsamling|medlemsm|intro ?m|årsm|stiftende|velkomst|nye medlemmer|workshop|organisatorisk/i],
  ['Kampagne', /kampagne|\bstand\b|uddel|plakat|dør.til.dør|happening|valgkamp|flyer/i],
  ['Oplæg & debat', /oplæg|debat|keynote|foredrag|panel|ordfører|folketing|minister|besøg af|bogturn|webinar|diskussion|samtale|kursus|seminar|studiekreds|læsekreds|landsmøde/i],
  ['Socialt', /fredagsbar|fredagscaf|hygge|brætspil|\bfest|julefrokost|\bøl\b|\bbar\b|quiz|minigolf|\bspil|middag|bowling|grill|besøger|\btur\b|ekskursion|indvielse|reception|tag med|biograf|koncert|pizza/i],
];
const KAT_NAVNE = [...KATEGORIER.map(k => k[0]), 'Andet'];
const UGEDAGE = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];

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

let DATA = null;
let selected = null;
const MAP = {};
const layerState = {};

// ------------------------------------------------------------------ udvidelsespunkter

const PANEL_SECTIONS = [];
const MAP_LAYERS = [];
/** Sektion i foreningspanelet: {id, titel, synlig?(f), render(f) -> html, efter?(el, f)}. */
function registerSection(sec, {efter} = {}) {
  const i = efter ? PANEL_SECTIONS.findIndex(s => s.id === efter) : -1;
  PANEL_SECTIONS.splice(i >= 0 ? i + 1 : PANEL_SECTIONS.length, 0, sec);
}
/** Kortlag: {id, label, toggle, standard, synlig?(), tegn(g, ctx)} – ctx = {k, selected, proj}. */
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
    if (!f.national) f.merged = topojson.merge(topo, topo.objects.kom.geometries.filter(g => g.properties.forening === f.navn));
  }
  const features = topojson.feature(topo, topo.objects.kom).features;
  const lokale = foreninger.filter(f => !f.national);
  DATA = {foreninger, lokale, events, meta, topo, features, byName, firstRun};
}

function kategori(e) {
  for (const text of [e.navn, e.beskrivelse || '']) {
    for (const [k, re] of KATEGORIER) if (re.test(text)) return k;
  }
  return 'Andet';
}

// ------------------------------------------------------------------ kort

function largestPolygon(geom) {
  if (geom.type === 'Polygon') return geom;
  let best = null, bestA = -1;
  for (const coords of geom.coordinates) {
    const p = {type: 'Polygon', coordinates: coords}, a = d3.geoArea(p);
    if (a > bestA) { bestA = a; best = p; }
  }
  return best;
}

function inBox([lng, lat], box) {
  return lng >= box[0][0] && lng <= box[1][0] && lat >= box[0][1] && lat <= box[1][1];
}

function renderMap() {
  const el = document.getElementById('map');
  const card = el.closest('.map-card');
  const compact = el.clientWidth < 900;
  card.classList.toggle('compact', compact);

  const W = compact ? 720 : 1200, H = 700;
  const mapX = compact ? 0 : 250, mapW = compact ? 720 : 700;
  const mainW = Math.round(mapW * 0.74);
  const insetX = mapX + mainW + 14, insetW = mapW - mainW - 20;
  const {features, lokale, byName, topo} = DATA;

  const mainland = {type: 'FeatureCollection', features: features.filter(f => f.properties.navn !== 'Bornholm')};
  const bornholm = features.find(f => f.properties.navn === 'Bornholm');
  const kbhPoly = {type: 'Polygon', coordinates: [[
    KBH_BOX[0], [KBH_BOX[0][0], KBH_BOX[1][1]], KBH_BOX[1], [KBH_BOX[1][0], KBH_BOX[0][1]], KBH_BOX[0]]]};
  const bBox = {x: insetX, y: 30, w: insetW, h: 110};
  const kBox = {x: insetX, y: 262, w: insetW, h: insetW + 20};
  const proj = d3.geoMercator().fitExtent([[mapX + 6, 8], [mapX + mainW, H - 8]], mainland);
  const views = {
    born: {proj: d3.geoMercator().fitExtent([[bBox.x + 10, bBox.y + 10], [bBox.x + bBox.w - 10, bBox.y + bBox.h - 10]], bornholm), box: bBox, title: 'Bornholm', feats: [bornholm]},
    kbh: {proj: d3.geoMercator().fitExtent([[kBox.x + 1, kBox.y + 1], [kBox.x + kBox.w - 1, kBox.y + kBox.h - 1]], kbhPoly), box: kBox, title: 'Storkøbenhavn', feats: features},
  };
  const path = d3.geoPath(proj);
  Object.assign(MAP, {W, H, mapX, mainW, compact, proj, path, views, k: 1});

  const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`)
    .attr('role', 'img').attr('aria-label', 'Kort over LAU-lokalforeninger farvet efter planlagte aktiviteter');
  const defs = svg.append('defs');
  const obj = topo.objects.kom;
  const innerMesh = topojson.mesh(topo, obj, (a, b) => a !== b && a.properties.forening === b.properties.forening);
  const borderMesh = topojson.mesh(topo, obj, (a, b) => a.properties.forening !== b.properties.forening);

  const drawRegions = (g, p, feats) => {
    g.selectAll('path.kom').data(feats).join('path')
      .attr('class', d => 'kom' + (d.properties.navn === 'Bornholm' ? ' kom-bornholm' : ''))
      .attr('data-f', d => d.properties.forening).attr('d', p)
      .style('fill', d => STATUS[byName.get(d.properties.forening).status].fill)
      .on('mouseenter', (ev, d) => hoverForening(d.properties.forening, ev))
      .on('mousemove', ev => moveTip(ev))
      .on('mouseleave', () => hoverForening(null))
      .on('click', (ev, d) => openForening(d.properties.forening));
    g.append('path').attr('class', 'kom-inner').attr('d', p(innerMesh));
    g.append('path').attr('class', 'forening-border').attr('d', p(borderMesh));
    g.selectAll('path.outline').data(lokale).join('path')
      .attr('class', 'outline').attr('data-f', f => f.navn).attr('d', f => p(f.merged));
  };

  // Hovedkortet: alle kommuner (også Bornholm, som kun ses, når der er zoomet ind).
  const zoomG = svg.append('g').attr('class', 'zoom');
  drawRegions(zoomG, path, features);
  const labelG = zoomG.append('g').attr('class', 'labels');
  for (const f of lokale) {
    const c = LABEL_AT[f.navn] || d3.geoCentroid(largestPolygon(f.merged));
    const view = f.navn === 'Bornholm' ? 'born' : KBH_FORENINGER.has(f.navn) ? 'kbh' : 'main';
    f.anchor = {view, xy: (view === 'main' ? proj : views[view].proj)(c)};
    f.labelXY = proj(c);
    labelG.append('text').attr('class', 'region-label' + (view === 'main' ? '' : ' only-zoomed'))
      .attr('data-f', f.navn).attr('x', f.labelXY[0]).attr('y', f.labelXY[1] + 4).text(f.navn);
  }
  const layersG = zoomG.append('g').attr('class', 'layers');

  // Oversigtslaget: indsatser, pile og aktivitetsbokse (skjules ved zoom).
  const overlay = svg.append('g').attr('class', 'overlay');
  for (const [key, v] of Object.entries(views)) {
    const id = `clip-${key}`;
    defs.append('clipPath').attr('id', id).append('rect')
      .attr('x', v.box.x).attr('y', v.box.y).attr('width', v.box.w).attr('height', v.box.h);
    const g = overlay.append('g').attr('clip-path', `url(#${id})`);
    drawRegions(g, d3.geoPath(v.proj), v.feats);
    if (key === 'kbh') {
      for (const f of lokale.filter(x => KBH_FORENINGER.has(x.navn))) {
        g.append('text').attr('class', 'region-label').attr('x', f.anchor.xy[0]).attr('y', f.anchor.xy[1] + 4).text(f.navn);
      }
    }
    overlay.append('rect').attr('class', 'inset-frame')
      .attr('x', v.box.x).attr('y', v.box.y).attr('width', v.box.w).attr('height', v.box.h).attr('rx', 4);
    overlay.append('text').attr('class', 'inset-title').attr('x', v.box.x).attr('y', v.box.y - 6).text(v.title);
  }
  const [[x0, y1], [x1, y0]] = [proj(KBH_BOX[0]), proj(KBH_BOX[1])];
  overlay.append('rect').attr('class', 'inset-marker').attr('x', x0).attr('y', y0).attr('width', x1 - x0).attr('height', y1 - y0);

  // Aktiviteter de næste 14 dage (lokale og landsforeningens).
  const soon = DATA.events.filter(e => !e.forsvundet && e.slutD >= NOW && e.startD <= H14 && byName.has(e.forening));
  const items = soon.map(e => {
    const f = byName.get(e.forening);
    let xy = f.national ? null : f.anchor.xy;
    if (e.lat != null && e.lng != null) {
      const ll = [e.lng, e.lat];
      xy = inBox(ll, KBH_BOX) ? views.kbh.proj(ll) : e.lng > 14.5 ? views.born.proj(ll) : proj(ll);
    }
    return {e, f, ax: xy ? xy[0] : null, ay: xy ? xy[1] : null};
  });
  const anchors = overlay.append('g');
  if (compact) {
    for (const it of items.filter(i => i.ax != null)) drawAnchor(anchors, it);
    renderCompactList(soon);
  } else {
    placeCallouts(overlay, anchors, items);
  }

  Object.assign(MAP, {svg, zoomG, labelG, layersG, overlay});
  el.replaceChildren(svg.node());
  const f = selected && byName.get(selected);
  applyZoom(f && !f.national ? f : null, false);
}

function drawAnchor(g, it) {
  if (it.f.national) {
    g.append('path').attr('class', 'anchor national').attr('data-ev', `ev-${it.e.id}`)
      .attr('transform', `translate(${it.ax},${it.ay})`).attr('d', d3.symbol(d3.symbolDiamond, 90)());
  } else {
    g.append('circle').attr('class', 'anchor').attr('data-ev', `ev-${it.e.id}`).attr('cx', it.ax).attr('cy', it.ay).attr('r', 4.5);
  }
}

function placeCallouts(svg, anchors, items) {
  const {W, H, mapX, mainW} = MAP;
  const CW = 228, CH = 58, GAP = 8, M = 8;
  const cap = Math.floor((H - 2 * M + GAP) / (CH + GAP));
  const sorted = [...items].sort((a, b) => a.e.startD - b.e.startD);
  const shown = sorted.slice(0, cap * 2);
  const hidden = sorted.length - shown.length;
  const mid = mapX + mainW * 0.55;
  // Uden sted: placeres i den kolonne med færrest bokse, sorteret efter dato.
  let left = shown.filter(i => i.ax != null && i.ax < mid), right = shown.filter(i => i.ax != null && i.ax >= mid);
  for (const it of shown.filter(i => i.ax == null)) (left.length <= right.length ? left : right).push(it);
  const move = (from, to, pick) => { from.sort(pick); to.push(from.pop()); };
  while (left.length > cap) move(left, right, (a, b) => (a.ax ?? 0) - (b.ax ?? 0));
  while (right.length > cap) move(right, left, (a, b) => (b.ax ?? W) - (a.ax ?? W));

  const place = col => {
    col.forEach(i => { i.sortY = i.ay ?? (H * (i.e.startD - NOW) / (14 * DAY)); });
    col.sort((a, b) => a.sortY - b.sortY);
    let y = M;
    for (const it of col) { it.y = Math.max(it.sortY - CH / 2, y); y = it.y + CH + GAP; }
    let bottom = H - M - (hidden && col === right ? 18 : 0);
    for (let k = col.length - 1; k >= 0; k--) {
      if (col[k].y + CH > bottom) col[k].y = bottom - CH;
      bottom = col[k].y - GAP;
    }
  };
  place(left);
  place(right);

  const draw = (col, side) => {
    for (const it of col) {
      const x = side === 'left' ? 10 : W - 10 - CW;
      const edge = side === 'left' ? x + CW : x;
      const elbow = side === 'left' ? edge + 10 : edge - 10;
      const my = it.y + CH / 2;
      const id = `ev-${it.e.id}`;
      if (it.ax != null) {
        anchors.append('path').attr('class', 'leader').attr('data-ev', id)
          .attr('d', `M${edge},${my}H${elbow}L${it.ax},${it.ay}`);
        drawAnchor(anchors, it);
      }
      const fo = svg.append('foreignObject').attr('x', x).attr('y', it.y).attr('width', CW).attr('height', CH);
      const div = document.createElement('div');
      div.className = 'callout' + (it.e.aflyst ? ' cancelled' : '') + (it.f.national ? ' national' : '');
      div.tabIndex = 0;
      div.setAttribute('role', 'button');
      div.innerHTML = `<div><span class="when">${esc(fmtDay.format(it.e.startD))} ${esc(fmtTime.format(it.e.startD))}</span>`
        + ` <span class="who">· ${esc(it.f.national ? '◆ Landsforeningen' : it.f.navn)}</span>${it.e.aflyst ? ' <span class="badge cancel">AFLYST</span>' : ''}</div>`
        + `<div class="what">${esc(it.e.navn)}</div>`;
      div.addEventListener('click', () => openForening(it.f.navn));
      div.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openForening(it.f.navn); } });
      div.addEventListener('mouseenter', () => { hoverForening(it.f.navn); anchors.selectAll(`[data-ev="${id}"]`).classed('hover', true); });
      div.addEventListener('mouseleave', () => { hoverForening(null); anchors.selectAll(`[data-ev="${id}"]`).classed('hover', false); });
      fo.node().appendChild(div);
    }
  };
  draw(left, 'left');
  draw(right, 'right');
  if (!items.length) {
    svg.append('text').attr('class', 'more-note').attr('x', 10).attr('y', 24).text('Ingen aktiviteter de næste 14 dage.');
  }
  if (hidden) {
    svg.append('text').attr('class', 'more-note').attr('x', W - 10).attr('y', H - 10).attr('text-anchor', 'end')
      .text(`+ ${hidden} flere – se listen nedenfor`);
  }
}

/** Det synlige kortområde i SVG-koordinater (panelet dækker højre side / bunden af skærmen). */
function visibleBox() {
  const {W, H, svg} = MAP;
  const r = svg.node().getBoundingClientRect();
  const s = r.width / W || 1;
  const top = MAP.viewTop ?? r.top; // forventet placering efter evt. rulning
  const drawer = document.getElementById('drawer');
  const open = drawer.classList.contains('open');
  const narrow = innerWidth <= 760;
  let right = W;
  if (!narrow && open) right = Math.min(W, (innerWidth - drawer.offsetWidth - r.left) / s);
  const bottomPx = innerHeight - (narrow && open ? drawer.offsetHeight : 0);
  const y0 = Math.max(0, -top / s) + 20;
  const y1 = Math.min(H, (bottomPx - top) / s) - 20;
  return {x0: 20, y0, x1: Math.max(260, right - 20), y1: Math.max(y0 + 150, y1)};
}

/** Zoom ind på en lokalforening (eller ud til hele landet med f = null). */
function applyZoom(f, animate = true) {
  let k = 1, tx = 0, ty = 0;
  if (f) {
    const [[x0, y0], [x1, y1]] = MAP.path.bounds(f.merged);
    const b = visibleBox();
    k = Math.min(14, 0.9 * Math.min((b.x1 - b.x0) / (x1 - x0), (b.y1 - b.y0) / (y1 - y0)));
    tx = (b.x0 + b.x1) / 2 - k * (x0 + x1) / 2;
    ty = (b.y0 + b.y1) / 2 - k * (y0 + y1) / 2;
  }
  MAP.k = k;
  MAP.focus = f ? f.navn : null;
  const zoomed = !!f;
  const root = d3.select(MAP.svg.node()).classed('zoomed', zoomed);
  root.selectAll('.kom').classed('dim', function () { return zoomed && this.dataset.f !== f.navn; });
  const t = animate ? d3.transition().duration(750).ease(d3.easeCubicInOut) : null;
  const sel = x => (t ? x.transition(t) : x);
  sel(MAP.zoomG).attr('transform', `translate(${tx},${ty}) scale(${k})`);
  sel(MAP.overlay).style('opacity', zoomed ? 0 : 1);
  MAP.overlay.style('pointer-events', zoomed ? 'none' : null);
  MAP.labelG.selectAll('text').style('font-size', `${11 / k}px`).style('stroke-width', `${3 / k}px`)
    .style('display', function () { return zoomed && this.dataset.f === f.navn ? 'none' : null; });
  document.getElementById('zoom-reset').hidden = !zoomed;
  renderLayerToggles();
  drawLayers();
}

function drawLayers() {
  if (!MAP.layersG) return;
  MAP.layersG.selectAll('*').remove();
  const ctx = {k: MAP.k, selected: MAP.focus, proj: MAP.proj, zoomed: MAP.k > 1};
  for (const layer of MAP_LAYERS) {
    if (layer.synlig && !layer.synlig(ctx)) continue;
    if (layer.toggle && !layerState[layer.id]) continue;
    layer.tegn(MAP.layersG.append('g').attr('class', `layer layer-${layer.id}`), ctx);
  }
}

function renderLayerToggles() {
  const el = document.getElementById('layer-toggles');
  const ctx = {k: MAP.k, selected: MAP.focus, zoomed: MAP.k > 1};
  const toggles = MAP_LAYERS.filter(l => l.toggle && (!l.synlig || l.synlig(ctx)));
  el.innerHTML = toggles.map(l => `<label><input type="checkbox" data-layer="${esc(l.id)}"${layerState[l.id] ? ' checked' : ''}> ${esc(l.label)}</label>`).join('');
  el.querySelectorAll('input').forEach(i => i.addEventListener('change', () => { layerState[i.dataset.layer] = i.checked; drawLayers(); }));
}

function eventDot(g, e, {k, hollow}) {
  if (e.lat == null || e.lng == null) return;
  const [x, y] = MAP.proj([e.lng, e.lat]);
  const national = e.forening === NATIONAL;
  const node = national
    ? g.append('path').attr('transform', `translate(${x},${y}) scale(${1 / k})`).attr('d', d3.symbol(d3.symbolDiamond, 110)())
    : g.append('circle').attr('cx', x).attr('cy', y).attr('r', 5.5 / k);
  node.attr('class', 'ev-dot' + (hollow ? ' hollow' : '') + (national ? ' national' : ''))
    .style('stroke-width', national ? '2px' : `${2 / k}px`)
    .on('mouseenter', ev => showTip(ev, [e.navn, `${fmtDay.format(e.startD)} kl. ${fmtTime.format(e.startD)}`,
      `${national ? 'Landsforeningen' : 'LAU ' + e.forening} · ${e.sted || 'Sted ikke angivet'}`]))
    .on('mousemove', moveTip).on('mouseleave', hideTip)
    .on('click', () => window.open(e.url, '_blank', 'noopener'));
}

// Indbyggede kortlag.
registerLayer({
  id: 'kommunenavne', label: 'Kommunenavne', toggle: true, standard: true,
  synlig: ctx => ctx.zoomed,
  tegn(g, {k, selected: navn}) {
    if (!navn) return;
    for (const feat of DATA.features.filter(d => d.properties.forening === navn)) {
      const [x, y] = MAP.proj(d3.geoCentroid(largestPolygon(feat.geometry)));
      g.append('text').attr('class', 'kommune-label').attr('x', x).attr('y', y)
        .style('font-size', `${11 / k}px`).style('stroke-width', `${3 / k}px`).text(feat.properties.navn);
    }
  },
});
registerLayer({
  id: 'afholdte', label: 'Afholdte aktiviteter', toggle: true, standard: false,
  tegn(g, ctx) {
    const list = ctx.selected ? DATA.byName.get(ctx.selected).afholdt : DATA.events.filter(e => !e.forsvundet && !e.aflyst && e.slutD < NOW);
    for (const e of list) eventDot(g, e, {k: ctx.k, hollow: true});
  },
});
registerLayer({
  id: 'kommende', label: 'Kommende aktiviteter', toggle: false,
  synlig: ctx => ctx.zoomed,
  tegn(g, ctx) {
    const f = DATA.byName.get(ctx.selected);
    const national = DATA.byName.get(NATIONAL);
    // Foreningens egne + landsforeningens arrangementer i området.
    const egne = f.upcoming.filter(e => !e.aflyst);
    const lands = national ? national.upcoming.filter(e => !e.aflyst && e.kommune && f.kommuner.includes(e.kommune) && !egne.includes(e)) : [];
    for (const e of [...lands, ...egne]) eventDot(g, e, {k: ctx.k});
  },
});
registerLayer({
  // Eksempel på et privat lag: vises kun, hvis adminversionen leverer medlemstal pr. by.
  id: 'medlemmer', label: 'Medlemmer pr. by', toggle: true, standard: false,
  synlig: () => !!(CONFIG.privat && CONFIG.privat.medlemmer),
  tegn(g, ctx) {
    const rows = CONFIG.privat.medlemmer.filter(r => !ctx.selected || r.forening === ctx.selected);
    const max = d3.max(rows, r => r.antal) || 1;
    for (const r of rows) {
      const [x, y] = MAP.proj([r.lng, r.lat]);
      g.append('circle').attr('class', 'member-dot').attr('cx', x).attr('cy', y)
        .attr('r', (4 + 16 * Math.sqrt(r.antal / max)) / ctx.k).style('stroke-width', `${1.5 / ctx.k}px`)
        .on('mouseenter', ev => showTip(ev, [r.by, `${r.antal} medlemmer`])).on('mousemove', moveTip).on('mouseleave', hideTip);
    }
  },
});

function renderCompactList(soon) {
  const el = document.getElementById('upcoming-compact');
  el.innerHTML = `<h3>De næste 14 dage</h3>${evList(soon.sort((a, b) => a.startD - b.startD), true)}`;
  bindForeningLinks(el);
}

function hoverForening(navn, ev) {
  d3.selectAll('.outline').classed('hover', function () { return this.dataset.f === navn; });
  if (!navn) return hideTip();
  if (!ev) return;
  const f = DATA.byName.get(navn);
  const next = f.naeste ? `Næste: ${fmtDay.format(f.naeste.startD)} – ${f.naeste.navn}` : 'Ingen planlagte aktiviteter';
  showTip(ev, [visningsnavn(f), STATUS[f.status].label, next]);
}

function markSelected(navn) {
  d3.selectAll('.outline').classed('selected', function () { return this.dataset.f === navn; });
  document.querySelectorAll('.chip[data-f]').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.f === navn)));
}

// ------------------------------------------------------------------ tooltip

const tipEl = () => document.getElementById('tooltip');
function showTip(ev, lines) {
  const t = tipEl();
  t.innerHTML = lines.map((l, i) => i ? `<div class="muted">${esc(l)}</div>` : `<b>${esc(l)}</b>`).join('');
  t.hidden = false;
  moveTip(ev);
}
function moveTip(ev) {
  const t = tipEl();
  if (t.hidden) return;
  const pad = 14, r = t.getBoundingClientRect();
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}
function hideTip() { tipEl().hidden = true; }
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
  root.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => openForening(b.dataset.f)));
}

function statusPill(status) {
  return `<span class="status"><span class="dot" style="background:${STATUS[status].fill};border:1px solid var(--border)"></span>${esc(STATUS[status].label)}</span>`;
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
function hbars(rows, {width = 440, labelW = 150, colors = ['var(--accent)', 'var(--accent-light)'], aria = ''} = {}) {
  const barH = 14, rowH = 24;
  const max = Math.max(1, ...rows.map(r => r.values.reduce((a, b) => a + b, 0)));
  const plotW = width - labelW - 34;
  const h = rows.length * rowH + 2;
  let s = `<svg class="chart" viewBox="0 0 ${width} ${h}" role="img" aria-label="${esc(aria)}">`;
  s += `<line class="baseline" x1="${labelW}" x2="${labelW}" y1="0" y2="${h}"/>`;
  rows.forEach((r, i) => {
    const y = i * rowH + 5, total = r.values.reduce((a, b) => a + b, 0);
    s += `<text class="lbl" x="${labelW - 8}" y="${y + 11}" text-anchor="end">${esc(trunc(r.label, 24))}</text>`;
    let x = labelW;
    const segs = r.values.map((v, k) => ({v, k})).filter(d => d.v > 0);
    segs.forEach((d, j) => {
      const w = Math.max(2, d.v / max * plotW) - (j < segs.length - 1 ? 2 : 0);
      s += j === segs.length - 1
        ? `<path d="${barRight(x, y, w, barH)}" fill="${colors[d.k]}"/>`
        : `<rect x="${x}" y="${y}" width="${w}" height="${barH}" fill="${colors[d.k]}"/>`;
      x += w + 2;
    });
    s += `<text class="val" x="${(segs.length ? x - 2 : labelW) + 6}" y="${y + 11}">${esc(num1(total))}</text>`;
    s += `<rect class="hit" x="0" y="${y - 5}" width="${width}" height="${rowH}" data-tip="${esc(r.tip || `${r.label}|${num1(total)}`)}"/>`;
  });
  return s + '</svg>';
}

/** Lodrette (evt. stablede) søjler; cols: {label, values:[a,b], tip, nodata}. */
function columns(cols, {width = 440, height = 150, colors = ['var(--accent)', 'var(--accent-light)'], aria = ''} = {}) {
  const top = 18, bottom = 22, plotH = height - top - bottom;
  const max = Math.max(1, ...cols.map(c => c.values.reduce((a, b) => a + b, 0)));
  const band = width / cols.length, bw = Math.min(24, band * 0.6);
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
    s += `<text class="tick" x="${x + bw / 2}" y="${height - 6}" text-anchor="middle">${esc(c.label)}</text>`;
    s += `<rect class="hit" x="${i * band}" y="0" width="${band}" height="${height}" data-tip="${esc(c.tip || `${c.label}|${num1(total)}`)}"/>`;
  });
  return s + '</svg>';
}

function legend2(a, b, extra = '') {
  return `<div class="chart-legend"><span><span class="swatch" style="background:var(--accent)"></span>${esc(a)}</span>`
    + `<span><span class="swatch" style="background:var(--accent-light)"></span>${esc(b)}</span>${extra}</div>`;
}

// ------------------------------------------------------------------ landsoverblik

function renderOverview() {
  const {foreninger, lokale, events, meta, firstRun, byName} = DATA;
  const soon = events.filter(e => !e.forsvundet && e.slutD >= NOW && e.startD <= H14 && byName.has(e.forening));
  const planlagt = events.filter(e => !e.forsvundet && !e.aflyst && e.slutD >= NOW).length;
  const medPlan = lokale.filter(f => f.planlagt.length).length;
  const afholdt = events.filter(e => !e.forsvundet && !e.aflyst && e.slutD < NOW).length;

  document.getElementById('tiles').innerHTML =
    tile('Aktiviteter de næste 14 dage', String(soon.filter(e => !e.aflyst).length), null, true)
    + tile('Planlagte aktiviteter i alt', String(planlagt), 'Inkl. landsforeningens')
    + tile('Lokalforeninger med planlagte aktiviteter', `${medPlan} af ${lokale.length}`,
      `${lokale.filter(f => !f.facebook).length} uden Facebook-side`)
    + tile('Afholdte aktiviteter registreret', String(afholdt), `Siden ${fmtDate.format(firstRun)}`);

  const rows = [...foreninger]
    .sort((a, b) => (b.afholdt90.length + b.planlagt.length) - (a.afholdt90.length + a.planlagt.length) || a.navn.localeCompare(b.navn, 'da'))
    .map(f => ({label: f.navn, values: [f.afholdt90.length, f.planlagt.length],
                tip: `${visningsnavn(f)}|Afholdt seneste 90 dage: ${f.afholdt90.length}|Planlagt: ${f.planlagt.length}`}));
  const act = document.getElementById('chart-activity');
  act.innerHTML = legend2('Afholdt (90 dage)', 'Planlagt') + hbars(rows, {width: 520, labelW: 130, aria: 'Aktiviteter pr. forening'});
  bindTips(act);

  const l14 = document.getElementById('list-14');
  l14.innerHTML = evList(soon.sort((a, b) => a.startD - b.startD), true, 'Ingen aktiviteter de næste 14 dage.');
  bindForeningLinks(l14);

  renderRank();

  const last = meta.koersler[meta.koersler.length - 1];
  document.getElementById('updated').textContent = last
    ? `Sidst hentet fra Facebook: ${fmtStamp.format(new Date(last.tid))}` : '';
  document.getElementById('method').textContent =
    `Data hentes automatisk fra foreningernes offentlige Facebook-begivenheder hver uge (${meta.koersler.length} kørsler indtil nu). `
    + `Facebook viser kun kommende begivenheder, så afholdte aktiviteter tælles fra ${fmtDate.format(firstRun)}, hvor indsamlingen startede, og historikken vokser uge for uge. `
    + '"Tilkendegivelser" er antal "deltager" + "interesseret" på Facebook ved seneste måling før aktiviteten. '
    + 'Aktivitetstyper er inddelt automatisk ud fra titel og beskrivelse. Aktiviteter oprettet og afholdt mellem to ugentlige kørsler kommer ikke med.';
}

const RANK_COLS = [
  {key: 'navn', label: 'Forening', val: f => (f.national ? '0' : '1') + f.navn, fmt: f => esc(visningsnavn(f))},
  {key: 'status', label: 'Status', val: f => ['snart', 'planlagt', 'ingen', 'ingenfb'].indexOf(f.status), fmt: f => statusPill(f.status)},
  {key: 'naeste', label: 'Næste aktivitet', val: f => f.naeste ? +f.naeste.startD : Infinity,
   fmt: f => f.naeste ? `${esc(fmtDay.format(f.naeste.startD))} – ${esc(trunc(f.naeste.navn, 28))}` : '<span class="pending">–</span>'},
  {key: 'planlagt', label: 'Planlagt', num: true, val: f => f.planlagt.length, fmt: f => f.planlagt.length},
  {key: 'afholdt90', label: 'Afholdt (90 d.)', num: true, val: f => f.afholdt90.length, fmt: f => f.afholdt90.length},
  {key: 'svar', label: 'Tilkendegivelser (gns.)', num: true, val: f => f.gnsSvar ?? -1, fmt: f => num1(f.gnsSvar)},
  {key: 'sidste', label: 'Sidst afholdt', val: f => f.sidste ? +f.sidste : -Infinity,
   fmt: f => f.sidste ? esc(fmtDate.format(f.sidste)) : '<span class="pending">–</span>'},
];
let rankSort = {key: 'naeste', dir: 1};

function renderRank() {
  const t = document.getElementById('rank');
  const col = RANK_COLS.find(c => c.key === rankSort.key);
  const list = [...DATA.foreninger].sort((a, b) => {
    const va = col.val(a), vb = col.val(b);
    const d = typeof va === 'string' ? va.localeCompare(vb, 'da') : va - vb;
    return d * rankSort.dir || a.navn.localeCompare(b.navn, 'da');
  });
  t.innerHTML = `<thead><tr>${RANK_COLS.map(c => `<th class="${c.num ? 'num' : ''}" data-k="${c.key}" tabindex="0"${
    c.key === rankSort.key ? ` aria-sort="${rankSort.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>`
    + `<tbody>${list.map(f => `<tr tabindex="0" data-f="${esc(f.navn)}">${RANK_COLS.map(c =>
      `<td class="${c.num ? 'num' : ''}">${c.fmt(f)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  t.querySelectorAll('th').forEach(th => {
    const sortBy = () => {
      const k = th.dataset.k;
      rankSort = {key: k, dir: rankSort.key === k ? -rankSort.dir : (RANK_COLS.find(c => c.key === k).num ? -1 : 1)};
      renderRank();
    };
    th.addEventListener('click', sortBy);
    th.addEventListener('keydown', ev => { if (ev.key === 'Enter') sortBy(); });
  });
  t.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', () => openForening(tr.dataset.f));
    tr.addEventListener('keydown', ev => { if (ev.key === 'Enter') openForening(tr.dataset.f); });
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
    return legend2('Afholdt', 'Planlagt', extra) + columns(cols, {width: 440, aria: 'Aktiviteter pr. måned det seneste år'});
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
    return legend2('Afholdt', 'Planlagt') + hbars(rows, {aria: 'Typer af aktiviteter', labelW: 120});
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
      + legend2('Afholdt', 'Planlagt') + hbars(rows, {aria: 'Tilkendegivelser pr. aktivitet', labelW: 210});
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
    if (andet) rows.push({label: f.national ? 'Online/uden adresse' : 'Uden for området/ukendt', values: [andet, 0], tip: `Online, uden adresse eller uden for området|${andet}`});
    const medAkt = [...komCount.values()].filter(v => v > 0).length;
    const note = f.national ? `Aktiviteter i ${medAkt} kommuner.` : `${medAkt} af ${f.kommuner.length} kommuner i området har haft eller får aktiviteter.`;
    return `<p class="note">${esc(note)}</p>` + hbars(rows, {aria: 'Aktiviteter pr. kommune', labelW: 150});
  },
});
registerSection({
  id: 'ugedage', titel: 'Ugedage', synlig: f => f.gyldige.length > 0,
  render: f => columns(UGEDAGE.map((d, i) => ({label: d, values: [f.gyldige.filter(e => weekday(e.startD) === i).length, 0]})),
    {height: 120, aria: 'Aktiviteter pr. ugedag'}),
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

// ------------------------------------------------------------------ foreningspanel

function openForening(navn) {
  const f = DATA.byName.get(navn);
  if (!f) return;
  selected = navn;
  markSelected(navn);
  hideTip();

  const body = document.getElementById('drawer-body');
  body.innerHTML = `
    <h2 id="drawer-title">${esc(visningsnavn(f))}</h2>
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

  const d = document.getElementById('drawer');
  d.classList.add('open');
  d.setAttribute('aria-hidden', 'false');
  d.scrollTop = 0;
  history.replaceState(null, '', '#' + encodeURIComponent(navn));

  // Rul kortet på plads (på mobil helt op under skærmkanten), og zoom til det synlige udsnit.
  const cardR = document.querySelector('.map-card').getBoundingClientRect();
  const svgR = MAP.svg.node().getBoundingClientRect();
  let viewTop = svgR.top;
  if (innerWidth <= 760) viewTop = 0;
  else if (cardR.top < -cardR.height / 3 || cardR.top > innerHeight * 0.5) viewTop = svgR.top - cardR.top + 12;
  if (Math.abs(viewTop - svgR.top) > 4) scrollBy({top: svgR.top - viewTop, behavior: 'smooth'});
  MAP.viewTop = viewTop;
  applyZoom(f.national ? null : f);
  MAP.viewTop = undefined;
  document.getElementById('drawer-close').focus({preventScroll: true});
}

function closeDrawer() {
  const d = document.getElementById('drawer');
  d.classList.remove('open');
  d.setAttribute('aria-hidden', 'true');
  selected = null;
  markSelected(null);
  applyZoom(null);
  history.replaceState(null, '', location.pathname + location.search);
}

function renderLegend() {
  document.getElementById('legend').innerHTML = Object.values(STATUS)
    .map(s => `<span><span class="swatch" style="background:${s.fill}"></span>${esc(s.label)}</span>`).join('')
    + '<span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="currentColor"/></svg>Lokal aktivitet</span>'
    + `<span><svg width="14" height="14" aria-hidden="true"><path transform="translate(7,7)" d="${d3.symbol(d3.symbolDiamond, 70)()}" fill="currentColor"/></svg>Landsforeningens aktivitet</span>`;
}

// ------------------------------------------------------------------ start

window.LAU = {registerSection, registerLayer, openForening, closeDrawer, CONFIG, get data() { return DATA; }};

async function main() {
  try {
    await load();
  } catch (err) {
    document.getElementById('map').innerHTML = `<p class="empty">Kunne ikke indlæse data (${esc(err.message)}).</p>`;
    return;
  }
  renderLegend();
  const nat = DATA.byName.get(NATIONAL);
  document.getElementById('map-actions').innerHTML = (nat ? `<button class="chip" data-f="${NATIONAL}" aria-pressed="false">◆ Landsforeningen</button>` : '')
    + '<button class="chip" id="zoom-reset" hidden>← Hele landet</button>';
  bindForeningLinks(document.getElementById('map-actions'));
  document.getElementById('zoom-reset').addEventListener('click', closeDrawer);
  renderMap();
  renderOverview();
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  addEventListener('keydown', ev => { if (ev.key === 'Escape') closeDrawer(); });
  let t;
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(renderMap, 150); });
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash && DATA.byName.has(hash)) openForening(hash);
}

main();
