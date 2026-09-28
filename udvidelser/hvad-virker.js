'use strict';
/*
 * "Hvad virker?" – kun for admins. Hvilke typer, ugedage, tidspunkter og varsler giver flest tilkendegivelser på Facebook?
 * Grundlag: afholdte, gyldige arrangementer med svar (deltager + interesseret) fra lokalforeningerne. For at store
 * foreninger ikke dominerer, måles hvert arrangement mod sin forenings median: indeks = svar ÷ foreningens median svar
 * (kun foreninger med mindst HV.minForening arrangementer). Pr. gruppe vises medianindekset; grupper med færre end
 * HV.minN arrangementer nedtones og bruges ikke i konklusionerne.
 * Filen er pakket ind i en funktion, så dens navne ikke støder sammen med app.js eller andre udvidelser.
 */
(() => {
  const HV = {minForening: 3, minN: 5, forskel: 0.2};
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

  /** Arrangementerne i grundlaget med indeks, og hvem der er udeladt. */
  function grundlag() {
    const pr = new Map(); // forening → dens arrangementer med svar (hvert arrangement én gang, hos den første lokalforening)
    for (const f of DATA.lokale) {
      for (const e of f.afholdt) {
        if (e.svar == null) continue;
        const ejer = e.foreninger.find(n => n !== NATIONAL && DATA.byName.has(n));
        if (ejer !== f.navn) continue;
        if (!pr.has(f.navn)) pr.set(f.navn, []);
        pr.get(f.navn).push(e);
      }
    }
    const rows = [], udeladt = [];
    for (const [navn, list] of pr) {
      const m = median(list.map(e => e.svar));
      if (list.length < HV.minForening || !m) { udeladt.push({navn, n: list.length}); continue; }
      for (const e of list) rows.push({e, forening: navn, median: m, idx: e.svar / m});
    }
    return {rows, udeladt, foreninger: pr.size - udeladt.length};
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
      const tip = !g.n ? `${g.label}|Ingen arrangementer` : `${g.label}|Median: ${fx(g.idx)} foreningens normale tilslutning|n = ${g.n} arrangementer${
        faa ? `|For få (under ${HV.minN}) til at konkludere` : ''}`;
      s += `<rect class="hit" x="0" y="${y - 5}" width="${width}" height="${rowH}" data-tip="${esc(tip)}"/>`;
    });
    return s + '</svg>';
  }

  /** Konklusionen for én opdeling i ord – kun ud fra grupper med nok arrangementer. */
  function konklusion(dim, grupper) {
    const ok = grupper.filter(g => g.n >= HV.minN).sort((a, b) => b.idx - a.idx);
    if (ok.length < 2) return `<b>${esc(dim.titel)}:</b> for få arrangementer til at sammenligne${ok.length ? ` (kun ${esc(ok[0].label.toLowerCase())} har mindst ${HV.minN})` : ''}.`;
    const bedst = ok[0], svagest = ok[ok.length - 1];
    if (bedst.idx - svagest.idx < HV.forskel) return `<b>${esc(dim.titel)}:</b> ingen tydelig forskel (${esc(tal1(svagest.idx))}–${esc(fx(bedst.idx))}).`;
    return `${dim.saetning(bedst.label)} giver ${esc(fx(bedst.idx))} foreningens normale tilslutning (n = ${bedst.n}), `
      + `mens ${dim.saetning(svagest.label).replace(/^Arrangementer/, 'arrangementer')} giver ${esc(fx(svagest.idx))} (n = ${svagest.n}).`;
  }

  registerAnalyse({
    id: 'hvad-virker', titel: 'Hvad virker?',
    beskrivelse: 'Hvilke typer, ugedage, tidspunkter og varsler giver flest tilkendegivelser – målt mod hver forenings normale niveau.',
    render() {
      const {rows, udeladt, foreninger} = grundlag();
      if (!rows.length) return `<p class="empty">Endnu ingen lokalforeninger med mindst ${HV.minForening} afholdte arrangementer med tilkendegivelser.</p>`;
      const opdelt = DIMENSIONER.map(dim => ({dim, grupper: opdel(rows, dim)}));
      const nVarsel = rows.filter(r => varselDage(r.e) != null).length;
      const top = [...rows].sort((a, b) => b.idx - a.idx || b.e.svar - a.e.svar).slice(0, 10);
      const udeladtN = udeladt.reduce((s, u) => s + u.n, 0);
      return `<div class="tiles">
          ${tile('Arrangementer i grundlaget', String(rows.length), `Afholdte med tilkendegivelser fra ${foreninger} lokalforeninger`)}
          ${tile('Tilkendegivelser (median)', num1(median(rows.map(r => r.e.svar))), 'Deltager + interesseret på Facebook')}
          ${tile('Med målt varsel', String(nVarsel), 'Opdaget efter indsamlingens start')}
        </div>
        <h3>Konklusioner</h3>
        <ul class="hv-konklusioner">${opdelt.map(({dim, grupper}) => `<li>${konklusion(dim, grupper)}</li>`).join('')}</ul>
        <div class="hv-grid">${opdelt.map(({dim, grupper}) => `<div><h3>${esc(dim.titel)}</h3>${
          dim.id === 'varsel' && !nVarsel ? `<p class="note">Varsel kan kun måles for arrangementer, der er dukket op efter indsamlingens start (${esc(fmtDate.format(DATA.firstRun))}) – endnu ingen afholdte.</p>`
          : indeksSoejler(grupper, {aria: `Medianindeks pr. ${dim.titel.toLowerCase()}`})}</div>`).join('')}</div>
        <div class="chart-legend"><span><span class="swatch" style="background:var(--accent)"></span>Medianindeks (1 × = foreningens normale tilslutning)</span>
          <span><span class="swatch hv-swatch-faa"></span>Under ${HV.minN} arrangementer – for få til at konkludere</span></div>
        <h3>Top 10 – mest over foreningens normale</h3>
        <table class="hb-tabel analyse-tabel hv-top"><thead><tr><th>Arrangement</th><th>Forening</th><th>Dato</th>
          <th title="Deltager + interesseret">Tilk.</th><th title="Foreningens median">Normalt</th><th>Indeks</th></tr></thead>
          <tbody>${top.map(({e, forening, median: m, idx}) => `<tr>
            <td class="hv-navn">${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(trunc(e.navn, 60))}</a>` : esc(trunc(e.navn, 60))}<span class="hv-kat">${esc(e.kat)}</span></td>
            <td><button class="forening-link" data-f="${esc(forening)}">${esc(forening)}</button></td>
            <td class="tal">${esc(fmtDate.format(e.startD))}</td><td class="tal">${e.svar}</td><td class="tal">${esc(num1(m))}</td>
            <td class="tal"><b>${esc(fx(idx))}</b></td></tr>`).join('')}</tbody></table>
        <h3>Forbehold</h3>
        <ul class="hv-forbehold">
          <li>Tilkendegivelser på Facebook ("deltager" + "interesseret") er ikke fremmøde – og nogle arrangementer deles mere end andre.</li>
          <li>Der er få data: ${rows.length} arrangementer fordelt på ${foreninger} foreninger. Grupper med under ${HV.minN} arrangementer er nedtonet og indgår ikke i konklusionerne, og også større grupper kan skyldes tilfældigheder eller én enkelt forening.</li>
          <li>Opdelingerne hænger sammen (fx ligger oplæg ofte på hverdagsaftener), så en forskel på én led kan skyldes en anden.</li>
          <li>Historikken er først hentet i 2026 (data fra ${esc(fmtDate.format(DATA.dataFra))}), og Facebook viser svarene, som de var, da arrangementet sidst blev set.</li>
          <li>Varsel kan kun måles for arrangementer, der er dukket op efter indsamlingens start (${esc(fmtDate.format(DATA.firstRun))}) – ${nVarsel} indtil nu.</li>
          ${udeladt.length ? `<li>${udeladtN} arrangementer fra ${udeladt.length} foreninger med færre end ${HV.minForening} (${esc(udeladt.map(u => u.navn).sort((a, b) => a.localeCompare(b, 'da')).join(', '))}) er ikke med, da deres normale niveau ikke kan bestemmes.</li>` : ''}
        </ul>`;
    },
  });
})();
