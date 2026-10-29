'use strict';
/*
 * Egne analyser – analysebyggeren. Kun for admins (som resten af Analyser).
 *
 * Bygget på kernen (kerne/, se docs/arkitektur.md): alle objekttyper, egenskaber og links kommer fra ontologien
 * (kerne/lau.js), og en analyse er en objektsæt-forespørgsel (kerne/objektsaet.js). Filen her er KUN brugerfladen:
 * en ny egenskab eller objekttype i ontologien dukker automatisk op her, på kortet og i CSV-eksporten.
 *
 * Trin: vælg objekttype → filtrér (også gennem links, og "har ingen …") → evt. search around til linkede objekter →
 * gruppér og mål. Klik på en søjle for at bore ned. Vis på kortet (mål pr. forening). Hent CSV. Gem i browseren eller
 * for alle admins (krypteret i data/admin/analyser.krypt.json). En gemt analyse er forespørgslen – den regnes altid
 * på de nyeste data.
 * Kernen indlæses som ES-modul i index.html (window.LAU_KERNE). Filen er pakket ind i en funktion, så dens navne ikke
 * støder sammen med app.js eller andre udvidelser.
 */
(() => {
  const LAGER = 'lau-analyser';
  const FARVE = '#0e7c86'; // petrol: forveksles ikke med aktivitet (blå), HB (lilla), momentum eller hvide pletter (okker)
  const MAKS_RAEKKER = 150, MAKS_LISTE = 40;
  const K = () => window.LAU_KERNE;

  // ---------------------------------------------------------------- lageret

  /** Kernens objektlager for de data, app.js har indlæst (bygges i beregn() og igen efter en rettelse). */
  const lager = () => {
    if (!K() || !DATA || !DATA.lager) throw new Error('Kernen er ikke indlæst');
    return DATA.lager;
  };
  const ont = () => K().LAU;
  const typer = () => [...ont().typer.values()].filter(t => lager().alle(t.id).length);
  const flertal = id => ont().type(id).flertal;

  // ---------------------------------------------------------------- forespørgslen og dens trin

  const nySpec = () => ({type: 'Arrangement', filtre: [{egenskab: 'start', periode: 'seneste365'}], gruppering: {egenskab: 'arrangeretAf.navn'}, maal: {funktion: 'antal'}});
  const kopi = x => JSON.parse(JSON.stringify(x));
  /** Færdige spørgsmål, man kan starte fra (og rette til). Ugyldige (fx en fjernet egenskab) vises ikke. */
  const AFHOLDT_AAR = [{egenskab: 'start', periode: 'seneste365'}, {egenskab: 'status', er: ['bekraeftet', 'afholdt']}];
  const EKSEMPLER = [
    {navn: 'Gennemsnitligt antal deltagere pr. forening',
      spec: {type: 'Arrangement', filtre: AFHOLDT_AAR, gruppering: {egenskab: 'arrangeretAf.navn'}, maal: {funktion: 'gns', egenskab: 'deltager'}}},
    {navn: 'Lokalforeninger: deltagere pr. arrangement mod antal arrangementer',
      spec: {type: 'Forening', filtre: [{egenskab: 'niveau', er: ['lokal']}], visning: 'punkter',
        maal: {funktion: 'sum', egenskab: 'deltagereGns'}, maal2: {funktion: 'sum', egenskab: 'afholdtAar'}}},
    {navn: 'Arrangementer pr. måned', spec: {type: 'Arrangement', filtre: [{egenskab: 'start', periode: 'seneste365'}], gruppering: {egenskab: 'start', pr: 'maaned'}, maal: {funktion: 'antal'}}},
    {navn: 'Hvilken ugedag giver flest deltagere?',
      spec: {type: 'Arrangement', filtre: AFHOLDT_AAR, gruppering: {egenskab: 'ugedag'}, maal: {funktion: 'gns', egenskab: 'deltager'}}},
    {navn: 'Lokalforeninger uden planlagte arrangementer',
      spec: {type: 'Forening', filtre: [{egenskab: 'niveau', er: ['lokal']}, {egenskab: 'planlagte', min: null, max: 0}], maal: {funktion: 'antal'}}},
  ];
  /** Trinene: [{type, filtre}] – startsættet og hvert search around. */
  function trin(spec) {
    const ud = [{type: spec.type, filtre: spec.filtre || (spec.filtre = []), link: null}];
    let t = spec.type;
    for (const s of spec.searchAround || []) {
      const l = ont().link(t, s.link);
      t = l.til;
      ud.push({type: t, filtre: s.filtre || (s.filtre = []), link: l});
    }
    return ud;
  }
  const slutType = spec => K().slutType(ont(), spec);
  /** Filterlisten, en sti af indeks peger på (link-filtre har deres egne filtre). */
  function filterVed(spec, sti) {
    const [t, ...rest] = sti;
    let liste = trin(spec)[t].filtre, f = null;
    for (const i of rest) { f = liste[i]; liste = f.filtre || (f.filtre = []); }
    return {f, liste};
  }
  /** Typen, filtrene på en sti gælder for. */
  function typeVed(spec, sti) {
    let type = trin(spec)[sti[0]].type, liste = trin(spec)[sti[0]].filtre;
    for (const i of sti.slice(1)) { const f = liste[i]; type = ont().link(type, f.link).til; liste = f.filtre; }
    return type;
  }

  // ---------------------------------------------------------------- gemte analyser

  const GEMT = {lokal: [], faelles: [], hentet: false};
  try { GEMT.lokal = JSON.parse(localStorage.getItem(LAGER)) || []; } catch (_) { /* fx privat vindue */ }
  const gemLokalt = () => { try { localStorage.setItem(LAGER, JSON.stringify(GEMT.lokal)); } catch (_) { /* fx privat vindue */ } };
  const nyId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function hentFaelles() {
    if (GEMT.hentet || !erAdmin()) return;
    GEMT.hentet = true;
    try { GEMT.faelles = ((await LAU.admin.hent('analyser')) || {}).analyser || []; } catch (_) { GEMT.faelles = []; }
    synkListe();
  }

  /** Én analyse i listen under fanen Analyser: den nye (tomme) og hver gemt analyse har sin egen tilstand. */
  function lavAnalyse(id, titel, spec, gemt) {
    const t = {spec: kopi(spec), gemt, aaben: null, besked: '', navn: gemt ? gemt.navn : ''};
    return {
      id, titel, admin: true, egen: true,
      beskrivelse: gemt ? `Egen analyse${gemt.hvor === 'faelles' ? ' (fælles)' : ' (kun denne browser)'}`
        : 'Byg din egen analyse: vælg foreninger, arrangementer eller kommuner, filtrér, følg links, gruppér og mål – og vis det på kortet.',
      render: () => renderBygger(t),
      efter: el => bindBygger(el, t),
    };
  }
  /** Lægger de gemte analyser ind i listen (lige efter analysebyggeren). */
  function synkListe() {
    for (let i = ANALYSER.length - 1; i >= 0; i--) if (ANALYSER[i].egen && ANALYSER[i].id !== 'egen') ANALYSER.splice(i, 1);
    const i = ANALYSER.findIndex(a => a.id === 'egen');
    const gemte = [...GEMT.faelles.map(g => ({...g, hvor: 'faelles'})), ...GEMT.lokal.map(g => ({...g, hvor: 'lokal'}))]
      .filter(g => !K() || !K().valider(ont(), g.spec).length); // ugyldige (fx en fjernet egenskab) springes over
    ANALYSER.splice(i + 1, 0, ...gemte.map(g => lavAnalyse(`egen:${g.id}`, g.navn, g.spec, g)));
    if (FANE === 'analyser') renderAnalyseListe();
    if (ANA.aaben && ANA.aktiv && ANA.aktiv.startsWith('egen')) {
      if (!analyseFor(ANA.aktiv)) ANA.aktiv = 'egen';
      renderAnalyser();
    }
  }

  async function gem(t, hvor, somNy) {
    const navn = t.navn.trim();
    if (!navn) { t.besked = 'Giv analysen et navn først.'; renderAnalyser(); return; }
    const id = !somNy && t.gemt && t.gemt.hvor === hvor ? t.gemt.id : nyId();
    const post = {id, navn, spec: kopi(t.spec), af: mitNavn() || undefined, gemt: new Date().toISOString()};
    const erstat = liste => [...liste.filter(g => g.id !== id), post];
    if (hvor === 'lokal') { GEMT.lokal = erstat(GEMT.lokal); gemLokalt(); }
    else {
      t.besked = 'Gemmer for alle …';
      renderAnalyser();
      GEMT.faelles = (await LAU.admin.gem('analyser', data => ({analyser: erstat((data && data.analyser) || [])}), `Egen analyse: ${navn}`)).analyser;
    }
    t.besked = '';
    ANA.aktiv = `egen:${id}`;
    synkListe();
    renderAnalyser();
  }
  async function slet(t) {
    const g = t.gemt;
    if (!g || !confirm(`Slet analysen "${g.navn}"${g.hvor === 'faelles' ? ' for alle admins' : ''}?`)) return;
    if (g.hvor === 'lokal') { GEMT.lokal = GEMT.lokal.filter(x => x.id !== g.id); gemLokalt(); }
    else GEMT.faelles = (await LAU.admin.gem('analyser', data => ({analyser: ((data && data.analyser) || []).filter(x => x.id !== g.id)}), `Slet egen analyse: ${g.navn}`)).analyser;
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
  /**
   * Stiens navn til skærmen: "Arrangeret af → Navn" bliver "Forening (arrangeret af)", og "Arrangeret af → Momentum"
   * bliver "Arrangeret af: momentum".
   */
  function stiNavn(type, sti) {
    const s = ont().sti(type, sti);
    if (!s.led.length) return s.egenskab.label;
    const l = s.led[s.led.length - 1];
    if (s.led.length === 1 && s.egenskab && s.egenskab.id === ont().type(l.til).titel) {
      const tl = ont().type(l.til).label;
      return tl.toLowerCase() === l.label.toLowerCase() ? tl : `${tl} (${l.label.toLowerCase()})`;
    }
    return ont().stiLabel(type, sti).split(' → ').map((x, i) => (i ? x.toLowerCase() : x)).join(': ');
  }
  /** Målenes navne i menuerne ("I alt" er lettere at forstå end "Sum"). */
  const MAAL_NAVN = {sum: 'I alt', gns: 'Gennemsnit', median: 'Median', min: 'Laveste', max: 'Højeste'};
  const maalNavn = k => MAAL_NAVN[k] || K().MAAL[k].label;
  const maalTekst = (spec, m = spec.maal || {funktion: 'antal'}) => {
    const T = slutType(spec);
    return m.funktion === 'antal' ? `Antal ${flertal(T).toLowerCase()}` : `${maalNavn(m.funktion)} af ${stiNavn(T, m.egenskab).toLowerCase()}`;
  };
  const maalVaerdi = m => (!m || m.funktion === 'antal' ? 'antal' : `${m.funktion}|${m.egenskab}`);
  const tilMaal = v => { if (v === 'antal') return {funktion: 'antal'}; const [funktion, egenskab] = v.split('|'); return {funktion, egenskab}; };

  registerLayer({
    id: 'egen-analyse', label: 'Egen analyse', toggle: true, standard: false, admin: true, gruppe: 'kort',
    hint: 'Den analyse, du senest viste på kortet (Analyser → "Vis på kortet"). Mørkere = højere værdi',
    tilgaengelig: () => !!KORT.spec,
    tegn(api, ctx) {
      if (!KORT.spec || !K()) return;
      const L = lager(), res = K().koer(L, KORT.spec);
      const v = new Map([...K().prObjekt(L, res, KORT.spec.maal, 'Forening')].map(([f, x]) => [f.id, x]));
      const max = Math.max(1e-9, ...v.values());
      const feats = DATA.geo.outlines.features.filter(x => v.has(x.properties.forening))
        .map(x => ({...x, properties: {forening: x.properties.forening, v: v.get(x.properties.forening) / max}}));
      const src = api.source('flader', {type: 'FeatureCollection', features: feats});
      api.layer({id: 'fyld', type: 'fill', source: src, paint: {'fill-color': FARVE, 'fill-opacity': ['interpolate', ['linear'], ['get', 'v'], 0, 0.08, 1, 0.75]}});
      api.layer({id: 'kant', type: 'line', source: src, paint: {'line-color': FARVE, 'line-width': 1.4, 'line-opacity': 0.9}});
      const lbl = DATA.geo.flabels.features.filter(x => v.has(x.properties.forening))
        .map(x => ({...x, properties: {tekst: num1(v.get(x.properties.forening))}}));
      api.layer({id: 'tal', type: 'symbol', source: api.source('tal', {type: 'FeatureCollection', features: lbl}),
        layout: {'text-field': ['get', 'tekst'], 'text-font': FONT_BOLD, 'text-size': 13, 'text-offset': [0, 1.3]},
        paint: {'text-color': FARVE, 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.8}});
      if (res.type === 'Arrangement') {
        const pts = res.objekter.map(o => o.v.raw).filter(e => e.lat != null && e.lng != null && (!ctx.zoomed || e.foreninger.includes(ctx.selected)));
        api.layer({id: 'punkter', type: 'circle', source: api.source('punkter', pointsFC(pts)),
          paint: {'circle-radius': 4.5, 'circle-color': FARVE, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.3}});
      }
    },
  });

  if (typeof renderLegend === 'function') {
    const tidligere = renderLegend;
    renderLegend = function () { // eslint-disable-line no-global-assign
      tidligere.apply(this, arguments);
      const el = document.getElementById('legend');
      if (!el || !DATA || !erAdmin() || !layerState['egen-analyse'] || !KORT.spec || !K()) return;
      el.insertAdjacentHTML('beforeend', `<span><span class="swatch" style="background:linear-gradient(90deg, ${FARVE}22, ${FARVE})"></span>`
        + `${esc(KORT.titel)}: ${esc(maalTekst(KORT.spec).toLowerCase())} pr. forening (mørkere = højere)</span>`);
    };
  }

  // ---------------------------------------------------------------- brugerflade

  const opt = (v, label, valgt) => `<option value="${esc(v)}"${valgt ? ' selected' : ''}>${esc(label)}</option>`;
  const stiNoegle = sti => sti.join('.');
  /** Menuen "+ Tilføj filter": egne egenskaber, egenskaber gennem links og link-filtre ("har …"/"har ingen …"). */
  function nytFilterMenu(type, sti) {
    const stier = ont().stier(type, {rolle: 'admin'});
    const egne = stier.filter(s => !s.viaLink), via = stier.filter(s => s.viaLink);
    const links = ont().links(type).filter(l => lager().alle(l.til).length);
    const grp = new Map();
    for (const s of via) { const l = s.sti.split('.')[0]; if (!grp.has(l)) grp.set(l, []); grp.get(l).push(s); }
    return `<select data-ea-nyt="${stiNoegle(sti)}" aria-label="Tilføj filter"><option value="">+ Tilføj filter …</option>
      <optgroup label="${esc(flertal(type))}s egne oplysninger">${egne.map(s => opt(`e:${s.sti}`, s.label)).join('')}</optgroup>
      ${[...grp].map(([l, xs]) => { const lk = ont().link(type, l);
        return `<optgroup label="${esc(lk.label)} (${esc(flertal(lk.til).toLowerCase())})">${xs.map(s => opt(`e:${s.sti}`, s.egenskab.label)).join('')}</optgroup>`; }).join('')}
      ${links.length ? `<optgroup label="Har / har ingen …">${links.map(l => opt(`l:${l.navn}`, `Har (ingen) ${l.label.toLowerCase()} der …`)).join('')}</optgroup>` : ''}
    </select>`;
  }

  function filterTekst(type, f) {
    if (f.link) {
      const l = ont().link(type, f.link);
      return `${f.ingen ? 'Har ingen' : 'Har'} ${l.label.toLowerCase()}${f.filtre && f.filtre.length ? ' der …' : ''}`;
    }
    const e = ont().sti(type, f.egenskab).egenskab, label = stiNavn(type, f.egenskab);
    if (f.indeholder) return `${label} indeholder "${f.indeholder}"`;
    if (e.type === 'tal') {
      return `${label}: ${f.min != null && f.max != null ? `${num1(f.min)}–${num1(f.max)}` : f.min != null ? `mindst ${num1(f.min)}` : f.max != null ? `højst ${num1(f.max)}` : 'alle'}`;
    }
    if (e.type === 'dato') return `${label}: ${f.periode && f.periode !== 'egen' ? K().PERIODER[f.periode].label.toLowerCase() : `${f.fra || '…'} – ${f.til || '…'}`}`;
    const v = (f.er || []).map(x => (x == null ? '(ingen)' : K().visVaerdi(e, x)));
    return `${label}: ${!v.length ? 'alle' : v.length <= 2 ? v.join(', ') : `${v.slice(0, 2).join(', ')} +${v.length - 2}`}`;
  }

  /** Filterlisten for et trin eller et link-filter (rekursivt). */
  function filterListe(t, type, filtre, sti) {
    return `<div class="ea-knapper">${filtre.map((f, i) => {
      const s = [...sti, i], k = stiNoegle(s), aaben = t.aaben === k;
      return `<span class="ea-filter${aaben ? ' aaben' : ''}${f.link ? ' ea-link' : ''}">
        <button type="button" class="ea-filter-tekst" data-ea-rediger="${k}">${esc(filterTekst(type, f))}</button>
        <button type="button" class="ea-fjern" data-ea-fjern="${k}" aria-label="Fjern filter">×</button></span>`;
    }).join('')}${nytFilterMenu(type, sti)}</div>
    ${filtre.map((f, i) => {
      const s = [...sti, i], k = stiNoegle(s);
      if (f.link) {
        const under = ont().link(type, f.link).til;
        return `<div class="ea-linkfilter"><div class="ea-linkfilter-top">
            <select data-ea-ingen="${k}">${opt('har', 'Har', !f.ingen)}${opt('ingen', 'Har ingen', f.ingen)}</select>
            <b>${esc(ont().link(type, f.link).label.toLowerCase())}</b> der opfylder:</div>
          ${filterListe(t, under, f.filtre || (f.filtre = []), s)}</div>`;
      }
      return t.aaben === k ? filterEditor(t, type, f, k) : '';
    }).join('')}`;
  }

  function filterEditor(t, type, f, k) {
    const L = lager(), e = ont().sti(type, f.egenskab).egenskab, label = stiNavn(type, f.egenskab);
    if (e.type === 'tal') {
      return `<div class="ea-editor" data-ea-editor="${k}"><b>${esc(label)}</b>
        <div class="ea-raekke"><label>Mindst<input type="number" data-ea-min value="${f.min ?? ''}"></label>
        <label>Højst<input type="number" data-ea-max value="${f.max ?? ''}"></label></div>
        <p class="note">Objekter uden en værdi falder fra, når der er sat en grænse.</p></div>`;
    }
    if (e.type === 'dato') {
      const p = f.periode || 'egen';
      return `<div class="ea-editor" data-ea-editor="${k}"><b>${esc(label)}</b>
        <div class="ea-raekke"><label>Periode<select data-ea-periode>${Object.entries(K().PERIODER).map(([x, v]) => opt(x, v.label, p === x)).join('')}</select></label>
        ${p === 'egen' ? `<label>Fra<input type="date" data-ea-fra value="${esc(f.fra || '')}"></label><label>Til<input type="date" data-ea-til value="${esc(f.til || '')}"></label>` : ''}</div></div>`;
    }
    // Kategori, ja/nej og tekst: værdierne med antal i sættet (som Palantirs histogram i filteret).
    const n = new Map();
    for (const o of L.alle(type)) for (const v of new Set(L.vaerdier(o, f.egenskab).length ? L.vaerdier(o, f.egenskab) : [null])) n.set(v, (n.get(v) || 0) + 1);
    for (const v of f.er || []) if (!n.has(v)) n.set(v, 0);
    if (e.type === 'tekst' && n.size > MAKS_LISTE) {
      return `<div class="ea-editor" data-ea-editor="${k}"><b>${esc(label)}</b>
        <div class="ea-raekke"><label>Indeholder<input type="text" data-ea-indeholder value="${esc(f.indeholder || '')}" placeholder="Søg …"></label></div></div>`;
    }
    const orden = e.vaerdier ? Object.keys(e.vaerdier) : null;
    const liste = [...n].sort((a, b) => (a[0] == null) - (b[0] == null)
      || (orden ? ((orden.indexOf(a[0]) + 1) || 999) - ((orden.indexOf(b[0]) + 1) || 999) : 0) || b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'da'));
    const valgt = new Set((f.er || []).map(v => JSON.stringify(v)));
    return `<div class="ea-editor" data-ea-editor="${k}"><div class="ea-editor-top"><b>${esc(label)}</b>
        <button type="button" class="linkbtn" data-ea-alle>Ingen valgt (= alle)</button></div>
      <div class="ea-vaerdier">${liste.map(([v, c]) => `<label><input type="checkbox" data-ea-v="${esc(JSON.stringify(v))}"${valgt.has(JSON.stringify(v)) ? ' checked' : ''}>
        <span>${esc(v == null ? '(ingen)' : K().visVaerdi(e, v))}</span><span class="ea-n">${c}</span></label>`).join('')}</div></div>`;
  }

  /** Menu over stier, delt op i typens egne oplysninger og oplysninger gennem hvert link (i stedet for "A → B"). */
  function stiMenu(type, stier, valgt) {
    const egne = stier.filter(s => !s.viaLink), grp = new Map();
    for (const s of stier.filter(x => x.viaLink)) { const l = s.sti.split('.')[0]; if (!grp.has(l)) grp.set(l, []); grp.get(l).push(s); }
    return `${egne.length ? `<optgroup label="${esc(flertal(type))}s egne oplysninger">${egne.map(s => opt(s.sti, s.label, valgt === s.sti)).join('')}</optgroup>` : ''}
      ${[...grp].map(([l, xs]) => { const lk = ont().link(type, l);
        return `<optgroup label="${esc(lk.label)} (${esc(flertal(lk.til).toLowerCase())})">${xs.map(s => opt(s.sti, stiNavn(type, s.sti), valgt === s.sti)).join('')}</optgroup>`; }).join('')}`;
  }

  /** Én menu for målet: "Antal …" og for hver beregning (gennemsnit, i alt …) typens tal-egenskaber. */
  function maalMenu(type, stier, m, attr) {
    const tal = stier.filter(x => x.egenskab.type === 'tal'), valgt = maalVaerdi(m);
    return `<select ${attr}>${opt('antal', `Antal ${flertal(type).toLowerCase()}`, valgt === 'antal')}
      ${Object.keys(K().MAAL).filter(k => k !== 'antal').map(k => `<optgroup label="${esc(maalNavn(k))} af …">${tal.map(x => {
        const v = `${k}|${x.sti}`;
        return opt(v, `${maalNavn(k)} af ${stiNavn(type, x.sti).toLowerCase()}`, valgt === v);
      }).join('')}</optgroup>`).join('')}</select>`;
  }

  /** Punktdiagram uden gruppering: hvert objekt er et punkt, og akserne er objektets egne tal (fx en forenings antal arrangementer). */
  const egneTal = type => ont().stier(type, {rolle: 'admin'}).filter(x => x.egenskab.type === 'tal' && !x.viaLink);
  function egenskabMenu(type, m, attr) {
    return `<select ${attr}>${egneTal(type).map(x => opt(`sum|${x.sti}`, x.label, m && m.egenskab === x.sti)).join('')}</select>`;
  }
  /** Sørger for, at akserne er objektets egne tal – helst deltagere pr. arrangement og antal arrangementer. */
  function objektAkser(s) {
    const tal = egneTal(slutType(s)).map(x => x.sti), ok = m => m && m.funktion !== 'antal' && tal.includes(m.egenskab);
    const valg = [...['deltagereGns', 'afholdtAar'].filter(x => tal.includes(x)), ...tal];
    if (!ok(s.maal)) s.maal = {funktion: 'sum', egenskab: valg.find(x => !s.maal2 || x !== s.maal2.egenskab)};
    if (!ok(s.maal2)) s.maal2 = {funktion: 'sum', egenskab: valg.find(x => x !== s.maal.egenskab) || valg[0]};
    for (const m of [s.maal, s.maal2]) m.funktion = 'sum';
  }

  /** Pæne akse-inddelinger fra 0: 0, 5, 10 … eller 0, 20, 40 … */
  function inddeling(max) {
    const raa = Math.max(max, 1e-9) / 5, p = 10 ** Math.floor(Math.log10(raa));
    const trin = [1, 2, 2.5, 5, 10].map(x => x * p).find(x => x >= raa);
    const top = Math.max(trin, Math.ceil(max / trin) * trin);
    return {top, ticks: Array.from({length: Math.round(top / trin) + 1}, (_, i) => i * trin)};
  }
  /** Punktdiagram: ét punkt pr. gruppe, maal ud ad x og maal2 op ad y. hældning: den stiplede gennemsnitslinje (y = hældning · x). */
  function punktdiagram(grupper, {x, y, hældning, enhed, kryds, klik = 'Klik for kun at se denne', navn = 'grupper'}) {
    const W = 740, H = 400, ml = 60, mr = 20, mt = 14, mb = 46, pw = W - ml - mr, ph = H - mt - mb;
    const pts = grupper.map((g, i) => ({g, i})).filter(d => d.g.vaerdi != null && d.g.vaerdi2 != null);
    const ax = inddeling(Math.max(0, ...pts.map(d => d.g.vaerdi))), ay = inddeling(Math.max(0, ...pts.map(d => d.g.vaerdi2)));
    const X = v => ml + v / ax.top * pw, Y = v => mt + ph - v / ay.top * ph;
    let svg = `<svg class="chart ea-punkter" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${y} mod ${x}`)}">`;
    for (const t of ay.ticks) svg += `<line class="ea-gitter" x1="${ml}" x2="${W - mr}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${ml - 6}" y="${Y(t) + 3}" text-anchor="end">${esc(num1(t))}</text>`;
    for (const t of ax.ticks) svg += `<line class="ea-gitter" x1="${X(t)}" x2="${X(t)}" y1="${mt}" y2="${mt + ph}"/><text class="tick" x="${X(t)}" y="${mt + ph + 14}" text-anchor="middle">${esc(num1(t))}</text>`;
    svg += `<line class="baseline" x1="${ml}" x2="${W - mr}" y1="${mt + ph}" y2="${mt + ph}"/><line class="baseline" x1="${ml}" x2="${ml}" y1="${mt}" y2="${mt + ph}"/>`;
    svg += `<text class="lbl" x="${ml + pw / 2}" y="${H - 6}" text-anchor="middle">${esc(x)} →</text>`;
    svg += `<text class="lbl" transform="translate(14 ${mt + ph / 2}) rotate(-90)" text-anchor="middle">${esc(y)} →</text>`;
    if (hældning != null && isFinite(hældning) && hældning > 0) {
      const x2 = Math.min(ax.top, ay.top / hældning);
      svg += `<line class="ea-snit" x1="${X(0)}" y1="${Y(0)}" x2="${X(x2)}" y2="${Y(x2 * hældning)}"/>`;
    }
    if (kryds) { // gennemsnittet for hver akse deler diagrammet i fire felter (fx få arrangementer, men mange deltagere)
      const mx = pts.reduce((a, d) => a + d.g.vaerdi, 0) / (pts.length || 1), my = pts.reduce((a, d) => a + d.g.vaerdi2, 0) / (pts.length || 1);
      svg += `<line class="ea-snit" x1="${X(mx)}" x2="${X(mx)}" y1="${mt}" y2="${mt + ph}"/><line class="ea-snit" x1="${ml}" x2="${W - mr}" y1="${Y(my)}" y2="${Y(my)}"/>`;
      svg += `<text class="tick" x="${X(mx) + 4}" y="${mt + 10}">gns. ${esc(num1(mx))}</text><text class="tick" x="${W - mr - 4}" y="${Y(my) - 4}" text-anchor="end">gns. ${esc(num1(my))}</text>`;
    }
    // Navne ved punkterne – de højeste først, og et navn, der ville overlappe et andet navn eller punkt, udelades (se det ved at holde musen over).
    const optaget = pts.map(d => ({x1: X(d.g.vaerdi) - 6, x2: X(d.g.vaerdi) + 6, y1: Y(d.g.vaerdi2) - 6, y2: Y(d.g.vaerdi2) + 6}));
    const navne = new Map();
    for (const {g, i} of [...pts].sort((a, b) => b.g.vaerdi2 - a.g.vaerdi2)) {
      const tekst = trunc(g.label, 22), cx = X(g.vaerdi), cy = Y(g.vaerdi2), b = {x1: cx + 7, x2: cx + 9 + tekst.length * 6, y1: cy - 6, y2: cy + 6};
      const ramt = o => o.x1 < b.x2 && b.x1 < o.x2 && o.y1 < b.y2 && b.y1 < o.y2;
      if (b.x2 > W || optaget.some((o, j) => j !== pts.findIndex(d => d.i === i) && ramt(o))) continue;
      optaget.push(b); navne.set(i, tekst);
    }
    for (const {g, i} of pts) {
      const cx = X(g.vaerdi), cy = Y(g.vaerdi2);
      if (navne.has(i)) svg += `<text class="tick ea-punktnavn" x="${cx + 7}" y="${cy + 3}">${esc(navne.get(i))}</text>`;
      svg += `<circle class="ea-punkt" cx="${cx}" cy="${cy}" r="5.5" fill="${FARVE}" data-ea-punkt="${i}" data-ea-noegle="${esc(String(g.noegle))}"
        data-tip="${esc(`${g.label}|${x}: ${num1(g.vaerdi)}|${y}: ${num1(g.vaerdi2)}${hældning != null && g.vaerdi ? `|${num1(g.vaerdi2 / g.vaerdi)} ${enhed}` : ''}${klik ? `|${klik}` : ''}`)}"/>`;
    }
    return svg + '</svg>' + (pts.length < grupper.length ? `<p class="note">${grupper.length - pts.length} ${esc(navn)} uden begge tal er udeladt.</p>` : '');
  }

  /** Analysen læst op i én sætning, så man kan se, hvad tallene betyder. */
  function opsummering(s, r, T) {
    // Filtre uden noget valgt (fx "alle") gør ingenting og nævnes ikke.
    const virker = f => f.link || f.indeholder || f.periode || f.fra || f.til || f.min != null || f.max != null || (f.er && f.er.length);
    const t0 = trin(s)[0], filtre = t => t.filtre.filter(virker).map(f => filterTekst(t.type, f).toLowerCase());
    const dele = [`<b>${r.objekter.length} ${esc(flertal(T).toLowerCase())}</b>`];
    const f0 = filtre(t0);
    const kaede = trin(s).slice(1);
    if (kaede.length) {
      dele.push(`– fundet via ${esc(flertal(t0.type).toLowerCase())}${f0.length ? ` (${esc(f0.join(', '))})` : ''}`
        + kaede.map(x => ` → ${esc(x.link.label.toLowerCase())}${filtre(x).length ? ` (${esc(filtre(x).join(', '))})` : ''}`).join(''));
    } else if (f0.length) dele.push(`hvor ${esc(f0.join(' og '))}`);
    const g = s.gruppering;
    if (g) {
      const ge = ont().sti(T, g.egenskab).egenskab;
      dele.push(`– delt op efter <b>${esc(ge.type === 'dato' ? `${stiNavn(T, g.egenskab).toLowerCase()} pr. ${K().DATO_GRUPPER[g.pr || 'maaned'].label.toLowerCase()}` : stiNavn(T, g.egenskab).toLowerCase())}</b>`);
    }
    if (s.visning === 'punkter' && !g) dele.push(`– ét punkt pr. ${esc(ont().type(T).label.toLowerCase())}: <b>${esc(stiNavn(T, s.maal.egenskab).toLowerCase())}</b> (vandret) mod <b>${esc(stiNavn(T, s.maal2.egenskab).toLowerCase())}</b> (lodret)`);
    else if (s.visning === 'punkter' && g) dele.push(`– ét punkt pr. gruppe: <b>${esc(maalTekst(s).toLowerCase())}</b> (vandret) mod <b>${esc(maalTekst(s, s.maal2 || {funktion: 'antal'}).toLowerCase())}</b> (lodret)`);
    else if ((s.maal || {}).funktion && s.maal.funktion !== 'antal') dele.push(`– viser <b>${esc(maalTekst(s).toLowerCase())}</b>`);
    return `<p class="ea-opsummering">Du ser ${dele.join(' ')}.</p>`;
  }

  const KOLONNER = {Forening: ['momentum', 'afholdt90', 'planlagte'], Arrangement: ['start', 'arrangeretAf.navn', 'status'], Kommune: ['forening.navn', 'aktivitetSenesteAar']};

  function renderBygger(t) {
    if (!K()) return '<p class="empty">Kernen er ikke indlæst (kerne/index.js).</p>';
    if (!GEMT.hentet) hentFaelles();
    const L = lager(), s = t.spec, T = slutType(s), stier = ont().stier(T, {rolle: 'admin'});
    const fejl = K().valider(ont(), s);
    if (fejl.length) return `<p class="empty">Analysen kan ikke køres: ${esc(fejl.join('; '))}</p><button type="button" class="chip small" data-ea-nulstil>Nulstil</button>`;
    const r = K().koer(L, s), g = s.gruppering, ge = g && ont().sti(T, g.egenskab).egenskab;
    const maal = s.maal || {funktion: 'antal'};
    const gruppeTekst = !g ? '' : ge.type === 'dato' ? K().DATO_GRUPPER[g.pr || 'maaned'].label.toLowerCase() : stiNavn(T, g.egenskab).toLowerCase();
    const punkter = s.visning === 'punkter', maal2 = s.maal2 || {funktion: 'antal'};
    // Gennemsnitslinjen giver kun mening, når begge tal er optællinger eller summer (fx deltagere i alt ÷ antal arrangementer).
    const tæller = m => m.funktion === 'antal' || m.funktion === 'sum';
    const hældning = punkter && tæller(maal) && tæller(maal2) && r.total ? (r.total2 ?? 0) / r.total : null;
    const enhed = `${maal2.funktion === 'antal' ? flertal(T).toLowerCase() : stiNavn(T, maal2.egenskab).toLowerCase()} pr. ${maal.funktion === 'antal' ? ont().type(T).label.toLowerCase() : stiNavn(T, maal.egenskab).toLowerCase()}`;
    // Punktdiagram uden gruppering: hvert objekt er sit eget punkt, og akserne er dets egne tal.
    const hvertObjekt = punkter && !g;
    const akse = m => (hvertObjekt ? stiNavn(T, m.egenskab) : maalTekst(s, m));
    const pgrupper = !punkter ? null : hvertObjekt
      ? r.objekter.map(o => ({noegle: o.id, label: L.titel(o), objekter: [o], vaerdi: K().maal(L, maal, [o]), vaerdi2: K().maal(L, maal2, [o])}))
        .sort((a, b) => (b.vaerdi2 ?? -Infinity) - (a.vaerdi2 ?? -Infinity))
      : r.grupper;
    const vis = r.grupper ? r.grupper.slice(0, MAKS_LISTE) : [];
    const diagram = !pgrupper && !r.grupper ? '' : !(pgrupper || r.grupper).length ? '<p class="empty">Ingen objekter i sættet.</p>'
      : hvertObjekt ? punktdiagram(pgrupper, {x: akse(maal), y: akse(maal2), kryds: true, navn: flertal(T).toLowerCase(), klik: T === 'Forening' ? 'Klik for at åbne foreningen' : ''})
        + `<p class="note">De stiplede linjer er gennemsnittet for hver akse. De deler diagrammet i fire felter – fx øverst til venstre: ${esc(akse(maal2).toLowerCase())} over gennemsnittet, men ${esc(akse(maal).toLowerCase())} under.</p>`
        + `<table class="hb-tabel analyse-tabel ea-tabel"><thead><tr><th>${esc(ont().type(T).label)}</th><th>${esc(akse(maal))}</th><th>${esc(akse(maal2))}</th></tr></thead>
          <tbody>${pgrupper.slice(0, MAKS_RAEKKER).map(x => `<tr${T === 'Forening' ? ` tabindex="0" data-f="${esc(x.noegle)}"` : ''}><td>${esc(x.label)}</td><td>${esc(num1(x.vaerdi))}</td><td>${esc(num1(x.vaerdi2))}</td></tr>`).join('')}</tbody></table>`
      : punkter ? punktdiagram(r.grupper, {x: maalTekst(s), y: maalTekst(s, maal2), hældning, enhed})
        + (hældning != null ? `<p class="note">Den stiplede linje er gennemsnittet for alle: <b>${esc(num1(hældning))} ${esc(enhed)}</b>. Punkter over linjen ligger over gennemsnittet.</p>` : '')
        + `<table class="hb-tabel analyse-tabel ea-tabel"><thead><tr><th>${esc(gruppeTekst.charAt(0).toUpperCase() + gruppeTekst.slice(1))}</th><th>${esc(maalTekst(s))}</th><th>${esc(maalTekst(s, maal2))}</th>${hældning != null ? `<th>${esc(enhed.charAt(0).toUpperCase() + enhed.slice(1))}</th>` : ''}</tr></thead>
          <tbody>${r.grupper.slice(0, MAKS_RAEKKER).map(x => `<tr><td>${esc(x.label)}</td><td>${esc(num1(x.vaerdi))}</td><td>${esc(num1(x.vaerdi2))}</td>${hældning != null ? `<td>${x.vaerdi ? esc(num1(x.vaerdi2 / x.vaerdi)) : '–'}</td>` : ''}</tr>`).join('')}</tbody></table>`
      : hbars(vis.map(x => ({label: x.label, values: [x.vaerdi ?? 0],
        tip: `${x.label}|${maalTekst(s)}: ${num1(x.vaerdi)}|${x.objekter.length} ${flertal(T).toLowerCase()} – klik for at bore ned`})),
        {width: 740, labelW: 190, colors: [FARVE], aria: maalTekst(s)})
        + (r.grupper.length > vis.length ? `<p class="note">Viser de første ${vis.length} af ${r.grupper.length} grupper.</p>` : '');
    const kanFaelles = typeof kanGemme === 'function' && kanGemme();
    const trinliste = trin(s);
    const kol = (KOLONNER[T] || []).filter(k => { try { return !!ont().sti(T, k).egenskab; } catch (_) { return false; } });
    const maalKol = maal.funktion !== 'antal' && maal.egenskab && !kol.includes(maal.egenskab) ? [maal.egenskab] : [];
    const celle = (o, sti) => { const e = ont().sti(T, sti).egenskab; return [...new Set(L.vaerdier(o, sti).map(v => K().visVaerdi(e, v)))].join(', ') || '–'; };
    const tilForening = ont().links(T).find(l => l.til === 'Forening');
    const foreningFor = o => (T === 'Forening' ? o.id : tilForening ? (L.linkede(o, tilForening.navn)[0] || {id: null}).id : null);

    const eksempler = EKSEMPLER.filter(x => !K().valider(ont(), x.spec).length);
    return `<div class="ea">
      ${eksempler.length ? `<div class="ea-eksempler"><b>Start med et spørgsmål</b> <span class="muted">– klik, og ret det bagefter til</span>
        <div class="ea-knapper">${eksempler.map((x, i) => `<button type="button" class="chip small" data-ea-eksempel="${EKSEMPLER.indexOf(x)}">${esc(x.navn)}</button>`).join('')}</div></div>` : ''}
      <div class="ea-trin"><span class="ea-nr">1</span><div><b>Hvad vil du tælle?</b><p class="ea-hjaelp">Vælg hvad analysen handler om.</p>
        <div class="ea-knapper">${typer().map(x => `<button type="button" class="chip small${s.type === x.id ? ' on' : ''}" data-ea-type="${x.id}" aria-pressed="${s.type === x.id}">${esc(x.flertal)}</button>`).join('')}</div></div></div>

      <div class="ea-trin"><span class="ea-nr">2</span><div><b>Afgræns <span class="muted">(valgfrit)</span></b>
        <p class="ea-hjaelp">Tilføj filtre for kun at tage nogle med. Klik på et filter for at ændre det, × fjerner det.</p>
        ${trinliste.map((x, i) => `<div class="ea-saet">
          <div class="ea-saet-top">${i ? `<span class="ea-pil">→</span> <b>${esc(x.link.label)}</b> <span class="muted">(${esc(flertal(x.type).toLowerCase())})</span>
            ${i === trinliste.length - 1 ? '<button type="button" class="ea-fjern" data-ea-around-fjern aria-label="Fjern trin">×</button>' : ''}` : `<b>${esc(flertal(x.type))}</b>`}</div>
          ${filterListe(t, x.type, x.filtre, [i])}</div>`).join('')}
        ${ont().links(T).some(l => L.alle(l.til).length) ? `<div class="ea-around"><span>Vil du i stedet se på det, de ${r.objekter.length} ${esc(flertal(T).toLowerCase())} hænger sammen med? Skift til:</span>
          <div class="ea-knapper">${ont().links(T).filter(l => L.alle(l.til).length)
          .map(l => `<button type="button" class="chip small" data-ea-around="${esc(l.navn)}" title="Fx: arrangementerne ovenfor → de foreninger, der har arrangeret dem">${esc(l.label)} <span class="muted">(${esc(flertal(l.til).toLowerCase())})</span></button>`).join('')}</div></div>` : ''}
      </div></div>

      <div class="ea-trin"><span class="ea-nr">3</span><div><b>Vis resultatet som</b>
        <div class="ea-knapper">
          <button type="button" class="chip small${punkter ? '' : ' on'}" data-ea-visning="soejler" aria-pressed="${!punkter}">Søjler – ét tal pr. gruppe</button>
          <button type="button" class="chip small${punkter ? ' on' : ''}" data-ea-visning="punkter" aria-pressed="${punkter}">Punktdiagram – sammenlign to tal</button>
        </div>
        <p class="ea-hjaelp">${hvertObjekt ? `Hver ${esc(ont().type(T).label.toLowerCase())} er et punkt. Vælg de to tal, der skal stilles op mod hinanden.`
          : punkter ? 'Hvert punkt er en gruppe – fx alle arrangementer fra én forening. Vælg "Hver … for sig" for at bruge hvert objekts egne tal.'
          : 'Del resultatet op i grupper (fx pr. forening eller pr. måned), og vælg hvad søjlerne skal vise.'}</p>
        <div class="ea-raekke">
          <label>${punkter ? 'Ét punkt pr.' : 'Én søjle pr.'}<select data-ea-gruppe>${opt('', punkter ? `Hver ${ont().type(T).label.toLowerCase()} for sig` : 'Ingen opdeling – kun det samlede tal', !g)}${stiMenu(T, stier.filter(x => x.egenskab.type !== 'tal'), g && g.egenskab)}</select></label>
          ${ge && ge.type === 'dato' ? `<label>pr.<select data-ea-pr>${Object.entries(K().DATO_GRUPPER).map(([k, d]) => opt(k, d.label, (g.pr || 'maaned') === k)).join('')}</select></label>` : ''}
          <label>${punkter ? 'Vandret akse (→)' : 'Søjlerne viser'}${hvertObjekt ? egenskabMenu(T, maal, 'data-ea-maal') : maalMenu(T, stier, maal, 'data-ea-maal')}</label>
          ${punkter ? `<label>Lodret akse (↑)${hvertObjekt ? egenskabMenu(T, maal2, 'data-ea-maal2') : maalMenu(T, stier, maal2, 'data-ea-maal2')}</label>` : ''}
        </div></div></div>

      <h3 class="ea-resultat">Resultat</h3>
      ${opsummering(s, r, T)}
      <div class="tiles">
        ${tile(`${flertal(T)} i resultatet`, String(r.objekter.length), `af ${L.alle(T).length} i alt`)}
        ${maal.funktion !== 'antal' && !punkter ? tile(maalTekst(s), num1(r.total), 'for hele sættet', true) : ''}
        ${r.grupper ? tile('Grupper', String(r.grupper.length), `én pr. ${gruppeTekst}`) : ''}
      </div>
      ${hvertObjekt ? `<h3>${esc(akse(maal2))} mod ${esc(akse(maal).toLowerCase())}</h3>
        <div class="ea-diagram">${diagram}</div>` : ''}
      ${r.grupper ? `<h3>${punkter ? `${esc(maalTekst(s, maal2))} mod ${esc(maalTekst(s).toLowerCase())}` : esc(maalTekst(s))} pr. ${esc(gruppeTekst)}</h3>
        <p class="note">Klik på ${punkter ? 'et punkt' : 'en søjle'} for kun at se den gruppe (den bliver et filter).</p><div class="ea-diagram">${diagram}</div>` : ''}

      <div class="ea-handlinger">
        <button type="button" class="chip small primary" data-ea-kort>Vis på kortet</button>
        <button type="button" class="chip small" data-ea-csv>Hent som CSV</button>
        <button type="button" class="chip small" data-ea-nulstil>Nulstil</button>
      </div>

      <h3>${esc(flertal(T))} med i resultatet</h3>
      ${!r.objekter.length ? '<p class="empty">Ingen.</p>' : `<table class="hb-tabel analyse-tabel ea-tabel"><thead><tr><th>${esc(ont().type(T).egenskaber[ont().type(T).titel].label)}</th>
        ${[...kol, ...maalKol].map(k => `<th>${esc(stiNavn(T, k))}</th>`).join('')}</tr></thead>
        <tbody>${r.objekter.slice(0, MAKS_RAEKKER).map(o => { const f = foreningFor(o);
          return `<tr${f ? ` tabindex="0" data-f="${esc(f)}"` : ''}><td>${esc(L.titel(o))}</td>${[...kol, ...maalKol].map(k => `<td>${esc(celle(o, k))}</td>`).join('')}</tr>`; }).join('')}</tbody></table>
        ${r.objekter.length > MAKS_RAEKKER ? `<p class="note">Viser ${MAKS_RAEKKER} af ${r.objekter.length} – hent CSV for dem alle.</p>` : ''}`}

      <h3>Gem analysen</h3>
      <div class="ea-raekke ea-gem">
        <label>Navn<input type="text" data-ea-navn value="${esc(t.navn)}" placeholder="Fx Foreninger uden noget planlagt"></label>
        <button type="button" class="chip small" data-ea-gem="lokal">Gem i browseren</button>
        <button type="button" class="chip small" data-ea-gem="faelles"${kanFaelles ? '' : ' disabled title="Gem for alle er ikke sat op (se README: Rettelser)"'}>Gem for alle admins</button>
        ${t.gemt ? `<button type="button" class="linkbtn" data-ea-somny>Gem som ny</button><button type="button" class="linkbtn danger" data-ea-slet>Slet</button>` : ''}
      </div>
      <p class="form-status">${esc(t.besked)}</p>
      <p class="note">Analysen gemmes som en opskrift og regnes altid på de nyeste data. Gemte analyser står i listen til venstre.</p>
    </div>`;
  }

  function csv(res) {
    const L = lager(), T = res.type, stier = ont().stier(T, {rolle: 'admin', dybde: 0});
    const celle = v => { const x = v instanceof Date ? K().tid.dagNoegle(v) : v ?? ''; return `"${String(x).replace(/"/g, '""')}"`; };
    const linjer = [['id', ...stier.map(s => s.label)].map(celle).join(';'),
      ...res.objekter.map(o => [o.id, ...stier.map(s => L.vaerdi(o, s.sti))].map(celle).join(';'))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + linjer.join('\r\n')], {type: 'text/csv;charset=utf-8'}));
    a.download = `lau-${T.toLowerCase()}-${K().tid.dagNoegle(new Date())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function bindBygger(el, t) {
    const igen = () => { hideTip(); renderAnalyser(); };
    const on = (sel, ev, fn) => el.querySelectorAll(sel).forEach(x => x.addEventListener(ev, e => fn(x, e)));
    const sti = k => k.split('.').map(Number);
    on('[data-ea-nulstil]', 'click', () => { t.spec = t.gemt ? kopi(t.gemt.spec) : nySpec(); t.aaben = null; igen(); });
    if (!K() || K().valider(ont(), t.spec).length) return;
    const s = t.spec;
    on('[data-ea-eksempel]', 'click', b => { t.spec = kopi(EKSEMPLER[+b.dataset.eaEksempel].spec); t.aaben = null; igen(); });
    on('[data-ea-type]', 'click', b => {
      if (s.type === b.dataset.eaType && !s.searchAround?.length) return;
      t.spec = {type: b.dataset.eaType, filtre: [], maal: {funktion: 'antal'}};
      t.aaben = null; igen();
    });
    on('[data-ea-nyt]', 'change', x => {
      const p = sti(x.dataset.eaNyt), type = typeVed(s, p), {liste} = filterVed(s, p), [art, navn] = [x.value.slice(0, 1), x.value.slice(2)];
      if (!navn) return;
      if (art === 'l') { liste.push({link: navn, filtre: []}); t.aaben = null; }
      else {
        const e = ont().sti(type, navn).egenskab;
        liste.push(e.type === 'dato' ? {egenskab: navn, periode: 'seneste365'} : e.type === 'tal' ? {egenskab: navn, min: null, max: null} : {egenskab: navn, er: []});
        t.aaben = stiNoegle([...p, liste.length - 1]);
      }
      igen();
    });
    on('[data-ea-rediger]', 'click', b => { const k = b.dataset.eaRediger; if (!filterVed(s, sti(k)).f.link) t.aaben = t.aaben === k ? null : k; igen(); });
    on('[data-ea-fjern]', 'click', b => {
      const p = sti(b.dataset.eaFjern), {liste} = filterVed(s, p.slice(0, -1));
      liste.splice(p[p.length - 1], 1); t.aaben = null; igen();
    });
    on('[data-ea-ingen]', 'change', x => { filterVed(s, sti(x.dataset.eaIngen)).f.ingen = x.value === 'ingen'; igen(); });
    const ed = el.querySelector('[data-ea-editor]');
    if (ed) {
      const f = filterVed(s, sti(ed.dataset.eaEditor)).f, tal = v => (v === '' ? null : +v);
      on('[data-ea-v]', 'change', () => { f.er = [...ed.querySelectorAll('[data-ea-v]:checked')].map(x => JSON.parse(x.dataset.eaV)); igen(); });
      on('[data-ea-alle]', 'click', () => { f.er = []; igen(); });
      on('[data-ea-min]', 'change', x => { f.min = tal(x.value); igen(); });
      on('[data-ea-max]', 'change', x => { f.max = tal(x.value); igen(); });
      on('[data-ea-periode]', 'change', x => { f.periode = x.value; igen(); });
      on('[data-ea-fra]', 'change', x => { f.fra = x.value; igen(); });
      on('[data-ea-til]', 'change', x => { f.til = x.value; igen(); });
      on('[data-ea-indeholder]', 'change', x => { f.indeholder = x.value.trim() || undefined; igen(); });
    }
    // Efter et skift til en anden type passer grupperingen og målene ikke længere.
    const nulstilVisning = () => { delete s.gruppering; delete s.maal2; delete s.visning; s.maal = {funktion: 'antal'}; };
    on('[data-ea-around]', 'click', b => {
      (s.searchAround = s.searchAround || []).push({link: b.dataset.eaAround, filtre: []});
      nulstilVisning(); t.aaben = null; igen();
    });
    on('[data-ea-around-fjern]', 'click', () => { s.searchAround.pop(); nulstilVisning(); t.aaben = null; igen(); });
    on('[data-ea-gruppe]', 'change', x => {
      if (x.value) s.gruppering = {egenskab: x.value}; else delete s.gruppering;
      if (s.visning === 'punkter' && !s.gruppering) objektAkser(s);
      igen();
    });
    on('[data-ea-pr]', 'change', x => { s.gruppering.pr = x.value; igen(); });
    on('[data-ea-maal]', 'change', x => { s.maal = tilMaal(x.value); igen(); });
    on('[data-ea-maal2]', 'change', x => { s.maal2 = tilMaal(x.value); igen(); });
    on('[data-ea-visning]', 'click', b => {
      if (b.dataset.eaVisning === 'soejler') { delete s.visning; delete s.maal2; igen(); return; }
      const T = slutType(s), stier = ont().stier(T, {rolle: 'admin'});
      s.visning = 'punkter';
      // Har typen selv mindst to tal (fx foreninger), er hvert objekt et punkt. Ellers ét punkt pr. forening (eller den første kategori).
      if (!s.gruppering && egneTal(T).length >= 2) { objektAkser(s); igen(); return; }
      if (!s.gruppering) {
        const l = ont().links(T).find(y => y.til === 'Forening');
        const sti = l ? `${l.navn}.navn` : (stier.find(y => y.egenskab.type === 'kat') || stier.find(y => y.egenskab.type !== 'tal')).sti;
        s.gruppering = {egenskab: sti};
      }
      if (!s.maal2) { const tal = stier.find(y => y.egenskab.type === 'tal' && !y.viaLink); s.maal2 = tal ? {funktion: 'sum', egenskab: tal.sti} : {funktion: 'antal'}; }
      igen();
    });

    // Bor ned: klik på en søjle gør gruppen til et filter (søjlerne står i samme rækkefølge som grupperne).
    const r = K().koer(lager(), s);
    if (s.visning === 'punkter' && !s.gruppering) {
      if (slutType(s) === 'Forening') on('[data-ea-punkt]', 'click', c => openForening(c.dataset.eaNoegle));
    } else if (r.grupper) {
      on('[data-ea-punkt]', 'click', c => { t.spec = K().boreNed(ont(), s, r.grupper[+c.dataset.eaPunkt]); t.aaben = null; igen(); });
      el.querySelectorAll('.ea-diagram rect.hit').forEach((rect, i) => {
        const g = r.grupper[i];
        if (!g) return;
        rect.style.cursor = 'pointer';
        rect.addEventListener('click', () => { t.spec = K().boreNed(ont(), s, g); t.aaben = null; igen(); });
      });
    }
    on('[data-ea-kort]', 'click', () => visPaaKort(t));
    on('[data-ea-csv]', 'click', () => csv(r));
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
