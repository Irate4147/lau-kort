'use strict';
/*
 * Egne analyser – en analysebygger inspireret af Palantirs Object Explorer. Kun for admins (som resten af Analyser).
 *
 * Tankegangen (Palantirs "Ontology"): data er objekter af en bestemt type (arrangementer og foreninger) med egenskaber
 * (felter). En analyse er et objektsæt – en objekttype + filtre – der kan grupperes efter en egenskab og måles
 * (antal, sum, gennemsnit …). Klik på en søjle for at bore ned (søjlen bliver et filter), "Search around" skifter
 * mellem foreningerne og deres arrangementer, og "Vis på kortet" tegner sættet på kortet.
 *
 * Nye egenskaber: tilføj et felt i TYPER nedenfor ({id, label, type: 'kat' | 'tal' | 'dato', get(obj), orden?}).
 * 'kat'-felter må returnere en liste (fx et arrangement med flere arrangører). Alt andet følger automatisk.
 *
 * Analyser gemmes i browseren eller for alle admins (krypteret i data/admin/analyser.krypt.json via LAU.admin.gem).
 * Gemte analyser står i listen under fanen Analyser. En analyse gemmes som en opskrift (spec), ikke som resultat,
 * så den altid regnes på de nyeste data – "seneste 90 dage" er altid de seneste 90 dage.
 * Filen er pakket ind i en funktion, så dens navne ikke støder sammen med app.js eller andre udvidelser.
 */
