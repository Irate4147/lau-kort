// Enhedstests af kernen på et lille, fast datasæt.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bygFraJson, koer, valider, boreNed, prObjekt, objektVisning, Lager, LAU, Ontologi, regler, regler as R, tid, rapport as RAP} from '../kerne/index.js';

const NU = new Date('2026-09-29T10:00:00Z');
const ev = (id, forening, start, ekstra = {}) => ({id, forening, foreninger: [forening], navn: `Arrangement ${id}`, start,
  slut: start, foerst_set: '2026-01-01T00:00:00Z', historisk: true, aflyst: false, forsvundet: false, deltager: 10, ...ekstra});
const DATA = {
  foreninger: [
    {navn: 'Landsforeningen', national: true, facebook: 'x', kommuner: []},
    {navn: 'Fyn', facebook: 'x', kommuner: ['Odense', 'Svendborg']},
    {navn: 'Aarhus', facebook: 'x', kommuner: ['Aarhus']},
    {navn: 'Bornholm', facebook: '', kommuner: ['Bornholm']},
  ],
  events: [
    ev('1', 'Fyn', '2026-09-20T17:00:00Z', {kommune: 'Odense', navn: 'Debat med ordfører', deltager: 30}),
    ev('2', 'Fyn', '2026-08-10T17:00:00Z', {kommune: 'Odense', navn: 'Fredagsbar'}),
    ev('3', 'Fyn', '2026-10-05T17:00:00Z', {kommune: 'Svendborg', navn: 'Kampagne på torvet', historisk: false}),
    ev('4', 'Aarhus', '2026-05-01T10:00:00Z', {kommune: 'Aarhus', deltager: 4}),
    ev('5', 'Aarhus', '2026-09-01T10:00:00Z', {kommune: 'Aarhus', aflyst: true}),
    ev('6', 'Landsforeningen', '2026-09-10T10:00:00Z', {foreninger: ['Landsforeningen', 'Fyn'], navn: 'Landsmøde'}),
    ev('7', 'Aarhus', '2026-09-15T10:00:00Z', {navn: 'Dublet'}),
  ],
  meta: {koersler: [{tid: '2026-01-01T00:00:00Z'}], historik: {fra: '2026-01-01T00:00:00Z', koersler: []}},
  rettelser: {'7': {status: 'skjult'}, '4': {deltagere: 6}},
  nu: NU,
};
const L = bygFraJson(DATA);
const ids = r => r.objekter.map(o => o.id).sort();

test('lageret: objekter, links begge veje og rettelser', () => {
  assert.equal(L.alle('Arrangement').length, 6, 'skjult dublet er udeladt');
  assert.deepEqual(L.linkede(L.hent('Forening', 'Fyn'), 'arrangementer').map(o => o.id).sort(), ['1', '2', '3', '6']);
  assert.equal(L.linkede(L.hent('Kommune', 'Odense'), 'forening')[0].id, 'Fyn');
  assert.equal(L.vaerdi(L.hent('Forening', 'Fyn'), 'antalKommuner'), 2);
  // Alle beregnede egenskaber kan beregnes for alle objekter (fanger fx et forkert linknavn i en beregning).
  for (const t of LAU.typer.values()) for (const o of L.alle(t.id)) for (const e of t.egenskabsliste) L.vaerdi(o, e.id);
  assert.equal(L.vaerdi(L.hent('Arrangement', '4'), 'fremmoede'), 6, 'rettelsens fremmøde');
  assert.equal(L.vaerdi(L.hent('Arrangement', '1'), 'kategori'), 'Oplæg & debat');
  assert.equal(L.vaerdi(L.hent('Arrangement', '3'), 'status'), 'planlagt');
  assert.equal(L.vaerdi(L.hent('Arrangement', '5'), 'status'), 'aflyst');
});

test('stier gennem links', () => {
  const a = L.hent('Arrangement', '6');
  assert.deepEqual(L.vaerdier(a, 'arrangeretAf.navn').sort(), ['Fyn', 'Landsforeningen']);
  assert.deepEqual(L.vaerdier(L.hent('Kommune', 'Odense'), 'forening.momentum'), ['godt']);
  assert.equal(LAU.stiLabel('Arrangement', 'arrangeretAf.momentum'), 'Arrangeret af → Momentum');
  assert.throws(() => LAU.sti('Arrangement', 'findesIkke'));
});

test('filtre: kategori, tal, dato, gennem link og link-filtre', () => {
  assert.deepEqual(ids(koer(L, {type: 'Arrangement', filtre: [{egenskab: 'kategori', er: ['Socialt']}]})), ['2']);
  assert.deepEqual(ids(koer(L, {type: 'Arrangement', filtre: [{egenskab: 'deltager', min: 20}]})), ['1']);
  assert.deepEqual(ids(koer(L, {type: 'Arrangement', filtre: [{egenskab: 'navn', indeholder: 'DEBAT'}]})), ['1']);
  assert.deepEqual(ids(koer(L, {type: 'Arrangement', filtre: [{egenskab: 'start', periode: 'seneste30'}]})), ['1', '5', '6']);
  assert.deepEqual(ids(koer(L, {type: 'Arrangement', filtre: [{egenskab: 'start', periode: 'egen', fra: '2026-08-01', til: '2026-08-31'}]})), ['2']);
  assert.deepEqual(ids(koer(L, {type: 'Arrangement', filtre: [{egenskab: 'afholdtI.navn', er: [null]}]})), ['6'], 'uden kommune');
  // Foreninger uden noget planlagt de næste 30 dage.
  const uden = koer(L, {type: 'Forening', filtre: [{egenskab: 'niveau', er: ['lokal']},
    {link: 'arrangementer', ingen: true, filtre: [{egenskab: 'start', periode: 'naeste30'}, {egenskab: 'status', er: ['planlagt']}]}]});
  assert.deepEqual(ids(uden), ['Aarhus', 'Bornholm']);
});

