// Ontologien: skemaet for alle objekttyper, deres egenskaber og links. Ved intet om LAU – se lau.js for indholdet.
//
// Begreber (som i Palantir Foundry):
//   objekttype  fx Forening, Arrangement           objekt    én forening, ét arrangement
//   egenskab    fx navn, momentum (gemt/beregnet)   link      fx Arrangement —arrangeretAf→ Forening (to retninger)
//   sti         egenskab gennem links, fx 'arrangeretAf.momentum' på et arrangement
//   adgang      offentlig < forening < admin – på typer og egenskaber (fase 2: håndhæves også i databasen)

/**
 * @typedef {'tekst'|'kat'|'tal'|'dato'|'bool'|'objekt'} Datatype
 * @typedef {'offentlig'|'forening'|'admin'} Adgang
 *
 * @typedef {object} EgenskabDef
 * @property {string} label
 * @property {Datatype} type
 * @property {Record<string, string>} [vaerdier]  kat: nøgle → visningsnavn, i den rækkefølge de skal vises
 * @property {(o: Objekt, lager: import('./lager.js').Lager) => any} [beregn]  beregnet egenskab (ellers gemt i o.v[id])
 * @property {Adgang} [adgang]   standard: typens adgang
 * @property {boolean} [intern]  bruges kun af andre beregninger – vises ikke i filtre og tabeller
 * @property {string} [hint]
 *
 * @typedef {EgenskabDef & {id: string, typeId: string, adgang: Adgang}} Egenskab
 *
 * @typedef {object} TypeDef
 * @property {string} label
 * @property {string} flertal
 * @property {string} titel     egenskaben, der bruges som objektets navn
 * @property {Adgang} [adgang]
 * @property {string} [kilde]   hvor data kommer fra (dokumentation)
 * @property {(o: Objekt, lager: import('./lager.js').Lager, rolle: Adgang) => boolean} [raekkeadgang]  må rollen se objektet?
 * @property {Record<string, EgenskabDef>} egenskaber
 *
 * @typedef {TypeDef & {id: string, adgang: Adgang, egenskabsliste: Egenskab[]}} ObjektType
 *
 * @typedef {object} LinkDef
 * @property {string} fra
 * @property {string} til
 * @property {string} label
 * @property {boolean} [mange]  kan objektet i "fra" have flere i "til"?
 * @property {{id: string, label: string, mange?: boolean}} omvendt  linket set fra "til"
 *
 * @typedef {object} Link  et link set fra én type
 * @property {string} navn      id, der bruges i stier og filtre (fx 'arrangeretAf' eller 'arrangementer')
 * @property {string} label
 * @property {string} til       typen i den anden ende
 * @property {boolean} mange
 * @property {string} linkId    linkets id i ontologien (det samme i begge retninger)
 * @property {boolean} omvendt  er det linket set bagfra?
 *
 * @typedef {{type: string, id: string, v: Record<string, any>}} Objekt
 */

export const ADGANG_NIVEAU = {offentlig: 0, forening: 1, admin: 2};

/** Må rollen se noget med denne adgang? @param {Adgang} adgang @param {Adgang} rolle */
export const tilladt = (adgang, rolle) => ADGANG_NIVEAU[rolle] >= ADGANG_NIVEAU[adgang || 'offentlig'];

