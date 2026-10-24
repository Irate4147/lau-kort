// Adapter: bygger objektlageret ud fra de nuværende JSON-filer i data/ (+ rettelser).
// Fase 2: en Supabase-adapter med samme resultat (et Lager) erstatter denne – ontologien og alt ovenpå er uændret.

import {Lager} from '../lager.js';
import {LAU} from '../lau.js';
import {anvendRettelser, beregnDaekning, tilstandVed} from '../regler.js';

/**
 * @param {object} kilder
 * @param {any[]} kilder.foreninger  data/foreninger.json
 * @param {any[]} kilder.events      data/events.json
 * @param {any} kilder.meta          data/meta.json
 * @param {Record<string, any>} [kilder.rettelser]  rettelser (admin: alle; ellers den offentlige del)
 * @param {any} [kilder.topo]        geo/kommuner.topo.json (kommunernes navne og koder)
 * @param {any} [kilder.udvikling]   udviklingsudvalgets data (data/admin/udvikling.krypt.json, kun admins):
 *   {udvalg: [{id, navn, rolle, aktiv}], ansvar: {forening: udvalgsmedlemmets id}, kontakter: [{id, forening, dato, af, …}]}
 * @param {Date} [kilder.nu]          hvornår data er hentet (dækningen regnes herfra)
 * @param {import('../ontologi.js').Adgang} [kilder.rolle]
 * @param {{tid: Date, rekonstruer?: boolean}} [kilder.ved]  lageret på et andet tidspunkt: reglerne regner fra tid, og med
 *   rekonstruer kun med det, man vidste dengang (tilstandVed – månedsrapportens snapshots og "Fremad")
 * @returns {Lager}
 */
export function bygFraJson({foreninger, events, meta, rettelser = {}, topo = null, udvikling = null, nu = new Date(), rolle = 'admin', ved = null}) {
  nu = new Date(+nu);
  const daekning = beregnDaekning(meta, events, foreninger, nu);
  // alleArrangementer: kildedata med rettelser, også skjulte (bruges af rettelsesfanen i app.js, der skal kunne vise dem).
  let alle = anvendRettelser(events.map(e => ({...e})), rettelser);
  // Samme forberedelse som beregn() i app.js.
  for (const e of alle) {
    e.startD = new Date(e.start);
    e.slutD = new Date(e.slut || e.start);
    e.firstD = new Date(e.foerst_set);
    e.foreninger = e.foreninger || [e.forening];
  }
  const tid = ved ? new Date(+ved.tid) : nu;
  if (ved && ved.rekonstruer) alle = alle.map(e => tilstandVed(e, tid)).filter(Boolean);
  const L = new Lager(LAU, {nu: tid, rolle, daekning, alleArrangementer: alle, udvikling});

  const kommune = new Map();
  const hentKommune = (navn, kode = null) => {
    if (!kommune.has(navn)) kommune.set(navn, L.tilfoej('Kommune', navn, {navn, kode}));
    return kommune.get(navn);
  };
  for (const g of (topo && topo.objects && topo.objects.kom && topo.objects.kom.geometries) || []) hentKommune(g.properties.navn, g.properties.kode);

  const forening = new Map();
  for (const f of foreninger) {
    const o = L.tilfoej('Forening', f.navn, {navn: f.navn, national: !!f.national, facebook: f.facebook || '', stamdata: f.stamdata || null});
    forening.set(f.navn, o);
    for (const k of f.kommuner || []) L.forbind('kommuner', o, hentKommune(k));
  }

  // Skjulte (dubletter, ikke-LAU) kommer ikke med.
  for (const e of alle) {
    if (e.skjult) continue;
    const o = L.tilfoej('Arrangement', e.id, {
      navn: e.navn, start: e.startD, slut: e.slutD, sted: e.sted || '', online: !!e.online, aflyst: !!e.aflyst,
      forsvundet: !!e.forsvundet, manuel: !!e.manuel, deltager: e.deltager ?? null, interesserede: e.interesserede ?? null,
      svar: e.svar ?? null, fremmoede: e.fremmoede ?? null, note: e.note || null, url: e.url || '', raw: e,
    });
    for (const n of e.foreninger) if (forening.has(n)) L.forbind('arrangeretAf', o, forening.get(n));
    if (e.kommune) L.forbind('afholdtI', o, hentKommune(e.kommune));
  }

  // Udviklingsudvalget: medlemmerne (stabile id'er, så et navneskift ikke knækker noget), ansvaret og kontakterne.
  if (udvikling) {
    const medlem = new Map();
    for (const u of udvikling.udvalg || []) {
      medlem.set(u.id, L.tilfoej('Udvalgsmedlem', u.id, {navn: u.navn, rolle: u.rolle || 'medlem', aktiv: u.aktiv !== false}));
    }
    for (const [navn, id] of Object.entries(udvikling.ansvar || {})) {
      if (forening.has(navn) && medlem.has(id)) L.forbind('ansvarFor', medlem.get(id), forening.get(navn));
    }
    for (const k of udvikling.kontakter || []) {
      if (!forening.has(k.forening)) continue;
      const o = L.tilfoej('Kontakt', k.id, {dato: new Date(k.dato + 'T12:00:00Z'), form: k.form || null, med: k.med || null,
        stemning: k.stemning || null, tekst: k.tekst || null, opfoelgning: k.opfoelgning || null,
        frist: k.frist ? new Date(k.frist + 'T12:00:00Z') : null, raw: k});
      L.forbind('kontaktMed', o, forening.get(k.forening));
      if (medlem.has(k.af)) L.forbind('kontaktetAf', o, medlem.get(k.af));
    }
  }
  return L;
}