test('search around, gruppering, mål og boring ned', () => {
  const r = koer(L, {type: 'Kommune', filtre: [{egenskab: 'navn', er: ['Odense', 'Svendborg']}], searchAround: [{link: 'arrangementer'}],
    gruppering: {egenskab: 'kategori'}, maal: {funktion: 'sum', egenskab: 'deltager'}});
  assert.equal(r.type, 'Arrangement');
  assert.deepEqual(r.grupper.map(g => [g.noegle, g.vaerdi]), [['Kampagne', 10], ['Oplæg & debat', 30], ['Socialt', 10]], 'i ontologiens rækkefølge');
  const ned = boreNed(LAU, {type: 'Kommune', searchAround: [{link: 'arrangementer'}], gruppering: {egenskab: 'kategori'}}, r.grupper[1]);
  assert.deepEqual(ned.searchAround[0].filtre, [{egenskab: 'kategori', er: ['Oplæg & debat']}]);
  assert.deepEqual(ids(koer(L, ned)), ['1']);
  const pr = koer(L, {type: 'Arrangement', gruppering: {egenskab: 'start', pr: 'kvartal'}});
  assert.deepEqual(pr.grupper.map(g => g.noegle), ['2026-Q2', '2026-Q3', '2026-Q4']);
  const q3 = boreNed(LAU, {type: 'Arrangement', gruppering: {egenskab: 'start', pr: 'kvartal'}}, pr.grupper[1]);
  assert.equal(q3.gruppering.pr, 'maaned', 'kvartal → måned');
  assert.equal(koer(L, q3).objekter.length, 4, 'Q3: 1, 2, 5 og 6');
});

test('mål pr. forening (til kortet)', () => {
  const r = koer(L, {type: 'Arrangement', filtre: [{egenskab: 'status', er: ['afholdt']}]});
  const pr = prObjekt(L, r, {funktion: 'antal'}, 'Forening');
  assert.deepEqual([...pr].map(([f, v]) => [f.id, v]).sort(), [['Aarhus', 1], ['Fyn', 3], ['Landsforeningen', 1]]);
});

test('adgang: offentlig ser hverken momentum, fremmøde, personer eller gamle arrangementer', () => {
  const O = bygFraJson({...DATA, rolle: 'offentlig', nu: new Date('2027-06-01T00:00:00Z')});
  assert.equal(O.vaerdi(O.hent('Forening', 'Fyn'), 'momentum'), null);
  assert.equal(O.alle('Person').length, 0);
  assert.equal(O.alle('Arrangement').length, 5, 'kun det seneste år (4 er for gammelt)');
  assert.ok(!LAU.stier('Forening', {rolle: 'offentlig'}).some(s => s.sti === 'momentum'));
  assert.ok(LAU.stier('Forening', {rolle: 'admin'}).some(s => s.sti === 'arrangementer.kategori'));
});

test('validering fanger fejl i forespørgsler', () => {
  assert.deepEqual(valider(LAU, {type: 'Forening', gruppering: {egenskab: 'momentum'}}), []);
  assert.equal(valider(LAU, {type: 'Forening', filtre: [{egenskab: 'nej'}]}).length, 1);
  assert.equal(valider(LAU, {type: 'Forening', maal: {funktion: 'sum', egenskab: 'navn'}}).length, 1);
  assert.equal(valider(LAU, {type: 'Findes'}).length, 1);
  assert.throws(() => koer(L, {type: 'Forening', searchAround: [{link: 'nej'}]}));
});

test('ontologien afviser dobbelte navne og ukendte typer', () => {
  assert.throws(() => new Ontologi({typer: {A: {label: 'A', flertal: 'A', titel: 'x', egenskaber: {x: {label: 'x', type: 'tekst'}}}},
    links: {l: {fra: 'A', til: 'B', label: 'l', omvendt: {id: 'm', label: 'm'}}}}), /ukendt type/);
  assert.throws(() => new Ontologi({typer: {A: {label: 'A', flertal: 'A', titel: 'x', egenskaber: {x: {label: 'x', type: 'tekst'}}}},
    links: {x: {fra: 'A', til: 'A', label: 'l', omvendt: {id: 'y', label: 'y'}}}}), /to gange/);
});

