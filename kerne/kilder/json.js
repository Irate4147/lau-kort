// Adapter: bygger objektlageret ud fra de nuværende JSON-filer i data/ (+ rettelser).
// Fase 2: en Supabase-adapter med samme resultat (et Lager) erstatter denne – ontologien og alt ovenpå er uændret.

import {Lager} from '../lager.js';
import {LAU} from '../lau.js';
import {anvendRettelser, beregnDaekning} from '../regler.js';

/**
 * @param {object} kilder
 * @param {any[]} kilder.foreninger  data/foreninger.json
 * @param {any[]} kilder.events      data/events.json
 * @param {any} kilder.meta          data/meta.json
 * @param {Record<string, any>} [kilder.rettelser]  rettelser (admin: alle; ellers den offentlige del)
 * @param {any} [kilder.topo]        geo/kommuner.topo.json (kommunernes navne og koder)
 * @param {Date} [kilder.nu]
 * @param {import('../ontologi.js').Adgang} [kilder.rolle]
 * @returns {Lager}
 */
export function bygFraJson({foreninger, events, meta, rettelser = {}, topo = null, nu = new Date(), rolle = 'admin'}) {
  nu = new Date(+nu);
  const daekning = beregnDaekning(meta, events, foreninger, nu);
  // alleArrangementer: kildedata med rettelser, også skjulte (bruges af rettelsesfanen i app.js, der skal kunne vise dem).
  const alle = anvendRettelser(events.map(e => ({...e})), rettelser);
  const L = new Lager(LAU, {nu, rolle, daekning, alleArrangementer: alle});

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

  // Samme forberedelse som beregn() i app.js. Skjulte (dubletter, ikke-LAU) kommer ikke med.
  for (const e of alle) {
    e.startD = new Date(e.start);
    e.slutD = new Date(e.slut || e.start);
    e.firstD = new Date(e.foerst_set);
    e.foreninger = e.foreninger || [e.forening];
    if (e.skjult) continue;
    const o = L.tilfoej('Arrangement', e.id, {
      navn: e.navn, start: e.startD, slut: e.slutD, sted: e.sted || '', online: !!e.online, aflyst: !!e.aflyst,
      forsvundet: !!e.forsvundet, manuel: !!e.manuel, deltager: e.deltager ?? null, interesserede: e.interesserede ?? null,
      svar: e.svar ?? null, fremmoede: e.fremmoede ?? null, note: e.note || null, url: e.url || '', raw: e,
    });
    for (const n of e.foreninger) if (forening.has(n)) L.forbind('arrangeretAf', o, forening.get(n));
    if (e.kommune) L.forbind('afholdtI', o, hentKommune(e.kommune));
  }
  return L;
}