export class Ontologi {
  /** @param {{typer: Record<string, TypeDef>, links: Record<string, LinkDef>}} def */
  constructor({typer, links}) {
    /** @type {Map<string, ObjektType>} */
    this.typer = new Map();
    for (const [id, t] of Object.entries(typer)) {
      const adgang = t.adgang || 'offentlig';
      const egenskabsliste = Object.entries(t.egenskaber).map(([eid, e]) => ({...e, id: eid, typeId: id, adgang: e.adgang || adgang}));
      this.typer.set(id, {...t, id, adgang, egenskabsliste});
      if (!t.egenskaber[t.titel]) throw new Error(`${id}: titel-egenskaben "${t.titel}" findes ikke`);
    }
    /** @type {Map<string, Link[]>} */
    this.linksPrType = new Map([...this.typer.keys()].map(t => [t, []]));
    for (const [linkId, l] of Object.entries(links)) {
      for (const t of [l.fra, l.til]) if (!this.typer.has(t)) throw new Error(`Link ${linkId}: ukendt type ${t}`);
      this.linksPrType.get(l.fra).push({navn: linkId, label: l.label, til: l.til, mange: !!l.mange, linkId, omvendt: false});
      this.linksPrType.get(l.til).push({navn: l.omvendt.id, label: l.omvendt.label, til: l.fra, mange: !!l.omvendt.mange, linkId, omvendt: true});
    }
    // Egenskaber og links deler navnerum pr. type, så en sti altid er entydig.
    for (const [id, t] of this.typer) {
      const navne = [...t.egenskabsliste.map(e => e.id), ...this.linksPrType.get(id).map(l => l.navn)];
      const dublet = navne.find((n, i) => navne.indexOf(n) !== i);
      if (dublet) throw new Error(`${id}: navnet "${dublet}" bruges to gange`);
    }
  }

  /** @param {string} id */
  type(id) {
    const t = this.typer.get(id);
    if (!t) throw new Error(`Ukendt objekttype: ${id}`);
    return t;
  }

  /** @param {string} typeId @param {string} id */
  egenskab(typeId, id) { return this.type(typeId).egenskabsliste.find(e => e.id === id) || null; }

  /** @param {string} typeId */
  links(typeId) { this.type(typeId); return this.linksPrType.get(typeId); }

  /** @param {string} typeId @param {string} navn */
  link(typeId, navn) { return this.links(typeId).find(l => l.navn === navn) || null; }

  /**
   * Slår en sti op: nul eller flere links efterfulgt af en egenskab (fx 'arrangeretAf.momentum'), eller kun links
   * (fx 'arrangeretAf' – så er egenskab null og stien peger på objekterne).
   * @param {string} typeId @param {string} sti
   * @returns {{led: Link[], egenskab: Egenskab|null, slutType: string}}
   */
  sti(typeId, sti) {
    const dele = sti.split('.');
    /** @type {Link[]} */
    const led = [];
    let t = typeId;
    for (let i = 0; i < dele.length; i++) {
      const l = this.link(t, dele[i]);
      if (l) { led.push(l); t = l.til; continue; }
      const e = this.egenskab(t, dele[i]);
      if (e && i === dele.length - 1) return {led, egenskab: e, slutType: t};
      throw new Error(`${typeId}: ukendt sti "${sti}" (stoppede ved "${dele[i]}" på ${t})`);
    }
    return {led, egenskab: null, slutType: t};
  }

  /** Stiens visningsnavn, fx "Arrangeret af → Momentum". @param {string} typeId @param {string} sti */
  stiLabel(typeId, sti) {
    const s = this.sti(typeId, sti);
    return [...s.led.map(l => l.label), ...(s.egenskab ? [s.egenskab.label] : [])].join(' → ');
  }

  /**
   * De stier, en bruger kan filtrere, gruppere og måle på: typens egne egenskaber og – ét link væk – de linkede
   * typers egenskaber. Interne egenskaber, objekter og det, rollen ikke må se, er udeladt.
   * @param {string} typeId @param {{rolle?: Adgang, dybde?: number}} [valg]
   * @returns {{sti: string, label: string, egenskab: Egenskab, viaLink: boolean}[]}
   */
  stier(typeId, {rolle = 'admin', dybde = 1} = {}) {
    const ok = e => !e.intern && e.type !== 'objekt' && tilladt(e.adgang, rolle);
    const ud = this.type(typeId).egenskabsliste.filter(ok).map(e => ({sti: e.id, label: e.label, egenskab: e, viaLink: false}));
    if (dybde > 0) {
      for (const l of this.links(typeId)) {
        if (!tilladt(this.type(l.til).adgang, rolle)) continue;
        for (const e of this.type(l.til).egenskabsliste.filter(ok)) {
          ud.push({sti: `${l.navn}.${e.id}`, label: `${l.label} → ${e.label}`, egenskab: e, viaLink: true});
        }
      }
    }
    return ud;
  }
}