test('objektvisning: egenskaber og links efter rolle, uden interne, tomme og udeladte', () => {
  const O = bygFraJson({...DATA, nu: new Date('2027-09-15T00:00:00Z')}), fyn = O.hent('Forening', 'Fyn');
  const ids = v => v.egenskaber.map(x => x.egenskab.id);
  const admin = objektVisning(O, fyn), off = objektVisning(O, fyn, {rolle: 'offentlig'});
  assert.ok(ids(admin).includes('momentum') && ids(admin).includes('afholdtIAlt'));
  assert.ok(!ids(admin).some(id => LAU.egenskab('Forening', id).intern), 'ingen interne');
  assert.ok(!ids(off).some(id => LAU.egenskab('Forening', id).adgang === 'admin'), 'offentlig: ingen admin-egenskaber');
  assert.ok(!ids(admin).includes('naesteArrangement'), 'uden værdi (intet planlagt) udelades');
  assert.equal(admin.egenskaber.find(x => x.egenskab.id === 'antalKommuner').tekst, '2');
  assert.ok(!ids(objektVisning(O, fyn, {udelad: ['momentum']})).includes('momentum'));
  // Linkene: arrangementer med status-fordeling (offentligt kun det seneste år), kommuner; personer har ingen data.
  const link = (v, navn) => v.links.find(l => l.link.navn === navn);
  assert.deepEqual(admin.links.map(l => l.link.navn), ['arrangementer', 'kommuner']);
  assert.equal(link(admin, 'arrangementer').objekter.length, 4);
  assert.equal(link(off, 'arrangementer').objekter.length, 2, 'offentlig: kun det seneste år');
  assert.deepEqual(link(admin, 'arrangementer').fordeling.grupper.map(g => [g.noegle, g.antal]), [['afholdt', 4]]);
  assert.equal(link(admin, 'kommuner').fordeling.egenskab.id, 'hvidPlet', 'Kommune har ingen kategori: første ja/nej');
  assert.equal(link(off, 'kommuner').fordeling, null, 'hvidPlet er kun for admins');
  assert.equal(objektVisning(O, fyn, {udelad: ['kommuner']}).links.length, 1);
});

test('objektvisning: en ny egenskab eller et nyt link i ontologien kommer med uden ny kode', () => {
  const ont = new Ontologi({
    typer: {
      A: {label: 'A', flertal: 'A', titel: 'navn', egenskaber: {navn: {label: 'Navn', type: 'tekst'},
        ny: {label: 'Ny', type: 'tal', beregn: (o, L) => L.linkede(o, 'bs').length * 10},
        hemmelig: {label: 'Hemmelig', type: 'tekst', adgang: 'admin'}}},
      B: {label: 'B', flertal: 'B', titel: 'navn', egenskaber: {navn: {label: 'Navn', type: 'tekst'},
        farve: {label: 'Farve', type: 'kat', vaerdier: {roed: 'Rød', blaa: 'Blå'}}}},
    },
    links: {til: {fra: 'B', til: 'A', label: 'Til', omvendt: {id: 'bs', label: 'B\'er', mange: true}}},
  });
  const S = new Lager(ont), a = S.tilfoej('A', 'a', {navn: 'a', hemmelig: 'x'});
  for (const [id, farve] of [['1', 'blaa'], ['2', 'roed'], ['3', 'blaa']]) S.forbind('til', S.tilfoej('B', id, {navn: id, farve}), a);
  const v = objektVisning(S, a);
  assert.deepEqual(v.egenskaber.map(x => [x.egenskab.id, x.tekst]), [['navn', 'a'], ['ny', '30'], ['hemmelig', 'x']]);
  assert.deepEqual(objektVisning(S, a, {rolle: 'offentlig'}).egenskaber.map(x => x.egenskab.id), ['navn', 'ny']);
  assert.deepEqual(v.links.map(l => [l.link.label, l.objekter.length, l.fordeling.grupper.map(g => `${g.label} ${g.antal}`)]),
    [["B'er", 3, ['Rød 1', 'Blå 2']]], 'fordelingen står i kategoriens rækkefølge');
});

// ---------------------------------------------------------------- regler, som scripts/hb.py og rapport.py bruger via scripts/kerne.js

const X = [{navn: 'X', facebook: 'x'}];
const DK = regler.beregnDaekning({koersler: [{tid: '2026-01-01T00:00:00Z'}]}, [], X, NU);
const forb = (id, start, slut = start, ekstra = {}) => ({id, start, slut, startD: new Date(start), slutD: new Date(slut), foreninger: ['X'], ...ekstra});
const aktX = (nu, evs) => regler.aktivitet(evs, 'X', DK, new Date(nu));
const Q12 = [forb('a', '2026-02-10T17:00:00Z'), forb('b', '2026-05-10T17:00:00Z')];

test('tid: kalenderdage og dagPlus (også hen over sommertid og årsskifte)', () => {
  assert.equal(tid.dagPlus('2026-10-01', -1), '2026-09-30');
  assert.equal(tid.dagPlus('2026-12-31', 1), '2027-01-01');
  assert.equal(tid.kalenderdage('2026-03-28', '2026-03-30'), 2);
  assert.equal(tid.kalenderdage('2026-09-30', '2026-09-29'), -1);
});

test('HB-risiko: grænserne for niveauerne', () => {
  const n = regler.hbRisikoNiveau;
  assert.deepEqual([n('mangler', 14, false), n('mangler', 15, false), n('mangler', 45, false), n('mangler', 46, false)],
    ['kritisk', 'advarsel', 'advarsel', 'opmaerksom']);
  assert.deepEqual([n('planlagt', 21, false), n('planlagt', 22, false)], ['advarsel', 'opmaerksom']);
  assert.deepEqual([n('ja', 0, false), n('ja', 0, true), n('ukendt', 3, false)], ['sikret', 'tabt', 'ukendt']);
});

