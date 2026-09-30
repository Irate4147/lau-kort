// Objektsæt: ét forespørgselssprog, som alle dele af systemet bruger – analyser, kortlag, views, advarsler og (fase 4)
// regler. En forespørgsel er almindelig JSON, så den kan gemmes, deles som link og køres igen på nye data.
//
//   {
//     "type": "Arrangement",
//     "filtre": [
//       {"egenskab": "start", "periode": "seneste365"},                       // dato
//       {"egenskab": "kategori", "er": ["Kampagne"]},                          // kategori / ja-nej / tekst
//       {"egenskab": "deltager", "min": 10},                                   // tal
//       {"egenskab": "navn", "indeholder": "debat"},                          // tekst
//       {"egenskab": "arrangeretAf.momentum", "er": ["hjaelp", "faldende"]},   // gennem et link
//       {"link": "arrangeretAf", "filtre": [...]},                             // har et linket objekt, der matcher
//       {"link": "arrangementer", "ingen": true, "filtre": [...]}              // har INGEN linkede, der matcher
//     ],
//     "searchAround": [{"link": "arrangeretAf"}],                              // skift til de linkede objekter
//     "gruppering": {"egenskab": "start", "pr": "maaned"},
//     "maal": {"funktion": "median", "egenskab": "deltager"}
//   }

import {tilladt} from './ontologi.js';
import {DAG, dagNoegle, fmtDato, maanedNoegle} from './tid.js';

/** @typedef {import('./ontologi.js').Objekt} Objekt @typedef {import('./ontologi.js').Egenskab} Egenskab */
/** @typedef {import('./lager.js').Lager} Lager @typedef {import('./ontologi.js').Ontologi} Ontologi */

/**
 * @typedef {object} Filter
 * @property {string} [egenskab]  sti til en egenskab
 * @property {any[]} [er]         kat/bool/tekst: en af værdierne (null = ingen værdi)
 * @property {string} [indeholder] tekst: indeholder (uden forskel på store og små bogstaver)
 * @property {number|null} [min]
 * @property {number|null} [max]
 * @property {string} [periode]   nøgle i PERIODER
 * @property {string} [fra]       YYYY-MM-DD (periode 'egen')
 * @property {string} [til]       YYYY-MM-DD (periode 'egen'), inklusive
 * @property {string} [link]      link-filter: navnet på linket
 * @property {Filter[]} [filtre]  link-filter: de linkede objekter skal matche disse
 * @property {boolean} [ingen]    link-filter: der må IKKE være nogen linkede, der matcher
 *
 * @typedef {object} Spec
 * @property {string} type
 * @property {Filter[]} [filtre]
 * @property {{link: string, filtre?: Filter[]}[]} [searchAround]
 * @property {{egenskab: string, pr?: string}} [gruppering]
 * @property {{funktion: string, egenskab?: string}} [maal]
 * @property {{funktion: string, egenskab?: string}} [maal2]  et andet mål pr. gruppe – til et punktdiagram (maal ud ad x, maal2 op ad y)
 * @property {'soejler'|'punkter'} [visning]  kun brugerfladen: søjler (standard) eller punktdiagram
 *
 * @typedef {{noegle: any, label: string, objekter: Objekt[], vaerdi: number|null, vaerdi2?: number|null}} Gruppe
 * @typedef {{type: string, objekter: Objekt[], grupper: Gruppe[]|null, total: number|null, total2?: number|null, antalAlle: number}} Resultat
 */

