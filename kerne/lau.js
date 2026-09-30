// LAU's ontologi: foreningens objekttyper, egenskaber og links. Det er her, en ny egenskab eller objekttype tilføjes –
// derefter kan den straks bruges i filtre, grupperinger, mål, kortet og CSV-eksport.
//
// Beregnede egenskaber (beregn) bruger reglerne i regler.js. De får objektet og lageret og kan følge links.
// Personer og roller er defineret, men har endnu ingen data: de kommer i fase 2 (Supabase med personlige logins og
// adgang pr. række, så en lokal bestyrelse kun ser sin egen forening). Se docs/arkitektur.md.

import {Ontologi} from './ontologi.js';
import {afholdteMed, aktivitet, aktivitetsStatus, arrStatus, DELTAGER_MAAL, HB_RISIKO_NIVEAUER, HB_RISIKO_SPANDE, hbPrognose,
  hbRisikoDetaljer, kategori, kommuneAktivitet, median, momentum, MOMENTUM_NIVEAUER, normalniveau, rekord, starttid, STARTTID, varsel,
  varselDage, varselGruppe, VARSEL_GRUPPER} from './regler.js';
import {DAG, time, ugedag} from './tid.js';

/** @typedef {import('./ontologi.js').Objekt} Objekt @typedef {import('./lager.js').Lager} Lager */

export const ARR_STATUS = {
  planlagt: 'Planlagt', bekraeftet: 'Afholdt – bekræftet', afholdt: 'Afholdt ifølge Facebook', forsvundet: 'Fjernet fra Facebook',
  aflyst: 'Aflyst', ikke_afholdt: 'Ikke afholdt', skjult: 'Skjult',
};
export const AKTIVITET_STATUS = {
  snart: 'Aktivitet inden for det næste kvartal', planlagt: 'Aktiviteter planlagt senere', ingen: 'Intet planlagt',
  ingenfb: 'Ingen Facebook-side tilknyttet',
};
export const HB_STATUS = {
  plus_naeste: 'Aktivitet i alle kvartaler inkl. det indeværende + planlagt i næste kvartal',
  alle: 'Aktivitet i alle kvartaler inkl. det indeværende',
  planlagt_nu: 'Aktivitet i alle tidligere kvartaler – det indeværende har et planlagt arrangement',
  mangler_nu: 'Aktivitet i alle tidligere kvartaler – intet planlagt i det indeværende endnu',
  ikke: 'Mangler aktivitet i et kvartal – kan ikke HB-godkendes',
  ukendt: 'Historik mangler',
};
const KATEGORI = {'Foreningsmøde': 'Foreningsmøde', 'Kampagne': 'Kampagne', 'Oplæg & debat': 'Oplæg & debat', 'Socialt': 'Socialt', 'Andet': 'Andet'};
const UGEDAGE = {man: 'Mandag', tir: 'Tirsdag', ons: 'Onsdag', tor: 'Torsdag', fre: 'Fredag', loer: 'Lørdag', soen: 'Søndag'};
const TIDSRUM = {formiddag: 'Formiddag (før 12)', eftermiddag: 'Eftermiddag (12–17)', aften: 'Aften (fra 17)'};
const MOMENTUM = Object.fromEntries(Object.entries(MOMENTUM_NIVEAUER).map(([k, m]) => [k, m.label]));

// Genveje til foreningens aktivitet (beregnes én gang pr. forening og deles af de andre egenskaber).
/** @param {Objekt} f @param {Lager} L @returns {import('./regler.js').Aktivitet} */
const akt = (f, L) => L.vaerdi(f, 'aktivitet');
/** @param {Objekt} f */
const harFb = f => !!f.v.facebook;
const lokal = f => !f.v.national;
/** Lokalforeningernes navne (til afholdteMed: hvert arrangement tæller hos sin første lokalforening). @param {Lager} L */
const lokaleNavne = L => new Set(L.alle('Forening').filter(lokal).map(f => f.id));
/** "Hvad virker?": foreningens afholdte med et tal for målet. @param {Objekt} f @param {Lager} L @param {string} maal */
const medMaal = (f, L, maal) => afholdteMed(akt(f, L), f.v.navn, !!f.v.national, maal, lokaleNavne(L));