test('HB-risiko: indeværende kvartal, dage tilbage og tabte kvartaler', () => {
  const planlagt = [...Q12, forb('c', '2026-09-25T17:00:00Z')];
  const r = regler.hbRisiko(aktX('2026-09-10T10:00:00Z', planlagt), true, new Date('2026-09-10T10:00:00Z'));
  assert.deepEqual({...r, planlagt: r.planlagt.map(e => e.id)},
    {niveau: 'advarsel', kvartal: 'Q3', sidsteDag: '2026-09-30', dage: 20, status: 'planlagt', tabte: [], afholdt: [], planlagt: ['c']});
  assert.equal(regler.hbRisiko(aktX('2026-09-05T10:00:00Z', planlagt), true, new Date('2026-09-05T10:00:00Z')).niveau, 'opmaerksom');
  const intet = regler.hbRisiko(aktX('2026-09-16T21:30:00Z', Q12), true, new Date('2026-09-16T21:30:00Z'));
  assert.deepEqual([intet.niveau, intet.dage, intet.status], ['kritisk', 14, 'mangler']);
  const tabt = regler.hbRisiko(aktX('2026-09-16T10:00:00Z', [Q12[1]]), true, new Date('2026-09-16T10:00:00Z'));
  assert.deepEqual([tabt.niveau, tabt.tabte], ['tabt', ['Q1']]);
});

test('HB-prognose: afholdt er slut – og et andet år regnes som afsluttet (scripts/hb.py ÅR)', () => {
  // Et arrangement, der er begyndt, men ikke slut, er planlagt (som på siden).
  const lang = [...Q12, forb('c', '2026-09-29T08:00:00Z', '2026-10-02T12:00:00Z')];
  const nu = new Date('2026-09-30T21:30:00Z');
  assert.equal(regler.hbPrognose(aktX(nu, lang), true, nu).status, 'planlagt_nu');
  assert.equal(regler.iKvartal(lang[2], {fra: '2026-07-01', til: '2026-10-01'}), true);
  const senere = new Date('2027-01-10T10:00:00Z');
  const aaret = regler.hbPrognose(aktX(senere, lang), true, senere, 2026);
  assert.deepEqual(aaret, {status: 'ikke', aar: 2027, kvartaler: {Q1: 'ja', Q2: 'ja', Q3: 'ja', Q4: 'nej'}});
  const fire = [...lang, forb('d', '2026-11-10T17:00:00Z')];
  assert.equal(regler.hbPrognose(aktX(senere, fire), true, senere, 2026).status, 'alle');
  assert.equal(regler.hbPrognose(aktX(senere, fire), true, senere).aar, 2028, 'standard: året for nu');
});

test('snapshots: tilstandVed viser kun, hvad man vidste dengang', () => {
  const t = new Date('2026-06-01T00:00:00Z');
  const e = forb('e', '2026-06-20T17:00:00Z', '2026-06-20T19:00:00Z', {foerst_set: '2026-05-01T00:00:00Z', aflyst: true, forsvundet: false});
  assert.equal(regler.tilstandVed({...e, foerst_set: '2026-06-02T00:00:00Z'}, t), null, 'ikke set endnu');
  assert.equal(regler.tilstandVed(e, t).aflyst, false, 'aflysningen fra Facebook kom senere');
  const rettet = {...e, rettelse: {status: 'ikke_afholdt', rettet: '2026-05-15T00:00:00Z'}};
  assert.equal(regler.tilstandVed(rettet, t).aflyst, true, 'rettet som ikke afholdt før tidspunktet');
  assert.equal(regler.tilstandVed({...rettet, rettelse: {status: 'ikke_afholdt'}}, t).aflyst, true, 'uden tidsstempel: altid kendt');
  const vaek = {...e, aflyst: false, forsvundet: true};
  assert.equal(regler.tilstandVed({...vaek, sidst_set: '2026-05-20T00:00:00Z'}, t).forsvundet, true);
  assert.equal(regler.tilstandVed({...vaek, sidst_set: '2026-06-10T00:00:00Z'}, t).forsvundet, false);
  const afholdt = forb('f', '2026-05-01T17:00:00Z', '2026-05-01T19:00:00Z', {foerst_set: '2026-05-30T00:00:00Z', aflyst: true});
  assert.equal(regler.tilstandVed(afholdt, t), afholdt, 'afholdte er, som vi kender dem nu');
  assert.equal(+regler.kendtFra({start: '2026-02-10T17:00:00Z', manuel: true, rettelse: {rettet: '2026-03-01T00:00:00Z'}}),
    +new Date('2026-03-01T00:00:00Z'));
});

// ---------------------------------------------------------------- analysernes regler på faste datoer

// Et lille datasæt direkte på reglerne: data dækker fra 1. jan. 2026.
const DKF = {ugentligFra: '2026-01-01', fra: '2026-01-01', fraFor: new Map(), hentet: new Set(), forsteKoersel: new Date('2026-01-01T00:00:00Z')};
const arr = (start, ekstra = {}) => ({id: start, navn: `Arr. ${start}`, foreninger: ['X'], startD: new Date(start), slutD: new Date(start),
  firstD: new Date('2026-01-01T00:00:00Z'), aflyst: false, forsvundet: false, ...ekstra});
const HALVAAR = [arr('2026-02-01T18:00:00Z'), arr('2026-05-01T18:00:00Z')];
/** @param {any[]} events @param {string} nu */
const risiko = (events, nu, {facebook = true, daekning = DKF} = {}) => {
  const d = new Date(nu), a = R.aktivitet(events, 'X', daekning, d);
  return R.hbRisikoDetaljer(a, facebook, d);
};