const dag = (nu, n) => dagNoegle(new Date(+nu + n * DAG));
const aar = nu => maanedNoegle(nu).slice(0, 4);
/** Perioder regnes fra lagerets "nu" – en gemt analyse med "seneste 90 dage" er altid de seneste 90 dage. */
export const PERIODER = {
  seneste30: {label: 'Seneste 30 dage', fraTil: nu => [dag(nu, -30), dag(nu, 0)]},
  seneste90: {label: 'Seneste 90 dage', fraTil: nu => [dag(nu, -90), dag(nu, 0)]},
  seneste365: {label: 'Seneste år', fraTil: nu => [dag(nu, -365), dag(nu, 0)]},
  iaar: {label: 'I år', fraTil: nu => [`${aar(nu)}-01-01`, `${aar(nu)}-12-31`]},
  naeste30: {label: 'Næste 30 dage', fraTil: nu => [dag(nu, 0), dag(nu, 30)]},
  naeste90: {label: 'Næste 90 dage', fraTil: nu => [dag(nu, 0), dag(nu, 90)]},
  fortid: {label: 'Før i dag', fraTil: nu => ['', dag(nu, -1)]},
  fremtid: {label: 'Fra i dag og frem', fraTil: nu => [dag(nu, 0), '']},
  egen: {label: 'Egen periode', fraTil: (_, f) => [f.fra || '', f.til || '']},
};

export const DATO_GRUPPER = {
  maaned: {label: 'Måned', noegle: d => maanedNoegle(d),
    label2: k => new Intl.DateTimeFormat('da-DK', {month: 'short', year: 'numeric', timeZone: 'UTC'}).format(new Date(k + '-15T00:00:00Z')),
    periode: k => ({fra: `${k}-01`, til: `${k}-31`})},
  kvartal: {label: 'Kvartal', noegle: d => { const m = maanedNoegle(d); return `${m.slice(0, 4)}-Q${Math.floor((+m.slice(5) - 1) / 3) + 1}`; },
    label2: k => `${k.slice(5)} ${k.slice(0, 4)}`,
    periode: k => { const q = +k.slice(6), p = n => String(n).padStart(2, '0'); return {fra: `${k.slice(0, 4)}-${p(q * 3 - 2)}-01`, til: `${k.slice(0, 4)}-${p(q * 3)}-31`}; }},
  aar: {label: 'År', noegle: d => maanedNoegle(d).slice(0, 4), label2: k => k, periode: k => ({fra: `${k}-01-01`, til: `${k}-12-31`})},
};

export const MAAL = {
  antal: {label: 'Antal'},
  sum: {label: 'Sum', beregn: xs => (xs.length ? xs.reduce((a, b) => a + b, 0) : null)},
  gns: {label: 'Gennemsnit', beregn: xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)},
  median: {label: 'Median', beregn: xs => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }},
  min: {label: 'Laveste', beregn: xs => (xs.length ? Math.min(...xs) : null)},
  max: {label: 'Højeste', beregn: xs => (xs.length ? Math.max(...xs) : null)},
};

/** Objekttypen, sættet ender i efter search around. @param {Ontologi} ont @param {Spec} spec */
export function slutType(ont, spec) {
  let t = spec.type;
  for (const s of spec.searchAround || []) {
    const l = ont.link(t, s.link);
    if (!l) throw new Error(`${t} har intet link "${s.link}"`);
    t = l.til;
  }
  return t;
}

/** Fejl i en forespørgsel (tom liste = gyldig). @param {Ontologi} ont @param {Spec} spec @returns {string[]} */
export function valider(ont, spec) {
  const fejl = [];
  const tjekFiltre = (type, filtre) => {
    for (const f of filtre || []) {
      try {
        if (f.link) {
          const l = ont.link(type, f.link);
          if (!l) { fejl.push(`${type} har intet link "${f.link}"`); continue; }
          tjekFiltre(l.til, f.filtre);
        } else {
          const e = ont.sti(type, f.egenskab).egenskab;
          if (!e) fejl.push(`Filteret "${f.egenskab}" peger på objekter, ikke en egenskab`);
          else if (f.periode && !PERIODER[f.periode]) fejl.push(`Ukendt periode "${f.periode}"`);
        }
      } catch (err) { fejl.push(err.message); }
    }
  };
  try {
    ont.type(spec.type);
    tjekFiltre(spec.type, spec.filtre);
    let t = spec.type;
    for (const s of spec.searchAround || []) {
      const l = ont.link(t, s.link);
      if (!l) { fejl.push(`${t} har intet link "${s.link}"`); break; }
      t = l.til;
      tjekFiltre(t, s.filtre);
    }
    if (spec.gruppering) {
      const e = ont.sti(t, spec.gruppering.egenskab).egenskab;
      if (!e) fejl.push('Grupperingen skal pege på en egenskab');
      else if (spec.gruppering.pr && !DATO_GRUPPER[spec.gruppering.pr]) fejl.push(`Ukendt datogruppe "${spec.gruppering.pr}"`);
    }
    for (const m of [spec.maal, spec.maal2]) {
      if (!m) continue;
      if (!MAAL[m.funktion]) { fejl.push(`Ukendt mål "${m.funktion}"`); continue; }
      if (m.funktion !== 'antal') {
        const e = m.egenskab ? ont.sti(t, m.egenskab).egenskab : null;
        if (!e || e.type !== 'tal') fejl.push('Målet skal være en tal-egenskab');
      }
    }
  } catch (err) { fejl.push(err.message); }
  return fejl;
}