export const LAU = new Ontologi({
  typer: {
    Forening: {
      label: 'Forening', flertal: 'Foreninger', titel: 'navn', kilde: 'data/foreninger.json',
      egenskaber: {
        navn: {label: 'Navn', type: 'tekst'},
        niveau: {label: 'Lokal- eller landsforening', type: 'kat', vaerdier: {lokal: 'Lokalforening', lands: 'Landsforeningen'},
          beregn: f => (f.v.national ? 'lands' : 'lokal')},
        facebook: {label: 'Facebook-side', type: 'bool', beregn: harFb},
        aktivitet: {label: 'Aktivitet', type: 'objekt', intern: true,
          beregn: (f, L) => aktivitet(L.linkede(f, 'arrangementer').map(a => a.v.raw), f.v.navn, L.kontekst.daekning, L.nu)},
        status: {label: 'Aktivitet nu', type: 'kat', vaerdier: AKTIVITET_STATUS, beregn: (f, L) => aktivitetsStatus(akt(f, L), harFb(f))},
        afholdt90: {label: 'Afholdt de seneste 90 dage', type: 'tal', adgang: 'admin',
          beregn: (f, L) => akt(f, L).afholdt90.length},
        afholdtIAlt: {label: 'Afholdt i alt', type: 'tal', adgang: 'admin', beregn: (f, L) => akt(f, L).afholdt.length},
        planlagte: {label: 'Planlagte arrangementer', type: 'tal', beregn: (f, L) => akt(f, L).planlagt.length},
        sidsteArrangement: {label: 'Sidste afholdte arrangement', type: 'dato', beregn: (f, L) => akt(f, L).sidste},
        naesteArrangement: {label: 'Næste arrangement', type: 'dato', beregn: (f, L) => akt(f, L).naeste?.startD ?? null},
        dageSidenSidste: {label: 'Dage siden sidste arrangement', type: 'tal', adgang: 'admin',
          beregn: (f, L) => { const s = akt(f, L).sidste; return s ? Math.floor((+L.nu - +s) / DAG) : null; }},
        tilkendegivelser: {label: 'Tilkendegivelser pr. arrangement (gns.)', type: 'tal', adgang: 'admin',
          beregn: (f, L) => { const xs = akt(f, L).gyldige.filter(e => e.svar != null).map(e => e.svar); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }},
        varsel: {label: 'Varsel (median, dage)', type: 'tal', adgang: 'admin',
          beregn: (f, L) => median(akt(f, L).gyldige.map(e => varsel(e, L.kontekst.daekning.forsteKoersel)).filter(v => v != null))},
        fremmoede: {label: 'Registreret fremmøde i alt', type: 'tal', adgang: 'admin', beregn: (f, L) => {
          const xs = akt(f, L).afholdt.filter(e => e.fremmoede != null);
          return xs.length ? xs.reduce((s, e) => s + e.fremmoede, 0) : null;
        }},
        daekketFra: {label: 'Data dækker fra', type: 'tekst', adgang: 'admin', intern: true, beregn: (f, L) => akt(f, L).daekketFra},
        momentumDetaljer: {label: 'Momentum (detaljer)', type: 'objekt', adgang: 'admin', intern: true,
          beregn: (f, L) => (lokal(f) ? momentum(akt(f, L), harFb(f), L.nu) : null)},
        momentum: {label: 'Momentum', type: 'kat', adgang: 'admin', vaerdier: MOMENTUM,
          hint: 'Mindst ét arrangement om måneden? Se README: Momentum',
          beregn: (f, L) => L.vaerdi(f, 'momentumDetaljer')?.niveau ?? null},
        hbDetaljer: {label: 'HB (detaljer)', type: 'objekt', adgang: 'admin', intern: true,
          beregn: (f, L) => (lokal(f) ? hbPrognose(akt(f, L), harFb(f), L.nu) : null)},
        hb: {label: 'HB-prognose (næste år)', type: 'kat', adgang: 'admin', vaerdier: HB_STATUS,
          hint: 'Mindst ét afholdt arrangement i hvert kvartal (Organisationshåndbogen 8.2)',
          beregn: (f, L) => L.vaerdi(f, 'hbDetaljer')?.status ?? null},
        hbRisikoDetaljer: {label: 'HB-risiko (detaljer)', type: 'objekt', adgang: 'admin', intern: true,
          beregn: (f, L) => (lokal(f) ? hbRisikoDetaljer(akt(f, L), harFb(f), L.nu) : null)},
        hbRisiko: {label: 'HB-risiko (indeværende kvartal)', type: 'kat', adgang: 'admin', vaerdier: HB_RISIKO_NIVEAUER,
          hint: 'Mangler et afholdt arrangement i kvartalet – og hvor lidt tid er der tilbage? Se README: HB-risiko',
          beregn: (f, L) => L.vaerdi(f, 'hbRisikoDetaljer')?.niveau ?? null},
        hbRisikoSpand: {label: 'HB-risiko: hvad skal der gøres', type: 'kat', adgang: 'admin', vaerdier: HB_RISIKO_SPANDE,
          beregn: (f, L) => L.vaerdi(f, 'hbRisikoDetaljer')?.spand ?? null},
        antalKommuner: {label: 'Kommuner i området', type: 'tal', beregn: (f, L) => L.linkede(f, 'kommuner').length},
        // Hvide pletter: kun lokalforeninger med Facebook-side – uden den ved vi ikke, hvor foreningen er aktiv.
        kommuneAktivitet: {label: 'Aktivitet pr. kommune (detaljer)', type: 'objekt', adgang: 'admin', intern: true,
          beregn: (f, L) => (lokal(f) && harFb(f) ? kommuneAktivitet(akt(f, L), L.linkede(f, 'kommuner').map(k => k.v.navn), L.nu) : null)},
        hvidePletter: {label: 'Kommuner uden aktivitet (12 mdr.)', type: 'tal', adgang: 'admin',
          hint: 'Kommuner i området uden afholdte eller planlagte arrangementer det seneste år. Se README: Kommuner uden aktivitet',
          beregn: (f, L) => { const d = L.vaerdi(f, 'kommuneAktivitet'); return d ? [...d.kommuner.values()].filter(k => !k.afholdt && !k.planlagt).length : null; }},
        // "Hvad virker?": foreningens normale niveau pr. mål (deltager, svar, fremmoede) og arrangementernes indeks.
        normalniveau: {label: 'Normalt niveau (detaljer)', type: 'objekt', adgang: 'admin', intern: true,
          beregn: (f, L) => Object.fromEntries(Object.keys(DELTAGER_MAAL).map(m => [m, normalniveau(medMaal(f, L, m), m)]))},
        normaltDeltagere: {label: 'Deltagere pr. arrangement (median)', type: 'tal', adgang: 'admin',
          hint: 'Foreningens normale antal deltagere på Facebook – kræver mindst 3 afholdte med deltagere. Se README: Hvad virker?',
          beregn: (f, L) => L.vaerdi(f, 'normalniveau').deltager.median},
        rekordDetaljer: {label: 'Markant flere deltagere (detaljer)', type: 'objekt', adgang: 'admin', intern: true,
          beregn: (f, L) => (lokal(f) ? rekord(akt(f, L), m => medMaal(f, L, m), L.nu) : null)},
        rekord: {label: 'Markant flere deltagere end normalt', type: 'bool', adgang: 'admin',
          hint: 'Et arrangement de seneste 30 dage (eller planlagt de næste 14) med markant flere deltagere end normalt. Se README: Hvad virker?',
          beregn: (f, L) => (lokal(f) ? !!L.vaerdi(f, 'rekordDetaljer') : null)},
      },
    },

    Arrangement: {
      label: 'Arrangement', flertal: 'Arrangementer', titel: 'navn', kilde: 'Facebook via Apify (data/events.json) + rettelser',
      // Offentligt: kommende og afholdte det seneste år. Admins ser alle.
      raekkeadgang: (a, L, rolle) => rolle !== 'offentlig' || a.v.slut >= new Date(+L.nu - 365 * DAG),
      egenskaber: {
        navn: {label: 'Navn', type: 'tekst'},
        start: {label: 'Dato', type: 'dato'},
        slut: {label: 'Slut', type: 'dato', intern: true},
        sted: {label: 'Sted', type: 'tekst'},
        online: {label: 'Online', type: 'bool'},
        status: {label: 'Status', type: 'kat', vaerdier: ARR_STATUS, beregn: (a, L) => arrStatus(a.v.raw, L.nu)},
        kategori: {label: 'Type', type: 'kat', vaerdier: KATEGORI, beregn: a => kategori(a.v.raw)},
        ugedag: {label: 'Ugedag', type: 'kat', vaerdier: UGEDAGE, beregn: a => Object.keys(UGEDAGE)[ugedag(a.v.start)]},
        tidsrum: {label: 'Tidspunkt', type: 'kat', vaerdier: TIDSRUM,
          beregn: a => { const t = time(a.v.start); return t < 12 ? 'formiddag' : t < 17 ? 'eftermiddag' : 'aften'; }},
        kilde: {label: 'Kilde', type: 'kat', vaerdier: {facebook: 'Facebook', manuel: 'Tilføjet manuelt'}, beregn: a => (a.v.manuel ? 'manuel' : 'facebook')},
        landsforeningen: {label: 'Landsforeningens', type: 'bool', beregn: (a, L) => L.linkede(a, 'arrangeretAf').some(f => f.v.national)},
        deltager: {label: 'Deltagere (Facebook)', type: 'tal'},
        interesserede: {label: 'Interesserede (Facebook)', type: 'tal'},
        svar: {label: 'Tilkendegivelser', type: 'tal'},
        fremmoede: {label: 'Fremmøde (registreret)', type: 'tal', adgang: 'admin'},
        varsel: {label: 'Varsel (dage)', type: 'tal', adgang: 'admin', beregn: (a, L) => varsel(a.v.raw, L.kontekst.daekning.forsteKoersel)},
        // "Hvad virker?"s opdelinger og indeks.
        starttid: {label: 'Starttidspunkt', type: 'kat', vaerdier: STARTTID, beregn: a => starttid(a.v.start)},
        varselGruppe: {label: 'Varsel', type: 'kat', adgang: 'admin', vaerdier: VARSEL_GRUPPER,
          hint: 'Dage fra arrangementet dukkede op på Facebook, til det fandt sted (kun for dem, der er opdaget efter indsamlingens start)',
          beregn: (a, L) => varselGruppe(varselDage(a.v.raw, L.kontekst.daekning.forsteKoersel))},
        deltagerIndeks: {label: 'Deltagere i forhold til det normale (indeks)', type: 'tal', adgang: 'admin',
          hint: 'Deltagere ÷ arrangørens normale antal (median). 1 = som normalt. Afholdte, målt hos den første lokalforening blandt arrangørerne',
          beregn: (a, L) => {
            const lok = lokaleNavne(L), fs = L.linkede(a, 'arrangeretAf');
            const navn = a.v.raw.foreninger.find(n => lok.has(n)), f = fs.find(x => x.id === navn) || fs.find(x => x.v.national);
            return f ? L.vaerdi(f, 'normalniveau').deltager.arrangementer.find(x => x.e === a.v.raw)?.indeks ?? null : null;
          }},
        note: {label: 'Note', type: 'tekst', adgang: 'admin'},
        url: {label: 'Link', type: 'tekst', intern: true},
        raw: {label: 'Kildedata', type: 'objekt', intern: true},
      },
    },

    Kommune: {
      label: 'Kommune', flertal: 'Kommuner', titel: 'navn', kilde: 'geo/kommuner.topo.json + data/foreninger.json',
      egenskaber: {
        navn: {label: 'Navn', type: 'tekst'},
        aktivitetSenesteAar: {label: 'Arrangementer seneste år + planlagte', type: 'tal', hint: 'Hverken aflyste eller fjernede',
          beregn: (k, L) => L.linkede(k, 'arrangementer').filter(a => !a.v.aflyst && !a.v.forsvundet && a.v.slut >= new Date(+L.nu - 365 * DAG)).length},
        // Områdets egen lokalforening (kommuneAktivitet på Forening): null, hvis den ikke er med (fx uden Facebook-side).
        egenAktivitet: {label: 'Egen forenings aktivitet (detaljer)', type: 'objekt', adgang: 'admin', intern: true, beregn: (k, L) => {
          const f = L.linkede(k, 'forening')[0], d = f ? L.vaerdi(f, 'kommuneAktivitet') : null;
          return d ? d.kommuner.get(k.v.navn) ?? null : null;
        }},
        egneAfholdt: {label: 'Afholdt af områdets forening (12 mdr.)', type: 'tal', adgang: 'admin',
          beregn: (k, L) => L.vaerdi(k, 'egenAktivitet')?.afholdt ?? null},
        egnePlanlagte: {label: 'Planlagt af områdets forening', type: 'tal', adgang: 'admin',
          beregn: (k, L) => L.vaerdi(k, 'egenAktivitet')?.planlagt ?? null},
        hvidPlet: {label: 'Hvid plet (ingen aktivitet i 12 mdr.)', type: 'bool', adgang: 'admin',
          hint: 'Områdets lokalforening har hverken afholdt (seneste 12 mdr.) eller planlagt noget i kommunen. Kun foreninger med Facebook-side',
          beregn: (k, L) => { const a = L.vaerdi(k, 'egenAktivitet'); return a ? !a.afholdt && !a.planlagt : null; }},
      },
    },

    Person: {
      label: 'Person', flertal: 'Personer', titel: 'navn', adgang: 'forening', kilde: 'Supabase (fase 2)',
      egenskaber: {
        navn: {label: 'Navn', type: 'tekst'},
        by: {label: 'By', type: 'tekst'},
        indmeldt: {label: 'Indmeldt', type: 'dato'},
        foedselsaar: {label: 'Fødselsår', type: 'tal'},
        email: {label: 'E-mail', type: 'tekst', intern: true},
        telefon: {label: 'Telefon', type: 'tekst', intern: true},
      },
    },

    Rolle: {
      label: 'Rolle', flertal: 'Roller', titel: 'titel', adgang: 'forening', kilde: 'Supabase (fase 2)',
      egenskaber: {
        titel: {label: 'Titel', type: 'kat', vaerdier: {formand: 'Formand', naestformand: 'Næstformand', kasserer: 'Kasserer',
          bestyrelse: 'Bestyrelsesmedlem', suppleant: 'Suppleant', andet: 'Andet'}},
        fra: {label: 'Fra', type: 'dato'},
        til: {label: 'Til', type: 'dato'},
      },
    },
  },

  links: {
    arrangeretAf: {fra: 'Arrangement', til: 'Forening', mange: true, label: 'Arrangeret af', omvendt: {id: 'arrangementer', label: 'Arrangementer', mange: true}},
    afholdtI: {fra: 'Arrangement', til: 'Kommune', label: 'Afholdt i kommune', omvendt: {id: 'arrangementer', label: 'Arrangementer', mange: true}},
    kommuner: {fra: 'Forening', til: 'Kommune', mange: true, label: 'Kommuner', omvendt: {id: 'forening', label: 'Forening'}},
    medlemAf: {fra: 'Person', til: 'Forening', label: 'Medlem af', omvendt: {id: 'medlemmer', label: 'Medlemmer', mange: true}},
    rolleHos: {fra: 'Rolle', til: 'Person', label: 'Person', omvendt: {id: 'roller', label: 'Roller', mange: true}},
    rolleI: {fra: 'Rolle', til: 'Forening', label: 'Forening', omvendt: {id: 'bestyrelse', label: 'Bestyrelse og roller', mange: true}},
  },
});