test('HB-risiko: niveau og spand efter dage tilbage af kvartalet', () => {
  const kort = r => [r.niveau, r.spand, r.dage];
  // Intet afholdt eller planlagt i Q3 (sidste dag 30. sep.).
  assert.deepEqual(kort(risiko(HALVAAR, '2026-09-16T10:00:00Z')), ['kritisk', 'handle', 14]);
  assert.deepEqual(kort(risiko(HALVAAR, '2026-09-15T22:30:00Z')), ['kritisk', 'handle', 14], 'dansk tid: allerede 16. sep.');
  assert.deepEqual(kort(risiko(HALVAAR, '2026-09-15T10:00:00Z')), ['advarsel', 'handle', 15]);
  assert.deepEqual(kort(risiko(HALVAAR, '2026-08-16T10:00:00Z')), ['advarsel', 'handle', 45]);
  assert.deepEqual(kort(risiko(HALVAAR, '2026-08-15T10:00:00Z')), ['opmaerksom', 'hold', 46]);
  // Kun reddet af et planlagt arrangement.
  const plan = [...HALVAAR, arr('2026-09-25T17:00:00Z')];
  assert.deepEqual(kort(risiko(plan, '2026-09-09T10:00:00Z')), ['advarsel', 'planlagt', 21]);
  assert.deepEqual(kort(risiko(plan, '2026-09-08T10:00:00Z')), ['opmaerksom', 'hold', 22]);
  const r = risiko(plan, '2026-09-20T10:00:00Z');
  assert.equal(r.status, 'planlagt');
  assert.deepEqual(r.planlagt.map(e => e.id), ['2026-09-25T17:00:00Z']);
  assert.equal(r.sidsteDag, '2026-09-30');
});

test('HB-risiko: i hus, tabt, ukendt og det næste kvartal', () => {
  const s = risiko([...HALVAAR, arr('2026-09-01T17:00:00Z'), arr('2026-10-10T17:00:00Z'), arr('2027-01-10T17:00:00Z')], '2026-09-20T10:00:00Z');
  assert.deepEqual([s.niveau, s.spand, s.afholdt.length, s.naesteKv.length], ['sikret', 'sikret', 1, 1]);
  // Q4: intet næste kvartal samme år.
  const q4 = risiko([...HALVAAR, arr('2026-08-01T17:00:00Z'), arr('2027-01-10T17:00:00Z')], '2026-12-20T10:00:00Z');
  assert.deepEqual([q4.kvartal, q4.niveau, q4.dage, q4.naesteKv.length], ['Q4', 'kritisk', 11, 0]);
  // Et afsluttet kvartal uden afholdt arrangement: tabt, også selvom det indeværende er i hus.
  const t = risiko([HALVAAR[0], arr('2026-09-01T17:00:00Z')], '2026-09-20T10:00:00Z');
  assert.deepEqual([t.niveau, t.spand, t.tabte], ['tabt', 'tabt', ['Q2']]);
  // Uden Facebook-side og intet i kvartalet: kan ikke vurderes.
  assert.equal(risiko(HALVAAR, '2026-09-20T10:00:00Z', {facebook: false}).niveau, 'ukendt');
  // Data dækker først fra maj: Q1 er ukendt, men Q3 i hus.
  const u = risiko([HALVAAR[1], arr('2026-09-01T17:00:00Z')], '2026-09-20T10:00:00Z', {daekning: {...DKF, ugentligFra: '2026-05-01'}});
  assert.deepEqual([u.niveau, u.ukendte], ['sikret', ['Q1']]);
});

test('HB-risiko som egenskab i ontologien', () => {
  const O = bygFraJson({...DATA, events: [...DATA.events, ev('8', 'Aarhus', '2026-02-01T10:00:00Z'), ev('9', 'Aarhus', '2026-09-02T10:00:00Z')]});
  assert.equal(O.vaerdi(O.hent('Forening', 'Aarhus'), 'hbRisiko'), 'sikret', 'Q1, Q2 og Q3 afholdt');
  assert.equal(O.vaerdi(O.hent('Forening', 'Fyn'), 'hbRisiko'), 'tabt', 'intet i Q1');
  assert.equal(O.vaerdi(O.hent('Forening', 'Fyn'), 'hbRisikoSpand'), 'tabt');
  assert.equal(O.vaerdi(O.hent('Forening', 'Landsforeningen'), 'hbRisiko'), null, 'kun lokalforeninger');
  const g = koer(O, {type: 'Forening', filtre: [{egenskab: 'niveau', er: ['lokal']}], gruppering: {egenskab: 'hbRisiko'}});
  assert.deepEqual(g.grupper.map(x => [x.noegle, x.vaerdi]), [['sikret', 1], ['tabt', 1], ['ukendt', 1]]);
});

test('hvide pletter: aktivitet pr. kommune i foreningens område (12 mdr.)', () => {
  const k = (O, navn, e) => O.vaerdi(O.hent('Kommune', navn), e), f = (O, navn, e) => O.vaerdi(O.hent('Forening', navn), e);
  // 29. sep. 2026: Odense har to afholdte, Svendborg ét planlagt; Landsmødet (uden kommune) tælles for sig.
  assert.deepEqual([k(L, 'Odense', 'egneAfholdt'), k(L, 'Odense', 'egnePlanlagte'), k(L, 'Svendborg', 'egnePlanlagte')], [2, 0, 1]);
  assert.deepEqual([k(L, 'Odense', 'hvidPlet'), k(L, 'Svendborg', 'hvidPlet'), k(L, 'Aarhus', 'hvidPlet')], [false, false, false]);
  const d = f(L, 'Fyn', 'kommuneAktivitet');
  assert.deepEqual([d.ukendt, d.udenfor, f(L, 'Fyn', 'hvidePletter')], [1, 0, 0]);
  // Uden Facebook-side eller for landsforeningen: ikke med.
  assert.deepEqual([k(L, 'Bornholm', 'hvidPlet'), f(L, 'Bornholm', 'hvidePletter'), f(L, 'Landsforeningen', 'hvidePletter')], [null, null, null]);
  // Et år senere: Aarhus' arrangement fra maj 2026 er for gammelt, og det aflyste tæller ikke.
  const O = bygFraJson({...DATA, nu: new Date('2027-09-15T10:00:00Z')});
  assert.deepEqual([k(O, 'Odense', 'egneAfholdt'), k(O, 'Svendborg', 'egneAfholdt'), k(O, 'Aarhus', 'hvidPlet'), f(O, 'Aarhus', 'hvidePletter')], [1, 1, true, 1]);
  assert.deepEqual(ids(koer(O, {type: 'Kommune', filtre: [{egenskab: 'hvidPlet', er: [true]}]})), ['Aarhus']);
  // Et arrangement i en kommune uden for området.
  const u = R.kommuneAktivitet(R.aktivitet([arr('2026-09-01T17:00:00Z', {kommune: 'Aalborg'})], 'X', DKF, NU), ['Odense'], NU);
  assert.deepEqual([u.udenfor, u.ukendt, u.kommuner.get('Odense')], [1, 0, {afholdt: 0, planlagt: 0}]);
});

