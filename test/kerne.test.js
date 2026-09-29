// Enhedstests af kernen på et lille, fast datasæt.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bygFraJson, koer, valider, boreNed, prObjekt, LAU, Ontologi, regler as R} from '../kerne/index.js';

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

// ---------------------------------------------------------------- analysernes regler på faste datoer

// Et lille datasæt direkte på reglerne: data dækker fra 1. jan. 2026.
const DK = {ugentligFra: '2026-01-01', fra: '2026-01-01', fraFor: new Map(), hentet: new Set(), forsteKoersel: new Date('2026-01-01T00:00:00Z')};
const arr = (start, ekstra = {}) => ({id: start, navn: `Arr. ${start}`, foreninger: ['X'], startD: new Date(start), slutD: new Date(start),
  firstD: new Date('2026-01-01T00:00:00Z'), aflyst: false, forsvundet: false, ...ekstra});
const Q12 = [arr('2026-02-01T18:00:00Z'), arr('2026-05-01T18:00:00Z')];
/** @param {any[]} events @param {string} nu */
const risiko = (events, nu, {facebook = true, daekning = DK} = {}) => {
  const d = new Date(nu), a = R.aktivitet(events, 'X', daekning, d);
  return R.hbRisiko(a, R.hbPrognose(a, facebook, d), d);
};

test('HB-risiko: niveau og spand efter dage tilbage af kvartalet', () => {
  const kort = r => [r.niveau, r.spand, r.dage];
  // Intet afholdt eller planlagt i Q3 (sidste dag 30. sep.).
  assert.deepEqual(kort(risiko(Q12, '2026-09-16T10:00:00Z')), ['kritisk', 'handle', 14]);
  assert.deepEqual(kort(risiko(Q12, '2026-09-15T22:30:00Z')), ['kritisk', 'handle', 14], 'dansk tid: allerede 16. sep.');
  assert.deepEqual(kort(risiko(Q12, '2026-09-15T10:00:00Z')), ['advarsel', 'handle', 15]);
  assert.deepEqual(kort(risiko(Q12, '2026-08-16T10:00:00Z')), ['advarsel', 'handle', 45]);
  assert.deepEqual(kort(risiko(Q12, '2026-08-15T10:00:00Z')), ['opmaerksom', 'hold', 46]);
  // Kun reddet af et planlagt arrangement.
  const plan = [...Q12, arr('2026-09-25T17:00:00Z')];
  assert.deepEqual(kort(risiko(plan, '2026-09-09T10:00:00Z')), ['advarsel', 'planlagt', 21]);
  assert.deepEqual(kort(risiko(plan, '2026-09-08T10:00:00Z')), ['opmaerksom', 'hold', 22]);
  const r = risiko(plan, '2026-09-20T10:00:00Z');
  assert.equal(r.status, 'planlagt');
  assert.deepEqual(r.planlagt.map(e => e.id), ['2026-09-25T17:00:00Z']);
  assert.equal(r.sidsteDag, '2026-09-30');
});

test('HB-risiko: i hus, tabt, ukendt og det næste kvartal', () => {
  const s = risiko([...Q12, arr('2026-09-01T17:00:00Z'), arr('2026-10-10T17:00:00Z'), arr('2027-01-10T17:00:00Z')], '2026-09-20T10:00:00Z');
  assert.deepEqual([s.niveau, s.spand, s.afholdt.length, s.naesteKv.length], ['sikret', 'sikret', 1, 1]);
  // Q4: intet næste kvartal samme år.
  const q4 = risiko([...Q12, arr('2026-08-01T17:00:00Z'), arr('2027-01-10T17:00:00Z')], '2026-12-20T10:00:00Z');
  assert.deepEqual([q4.kvartal, q4.niveau, q4.dage, q4.naesteKv.length], ['Q4', 'kritisk', 11, 0]);
  // Et afsluttet kvartal uden afholdt arrangement: tabt, også selvom det indeværende er i hus.
  const t = risiko([Q12[0], arr('2026-09-01T17:00:00Z')], '2026-09-20T10:00:00Z');
  assert.deepEqual([t.niveau, t.spand, t.tabte], ['tabt', 'tabt', ['Q2']]);
  // Uden Facebook-side og intet i kvartalet: kan ikke vurderes.
  assert.equal(risiko(Q12, '2026-09-20T10:00:00Z', {facebook: false}).niveau, 'ukendt');
  // Data dækker først fra maj: Q1 er ukendt, men Q3 i hus.
  const u = risiko([Q12[1], arr('2026-09-01T17:00:00Z')], '2026-09-20T10:00:00Z', {daekning: {...DK, ugentligFra: '2026-05-01'}});
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
