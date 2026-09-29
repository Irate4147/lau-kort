// Enhedstests af kernen på et lille, fast datasæt.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bygFraJson, koer, valider, boreNed, prObjekt, LAU, Ontologi} from '../kerne/index.js';

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