test('"Hvad virker?": median, starttid og varsel', () => {
  assert.deepEqual([R.median([3, 1, 2]), R.median([4, 1, 3, 2]), R.median([])], [2, 2.5, null]);
  // Dansk tid: sommertid (UTC+2) og vintertid (UTC+1).
  assert.deepEqual(['2026-09-20T09:59:00Z', '2026-09-20T10:00:00Z', '2026-09-20T15:00:00Z', '2026-09-20T17:00:00Z', '2026-12-01T17:30:00Z']
    .map(t => R.starttid(new Date(t))), ['foer12', 'kl12', 'kl17', 'kl19', 'kl17']);
  const fk = DKF.forsteKoersel, ny = {historisk: false, manuel: false, firstD: new Date('2026-03-01T12:00:00Z')};
  assert.equal(R.varselDage(arr('2026-03-10T12:00:00Z', ny), fk), 9);
  assert.equal(R.varselGruppe(R.varselDage(arr('2026-03-10T12:00:00Z', ny), fk)), 'd7');
  assert.equal(R.varselDage(arr('2026-02-20T12:00:00Z', ny), fk), null, 'opdaget efter, det fandt sted');
  assert.equal(R.varselDage(arr('2026-03-10T12:00:00Z', {...ny, historisk: true}), fk), null, 'hentet bagudrettet');
  assert.deepEqual([0, 6.9, 7, 13.9, 14, 27.9, 28, null].map(R.varselGruppe), ['u7', 'u7', 'd7', 'd7', 'd14', 'd14', 'd28', null]);
});

test('"Hvad virker?": normalt niveau, indeks og markant flere deltagere', () => {
  const lokale = new Set(['X', 'Y']);
  const a = R.aktivitet([arr('2026-06-01T17:00:00Z', {deltager: 10}), arr('2026-07-01T17:00:00Z', {deltager: 20, foreninger: ['Landsforeningen', 'X']}),
    arr('2026-08-01T17:00:00Z', {deltager: 30, foreninger: ['Y', 'X']}), arr('2026-08-15T17:00:00Z', {deltager: null})], 'X', DKF, NU);
  // Hvert arrangement tæller kun hos den første lokalforening blandt arrangørerne; landsforeningen får alle sine.
  assert.equal(R.afholdteMed(a, 'X', false, 'deltager', lokale).length, 2);
  assert.equal(R.afholdteMed(a, 'X', true, 'deltager', lokale).length, 3);
  const n2 = R.normalniveau(R.afholdteMed(a, 'X', false, 'deltager', lokale), 'deltager');
  assert.deepEqual([n2.n, n2.median, n2.arrangementer.length], [2, null, 0], 'færre end MIN_FORENING');
  const n3 = R.normalniveau(R.afholdteMed(a, 'X', true, 'deltager', lokale), 'deltager');
  assert.deepEqual([n3.median, n3.arrangementer.map(x => x.indeks)], [20, [0.5, 1, 1.5]]);
  assert.equal(R.normalniveau([arr('1', {deltager: 0}), arr('2', {deltager: 0}), arr('3', {deltager: 0})], 'deltager').median, null, 'median 0');

  // Markant flere: 30 mod normalt 10 (tre andre); et planlagt med 40 på Facebook er større; fremmøde går forud.
  const tre = ['2026-05-01', '2026-06-01', '2026-07-01'].map(d => arr(`${d}T17:00:00Z`, {deltager: 10, fremmoede: 8}));
  const med = (evs, nu = NU) => { const x = R.aktivitet(evs, 'X', DKF, nu); return R.rekord(x, m => R.afholdteMed(x, 'X', false, m, lokale), nu); };
  const r1 = med([...tre, arr('2026-09-20T17:00:00Z', {deltager: 30})]);
  assert.deepEqual([r1.maal, r1.x, r1.m, r1.gange, r1.afholdt], ['deltager', 30, 10, 3, true]);
  const r2 = med([...tre, arr('2026-09-20T17:00:00Z', {deltager: 30}), arr('2026-10-10T17:00:00Z', {deltager: 40})]);
  assert.deepEqual([r2.x, r2.afholdt], [40, false]);
  assert.equal(med([...tre, arr('2026-10-20T17:00:00Z', {deltager: 40})]), null, 'planlagt mere end 14 dage frem');
  assert.equal(med([...tre, arr('2026-08-20T17:00:00Z', {deltager: 30})]), null, 'afholdt for mere end 30 dage siden');
  assert.equal(med([...tre, arr('2026-09-20T17:00:00Z', {deltager: 14})]), null, 'under 1,5 ×');
  const r3 = med([...tre, arr('2026-09-20T17:00:00Z', {deltager: 30, fremmoede: 12})]);
  assert.equal(r3, null, 'fremmøde (12 mod 8) går forud for Facebook – og er ikke markant');
  const r4 = med([...tre, arr('2026-09-20T17:00:00Z', {deltager: 11, fremmoede: 20})]);
  assert.deepEqual([r4.maal, r4.x, r4.m], ['fremmoede', 20, 8]);
});

