// Objektlageret: objekter og links i hukommelsen, med beregnede egenskaber (beregnes én gang pr. objekt).
// Lageret er et øjebliksbillede: ændres data (fx en rettelse), bygges et nyt. Det er hurtigt ved jeres datamængde.
// Fase 2: en adapter fylder lageret fra Supabase i stedet for JSON-filerne – resten af kernen er uændret.

import {tilladt} from './ontologi.js';

/** @typedef {import('./ontologi.js').Objekt} Objekt @typedef {import('./ontologi.js').Adgang} Adgang */

export class Lager {
  /**
   * @param {import('./ontologi.js').Ontologi} ontologi
   * @param {{nu?: Date, rolle?: Adgang, [k: string]: any}} [kontekst]  nu: tidspunktet, reglerne regner fra;
   *   rolle: hvad brugeren må se (standard admin); resten er adapterens egne oplysninger til beregningerne.
   */
  constructor(ontologi, kontekst = {}) {
    this.ontologi = ontologi;
    this.kontekst = kontekst;
    this.nu = new Date(+(kontekst.nu || new Date()));
    /** @type {Adgang} */
    this.rolle = kontekst.rolle || 'admin';
    /** @type {Map<string, Map<string, Objekt>>} */
    this._obj = new Map([...ontologi.typer.keys()].map(t => [t, new Map()]));
    /** @type {Map<string, Map<Objekt, Objekt[]>>} linkId + retning → fra → til */
    this._links = new Map();
    /** @type {WeakMap<Objekt, Map<string, any>>} */
    this._memo = new WeakMap();
    /** @type {Map<string, Objekt[]>} */
    this._synlige = new Map();
  }

  /** @param {string} type @param {string} id @param {Record<string, any>} v gemte egenskaber @returns {Objekt} */
  tilfoej(type, id, v) {
    const m = this._obj.get(type);
    if (!m) throw new Error(`Ukendt objekttype: ${type}`);
    if (m.has(id)) throw new Error(`${type} ${id} findes allerede`);
    const o = {type, id, v};
    m.set(id, o);
    this._synlige.delete(type);
    return o;
  }

  /** @param {string} type @param {string} id */
  hent(type, id) {
    const o = this._obj.get(type)?.get(id) || null;
    return o && this.maaSe(o) ? o : null;
  }

  /** Alle objekter af en type, som rollen må se. @param {string} type @returns {Objekt[]} */
  alle(type) {
    if (!this._synlige.has(type)) {
      const t = this.ontologi.type(type);
      const alle = [...this._obj.get(type).values()];
      this._synlige.set(type, !tilladt(t.adgang, this.rolle) ? [] : t.raekkeadgang ? alle.filter(o => t.raekkeadgang(o, this, this.rolle)) : alle);
    }
    return this._synlige.get(type);
  }

  /** Må rollen (standard: lagerets) se objektet? @param {Objekt} o @param {Adgang} [rolle] */
  maaSe(o, rolle = this.rolle) {
    const t = this.ontologi.type(o.type);
    return tilladt(t.adgang, rolle) && (!t.raekkeadgang || t.raekkeadgang(o, this, rolle));
  }

  /** Forbinder to objekter med et link fra ontologien. @param {string} linkId @param {Objekt} fra @param {Objekt} til */
  forbind(linkId, fra, til) {
    const l = this.ontologi.link(fra.type, linkId);
    if (!l || l.omvendt || l.til !== til.type) throw new Error(`Ugyldigt link ${linkId}: ${fra.type} → ${til.type}`);
    /** @type {[string, Objekt, Objekt][]} */
    const retninger = [[`${linkId}>`, fra, til], [`${linkId}<`, til, fra]];
    for (const [noegle, a, b] of retninger) {
      if (!this._links.has(noegle)) this._links.set(noegle, new Map());
      const m = this._links.get(noegle);
      if (!m.has(a)) m.set(a, []);
      if (!m.get(a).includes(b)) m.get(a).push(b);
    }
  }

  /** Objekterne i den anden ende af et link (kun dem, rollen må se). @param {Objekt} o @param {string} navn */
  linkede(o, navn) {
    const l = this.ontologi.link(o.type, navn);
    if (!l) throw new Error(`${o.type} har intet link "${navn}"`);
    const ud = this._links.get(`${l.linkId}${l.omvendt ? '<' : '>'}`)?.get(o) || [];
    return ud.filter(x => this.maaSe(x));
  }

  /**
   * En egenskabs værdi (gemt eller beregnet). null, hvis rollen ikke må se egenskaben.
   * @param {Objekt} o @param {string} id
   */
  vaerdi(o, id) {
    const e = this.ontologi.egenskab(o.type, id);
    if (!e) throw new Error(`${o.type} har ingen egenskab "${id}"`);
    if (!tilladt(e.adgang, this.rolle)) return null;
    if (!e.beregn) return o.v[id] ?? null;
    let memo = this._memo.get(o);
    if (!memo) this._memo.set(o, memo = new Map());
    if (!memo.has(id)) memo.set(id, e.beregn(o, this) ?? null);
    return memo.get(id);
  }

  /**
   * Værdierne ad en sti (fx 'arrangeretAf.momentum'). En egen egenskab giver én værdi; gennem links én pr. linket
   * objekt (ingen, hvis der ikke er nogen). En sti, der ender i et link, giver objekterne.
   * @param {Objekt} o @param {string} sti @returns {any[]}
   */
  vaerdier(o, sti) {
    const s = this.ontologi.sti(o.type, sti);
    let objs = [o];
    for (const l of s.led) objs = [...new Set(objs.flatMap(x => this.linkede(x, l.navn)))];
    return s.egenskab ? objs.map(x => this.vaerdi(x, s.egenskab.id)) : objs;
  }

  /** Objektets navn (typens titel-egenskab). @param {Objekt} o */
  titel(o) { return String(this.vaerdi(o, this.ontologi.type(o.type).titel) ?? o.id); }
}