/** @param {Lager} lager @param {string} type @param {Filter} f @returns {(o: Objekt) => boolean} */
function matcher(lager, type, f) {
  if (f.link) {
    const under = (f.filtre || []).map(x => matcher(lager, lager.ontologi.link(type, f.link).til, x));
    return o => {
      const har = lager.linkede(o, f.link).some(x => under.every(m => m(x)));
      return f.ingen ? !har : har;
    };
  }
  const e = lager.ontologi.sti(type, f.egenskab).egenskab;
  const vals = o => { const v = lager.vaerdier(o, f.egenskab); return v.length ? v : [null]; };
  if (e.type === 'tal') {
    if (f.min == null && f.max == null) return () => true;
    return o => vals(o).some(v => v != null && (f.min == null || v >= f.min) && (f.max == null || v <= f.max));
  }
  if (e.type === 'dato') {
    const [fra, til] = (PERIODER[f.periode] || PERIODER.egen).fraTil(lager.nu, f);
    return o => vals(o).some(v => { if (v == null) return false; const d = dagNoegle(v); return (!fra || d >= fra) && (!til || d <= til); });
  }
  if (f.indeholder) {
    const q = f.indeholder.toLocaleLowerCase('da');
    return o => vals(o).some(v => v != null && String(v).toLocaleLowerCase('da').includes(q));
  }
  if (!f.er || !f.er.length) return () => true;
  const s = new Set(f.er);
  return o => vals(o).some(v => s.has(v));
}

/** @param {Lager} lager @param {string} type @param {Filter[]} filtre @param {Objekt[]} objekter */
const filtrer = (lager, type, filtre, objekter) =>
  (filtre || []).reduce((xs, f) => { const m = matcher(lager, type, f); return xs.filter(m); }, objekter);

/** Målet for en mængde objekter. @param {Lager} lager @param {Spec['maal']} maal @param {Objekt[]} objekter */
export function maal(lager, maal, objekter) {
  if (!maal || maal.funktion === 'antal') return objekter.length;
  const xs = objekter.flatMap(o => lager.vaerdier(o, maal.egenskab)).filter(v => typeof v === 'number');
  return MAAL[maal.funktion].beregn(xs);
}

/** En værdi, som den skal vises. @param {Egenskab|null} e @param {any} v */
export function visVaerdi(e, v) {
  if (v == null || v === '') return '–';
  if (!e) return String(v);
  if (e.type === 'kat') return (e.vaerdier && e.vaerdier[v]) || String(v);
  if (e.type === 'bool') return v ? 'Ja' : 'Nej';
  if (e.type === 'dato') return fmtDato.format(v);
  if (e.type === 'tal') return v.toLocaleString('da-DK', {maximumFractionDigits: 1});
  return String(v);
}

/**
 * @typedef {import('./ontologi.js').Link} Link @typedef {import('./ontologi.js').Adgang} Adgang
 * @typedef {{egenskab: Egenskab, vaerdi: any, tekst: string}} VistEgenskab
 * @typedef {{link: Link, objekter: Objekt[], fordeling: {egenskab: Egenskab, grupper: {noegle: any, label: string, antal: number}[]}|null}} VistLink
 */