test('"Hvad virker?" som egenskaber i ontologien', () => {
  const O = bygFraJson({...DATA, events: [...DATA.events, ev('10', 'Fyn', '2026-07-01T17:00:00Z', {deltager: 8})]});
  const f = (navn, e) => O.vaerdi(O.hent('Forening', navn), e), a = (id, e) => O.vaerdi(O.hent('Arrangement', id), e);
  // Fyn: 1 (30), 2 (10), 6 (10 – landsforeningen og Fyn) og 10 (8). Landsforeningen har kun 6.
  assert.deepEqual([f('Fyn', 'normaltDeltagere'), f('Landsforeningen', 'normaltDeltagere')], [10, null]);
  assert.deepEqual([a('1', 'deltagerIndeks'), a('6', 'deltagerIndeks'), a('3', 'deltagerIndeks')], [3, 1, null], 'planlagte har intet indeks');
  assert.deepEqual([a('1', 'starttid'), a('4', 'starttid')], ['kl19', 'kl12']);
  assert.deepEqual([f('Fyn', 'rekord'), f('Aarhus', 'rekord'), f('Landsforeningen', 'rekord')], [true, false, null]);
  assert.equal(f('Fyn', 'rekordDetaljer').e.id, '1');
});

// ---------------------------------------------------------------- månedsrapporten (kerne/rapport.js)

test('månedsrapport: faldet eller forbedret (som scripts/rapport.py)', () => {
  const s = (ma, mb, ha, hb, hbSamme = true, kvSamme = true) => RAP.sammenlign({momentum: {start: ma, slut: mb}, hb: {start: ha, slut: hb}}, hbSamme, kvSamme);
  assert.deepEqual(s('godt', 'hjaelp', null, null), {ned: true, op: null, mom: ['godt', 'hjaelp'], hb: null});
  assert.equal(s('hjaelp', 'godt', null, null).op, true);
  assert.equal(s('ukendt', 'godt', null, null).mom, null, 'ukendt sammenlignes ikke');
  assert.deepEqual(s(null, null, 'alle', 'mangler_nu', true, false).hb, null, 'nyt kvartal nulstiller HB-prognosen');
  assert.deepEqual(s(null, null, 'alle', 'ikke', true, false).hb, ['alle', 'ikke'], '… men "ikke" tæller');
  assert.equal(s(null, null, 'alle', 'ikke', false, true).hb, null, 'andet HB-år');
});

test('månedsrapport: denne måned indtil nu', () => {
  const r = RAP.maanedIndtilNu(L);
  assert.deepEqual([r.maaned, r.fra, r.til, r.start], ['2026-09', '2026-09-01', '2026-10-01', null]);
  assert.deepEqual([r.total.afholdt, r.total.aflyst, r.total.aktive, r.total.lokale, r.total.uden_data], [2, 1, 1, 3, 1]);
  assert.deepEqual(r.hoejdepunkter.uden_aktivitet.map(x => [x.forening, x.sidste]), [['Aarhus', '2026-05-01']]);
  assert.deepEqual(r.foreninger.Fyn.afholdt.map(e => e.id), ['6', '1']);
  // Med et snapshot fra månedens start: Fyn er gået fra "Brug for hjælp" til "Godt i gang", Aarhus' aflysning var kendt.
  const snap = {tid: '2026-09-01T00:00:00Z', hb_aar: 2027, foreninger: {Fyn: {niveau: 'hjaelp', hb: 'ikke', aflyste: []}, Aarhus: {aflyste: ['5']}}};
  const m = RAP.maanedIndtilNu(L, snap);
  assert.deepEqual(m.hoejdepunkter.forbedret, [{forening: 'Fyn', momentum: ['hjaelp', 'godt'], hb: null}]);
  assert.deepEqual([m.total.nye_aflysninger, m.fordeling.momentum.start.hjaelp], [0, 1]);
});

