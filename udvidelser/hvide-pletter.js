'use strict';
/*
 * Kommuner uden aktivitet ("hvide pletter") – kun for admins.
 * For hver kommune i en lokalforenings område tælles foreningens gyldige arrangementer de seneste 12 måneder plus de
 * planlagte (via e.kommune). Kun lokalforeninger med Facebook-side er med – uden den ved vi ikke, hvor foreningen er
 * aktiv. Reglen står i kernen: kommuneAktivitet() i kerne/regler.js, og i ontologien (kerne/lau.js) som egenskaberne
 * hvidPlet, egneAfholdt og egnePlanlagte på Kommune og hvidePletter på Forening – så den også kan bruges i filtre,
 * grupperinger og analysebyggeren. Filen her er kortlaget og analysen, og den placerer medlemmerne: kendes
 * medlemstallene (data/admin/medlemmer.krypt.json), placeres hver by i den kommune, den ligger i (punkt-i-polygon), og
 * medlemmerne summeres pr. kommune. Samme beregning bruges af kortlaget og analysen.
 * Filen er pakket ind i en funktion, så dens navne ikke støder sammen med app.js eller andre udvidelser.
 */
(() => {
  // Okker/brændt orange: forveksles ikke med HB-magenta, aktivitetsfarverne (blå/grå) eller momentum (grøn/gul/rød fyld).
  const HP = {farve: '#d97706', staerk: '#b45309', dage: K.regler.HVIDE_PLETTER.DAGE};
  const cache = {data: null, medl: null, res: null};

  /** Finder kommunen, et punkt ligger i. Ligger punktet lige uden for den forenklede kystlinje, prøves punkter i nærheden. */
  function kommuneFor(kommuner, lng, lat) {
    const i = p => kommuner.find(k => d3.geoContains(k.feature, p));
    let k = i([lng, lat]);
    for (const r of [0.01, 0.02, 0.04, 0.08]) { // ca. 1–9 km
      if (k) break;
      for (let v = 0; v < 8 && !k; v++) k = i([lng + 1.8 * r * Math.cos(v * Math.PI / 4), lat + r * Math.sin(v * Math.PI / 4)]);
    }
    return k || null;
  }

  /**
   * {kommuner: Map(navn → {navn, forening, feature, afholdt, planlagt, aktiv, medlemmer}), foreninger: [...], medl, uplaceret}.
   * aktiv er null for kommuner uden for de foreninger, der er med. medlemmer er null, når medlemstal ikke kendes.
   */
  function hvidePletter() {
    const medl = ADMIN.data.medlemmer || null;
    if (cache.data === DATA && cache.medl === medl) return cache.res;
    const fra = new Date(NOW.getTime() - HP.dage * DAY);
    const kommuner = new Map(DATA.geo.kom.features.map(feat => [feat.properties.navn, {
      navn: feat.properties.navn, forening: feat.properties.forening, feature: feat,
      afholdt: 0, planlagt: 0, aktiv: null, medlemmer: medl ? 0 : null}]));
    let uplaceret = 0;
    if (medl) {
      const alle = [...kommuner.values()];
      for (const r of medl) {
        const k = r.lat != null && r.lng != null ? kommuneFor(alle, +r.lng, +r.lat) : null;
        if (k) k.medlemmer += +r.antal || 0; else uplaceret += +r.antal || 0;
      }
    }
    const foreninger = [], L = DATA.lager;
    for (const f of DATA.lokale) {
      // Kernen: kommuneAktivitet på foreningen (null uden Facebook-side) og egneAfholdt/egnePlanlagte/hvidPlet på kommunen.
      const d = L.vaerdi(L.hent('Forening', f.navn), 'kommuneAktivitet');
      if (!d) continue;
      const {ukendt, udenfor} = d;
      const ks = f.kommuner.map(n => kommuner.get(n)).filter(Boolean);
      for (const k of ks) {
        const o = L.hent('Kommune', k.navn);
        Object.assign(k, {afholdt: L.vaerdi(o, 'egneAfholdt'), planlagt: L.vaerdi(o, 'egnePlanlagte'), aktiv: L.vaerdi(o, 'hvidPlet') === false});
      }
      const uden = ks.filter(k => !k.aktiv).sort((a, b) => (b.medlemmer || 0) - (a.medlemmer || 0) || a.navn.localeCompare(b.navn, 'da'));
      foreninger.push({f, navn: f.navn, kommuner: ks, med: ks.filter(k => k.aktiv), uden, ukendt, udenfor,
        medlemmerUden: medl ? uden.reduce((s, k) => s + k.medlemmer, 0) : null,
        medlemmerIalt: medl ? ks.reduce((s, k) => s + k.medlemmer, 0) : null});
    }
    // Mest at hente først: flest medlemmer i kommuner uden aktivitet (hvis kendt), så flest kommuner uden aktivitet.
    foreninger.sort((a, b) => (b.medlemmerUden || 0) - (a.medlemmerUden || 0) || b.uden.length - a.uden.length
      || a.med.length / a.kommuner.length - b.med.length / b.kommuner.length || a.navn.localeCompare(b.navn, 'da'));
    Object.assign(cache, {data: DATA, medl, res: {kommuner, foreninger, medl, uplaceret, fra}});
    return cache.res;
  }

  const skravIkon = farve => `<svg width="14" height="12" aria-hidden="true"><rect x="1" y="1" width="12" height="10" fill="none" stroke="${farve}" stroke-width="1.6"/><path d="M1 9L7 3M5 11L13 3" stroke="${farve}" stroke-width="1.6"/></svg>`;

  registerLayer({
    id: 'hvide-pletter', label: 'Kommuner uden aktivitet (12 mdr.)', toggle: true, standard: false, admin: true, gruppe: 'kort',
    hint: 'Orange skravering: ingen afholdte eller planlagte arrangementer i kommunen det seneste år. Tættere, hvis der er medlemmer',
    tegn(api, ctx) {
      const {kommuner} = hvidePletter();
      const map = ctx.map;
      if (!map.hasImage('hp-svag')) map.addImage('hp-svag', skravering(HP.farve, 10));
      if (!map.hasImage('hp-staerk')) map.addImage('hp-staerk', skravering(HP.staerk, 6));
      const punkt = new Map(DATA.geo.klabels.features.map(k => [k.properties.navn, k.geometry]));
      const valgte = [...kommuner.values()].filter(k => k.aktiv === false && (!ctx.zoomed || k.forening === ctx.selected));
      const src = api.source('kom', {type: 'FeatureCollection', features: valgte.map(k => ({type: 'Feature',
        properties: {navn: k.navn, medlemmer: k.medlemmer || 0}, geometry: k.feature.geometry}))});
      const medM = ['>', ['get', 'medlemmer'], 0];
      api.layer({id: 'svag', type: 'fill', source: src, filter: ['!', medM], paint: {'fill-pattern': 'hp-svag', 'fill-opacity': 0.75}});
      api.layer({id: 'staerk', type: 'fill', source: src, filter: medM, paint: {'fill-pattern': 'hp-staerk', 'fill-opacity': 0.9}});
      api.layer({id: 'kant', type: 'line', source: src, paint: {
        'line-color': ['case', medM, HP.staerk, HP.farve], 'line-width': ['case', medM, 2.2, 1.2], 'line-opacity': 0.9}});
      const etiketter = valgte.filter(k => k.medlemmer > 0 && punkt.has(k.navn));
      if (!etiketter.length) return;
      const pts = api.source('medl', {type: 'FeatureCollection', features: etiketter.map(k => ({type: 'Feature',
        properties: {tekst: `${k.medlemmer} medl.`}, geometry: punkt.get(k.navn)}))});
      // Under kommunenavnet (laget "Kommunenavne"), så de ikke skjuler hinanden.
      api.layer({id: 'antal', type: 'symbol', source: pts, layout: {'text-field': ['get', 'tekst'], 'text-font': FONT_BOLD,
        'text-size': 11, 'text-offset': [0, ctx.zoomed ? 1.4 : 0], 'text-padding': 2},
        paint: {'text-color': HP.staerk, 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.6}});
    },
  });

  // Tegnforklaringen: renderLegend() i app.js skriver hele #legend forfra, så laget tilføjer sin linje bagefter.
  // renderLegend er en global funktionserklæring, så app.js' egne kald går også gennem indpakningen.
  if (typeof renderLegend === 'function') {
    const tidligere = renderLegend;
    renderLegend = function () { // eslint-disable-line no-global-assign
      tidligere.apply(this, arguments);
      const el = document.getElementById('legend');
      if (!el || !DATA || !erAdmin() || !layerState['hvide-pletter']) return;
      const medl = !!ADMIN.data.medlemmer;
      el.insertAdjacentHTML('beforeend', `<span data-hp-legend>${skravIkon(HP.farve)}Kommune uden aktivitet (12 mdr.)</span>`
        + (medl ? `<span data-hp-legend>${skravIkon(HP.staerk)}– med medlemmer</span>` : ''));
    };
  }

  const kommuneTekst = (k, medl) => esc(k.navn) + (medl && k.medlemmer ? ` <span class="hp-medl">(${esc(String(k.medlemmer))})</span>` : '');

  registerAnalyse({
    id: 'hvide-pletter', titel: 'Kommuner uden aktivitet',
    beskrivelse: 'Kommuner i lokalforeningernes områder uden afholdte eller planlagte arrangementer det seneste år – og hvor mange medlemmer der bor dér.',
    render() {
      const {foreninger, medl, uplaceret, fra} = hvidePletter();
      const alle = foreninger.flatMap(x => x.kommuner), uden = foreninger.flatMap(x => x.uden);
      const medlUden = foreninger.reduce((s, x) => s + (x.medlemmerUden || 0), 0);
      const medlIalt = foreninger.reduce((s, x) => s + (x.medlemmerIalt || 0), 0);
      const pct = (a, b) => (b ? `${Math.round(a / b * 100)} %` : '–');
      const dataFra = DATA.dataFra > fra ? DATA.dataFra : fra;
      const rows = foreninger.map(x => `<tr>
        <td><button class="forening-link" data-f="${esc(x.navn)}">${esc(x.navn)}</button></td>
        <td class="tal">${x.kommuner.length}</td>
        <td class="tal">${x.med.length}</td>
        <td class="tal">${x.uden.length}</td>
        <td class="hp-navne">${x.uden.length ? x.uden.map(k => kommuneTekst(k, medl)).join(', ') : '<span class="muted">Aktivitet i alle</span>'}${
          x.ukendt + x.udenfor ? `<span class="hp-andet" title="Tæller ikke med ovenfor">+ ${x.ukendt ? `${x.ukendt} uden kendt sted` : ''}${x.ukendt && x.udenfor ? ', ' : ''}${
            x.udenfor ? `${x.udenfor} uden for området` : ''}</span>` : ''}</td>
        ${medl ? `<td class="tal">${x.medlemmerUden ? `<b>${x.medlemmerUden}</b>` : '0'}<span class="hp-af"> / ${x.medlemmerIalt}</span></td>` : ''}
        <td><button type="button" class="chip small" data-hp-vis="${esc(x.navn)}"${x.uden.length ? '' : ' disabled'}>Vis på kortet</button></td></tr>`).join('');
      return `<div class="tiles">
          ${tile('Kommuner i områderne', String(alle.length), `${foreninger.length} lokalforeninger med Facebook-side`)}
          ${tile('Uden aktivitet (12 mdr.)', String(uden.length), `${pct(uden.length, alle.length)} af kommunerne`, true)}
          ${medl ? tile('Medlemmer i kommuner uden aktivitet', String(medlUden), `${pct(medlUden, medlIalt)} af ${medlIalt} placerede medlemmer`) : ''}
        </div>
        <div class="hp-knapper"><button type="button" class="chip small" data-hp-vis="">Vis alle på kortet</button></div>
        <table class="hb-tabel analyse-tabel hp-tabel"><thead><tr>
          <th>Forening</th><th title="Kommuner i foreningens område">Kommuner</th><th title="Kommuner med mindst ét afholdt eller planlagt arrangement">Med akt.</th>
          <th title="Kommuner uden aktivitet">Uden</th><th>Kommuner uden aktivitet${medl ? ' (medlemmer)' : ''}</th>
          ${medl ? '<th title="Medlemmer i kommuner uden aktivitet / medlemmer i området">Medl. uden akt.</th>' : ''}<th></th></tr></thead>
          <tbody>${rows}</tbody></table>
        <h3>Sådan er det opgjort</h3>
        <p class="note">For hver kommune i en lokalforenings område tælles foreningens egne arrangementer (også dem, den er medarrangør af),
          der ikke er aflyst eller fjernet, og som er afholdt siden ${esc(fmtDate.format(fra))} eller er planlagt. Kommunen findes ud fra
          arrangementets adresse; arrangementer uden kendt sted (fx online eller uden adresse på Facebook) eller uden for området tæller ikke med,
          men vises som "+ …". Afholdte arrangementer kendes kun fra ${esc(fmtDate.format(dataFra))}, så de 12 måneder er i praksis kortere.
          Landsforeningens arrangementer tæller ikke med. Kun lokalforeninger med Facebook-side er med.
          ${medl ? `Medlemmerne er placeret i den kommune, byens koordinat ligger i${uplaceret ? ` (${uplaceret} medlemmer kunne ikke placeres)` : ''}.
          Sorteret efter flest medlemmer i kommuner uden aktivitet, derefter flest kommuner uden aktivitet.`
          : 'Medlemstal kendes ikke (data/admin/medlemmer.krypt.json mangler), så der er sorteret efter flest kommuner uden aktivitet.'}</p>`;
    },
    efter(el) {
      el.querySelectorAll('[data-hp-vis]').forEach(b => b.addEventListener('click', () => {
        if (!layerState['hvide-pletter']) setVisning('hvide-pletter', true);
        lukAnalyser(); // vinduet dækker højre del af kortet
        if (b.dataset.hpVis) openForening(b.dataset.hpVis); else if (selected) closeForening();
      }));
    },
  });
})();
