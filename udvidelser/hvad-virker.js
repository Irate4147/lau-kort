'use strict';
/*
 * "Hvad virker?" – kun for admins. Hvilke typer, ugedage, tidspunkter og varsler giver flest deltagere?
 * Grundlag: afholdte, gyldige arrangementer med et tal for det valgte mål (MAAL): deltagere på Facebook ("deltager"),
 * tilkendegivelser ("deltager" + "interesseret") eller registreret fremmøde (under Arrangementer).
 * Lokalforeningerne og landsforeningen beregnes hver for sig (landsforeningens arrangementer er af en anden størrelse).
 * For at store foreninger ikke dominerer, måles hvert arrangement mod sin forenings median: indeks = tal ÷ foreningens
 * median (kun foreninger med mindst HV.minForening arrangementer). Pr. gruppe vises medianindekset; grupper med færre
 * end HV.minN arrangementer nedtones og bruges ikke i konklusionerne.
 * Desuden: advarslen 'rekord' (niveau 'positiv') fremhæver i den grønne boks "Godt gået" lokalforeninger, der har fået
 * markant flere deltagere end normalt til et arrangement (se markant()).
 * Filen er pakket ind i en funktion, så dens navne ikke støder sammen med app.js eller andre udvidelser.
 */
(() => {
  const HV = {minForening: 3, minN: 5, forskel: 0.2};
  // "Markant flere deltagere end normalt": mindst REKORD.gange × foreningens median og mindst REKORD.plus flere,
  // målt mod mindst REKORD.minAndre andre afholdte arrangementer. Afholdt de seneste REKORD.bagud dage, eller planlagt
  // de næste REKORD.fremad dage (Facebook-deltagere indtil nu).
  const REKORD = {gange: 1.5, plus: 5, minAndre: 3, bagud: 30, fremad: 14};
  const MAAL = {
    deltager: {label: 'Deltagere', lang: 'deltagere på Facebook ("deltager")', v: e => e.deltager, enhed: 'deltagere'},
    svar: {label: 'Tilkendegivelser', lang: 'tilkendegivelser på Facebook ("deltager" + "interesseret")', v: e => e.svar, enhed: 'tilkendegivelser'},
    fremmoede: {label: 'Fremmøde', lang: 'registreret fremmøde (noteret under Arrangementer)', v: e => e.fremmoede, enhed: 'fremmødte'},
  };
  const valg = {maal: 'deltager'};
  const tal1 = v => v.toLocaleString('da-DK', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  const fx = v => `${tal1(v)} ×`;
  const UGEDAGE_LANG = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
  const time = e => +fmtHM.format(e.startD).slice(0, 2); // time på dagen i dansk tid
  // Varsel kan kun måles for arrangementer, der er opdaget efter indsamlingens start (samme regel som f.varsel i beregn()).
  const varselDage = e => (!e.historisk && !e.manuel && e.firstD - DATA.firstRun > DAY && e.startD >= e.firstD
    ? (e.startD - e.firstD) / DAY : null);

  // Opdelingerne: grupper (i visningsrækkefølge), hvilken gruppe et arrangement hører til (null = ikke med) og en sætning.
  const DIMENSIONER = [
    {id: 'kat', titel: 'Type', grupper: KAT_NAVNE, gruppe: e => e.kat,
     saetning: g => `<b>${esc(g)}</b>`},
    {id: 'dag', titel: 'Ugedag', grupper: UGEDAGE_LANG, gruppe: e => UGEDAGE_LANG[weekday(e.startD)],
     saetning: g => `Arrangementer om <b>${esc(g.toLowerCase())}en</b>`},
    {id: 'tid', titel: 'Tidspunkt (start, dansk tid)', grupper: ['Før kl. 12', 'Kl. 12–17', 'Kl. 17–19', 'Kl. 19 eller senere'],
     gruppe: e => { const h = time(e); return h < 12 ? 'Før kl. 12' : h < 17 ? 'Kl. 12–17' : h < 19 ? 'Kl. 17–19' : 'Kl. 19 eller senere'; },
     saetning: g => `Arrangementer, der starter <b>${esc(g.replace(/^Kl\./, 'kl.').replace(/^Før/, 'før'))}</b>,`},
    {id: 'varsel', titel: 'Varsel (dage fra oprettelse til afholdelse)', grupper: ['Under 7 dage', '7–13 dage', '14–27 dage', '28 dage eller mere'],
     gruppe: e => { const d = varselDage(e); return d == null ? null : d < 7 ? 'Under 7 dage' : d < 14 ? '7–13 dage' : d < 28 ? '14–27 dage' : '28 dage eller mere'; },
     saetning: g => `Arrangementer med <b>${esc(g.replace(/^Under/, 'under'))}</b> varsel`},
  ];

  /** Foreningens afholdte arrangementer med et tal for målet (hvert arrangement én gang, hos den første forening). */
  function afholdteMed(f, v) {
    return f.afholdt.filter(e => v(e) != null && (f.national || e.foreninger.find(n => n !== NATIONAL && DATA.byName.has(n)) === f.navn));
  }

  /** Arrangementerne i grundlaget med indeks, og hvem der er udeladt. national: landsforeningen, ellers lokalforeningerne. */
  function grundlag(maal, national) {
    const v = MAAL[maal].v, rows = [], udeladt = [];
    const foreninger = national ? [DATA.byName.get(NATIONAL)].filter(Boolean) : DATA.lokale;
    let med = 0;
    for (const f of foreninger) {
      const list = afholdteMed(f, v);
      if (!list.length) continue;
      const m = median(list.map(v));
      if (list.length < HV.minForening || !m) { udeladt.push({navn: f.navn, n: list.length}); continue; }
      med++;
      for (const e of list) rows.push({e, forening: f.navn, vaerdi: v(e), median: m, idx: v(e) / m});
    }
    return {rows, udeladt, foreninger: med};
  }

  function opdel(rows, dim) {
    const grupper = new Map(dim.grupper.map(g => [g, []]));
    for (const r of rows) { const g = dim.gruppe(r.e); if (g != null && grupper.has(g)) grupper.get(g).push(r.idx); }
    return [...grupper].map(([label, v]) => ({label, n: v.length, idx: median(v)}));
  }

  /** Vandrette søjler med medianindeks, en linje ved 1 × og n. Grupper med n < HV.minN nedtones. */
  function indeksSoejler(grupper, {width = 370, labelW = 124, aria = ''} = {}) {
    const barH = 13, rowH = 24, top = 18, nW = 70;
    const max = Math.max(1.5, ...grupper.filter(g => g.n).map(g => g.idx)) * 1.08;
    const plotW = width - labelW - nW - 40, x = v => labelW + v / max * plotW;
    const h = top + grupper.length * rowH + 2;
    let s = `<svg class="chart hv-chart" viewBox="0 0 ${width} ${h}" role="img" aria-label="${esc(aria)}">`;
    s += `<line class="baseline" x1="${labelW}" x2="${labelW}" y1="${top - 4}" y2="${h}"/>`;
    s += `<line class="hv-ref" x1="${x(1)}" x2="${x(1)}" y1="${top - 4}" y2="${h}"/>`;
    s += `<text class="tick" x="${x(1)}" y="${top - 7}" text-anchor="middle">1 × = normalt</text>`;
    grupper.forEach((g, i) => {
      const y = top + i * rowH + 4, faa = g.n < HV.minN;
      s += `<text class="lbl${faa ? ' hv-faa' : ''}" x="${labelW - 6}" y="${y + 10}" text-anchor="end">${esc(trunc(g.label, Math.round(labelW / 6.2)))}</text>`;
      if (g.n) {
        const w = Math.max(2, x(g.idx) - labelW);
        s += `<path class="${faa ? 'hv-bar-faa' : 'hv-bar'}" d="${barRight(labelW, y, w, barH)}"/>`;
        s += `<text class="val${faa ? ' hv-faa' : ''}" x="${labelW + w + 5}" y="${y + 10}">${esc(fx(g.idx))}</text>`;
      }
      s += `<text class="tick${faa ? ' hv-faa' : ''}" x="${width - 2}" y="${y + 10}" text-anchor="end">${!g.n ? 'ingen data' : `n = ${g.n}${faa ? ' · for få' : ''}`}</text>`;
      const tip = !g.n ? `${g.label}|Ingen arrangementer` : `${g.label}|Median: ${fx(g.idx)} det normale|n = ${g.n} arrangementer${
        faa ? `|For få (under ${HV.minN}) til at konkludere` : ''}`;
      s += `<rect class="hit" x="0" y="${y - 5}" width="${width}" height="${rowH}" data-tip="${esc(tip)}"/>`;
    });
    return s + '</svg>';
  }

  /** Konklusionen for én opdeling i ord – kun ud fra grupper med nok arrangementer. */
  function konklusion(dim, grupper, normalt) {
    const ok = grupper.filter(g => g.n >= HV.minN).sort((a, b) => b.idx - a.idx);
    if (ok.length < 2) return `<b>${esc(dim.titel)}:</b> for få arrangementer til at sammenligne${ok.length ? ` (kun ${esc(ok[0].label.toLowerCase())} har mindst ${HV.minN})` : ''}.`;
    const bedst = ok[0], svagest = ok[ok.length - 1];
    if (bedst.idx - svagest.idx < HV.forskel) return `<b>${esc(dim.titel)}:</b> ingen tydelig forskel (${esc(tal1(svagest.idx))}–${esc(fx(bedst.idx))}).`;
    return `${dim.saetning(bedst.label)} giver ${esc(fx(bedst.idx))} ${normalt} (n = ${bedst.n}), `
      + `mens ${dim.saetning(svagest.label).replace(/^Arrangementer/, 'arrangementer')} giver ${esc(fx(svagest.idx))} (n = ${svagest.n}).`;
  }

  /** Én sektion (lokalforeningerne eller landsforeningen) for det valgte mål. */
  function sektion(national) {
    const maal = MAAL[valg.maal], {rows, udeladt, foreninger} = grundlag(valg.maal, national);
    const hvem = national ? 'landsforeningen' : 'lokalforeningerne';
    const normalt = national ? 'landsforeningens normale' : 'foreningens normale';
    if (!rows.length) {
      return `<p class="empty">Endnu ikke nok data: ${hvem} skal have mindst ${HV.minForening} afholdte arrangementer med ${esc(maal.lang)}.${
        valg.maal === 'fremmoede' ? ' Fremmøde noteres under Arrangementer.' : ''}</p>`;
    }
    const opdelt = DIMENSIONER.map(dim => ({dim, grupper: opdel(rows, dim)}));
    const nVarsel = rows.filter(r => varselDage(r.e) != null).length;
    const top = [...rows].sort((a, b) => b.idx - a.idx || b.vaerdi - a.vaerdi).slice(0, national ? 5 : 10);
    const udeladtN = udeladt.reduce((s, u) => s + u.n, 0);
    return `<div class="tiles">
        ${tile('Arrangementer i grundlaget', String(rows.length), national ? `Afholdte med ${maal.enhed}` : `Afholdte med ${maal.enhed} fra ${foreninger} lokalforeninger`)}
        ${tile(`${maal.label} pr. arrangement (median)`, num1(median(rows.map(r => r.vaerdi))), national ? 'Landsforeningens normale niveau' : 'På tværs af lokalforeningerne')}
        ${tile('Med målt varsel', String(nVarsel), 'Opdaget efter indsamlingens start')}
      </div>
      <h3>Konklusioner</h3>
      <ul class="hv-konklusioner">${opdelt.map(({dim, grupper}) => `<li>${konklusion(dim, grupper, `${normalt} antal ${maal.enhed}`)}</li>`).join('')}</ul>
      <div class="hv-grid">${opdelt.map(({dim, grupper}) => `<div><h3>${esc(dim.titel)}</h3>${
        dim.id === 'varsel' && !nVarsel ? `<p class="note">Varsel kan kun måles for arrangementer, der er dukket op efter indsamlingens start (${esc(fmtDate.format(DATA.firstRun))}) – endnu ingen afholdte.</p>`
        : indeksSoejler(grupper, {aria: `Medianindeks pr. ${dim.titel.toLowerCase()}`})}</div>`).join('')}</div>
      <h3>Top ${top.length} – mest over det normale</h3>
      <table class="hb-tabel analyse-tabel hv-top"><thead><tr><th>Arrangement</th>${national ? '' : '<th>Forening</th>'}<th>Dato</th>
        <th>${esc(maal.label)}</th><th title="Foreningens median">Normalt</th><th>Indeks</th></tr></thead>
        <tbody>${top.map(({e, forening, vaerdi, median: m, idx}) => `<tr>
          <td class="hv-navn">${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(trunc(e.navn, 60))}</a>` : esc(trunc(e.navn, 60))}<span class="hv-kat">${esc(e.kat)}</span></td>
          ${national ? '' : `<td><button class="forening-link" data-f="${esc(forening)}">${esc(forening)}</button></td>`}
          <td class="tal">${esc(fmtDate.format(e.startD))}</td><td class="tal">${vaerdi}</td><td class="tal">${esc(num1(m))}</td>
          <td class="tal"><b>${esc(fx(idx))}</b></td></tr>`).join('')}</tbody></table>
      ${udeladt.length ? `<p class="note">${udeladtN} arrangementer fra ${udeladt.length} ${udeladt.length === 1 ? 'forening' : 'foreninger'} med færre end ${HV.minForening}
        (${esc(udeladt.map(u => u.navn).sort((a, b) => a.localeCompare(b, 'da')).join(', '))}) er ikke med, da det normale niveau ikke kan bestemmes.</p>` : ''}`;
  }

  // ---------------------------------------------------------------- markant flere deltagere end normalt

  /**
   * Arrangementer i lokalforeningerne med markant flere deltagere end foreningen plejer: registreret fremmøde, hvis
   * det findes for arrangementet og mindst REKORD.minAndre andre, ellers deltagere på Facebook. Sammenlignes med
   * medianen af foreningens andre afholdte arrangementer med samme mål. Højst ét (det største) pr. forening.
   */
  function markant() {
    const fra = new Date(NOW.getTime() - REKORD.bagud * DAY), til = new Date(NOW.getTime() + REKORD.fremad * DAY);
    const ud = [];
    for (const f of DATA.lokale) {
      let bedst = null;
      for (const e of f.gyldige) {
        const afholdt = e.slutD < NOW;
        if (afholdt ? e.slutD < fra : e.startD > til) continue;
        for (const maal of afholdt ? ['fremmoede', 'deltager'] : ['deltager']) {
          const v = MAAL[maal].v, x = v(e);
          if (x == null) continue;
          const andre = afholdteMed(f, v).filter(a => a !== e).map(v);
          if (andre.length < REKORD.minAndre) continue;
          const m = median(andre);
          if (x >= REKORD.gange * m && x - m >= REKORD.plus && (!bedst || x / m > bedst.gange)) bedst = {e, maal, x, m, gange: m ? x / m : Infinity, afholdt};
          break; // fremmøde går forud for Facebook, når det kan sammenlignes
        }
      }
      if (bedst) ud.push({f, ...bedst});
    }
    return ud.sort((a, b) => b.gange - a.gange);
  }

  registerAdvarsel({
    id: 'rekord',
    hent: () => markant().map(({f, e, maal, x, m, gange, afholdt}) => ({
      niveau: 'positiv', forening: f.navn,
      titel: `${afholdt ? '' : 'På vej: '}${x} ${maal === 'fremmoede' ? 'mødte op' : 'deltagere'} til "${trunc(e.navn, 40)}" – normalt ${num1(m)}`,
      tekst: `${fmtDay.format(e.startD)} · ${Number.isFinite(gange) ? `${tal1(gange)} ×` : 'langt over'} det normale${
        maal === 'fremmoede' ? ' (registreret fremmøde)' : ''}${afholdt ? '. Del erfaringerne med de andre foreninger.' : ' – indtil nu på Facebook.'}`,
      analyse: 'hvad-virker'})),
  });

  registerAnalyse({
    id: 'hvad-virker', titel: 'Hvad virker?',
    beskrivelse: 'Hvilke typer, ugedage, tidspunkter og varsler giver flest deltagere – målt mod hver forenings normale niveau. Lokalforeningerne og landsforeningen hver for sig.',
    render() {
      const maal = MAAL[valg.maal], gode = markant();
      return `<div class="hv-valg" role="group" aria-label="Mål">${Object.entries(MAAL).map(([id, m]) =>
          `<button type="button" class="chip small${id === valg.maal ? ' on' : ''}" data-hv-maal="${id}" aria-pressed="${id === valg.maal}">${esc(m.label)}</button>`).join('')}
          <span class="note">Måler ${esc(maal.lang)}.</span></div>
        ${gode.length ? `<div class="hv-gode"><h3>Markant flere deltagere end normalt</h3>${advarselHtml(gode.map(({f, e, maal: mm, x, m, gange, afholdt}) => ({
          niveau: 'positiv', forening: f.navn, titel: `${afholdt ? '' : 'På vej: '}${x} ${mm === 'fremmoede' ? 'mødte op' : 'deltagere'} til "${trunc(e.navn, 50)}" – normalt ${num1(m)}`,
          tekst: `${fmtDay.format(e.startD)} · ${Number.isFinite(gange) ? `${tal1(gange)} ×` : 'langt over'} det normale`})))}</div>` : ''}
        <h2 class="hv-sek">Lokalforeningerne</h2>
        ${sektion(false)}
        <h2 class="hv-sek">Landsforeningen</h2>
        <p class="note">Beregnet for sig: landsforeningens arrangementer måles mod landsforeningens eget normale niveau.</p>
        ${sektion(true)}
        <div class="chart-legend"><span><span class="swatch" style="background:var(--accent)"></span>Medianindeks (1 × = det normale)</span>
          <span><span class="swatch hv-swatch-faa"></span>Under ${HV.minN} arrangementer – for få til at konkludere</span></div>
        <h3>Forbehold</h3>
        <ul class="hv-forbehold">
          <li>Deltagere og tilkendegivelser på Facebook er ikke det samme som fremmøde – og nogle arrangementer deles mere end andre. Fremmøde kendes kun, hvor det er noteret under Arrangementer.</li>
          <li>Der er få data. Grupper med under ${HV.minN} arrangementer er nedtonet og indgår ikke i konklusionerne, og også større grupper kan skyldes tilfældigheder eller én enkelt forening.</li>
          <li>Opdelingerne hænger sammen (fx ligger oplæg ofte på hverdagsaftener), så en forskel på én led kan skyldes en anden.</li>
          <li>Historikken er først hentet i 2026 (data fra ${esc(fmtDate.format(DATA.dataFra))}), og Facebook viser tallene, som de var, da arrangementet sidst blev set.</li>
          <li>"Markant flere deltagere": mindst ${tal1(REKORD.gange)} × og ${REKORD.plus} flere end medianen af foreningens andre afholdte arrangementer (mindst ${REKORD.minAndre}) – afholdt de seneste ${REKORD.bagud} dage eller planlagt de næste ${REKORD.fremad} dage. De vises også i den grønne boks "Godt gået" i oversigten.</li>
        </ul>`;
    },
    efter(el) {
      el.querySelectorAll('[data-hv-maal]').forEach(b => b.addEventListener('click', () => { valg.maal = b.dataset.hvMaal; renderAnalyser(); }));
    },
  });
})();