test('månedsrapport: fremad – risici i rækkefølge efter alvor', () => {
  const byg = (nu, events) => bygFraJson({...DATA, foreninger: [{navn: 'X', facebook: 'x', kommuner: []}, {navn: 'Y', facebook: 'x', kommuner: []}],
    events: [...['X', 'Y'].flatMap(f => [ev(`${f}1`, f, '2026-02-01T17:00:00Z'), ev(`${f}2`, f, '2026-05-01T17:00:00Z')]), ...events],
    rettelser: {}, nu: new Date(nu)});
  const fr = RAP.fremad(byg('2026-09-20T10:00:00Z', [ev('X3', 'X', '2026-10-05T17:00:00Z'), ev('Y3', 'Y', '2026-09-25T17:00:00Z')]));
  assert.deepEqual([fr.fra, fr.til, fr.kvartal], ['2026-09-20', '2026-10-25', {navn: 'Q3', hb_aar: 2027, sidste_dag: '2026-09-30', dage: 10}]);
  // Begge har noget i kalenderen de næste 30 dage, så momentum er "Noget på vej" (ingen risiko).
  assert.deepEqual(fr.risici.map(x => [x.forening, x.niveau, x.type]), [['X', 'kritisk', 'hb'], ['Y', 'advarsel', 'hb_planlagt']]);
  assert.equal(fr.risici[0].tekst, 'HB 2027 i fare – intet afholdt eller planlagt i Q3, 10 dage tilbage.');
  assert.equal(fr.risici[1].tekst, 'Q3 hænger på ét planlagt arrangement: "Arrangement Y3" 25. sep. – 10 dage tilbage.');
  assert.deepEqual([Object.keys(fr.kommende), fr.total.kritisk, fr.total.advarsel, fr.uden_planlagt.length], [['X', 'Y'], 1, 1, 0]);
  // December: årsskiftet er fristen – X mangler stadig Q4.
  const dec = RAP.fremad(byg('2026-12-01T10:00:00Z', [ev('X3', 'X', '2026-08-05T17:00:00Z'), ev('Y3', 'Y', '2026-08-05T17:00:00Z'),
    ev('Y4', 'Y', '2026-11-05T17:00:00Z')]));
  const aar = dec.risici.find(x => x.type === 'aarsskifte');
  assert.deepEqual([aar.forening, aar.dage, /mangler stadig et afholdt arrangement i Q4 \(X\)/.test(aar.tekst)], [null, 30, true]);
});

test('månedsrapport: snapshots – levende den 1., ellers rekonstrueret med det, man vidste dengang', () => {
  // Arrangement 3 (5. okt.) var set på Facebook fra 1. januar; 9 blev først set 20. september og kendtes ikke 1. september.
  const kilder = {...DATA, events: [...DATA.events, ev('9', 'Fyn', '2026-10-10T17:00:00Z', {foerst_set: '2026-09-20T00:00:00Z', historisk: false})]};
  const ved = (tid, rekonstruer) => bygFraJson({...kilder, ved: {tid, rekonstruer}});
  const snap = RAP.snapshot(bygFraJson(kilder), ved, '2026-09');
  assert.deepEqual([snap.tid, snap.rekonstrueret, snap.taget, snap.hb_aar], ['2026-08-31T22:00:00Z', true, '2026-09-29T10:00:00Z', 2027]);
  assert.deepEqual([snap.foreninger.Fyn.planlagt, snap.foreninger.Fyn.afholdt], [3, 1], '1 (20. sep.), 6 (10. sep.) og 3 – ikke 9');
  assert.equal(snap.foreninger.Aarhus.aflyste.length, 0, 'aflysningen fra Facebook regnes som sket senere');
  // Den første kørsel den 1. (dansk tid) tager et levende snapshot af data, som de er.
  const live = RAP.snapshot(bygFraJson({...kilder, nu: new Date('2026-09-30T22:30:00Z')}), ved, '2026-10');
  assert.deepEqual([live.tid, live.rekonstrueret, live.foreninger.Fyn.planlagt], ['2026-09-30T22:30:00Z', false, 2]);
  assert.equal(RAP.maanedStart('2026-01').toISOString(), '2025-12-31T23:00:00.000Z', 'vintertid');
});

test('månedsrapport: opdater() genbruger gemte snapshots og rapporter', () => {
  const ved = (tid, rekonstruer) => bygFraJson({...DATA, ved: {tid, rekonstruer}});
  const foerste = RAP.opdater(L, ved, {}, '');
  assert.deepEqual([foerste.maaneder, Object.keys(foerste.snapshots), Object.keys(foerste.rapporter)], [['2026-08'], ['2026-09', '2026-08'], ['2026-08']]);
  assert.match(foerste.udskrift, /^\nMånedsrapport for august 2026\n\nFREMAD fra 1\. sep\. \(35 dage\)/);
  // Samme data igen: intet nyt at gemme – heller ikke når måneden genberegnes (rekonstrueret igen, men ens).
  const gemt = {snapshots: foerste.snapshots, rapporter: foerste.rapporter};
  for (const valg of ['', '2026-08']) {
    const igen = RAP.opdater(L, ved, gemt, valg);
    assert.deepEqual([Object.keys(igen.snapshots), Object.keys(igen.rapporter)], [[], []], valg);
  }
  assert.deepEqual(RAP.opdater(L, ved, gemt, 'alle').maaneder, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
  assert.deepEqual(RAP.opdater(L, ved, gemt, '2026-10'), {fejl: '2026-10 ligger i fremtiden'});
});

test('månedsrapport: lange titler afkortes efter tegn – en emoji deles ikke', () => {
  const navn = '🎅🏻🌲 Julefrokost med ekstra lang titel og endnu mere tekst, der skal væk';
  const fr = RAP.fremad(bygFraJson({...DATA, foreninger: [{navn: 'X', facebook: 'x', kommuner: []}],
    events: [ev('X1', 'X', '2026-02-01T17:00:00Z'), ev('X2', 'X', '2026-05-01T17:00:00Z'), ev('X3', 'X', '2026-09-25T17:00:00Z', {navn})],
    rettelser: {}, nu: new Date('2026-09-20T10:00:00Z')}));
  // Som Python: de første 49 tegn (kodepunkter), mellemrum til sidst fjernet, og "…".
  assert.equal(fr.risici[0].tekst, `Q3 hænger på ét planlagt arrangement: "${[...navn].slice(0, 49).join('').trimEnd()}…" 25. sep. – 10 dage tilbage.`);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(fr.risici[0].tekst), 'ingen halve emoji');
});