/**
 * Objektvisningen (som Palantirs Object View): et objekts egenskaber og links, som rollen må se, bygget af ontologien –
 * en ny egenskab eller et nyt link i lau.js kommer med uden ny kode. Interne egenskaber, objekter og egenskaber uden
 * værdi er udeladt. Et link giver de linkede objekter (kun dem, rollen må se; links uden objekter er udeladt) og deres
 * fordeling på den linkede types første kategori (ellers første ja/nej-egenskab), fx arrangementernes status.
 * @param {Lager} lager @param {Objekt} o
 * @param {{rolle?: Adgang, udelad?: Iterable<string>}} [valg] rolle: standard lagerets; udelad: egenskaber og links
 *   (id/navn), der allerede vises andetsteds
 * @returns {{egenskaber: VistEgenskab[], links: VistLink[]}}
 */
export function objektVisning(lager, o, {rolle = lager.rolle, udelad = []} = {}) {
  const ont = lager.ontologi, ud = new Set(udelad);
  const synlig = (/** @type {Egenskab} */ e) => !e.intern && e.type !== 'objekt' && tilladt(e.adgang, rolle) && !ud.has(e.id);
  const egenskaber = ont.type(o.type).egenskabsliste.filter(synlig)
    .map(e => ({egenskab: e, vaerdi: lager.vaerdi(o, e.id)}))
    .filter(x => x.vaerdi != null && x.vaerdi !== '')
    .map(x => ({...x, tekst: visVaerdi(x.egenskab, x.vaerdi)}));
  /** @type {VistLink[]} */
  const links = [];
  for (const link of ont.links(o.type)) {
    if (ud.has(link.navn) || !tilladt(ont.type(link.til).adgang, rolle)) continue;
    const objekter = lager.linkede(o, link.navn).filter(x => lager.maaSe(x, rolle));
    if (!objekter.length) continue;
    const kandidater = ont.type(link.til).egenskabsliste.filter(e => !e.intern && tilladt(e.adgang, rolle));
    const e = kandidater.find(x => x.type === 'kat') || kandidater.find(x => x.type === 'bool');
    let fordeling = null;
    if (e) {
      /** @type {Map<any, number>} */
      const antal = new Map();
      for (const x of objekter) { const v = lager.vaerdi(x, e.id); if (v != null) antal.set(v, (antal.get(v) || 0) + 1); }
      /** @type {any[]} */
      const orden = e.type === 'kat' ? Object.keys(e.vaerdier || {}) : [true, false];
      const plads = (/** @type {any} */ v) => (orden.indexOf(v) + 1) || orden.length + 1;
      const grupper = [...antal].sort((a, b) => plads(a[0]) - plads(b[0])).map(([noegle, n]) => ({noegle, label: visVaerdi(e, noegle), antal: n}));
      if (grupper.length) fordeling = {egenskab: e, grupper};
    }
    links.push({link, objekter, fordeling});
  }
  return {egenskaber, links};
}

/**
 * Kører en forespørgsel.
 * @param {Lager} lager @param {Spec} spec @returns {Resultat}
 */