(() => {
  const LAGER = 'lau-egne-analyser';
  const FARVE = '#0e7c86'; // petrol: forveksles ikke med aktivitet (blå), HB (lilla), momentum eller hvide pletter (okker)
  const MAKS_RAEKKER = 150;

  // ---------------------------------------------------------------- objekttyper og deres egenskaber

  const tidsrum = d => { const t = +fmtHM.format(d).slice(0, 2); return t < 12 ? 'Formiddag (før 12)' : t < 17 ? 'Eftermiddag (12–17)' : 'Aften (fra 17)'; };
  const forening = navn => DATA.byName.get(navn);
  const medlemmer = f => {
    const m = ADMIN.data.medlemmer;
    return m ? m.filter(r => r.forening === f.navn).reduce((s, r) => s + (+r.antal || 0), 0) : null;
  };
  const varsel = e => (!e.historisk && !e.manuel && e.firstD - DATA.firstRun > DAY ? Math.round((e.startD - e.firstD) / DAY) : null);

  const TYPER = {
    arrangement: {
      label: 'Arrangementer', ental: 'arrangement', flertal: 'arrangementer',
      objekter: () => DATA.events, // uden skjulte
      felter: [
        {id: 'forening', label: 'Forening', type: 'kat', get: e => e.foreninger},
        {id: 'niveau', label: 'Lokal- eller landsforening', type: 'kat', get: e => (e.national ? 'Landsforeningen' : 'Lokalforening')},
        {id: 'status', label: 'Status', type: 'kat', get: e => ARR_STATUS[arrStatus(e)].label, orden: Object.values(ARR_STATUS).map(s => s.label)},
        {id: 'type', label: 'Type', type: 'kat', get: e => e.kat, orden: KAT_NAVNE},
        {id: 'dato', label: 'Dato', type: 'dato', get: e => e.startD},
        {id: 'ugedag', label: 'Ugedag', type: 'kat', get: e => UGEDAGE[weekday(e.startD)], orden: UGEDAGE},
        {id: 'tidsrum', label: 'Tidspunkt', type: 'kat', get: e => tidsrum(e.startD), orden: ['Formiddag (før 12)', 'Eftermiddag (12–17)', 'Aften (fra 17)']},
        {id: 'kommune', label: 'Kommune', type: 'kat', get: e => e.kommune || (e.online ? 'Online' : 'Ukendt sted')},
        {id: 'online', label: 'Online eller fysisk', type: 'kat', get: e => (e.online ? 'Online' : 'Fysisk')},
        {id: 'kilde', label: 'Kilde', type: 'kat', get: e => (e.manuel ? 'Tilføjet manuelt' : 'Facebook')},
        // "Search around": egenskaber fra arrangørens forening.
        {id: 'f_momentum', label: 'Foreningens momentum', type: 'kat',
          get: e => { const f = forening(e.forening); return f && f.mom ? MOM_STATUS[f.mom.niveau].label : 'Landsforeningen'; },
          orden: Object.keys(MOM_ORDEN).sort((a, b) => MOM_ORDEN[a] - MOM_ORDEN[b]).map(k => MOM_STATUS[k].label)},
        {id: 'deltager', label: 'Deltagere (Facebook)', type: 'tal', get: e => e.deltager},
        {id: 'interesserede', label: 'Interesserede (Facebook)', type: 'tal', get: e => e.interesserede},
        {id: 'svar', label: 'Tilkendegivelser', type: 'tal', get: e => e.svar},
        {id: 'fremmoede', label: 'Fremmøde (registreret)', type: 'tal', get: e => e.fremmoede ?? null},
        {id: 'varsel', label: 'Varsel (dage)', type: 'tal', get: varsel},
      ],
      raekke: e => [fmtDate.format(e.startD), e.foreninger.join(', '), e.navn, ARR_STATUS[arrStatus(e)].label],
      kolonner: ['Dato', 'Forening', 'Arrangement', 'Status'],
    },
    forening: {
      label: 'Foreninger', ental: 'forening', flertal: 'foreninger',
      objekter: () => DATA.lokale,
      felter: [
        {id: 'navn', label: 'Forening', type: 'kat', get: f => f.navn},
        {id: 'momentum', label: 'Momentum', type: 'kat', get: f => MOM_STATUS[f.mom.niveau].label,
          orden: Object.keys(MOM_ORDEN).sort((a, b) => MOM_ORDEN[a] - MOM_ORDEN[b]).map(k => MOM_STATUS[k].label)},
        {id: 'hb', label: `HB-prognose ${HB_AAR}`, type: 'kat', get: f => (f.hb ? HB_STATUS[f.hb].label : 'Ukendt'), orden: Object.values(HB_STATUS).map(s => s.label)},
        {id: 'status', label: 'Aktivitet nu', type: 'kat', get: f => STATUS[f.status].label, orden: Object.values(STATUS).map(s => s.label)},
        {id: 'facebook', label: 'Facebook-side', type: 'kat', get: f => (f.facebook ? 'Ja' : 'Nej')},
        {id: 'afholdt90', label: 'Afholdt de seneste 90 dage', type: 'tal', get: f => f.afholdt90.length},
        {id: 'afholdt', label: 'Afholdt i alt', type: 'tal', get: f => f.afholdt.length},
        {id: 'planlagt', label: 'Planlagte', type: 'tal', get: f => f.planlagt.length},
        {id: 'dage', label: 'Dage siden sidste arrangement', type: 'tal', get: f => (f.sidste ? Math.floor((NOW - f.sidste) / DAY) : null)},
        {id: 'svar', label: 'Tilkendegivelser pr. arrangement', type: 'tal', get: f => f.gnsSvar},
        {id: 'fremmoede', label: 'Fremmøde i alt (registreret)', type: 'tal',
          get: f => { const m = f.afholdt.filter(e => e.fremmoede != null); return m.length ? m.reduce((s, e) => s + e.fremmoede, 0) : null; }},
        {id: 'varsel', label: 'Varsel (median, dage)', type: 'tal', get: f => f.varsel},
        {id: 'kommuner', label: 'Kommuner i området', type: 'tal', get: f => (f.kommuner || []).length},
        {id: 'medlemmer', label: 'Medlemmer', type: 'tal', get: medlemmer, kun: () => !!ADMIN.data.medlemmer},
      ],
      raekke: f => [f.navn, MOM_STATUS[f.mom.niveau].label, String(f.afholdt90.length), String(f.planlagt.length)],
      kolonner: ['Forening', 'Momentum', 'Afholdt 90 d', 'Planlagt'],
    },
  };
  const felterFor = type => TYPER[type].felter.filter(x => !x.kun || x.kun());
  const felt = (type, id) => TYPER[type].felter.find(x => x.id === id);
  const vaerdier = (fe, o) => { const v = fe.get(o); return Array.isArray(v) ? v : [v]; };

  // ---------------------------------------------------------------- filtre

  const PERIODER = {
    seneste30: {label: 'Seneste 30 dage', fra: () => dayKey(new Date(NOW - 30 * DAY)), til: () => dayKey(NOW)},
    seneste90: {label: 'Seneste 90 dage', fra: () => dayKey(new Date(NOW - 90 * DAY)), til: () => dayKey(NOW)},
    seneste365: {label: 'Seneste år', fra: () => dayKey(new Date(NOW - 365 * DAY)), til: () => dayKey(NOW)},
    iaar: {label: 'I år', fra: () => monthKey(NOW).slice(0, 4) + '-01-01', til: () => monthKey(NOW).slice(0, 4) + '-12-31'},
    naeste90: {label: 'Næste 90 dage', fra: () => dayKey(NOW), til: () => dayKey(new Date(+NOW + 90 * DAY))},
    fortid: {label: 'Afholdte (før i dag)', fra: () => '', til: () => dayKey(new Date(NOW - DAY))},
    fremtid: {label: 'Fra i dag og frem', fra: () => dayKey(NOW), til: () => ''},
    egen: {label: 'Egen periode', fra: fi => fi.fra || '', til: fi => fi.til || ''},
  };

  /** Et filter: {felt, vaerdier: [...]} (kat), {felt, min, max} (tal) eller {felt, periode, fra?, til?} (dato). */
  function matcher(type, fi) {
    const fe = felt(type, fi.felt);
    if (!fe) return () => true;
    if (fe.type === 'kat') { const s = new Set(fi.vaerdier || []); return o => !s.size || vaerdier(fe, o).some(v => s.has(v)); }
    if (fe.type === 'tal') {
      return o => { const v = fe.get(o); if (fi.min == null && fi.max == null) return true;
        return v != null && (fi.min == null || v >= fi.min) && (fi.max == null || v <= fi.max); };
    }
    const p = PERIODER[fi.periode] || PERIODER.egen, fra = p.fra(fi), til = p.til(fi);
    return o => { const d = dayKey(fe.get(o)); return (!fra || d >= fra) && (!til || d <= til); };
  }
  function filterTekst(type, fi) {
    const fe = felt(type, fi.felt);
    if (!fe) return '?';
    if (fe.type === 'kat') {
      const v = fi.vaerdier || [];
      return `${fe.label}: ${!v.length ? 'alle' : v.length <= 2 ? v.join(', ') : `${v.slice(0, 2).join(', ')} +${v.length - 2}`}`;
    }
    if (fe.type === 'tal') {
      return `${fe.label}: ${fi.min != null && fi.max != null ? `${num1(fi.min)}–${num1(fi.max)}`
        : fi.min != null ? `mindst ${num1(fi.min)}` : fi.max != null ? `højst ${num1(fi.max)}` : 'alle'}`;
    }
    if (fi.periode && fi.periode !== 'egen') return `${fe.label}: ${PERIODER[fi.periode].label.toLowerCase()}`;
    return `${fe.label}: ${fi.fra || '…'} – ${fi.til || '…'}`;
  }

  // ---------------------------------------------------------------- beregning

  const MAAL = [
    {id: 'antal', label: 'Antal', beregn: xs => xs.length},
    {id: 'sum', label: 'Sum af', beregn: xs => (xs.length ? xs.reduce((a, b) => a + b, 0) : null)},
    {id: 'gns', label: 'Gennemsnit af', beregn: mean},
    {id: 'median', label: 'Median af', beregn: median},
    {id: 'max', label: 'Højeste', beregn: xs => (xs.length ? Math.max(...xs) : null)},
  ];
  const maalTekst = s => (s.maal === 'antal' ? `Antal ${TYPER[s.type].flertal}`
    : `${MAAL.find(m => m.id === s.maal).label} ${(felt(s.type, s.maalFelt) || {}).label?.toLowerCase() || '?'}`);
  function maal(s, objekter) {
    const m = MAAL.find(x => x.id === s.maal) || MAAL[0];
    if (m.id === 'antal') return objekter.length;
    const fe = felt(s.type, s.maalFelt);
    return fe ? m.beregn(objekter.map(fe.get).filter(v => v != null)) : null;
  }

  const DATO_GRUPPER = {
    maaned: {label: 'Måned', noegle: d => monthKey(d), tekst: k => fmtMonth.format(new Date(k + '-15T00:00:00Z')) + ' ' + k.slice(0, 4),
      periode: k => ({fra: k + '-01', til: k + '-31'})},
    kvartal: {label: 'Kvartal', noegle: d => { const m = monthKey(d); return `${m.slice(0, 4)}-Q${Math.floor((+m.slice(5) - 1) / 3) + 1}`; },
      tekst: k => `${k.slice(6)} ${k.slice(0, 4)}`,
      periode: k => { const q = +k.slice(6); const m = n => String(n).padStart(2, '0'); return {fra: `${k.slice(0, 4)}-${m(q * 3 - 2)}-01`, til: `${k.slice(0, 4)}-${m(q * 3)}-31`}; }},
    aar: {label: 'År', noegle: d => monthKey(d).slice(0, 4), tekst: k => k, periode: k => ({fra: k + '-01-01', til: k + '-12-31'})},
  };

  /** Objektsættet og grupperne: {objekter, grupper: [{noegle, label, objekter, vaerdi}] | null, total}. */
  function beregnSpec(s) {
    const alle = TYPER[s.type].objekter();
    const objekter = s.filtre.reduce((xs, fi) => xs.filter(matcher(s.type, fi)), alle);
    const fe = s.gruppe && felt(s.type, s.gruppe);
    let grupper = null;
    if (fe) {
      const g = new Map();
      const dg = fe.type === 'dato' && (DATO_GRUPPER[s.datoGruppe] || DATO_GRUPPER.maaned);
      for (const o of objekter) {
        const noegler = dg ? [dg.noegle(fe.get(o))] : vaerdier(fe, o).map(v => (v == null ? '(ukendt)' : String(v)));
        for (const k of noegler) { if (!g.has(k)) g.set(k, []); g.get(k).push(o); }
      }
      grupper = [...g].map(([noegle, xs]) => ({noegle, label: dg ? dg.tekst(noegle) : noegle, objekter: xs, vaerdi: maal(s, xs)}));
      if (dg) grupper.sort((a, b) => a.noegle.localeCompare(b.noegle));
      else if (fe.orden) grupper.sort((a, b) => ((fe.orden.indexOf(a.noegle) + 1) || 99) - ((fe.orden.indexOf(b.noegle) + 1) || 99));
      else grupper.sort((a, b) => (b.vaerdi ?? -Infinity) - (a.vaerdi ?? -Infinity) || a.label.localeCompare(b.label, 'da'));
    }
    return {objekter, grupper, total: maal(s, objekter), alle: alle.length};
  }

  /** Målet pr. lokalforening (til kortet). Arrangementer tæller hos alle deres arrangører. */
  function prForening(s, objekter) {
    const g = new Map();
    for (const o of objekter) {
      for (const navn of s.type === 'forening' ? [o.navn] : o.foreninger) {
        if (!g.has(navn)) g.set(navn, []);
        g.get(navn).push(o);
      }
    }
    return new Map([...g].map(([navn, xs]) => [navn, maal(s, xs)]).filter(([, v]) => v != null));
  }

  // ---------------------------------------------------------------- gemte analyser

  const nySpec = () => ({type: 'arrangement', filtre: [{felt: 'dato', periode: 'seneste365'}], gruppe: 'forening', datoGruppe: 'maaned', maal: 'antal', maalFelt: ''});
  const kopi = x => JSON.parse(JSON.stringify(x));
  const GEMT = {
    lokal: (() => { try { return JSON.parse(localStorage.getItem(LAGER)) || []; } catch (_) { return []; } })(),
    faelles: [], hentet: false,
  };
  const gemLokalt = () => { try { localStorage.setItem(LAGER, JSON.stringify(GEMT.lokal)); } catch (_) { /* fx privat vindue */ } };
  const nyId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function hentFaelles() {
    if (GEMT.hentet || !erAdmin()) return;
    GEMT.hentet = true;
    try { GEMT.faelles = ((await LAU.admin.hent('analyser')) || {}).analyser || []; } catch (_) { GEMT.faelles = []; }
    synkListe();
  }

  /** Én analyse i listen under fanen Analyser. Den nye (tomme) og hver gemt analyse har sin egen tilstand. */
  function lavAnalyse(id, titel, spec, gemt) {
    const t = {spec: kopi(spec), gemt, aaben: null, besked: '', navn: gemt ? gemt.navn : ''};
    return {
      id, titel, admin: true, egen: true,
      beskrivelse: gemt ? `Egen analyse${gemt.hvor === 'faelles' ? ' (fælles)' : ' (kun denne browser)'} · ${TYPER[spec.type].label.toLowerCase()}`
        : 'Byg din egen analyse: vælg arrangementer eller foreninger, filtrér, gruppér og mål – og vis resultatet på kortet.',
      render: () => renderBygger(t),
      efter: el => bindBygger(el, t),
    };
  }
  /** Lægger de gemte analyser ind i listen (lige efter analysebyggeren). */
  function synkListe() {
    for (let i = ANALYSER.length - 1; i >= 0; i--) if (ANALYSER[i].egen && ANALYSER[i].id !== 'egen') ANALYSER.splice(i, 1);
    const i = ANALYSER.findIndex(a => a.id === 'egen');
    const gemte = [...GEMT.faelles.map(g => ({...g, hvor: 'faelles'})), ...GEMT.lokal.map(g => ({...g, hvor: 'lokal'}))];
    ANALYSER.splice(i + 1, 0, ...gemte.map(g => lavAnalyse(`egen:${g.id}`, g.navn, g.spec, g)));
    if (FANE === 'analyser') renderAnalyseListe();
    if (ANA.aaben && ANA.aktiv && ANA.aktiv.startsWith('egen')) {
      if (!analyseFor(ANA.aktiv)) ANA.aktiv = 'egen';
      renderAnalyser();
    }
  }

  async function gem(t, hvor, somNy) {
    const navn = t.navn.trim();
    if (!navn) { t.besked = 'Giv analysen et navn først.'; return; }
    const id = !somNy && t.gemt && t.gemt.hvor === hvor ? t.gemt.id : nyId();
    const post = {id, navn, spec: kopi(t.spec), af: mitNavn() || undefined, gemt: new Date().toISOString()};
    const erstat = liste => [...liste.filter(g => g.id !== id), post];
    if (hvor === 'lokal') { GEMT.lokal = erstat(GEMT.lokal); gemLokalt(); }
    else {
      t.besked = 'Gemmer for alle …';
      renderAnalyser();
      const ny = await LAU.admin.gem('analyser', data => ({analyser: erstat((data && data.analyser) || [])}), `Egen analyse: ${navn}`);
      GEMT.faelles = ny.analyser;
    }
    t.besked = '';
    synkListe();
    ANA.aktiv = `egen:${id}`;
    renderAnalyser();
    renderAnalyseListe();
  }
  async function slet(t) {
    const g = t.gemt;
    if (!g || !confirm(`Slet analysen "${g.navn}"${g.hvor === 'faelles' ? ' for alle admins' : ''}?`)) return;
    if (g.hvor === 'lokal') { GEMT.lokal = GEMT.lokal.filter(x => x.id !== g.id); gemLokalt(); }
    else {
      const ny = await LAU.admin.gem('analyser', data => ({analyser: ((data && data.analyser) || []).filter(x => x.id !== g.id)}), `Slet egen analyse: ${g.navn}`);
      GEMT.faelles = ny.analyser;
    }
    ANA.aktiv = 'egen';
    synkListe();
  }

  // ---------------------------------------------------------------- kortet

  const KORT = {spec: null, titel: ''};
  function visPaaKort(t) {
    KORT.spec = kopi(t.spec);
    KORT.titel = t.gemt ? t.gemt.navn : 'Egen analyse';
    if (farvning !== 'ingen') setFarvning('ingen'); // ellers blandes farverne med foreningernes fyld
    if (layerState['egen-analyse']) { drawLayers(); renderLegend(); } else setVisning('egen-analyse', true);
    if (selected) closeForening();
  }

  registerLayer({
    id: 'egen-analyse', label: 'Egen analyse', toggle: true, standard: false, admin: true, gruppe: 'kort',
    hint: 'Den analyse, du senest viste på kortet (Analyser → "Vis på kortet"). Mørkere = højere værdi',
    tilgaengelig: () => !!KORT.spec,
    tegn(api, ctx) {
      if (!KORT.spec) return;
      const {objekter} = beregnSpec(KORT.spec);
      const v = prForening(KORT.spec, objekter);
      const max = Math.max(1e-9, ...v.values());
      const feats = DATA.geo.outlines.features.filter(x => v.has(x.properties.forening))
        .map(x => ({...x, properties: {forening: x.properties.forening, v: v.get(x.properties.forening) / max}}));
      const src = api.source('flader', {type: 'FeatureCollection', features: feats});
      api.layer({id: 'fyld', type: 'fill', source: src, paint: {'fill-color': FARVE,
        'fill-opacity': ['interpolate', ['linear'], ['get', 'v'], 0, 0.08, 1, 0.75]}});
      api.layer({id: 'kant', type: 'line', source: src, paint: {'line-color': FARVE, 'line-width': 1.4, 'line-opacity': 0.9}});
      const lbl = DATA.geo.flabels.features.filter(x => v.has(x.properties.forening))
        .map(x => ({...x, properties: {tekst: num1(v.get(x.properties.forening))}}));
      api.layer({id: 'tal', type: 'symbol', source: api.source('tal', {type: 'FeatureCollection', features: lbl}),
        layout: {'text-field': ['get', 'tekst'], 'text-font': FONT_BOLD, 'text-size': 13, 'text-offset': [0, 1.3], 'text-allow-overlap': false},
        paint: {'text-color': FARVE, 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.8}});
      if (KORT.spec.type === 'arrangement') {
        const pts = api.source('punkter', pointsFC(objekter.filter(e => !ctx.zoomed || e.foreninger.includes(ctx.selected))));
        api.layer({id: 'punkter', type: 'circle', source: pts, paint: {'circle-radius': 4.5, 'circle-color': FARVE,
          'circle-stroke-color': '#fff', 'circle-stroke-width': 1.3}});
      }
    },
  });

  if (typeof renderLegend === 'function') {
    const tidligere = renderLegend;
    renderLegend = function () { // eslint-disable-line no-global-assign
      tidligere.apply(this, arguments);
      const el = document.getElementById('legend');
      if (!el || !DATA || !erAdmin() || !layerState['egen-analyse'] || !KORT.spec) return;
      el.insertAdjacentHTML('beforeend', `<span><span class="swatch" style="background:linear-gradient(90deg, ${FARVE}22, ${FARVE})"></span>`
        + `${esc(KORT.titel)}: ${esc(maalTekst(KORT.spec).toLowerCase())} pr. forening (mørkere = højere)</span>`);
    };
  }

  // ---------------------------------------------------------------- brugerflade

  const opt = (v, label, valgt) => `<option value="${esc(v)}"${valgt ? ' selected' : ''}>${esc(label)}</option>`;

  function filterEditor(t, i) {
    const s = t.spec, fi = s.filtre[i], fe = felt(s.type, fi.felt);
    if (fe.type === 'kat') {
      // Antal pr. værdi i sættet med de ANDRE filtre – som Palantirs histogram i filteret.
      const andre = s.filtre.filter((_, j) => j !== i).reduce((xs, f) => xs.filter(matcher(s.type, f)), TYPER[s.type].objekter());
      const n = new Map();
      for (const o of andre) for (const v of vaerdier(fe, o)) n.set(String(v ?? '(ukendt)'), (n.get(String(v ?? '(ukendt)')) || 0) + 1);
      for (const v of fi.vaerdier || []) if (!n.has(v)) n.set(v, 0);
      const liste = [...n].sort((a, b) => (fe.orden ? ((fe.orden.indexOf(a[0]) + 1) || 99) - ((fe.orden.indexOf(b[0]) + 1) || 99) : 0)
        || b[1] - a[1] || a[0].localeCompare(b[0], 'da'));
      const valgt = new Set(fi.vaerdier || []);
      return `<div class="ea-editor"><div class="ea-editor-top"><b>${esc(fe.label)}</b>
          <button type="button" class="linkbtn" data-ea-alle>Ingen valgt (= alle)</button></div>
        <div class="ea-vaerdier">${liste.map(([v, c]) => `<label><input type="checkbox" data-ea-v="${esc(v)}"${valgt.has(v) ? ' checked' : ''}>
          <span>${esc(v)}</span><span class="ea-n">${c}</span></label>`).join('')}</div></div>`;
    }
    if (fe.type === 'tal') {
      return `<div class="ea-editor"><div class="ea-editor-top"><b>${esc(fe.label)}</b></div>
        <div class="ea-raekke"><label>Mindst<input type="number" data-ea-min value="${fi.min ?? ''}"></label>
        <label>Højst<input type="number" data-ea-max value="${fi.max ?? ''}"></label></div>
        <p class="note">Objekter uden en værdi falder fra, når der er sat en grænse.</p></div>`;
    }
    return `<div class="ea-editor"><div class="ea-editor-top"><b>${esc(fe.label)}</b></div>
      <div class="ea-raekke"><label>Periode<select data-ea-periode>${Object.entries(PERIODER).map(([k, p]) => opt(k, p.label, (fi.periode || 'egen') === k)).join('')}</select></label>
      ${(fi.periode || 'egen') === 'egen' ? `<label>Fra<input type="date" data-ea-fra value="${esc(fi.fra || '')}"></label>
        <label>Til<input type="date" data-ea-til value="${esc(fi.til || '')}"></label>` : ''}</div></div>`;
  }

  function renderBygger(t) {
    if (!GEMT.hentet) hentFaelles();
    const s = t.spec, T = TYPER[s.type], felter = felterFor(s.type);
    const r = beregnSpec(s);
    const gruppeFelt = s.gruppe && felt(s.type, s.gruppe);
    const gruppeTekst = !gruppeFelt ? '' : gruppeFelt.type === 'dato'
      ? (DATO_GRUPPER[s.datoGruppe] || DATO_GRUPPER.maaned).label.toLowerCase() : gruppeFelt.label.toLowerCase();
    const talFelter = felter.filter(x => x.type === 'tal');
    const vis = r.grupper ? r.grupper.slice(0, 40) : [];
    const diagram = !r.grupper ? '' : !r.grupper.length ? '<p class="empty">Ingen objekter i sættet.</p>'
      : hbars(vis.map(g => ({label: g.label, values: [g.vaerdi ?? 0],
        tip: `${g.label}|${maalTekst(s)}: ${num1(g.vaerdi)}|${g.objekter.length} ${g.objekter.length === 1 ? T.ental : T.flertal} – klik for at bore ned`})),
        {width: 740, labelW: 180, colors: [FARVE], aria: maalTekst(s)})
        + (r.grupper.length > vis.length ? `<p class="note">Viser de første ${vis.length} af ${r.grupper.length} grupper.</p>` : '');
    const kanFaelles = typeof kanGemme === 'function' && kanGemme();
    const sa = s.type === 'forening' ? 'Deres arrangementer' : 'Arrangørernes foreninger';

    return `<div class="ea">
      <div class="ea-trin"><span class="ea-nr">1</span><div><b>Hvad vil du se på?</b>
        <div class="ea-knapper">${Object.entries(TYPER).map(([k, x]) =>
          `<button type="button" class="chip small${s.type === k ? ' on' : ''}" data-ea-type="${k}" aria-pressed="${s.type === k}">${esc(x.label)}</button>`).join('')}</div></div></div>

      <div class="ea-trin"><span class="ea-nr">2</span><div><b>Filtrér</b>
        <div class="ea-knapper">${s.filtre.map((fi, i) => `<span class="ea-filter${t.aaben === i ? ' aaben' : ''}">
            <button type="button" class="ea-filter-tekst" data-ea-rediger="${i}">${esc(filterTekst(s.type, fi))}</button>
            <button type="button" class="ea-fjern" data-ea-fjern="${i}" aria-label="Fjern filter">×</button></span>`).join('')}
          <select data-ea-nyt aria-label="Tilføj filter"><option value="">+ Tilføj filter …</option>${felter.map(x => opt(x.id, x.label)).join('')}</select></div>
        ${t.aaben != null && s.filtre[t.aaben] ? filterEditor(t, t.aaben) : ''}</div></div>

      <div class="ea-trin"><span class="ea-nr">3</span><div><b>Gruppér og mål</b>
        <div class="ea-raekke">
          <label>Gruppér efter<select data-ea-gruppe>${opt('', '(ingen – kun det samlede tal)', !s.gruppe)}${felter.filter(x => x.type !== 'tal')
            .map(x => opt(x.id, x.label, s.gruppe === x.id)).join('')}</select></label>
          ${gruppeFelt && gruppeFelt.type === 'dato' ? `<label>pr.<select data-ea-datogruppe>${Object.entries(DATO_GRUPPER)
            .map(([k, d]) => opt(k, d.label, s.datoGruppe === k)).join('')}</select></label>` : ''}
          <label>Mål<select data-ea-maal>${MAAL.map(m => opt(m.id, m.id === 'antal' ? `Antal ${T.flertal}` : m.label + ' …', s.maal === m.id)).join('')}</select></label>
          ${s.maal !== 'antal' ? `<label>&nbsp;<select data-ea-maalfelt>${opt('', 'Vælg egenskab …', !s.maalFelt)}${talFelter
            .map(x => opt(x.id, x.label, s.maalFelt === x.id)).join('')}</select></label>` : ''}
        </div></div></div>

      <div class="tiles">
        ${tile(`${T.label} i sættet`, String(r.objekter.length), `af ${r.alle} i alt`)}
        ${s.maal !== 'antal' ? tile(maalTekst(s), num1(r.total), 'for hele sættet', true) : ''}
        ${r.grupper ? tile('Grupper', String(r.grupper.length), gruppeTekst) : ''}
      </div>
      ${r.grupper ? `<h3>${esc(maalTekst(s))} pr. ${esc(gruppeTekst)}</h3>
        <p class="note">Klik på en søjle for at bore ned – gruppen bliver et filter.</p><div class="ea-diagram">${diagram}</div>` : ''}

      <div class="ea-handlinger">
        <button type="button" class="chip small primary" data-ea-kort>Vis på kortet</button>
        <button type="button" class="chip small" data-ea-around title="Search around: skift til de objekter, sættet hænger sammen med">→ ${esc(sa)}</button>
        <button type="button" class="chip small" data-ea-csv>Hent som CSV</button>
        <button type="button" class="chip small" data-ea-nulstil>Nulstil</button>
      </div>

      <h3>${esc(T.label)} i sættet</h3>
      ${!r.objekter.length ? '<p class="empty">Ingen.</p>' : `<table class="hb-tabel analyse-tabel ea-tabel"><thead><tr>${T.kolonner.map(k => `<th>${esc(k)}</th>`).join('')}
        ${s.maal !== 'antal' && s.maalFelt ? `<th>${esc(felt(s.type, s.maalFelt).label)}</th>` : ''}</tr></thead>
        <tbody>${r.objekter.slice(0, MAKS_RAEKKER).map(o => {
          const f = s.type === 'forening' ? o.navn : o.forening;
          return `<tr tabindex="0" data-f="${esc(f)}">${T.raekke(o).map(c => `<td>${esc(c)}</td>`).join('')}
            ${s.maal !== 'antal' && s.maalFelt ? `<td class="tal">${esc(num1(felt(s.type, s.maalFelt).get(o)))}</td>` : ''}</tr>`;
        }).join('')}</tbody></table>
        ${r.objekter.length > MAKS_RAEKKER ? `<p class="note">Viser ${MAKS_RAEKKER} af ${r.objekter.length} – hent CSV for dem alle.</p>` : ''}`}

      <h3>Gem analysen</h3>
      <div class="ea-raekke ea-gem">
        <label>Navn<input type="text" data-ea-navn value="${esc(t.navn)}" placeholder="Fx Fremmøde pr. måned i år"></label>
        <button type="button" class="chip small" data-ea-gem="lokal">Gem i browseren</button>
        <button type="button" class="chip small" data-ea-gem="faelles"${kanFaelles ? '' : ' disabled title="Gem for alle er ikke sat op (se README: Rettelser)"'}>Gem for alle admins</button>
        ${t.gemt ? `<button type="button" class="linkbtn" data-ea-somny>Gem som ny</button>
          <button type="button" class="linkbtn danger" data-ea-slet>Slet</button>` : ''}
      </div>
      <p class="form-status">${esc(t.besked)}</p>
      <p class="note">Analysen gemmes som en opskrift og regnes altid på de nyeste data. Gemte analyser står i listen til venstre.</p>
    </div>`;
  }

  function csv(s, objekter) {
    const felter = felterFor(s.type);
    const celle = v => { const x = v instanceof Date ? dayKey(v) : Array.isArray(v) ? v.join(' + ') : v ?? ''; return `"${String(x).replace(/"/g, '""')}"`; };
    // Arrangementer får navnet med som første kolonne; foreningerne har det allerede som egenskab.
    const navn = s.type === 'arrangement' ? [['Arrangement', e => e.navn || '']] : [];
    const kol = [...navn, ...felter.map(x => [x.label, x.get])];
    const linjer = [kol.map(k => celle(k[0])).join(';'), ...objekter.map(o => kol.map(k => celle(k[1](o))).join(';'))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + linjer.join('\r\n')], {type: 'text/csv;charset=utf-8'}));
    a.download = `lau-${s.type}-${dayKey(NOW)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function bindBygger(el, t) {
    const s = t.spec, igen = () => { hideTip(); renderAnalyser(); };
    const on = (sel, ev, fn) => el.querySelectorAll(sel).forEach(x => x.addEventListener(ev, e => fn(x, e)));
    on('[data-ea-type]', 'click', b => {
      if (s.type === b.dataset.eaType) return;
      Object.assign(s, {type: b.dataset.eaType, filtre: [], gruppe: '', maal: 'antal', maalFelt: ''});
      t.aaben = null; igen();
    });
    on('[data-ea-nyt]', 'change', x => {
      const fe = felt(s.type, x.value);
      if (!fe) return;
      s.filtre.push(fe.type === 'dato' ? {felt: fe.id, periode: 'seneste365'} : fe.type === 'tal' ? {felt: fe.id, min: null, max: null} : {felt: fe.id, vaerdier: []});
      t.aaben = s.filtre.length - 1; igen();
    });
    on('[data-ea-rediger]', 'click', b => { const i = +b.dataset.eaRediger; t.aaben = t.aaben === i ? null : i; igen(); });
    on('[data-ea-fjern]', 'click', b => { s.filtre.splice(+b.dataset.eaFjern, 1); t.aaben = null; igen(); });
    const fi = t.aaben != null ? s.filtre[t.aaben] : null;
    if (fi) {
      on('[data-ea-v]', 'change', () => { fi.vaerdier = [...el.querySelectorAll('[data-ea-v]:checked')].map(x => x.dataset.eaV); igen(); });
      on('[data-ea-alle]', 'click', () => { fi.vaerdier = []; igen(); });
      const tal = v => (v === '' ? null : +v);
      on('[data-ea-min]', 'change', x => { fi.min = tal(x.value); igen(); });
      on('[data-ea-max]', 'change', x => { fi.max = tal(x.value); igen(); });
      on('[data-ea-periode]', 'change', x => { fi.periode = x.value; igen(); });
      on('[data-ea-fra]', 'change', x => { fi.fra = x.value; igen(); });
      on('[data-ea-til]', 'change', x => { fi.til = x.value; igen(); });
    }
    on('[data-ea-gruppe]', 'change', x => { s.gruppe = x.value; igen(); });
    on('[data-ea-datogruppe]', 'change', x => { s.datoGruppe = x.value; igen(); });
    on('[data-ea-maal]', 'change', x => { s.maal = x.value; if (x.value !== 'antal' && !s.maalFelt) s.maalFelt = (felterFor(s.type).find(f => f.type === 'tal') || {}).id || ''; igen(); });
    on('[data-ea-maalfelt]', 'change', x => { s.maalFelt = x.value; igen(); });

    // Bor ned: klik på en søjle gør gruppen til et filter (søjlerne står i samme rækkefølge som grupperne).
    const r = beregnSpec(s), fe = s.gruppe && felt(s.type, s.gruppe);
    if (r.grupper && fe) {
      el.querySelectorAll('.ea-diagram rect.hit').forEach((rect, i) => {
        const g = r.grupper[i];
        if (!g) return;
        rect.style.cursor = 'pointer';
        rect.addEventListener('click', () => {
          hideTip();
          if (fe.type === 'dato') {
            const p = (DATO_GRUPPER[s.datoGruppe] || DATO_GRUPPER.maaned).periode(g.noegle);
            s.filtre = s.filtre.filter(x => x.felt !== fe.id).concat({felt: fe.id, periode: 'egen', ...p});
            const naeste = {aar: 'kvartal', kvartal: 'maaned', maaned: null}[s.datoGruppe];
            if (naeste) s.datoGruppe = naeste; else s.gruppe = '';
          } else {
            s.filtre = s.filtre.filter(x => x.felt !== fe.id).concat({felt: fe.id, vaerdier: [g.noegle]});
            s.gruppe = '';
          }
          t.aaben = null; igen();
        });
      });
    }

    on('[data-ea-kort]', 'click', () => visPaaKort(t));
    on('[data-ea-around]', 'click', () => {
      // Search around: foreninger ↔ deres arrangementer. Sættet bliver et filter på den anden side.
      if (s.type === 'forening') {
        const navne = r.objekter.map(f => f.navn);
        Object.assign(s, {type: 'arrangement', filtre: [{felt: 'forening', vaerdier: navne}], gruppe: 'forening', maal: 'antal', maalFelt: ''});
      } else {
        const navne = [...new Set(r.objekter.flatMap(e => e.foreninger))].filter(n => n !== NATIONAL);
        Object.assign(s, {type: 'forening', filtre: [{felt: 'navn', vaerdier: navne}], gruppe: '', maal: 'antal', maalFelt: ''});
      }
      t.aaben = null; igen();
    });
    on('[data-ea-csv]', 'click', () => csv(s, r.objekter));
    on('[data-ea-nulstil]', 'click', () => { t.spec = t.gemt ? kopi(t.gemt.spec) : nySpec(); t.aaben = null; igen(); });
    on('[data-ea-navn]', 'input', x => { t.navn = x.value; });
    const fejl = err => { t.besked = `Kunne ikke gemme: ${err.message}`; igen(); };
    on('[data-ea-gem]', 'click', b => gem(t, b.dataset.eaGem, false).catch(fejl));
    on('[data-ea-somny]', 'click', () => gem(t, t.gemt.hvor, true).catch(fejl));
    on('[data-ea-slet]', 'click', () => slet(t).catch(fejl));
    on('tr[data-f]', 'keydown', (tr, ev) => { if (ev.key === 'Enter') openForening(tr.dataset.f); });
  }

  registerAnalyse(lavAnalyse('egen', 'Egen analyse (byg selv)', nySpec(), null));
  synkListe();
})();
