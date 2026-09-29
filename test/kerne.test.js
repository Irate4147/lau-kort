// Enhedstests af kernen på et lille, fast datasæt.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bygFraJson, koer, valider, boreNed, prObjekt, LAU, Ontologi, regler, tid} from '../kerne/index.js';

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