export function koer(lager, spec) {
  const fejl = valider(lager.ontologi, spec);
  if (fejl.length) throw new Error(fejl.join('; '));
  let type = spec.type;
  const alle = lager.alle(type);
  let objekter = filtrer(lager, type, spec.filtre, alle);
  for (const s of spec.searchAround || []) {
    objekter = [...new Set(objekter.flatMap(o => lager.linkede(o, s.link)))];
    type = lager.ontologi.link(type, s.link).til;
    objekter = filtrer(lager, type, s.filtre, objekter);
  }
  let grupper = null;
  if (spec.gruppering) {
    const g = spec.gruppering, e = lager.ontologi.sti(type, g.egenskab).egenskab;
    const dg = e.type === 'dato' ? DATO_GRUPPER[g.pr || 'maaned'] : null;
    /** @type {Map<any, Objekt[]>} */
    const m = new Map();
    for (const o of objekter) {
      const vs = lager.vaerdier(o, g.egenskab);
      const noegler = new Set((vs.length ? vs : [null]).map(v => (v != null && dg ? dg.noegle(v) : v)));
      for (const k of noegler) { if (!m.has(k)) m.set(k, []); m.get(k).push(o); }
    }
    grupper = [...m].map(([noegle, xs]) => ({noegle, objekter: xs, vaerdi: maal(lager, spec.maal, xs),
      ...(spec.maal2 ? {vaerdi2: maal(lager, spec.maal2, xs)} : {}),
      label: noegle == null ? '(ingen)' : dg ? dg.label2(noegle) : visVaerdi(e, noegle)}));
    const orden = e.vaerdier ? Object.keys(e.vaerdier) : null;
    const sidst = (a, b) => +(a.noegle == null) - +(b.noegle == null);
    if (dg || e.type === 'tal') grupper.sort((a, b) => sidst(a, b) || (a.noegle < b.noegle ? -1 : a.noegle > b.noegle ? 1 : 0));
    else if (orden) grupper.sort((a, b) => sidst(a, b) || ((orden.indexOf(a.noegle) + 1) || 999) - ((orden.indexOf(b.noegle) + 1) || 999));
    else if (e.type === 'bool') grupper.sort((a, b) => sidst(a, b) || +b.noegle - +a.noegle);
    else grupper.sort((a, b) => sidst(a, b) || (b.vaerdi ?? -Infinity) - (a.vaerdi ?? -Infinity) || a.label.localeCompare(b.label, 'da'));
  }
  return {type, objekter, grupper, total: maal(lager, spec.maal, objekter),
    ...(spec.maal2 ? {total2: maal(lager, spec.maal2, objekter)} : {}), antalAlle: alle.length};
}

/**
 * Bor ned i en gruppe: gruppen bliver et filter (datoer: år → kvartal → måned). Returnerer en ny forespørgsel.
 * Filteret lægges på det trin, grupperingen hører til (efter search around, hvis der er et).
 * @param {Ontologi} ont @param {Spec} spec @param {Gruppe} gruppe @returns {Spec}
 */
export function boreNed(ont, spec, gruppe) {
  const ny = structuredClone(spec), g = ny.gruppering, type = slutType(ont, ny);
  const e = ont.sti(type, g.egenskab).egenskab;
  /** @type {Filter} */
  let filter;
  if (e.type === 'dato') {
    const pr = g.pr || 'maaned';
    filter = gruppe.noegle == null ? {egenskab: g.egenskab, periode: 'egen'} : {egenskab: g.egenskab, periode: 'egen', ...DATO_GRUPPER[pr].periode(gruppe.noegle)};
    const naeste = {aar: 'kvartal', kvartal: 'maaned'}[pr];
    if (naeste) g.pr = naeste; else delete ny.gruppering;
  } else {
    filter = e.type === 'tal' ? {egenskab: g.egenskab, min: gruppe.noegle, max: gruppe.noegle} : {egenskab: g.egenskab, er: [gruppe.noegle]};
    delete ny.gruppering;
  }
  const trin = ny.searchAround && ny.searchAround.length ? ny.searchAround[ny.searchAround.length - 1] : ny;
  trin.filtre = [...(trin.filtre || []).filter(f => f.egenskab !== g.egenskab), filter];
  return ny;
}

/**
 * Målet pr. objekt i den anden ende af et link – fx pr. forening, så et sæt arrangementer kan vises på kortet.
 * Er sættet selv af måltypen, måles hvert objekt for sig.
 * @param {Lager} lager @param {Resultat} res @param {Spec['maal']} maalSpec @param {string} tilType
 * @returns {Map<Objekt, number>}
 */
export function prObjekt(lager, res, maalSpec, tilType) {
  /** @type {Map<Objekt, Objekt[]>} */
  const m = new Map();
  const link = res.type === tilType ? null : lager.ontologi.links(res.type).find(l => l.til === tilType);
  if (res.type !== tilType && !link) return new Map();
  for (const o of res.objekter) {
    for (const t of link ? lager.linkede(o, link.navn) : [o]) { if (!m.has(t)) m.set(t, []); m.get(t).push(o); }
  }
  /** @type {Map<Objekt, number>} */
  const ud = new Map();
  for (const [t, xs] of m) { const v = maal(lager, maalSpec, xs); if (v != null) ud.set(t, v); }
  return ud;
}
