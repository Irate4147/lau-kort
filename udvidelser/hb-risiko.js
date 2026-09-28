'use strict';
/*
 * HB-risiko (kun admins): hvilke lokalforeninger risikerer at miste HB-godkendelsen næste år, fordi det indeværende
 * kvartal slutter uden et afholdt arrangement? Én beregning (hbRisiko) bruges af både advarslen øverst i sidepanelet
 * ("Kræver handling nu") og analysen "HB-risiko". Bygger på hbKvartal()/f.hbKv og rytme() i app.js.
 *
 * Niveauer for det indeværende HB-kvartal (d = dage tilbage til kvartalets sidste dag, R = foreningens rytme):
 *   kritisk     intet afholdt eller planlagt, og d ≤ 14 eller d ≤ R/2
 *   advarsel    intet afholdt eller planlagt, og d ≤ max(45, R) – eller kvartalet reddes kun af planlagte
 *               arrangementer, og d ≤ 21
 *   opmaerksom  som ovenfor, men der er god tid endnu
 *   ukendt      data dækker ikke hele kvartalet (historik mangler)
 *   tabt        et afsluttet kvartal er uden afholdt arrangement – kan ikke HB-godkendes (ingen advarsel)
 *   sikret      kvartalet er i hus (mindst ét afholdt)
 * Kritisk og advarsel giver højst én advarsel pr. forening. Grænserne står i GRAENSE nedenfor.
 * Tilgængelig for andre udvidelser som LAU.hbRisiko(f).
 */
(() => {
  const GRAENSE = {kritiskDage: 14, advarselMinDage: 45, planlagtDage: 21};
  const KV = HB_KVARTALER[HB_NU];
  const SIDST_I_AARET = HB_NU === HB_KVARTALER.length - 1; // Q4: kvartalsslut = årsskiftet = HB-fristen
  const KV_NAESTE = HB_KVARTALER[HB_NU + 1] || null;
  // Kvartalets sidste dag (YYYY-MM-DD) og fristen som tidspunkt: starten af den dag i dansk tid, så "om N dage"
  // i advarslen er antal kalenderdage – det samme som dage tilbage.
  const SIDSTE_DAG = (() => { const d = new Date(KV.til + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
  const FRIST = fraDanskTid(SIDSTE_DAG, '00:00');
  const kalenderdage = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
  const DAGE = kalenderdage(dayKey(NOW), SIDSTE_DAG);
  const fristTekst = fmtDate.format(FRIST);
  const dageTekst = d => (d <= 0 ? 'sidste dag i dag' : d === 1 ? '1 dag tilbage' : `${d} dage tilbage`);
  const iKvartal = (e, k) => { const d = dayKey(e.startD); return d >= k.fra && d < k.til; };
  const opremsning = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} og ${a[a.length - 1]}`);

  const NIVEAU = {
    kritisk:    {orden: 0, label: 'Kritisk', farve: '#d03b3b', hint: 'Intet afholdt eller planlagt, og kvartalet slutter snart'},
    advarsel:   {orden: 1, label: 'Advarsel', farve: '#fab219', hint: 'Intet afholdt endnu – kvartalet slutter inden for foreningens rytme, eller det afhænger af et planlagt arrangement tæt på fristen'},
    opmaerksom: {orden: 2, label: 'Hold øje', farve: '#f3d98b', hint: 'Intet afholdt endnu, men der er god tid'},
    ukendt:     {orden: 3, label: 'Kan ikke vurderes', farve: HB_FILL.ukendt, hint: 'Data dækker ikke hele kvartalet'},
    tabt:       {orden: 4, label: `Tabt for ${HB_AAR}`, farve: HB_FILL.ikke, hint: `Et afsluttet kvartal er uden afholdt arrangement – kan ikke HB-godkendes i ${HB_AAR}`},
    sikret:     {orden: 5, label: `${KV.kort} i hus`, farve: '#1f9d55', hint: `Mindst ét afholdt arrangement i ${KV.kort}`},
  };

  /**
   * Risikoen for, at foreningen mister HB-godkendelsen på grund af det indeværende kvartal:
   * {niveau, rytme, dage, frist, status, afholdt, planlagt, naeste, naesteKv, forklaring, advarsel: {niveau, titel, tekst} | null}
   * (afholdt/planlagt: foreningens arrangementer i kvartalet; naesteKv: planlagte i det næste kvartal samme år).
   */
  function hbRisiko(f) {
    const R = rytme(f).dage, status = f.hbKv[KV.id];
    const tabte = HB_KVARTALER.slice(0, HB_NU).filter(k => f.hbKv[k.id] === 'nej').map(k => k.kort);
    const ukendte = HB_KVARTALER.slice(0, HB_NU).filter(k => f.hbKv[k.id] === 'ukendt').map(k => k.kort);
    const afholdt = f.afholdt.filter(e => iKvartal(e, KV)), planlagt = f.planlagt.filter(e => iKvartal(e, KV));
    const naesteKv = KV_NAESTE ? f.planlagt.filter(e => iKvartal(e, KV_NAESTE)) : [];
    const ud = {niveau: 'sikret', rytme: R, dage: DAGE, frist: FRIST, status, afholdt, planlagt, naeste: f.naeste, naesteKv, forklaring: '', advarsel: null};
    const sidsteKvartal = SIDST_I_AARET ? ` ${KV.kort} er årets sidste kvartal: ${fristTekst} er også fristen for HB-godkendelsen.` : '';
    const tidligere = ukendte.length ? ` ${opremsning(ukendte)} kan ikke vurderes (historik mangler).` : '';

    if (tabte.length) {
      ud.niveau = 'tabt';
      ud.forklaring = `${opremsning(tabte)} uden afholdt arrangement – kan ikke HB-godkendes i ${HB_AAR}.`;
    } else if (status === 'ja') {
      const bekraeftet = afholdt.filter(e => e.bekraeftet).length;
      ud.forklaring = `${KV.kort} er i hus: ${afholdt.length} afholdt${bekraeftet ? `, heraf ${bekraeftet} bekræftet` : ''}.`
        + (SIDST_I_AARET ? ` Alle kvartaler ${HB_AAR - 1} er dermed klaret, hvis de tidligere er det.`
          : naesteKv.length ? ` ${KV_NAESTE.kort}: planlagt (${fmtDay.format(naesteKv[0].startD)}).`
          : ` ${KV_NAESTE.kort}: intet planlagt endnu${HB_NU + 1 === HB_KVARTALER.length - 1 ? ' (årets sidste kvartal – frist 31. dec.)' : ''}.`)
        + tidligere;
    } else if (status === 'planlagt') {
      const e = planlagt[0], buffer = kalenderdage(dayKey(e.startD), SIDSTE_DAG);
      ud.niveau = DAGE <= GRAENSE.planlagtDage ? 'advarsel' : 'opmaerksom';
      const hvad = planlagt.length === 1 ? `"${e.navn}" (${fmtDay.format(e.startD)})` : `${planlagt.length} planlagte arrangementer (det første ${fmtDay.format(e.startD)})`;
      ud.forklaring = `Intet afholdt i ${KV.kort} endnu – kvartalet afhænger af ${hvad}${buffer <= 3 ? '; aflyses det, er der næsten ingen tid til en erstatning' : ''}.`
        + sidsteKvartal + tidligere;
      if (ud.niveau === 'advarsel') {
        ud.advarsel = {niveau: 'advarsel',
          titel: planlagt.length === 1 ? `${KV.kort} afhænger af "${trunc(e.navn, 40)}" ${fmtDay.format(e.startD)}`
            : `${KV.kort} afhænger af ${planlagt.length} planlagte arrangementer (det første ${fmtDay.format(e.startD)})`,
          tekst: `Intet afholdt i ${KV.kort} endnu – aflyses det, er HB-godkendelse ${HB_AAR} i fare${buffer <= 3 ? ', og der er næsten ingen tid til en erstatning' : ''}. `
            + 'Sørg for, at det bliver afholdt, og bekræft det bagefter under Arrangementer (✓ Afholdt).' + sidsteKvartal};
      }
    } else if (status === 'mangler') {
      ud.niveau = DAGE <= GRAENSE.kritiskDage || DAGE <= R / 2 ? 'kritisk'
        : DAGE <= Math.max(GRAENSE.advarselMinDage, R) ? 'advarsel' : 'opmaerksom';
      ud.forklaring = `Intet afholdt eller planlagt i ${KV.kort} – ${dageTekst(DAGE)} (rytme: hver ${R}. dag).` + sidsteKvartal + tidligere;
      if (ud.niveau !== 'opmaerksom') {
        ud.advarsel = {niveau: ud.niveau,
          titel: `HB-godkendelse ${HB_AAR} i fare: afhold et arrangement i ${KV.kort}`,
          tekst: `Intet afholdt eller planlagt i ${KV.kort} (foreningens rytme: hver ${R}. dag). `
            + 'Opret og afhold et arrangement nu – eller tilføj et, der blev holdt uden om Facebook, under Arrangementer.' + sidsteKvartal};
      }
    } else {
      ud.niveau = 'ukendt';
      ud.forklaring = f.facebook
        ? `Data dækker ikke hele ${KV.kort} (kun fra ${fmtDate.format(new Date(daekketFra(f.navn) + 'T12:00:00Z'))}), og intet er registreret siden. Hent historikken, eller tilføj afholdte arrangementer under Arrangementer.`
        : 'Ingen Facebook-side – arrangementer skal tilføjes under Arrangementer for at tælle med.';
    }
    return ud;
  }
  LAU.hbRisiko = hbRisiko;

  registerAdvarsel({
    id: 'hb-risiko',
    hent: () => DATA.lokale.map(f => ({f, r: hbRisiko(f)})).filter(x => x.r.advarsel).map(({f, r}) => ({
      ...r.advarsel, forening: f.navn, frist: r.frist, analyse: 'hb-risiko'})),
  });

  const naesteTekst = e => (e ? `${fmtDay.format(e.startD)} – ${e.navn}` : 'Intet i kalenderen');
  registerAnalyse({
    id: 'hb-risiko', titel: 'HB-risiko',
    beskrivelse: `Hvilke lokalforeninger risikerer at miste HB-godkendelsen ${HB_AAR}, fordi ${KV.kort} slutter uden et afholdt arrangement? Klik på en forening for at åbne den.`,
    render() {
      const rows = DATA.lokale.map(f => ({f, r: hbRisiko(f)})).sort((a, b) => NIVEAU[a.r.niveau].orden - NIVEAU[b.r.niveau].orden
        || (b.r.status === 'mangler') - (a.r.status === 'mangler') || !b.r.naesteKv.length - !a.r.naesteKv.length || b.r.rytme - a.r.rytme || a.f.navn.localeCompare(b.f.navn, 'da'));
      const antal = k => rows.filter(x => x.r.niveau === k).length;
      const aabne = new Set(['kritisk', 'advarsel', 'opmaerksom', 'ukendt']);
      return `<p class="note">Krav (Organisationshåndbogen 8.2): mindst ét afholdt arrangement i hvert kvartal ${HB_AAR - 1}. <b>${esc(KV.kort)} slutter ${esc(fristTekst)} – ${esc(dageTekst(DAGE))}.</b>${
        SIDST_I_AARET ? ` ${esc(KV.kort)} er årets sidste kvartal, så kvartalsslut er også fristen for HB-godkendelsen.` : ''}</p>
        <p class="note">Metode: for hver lokalforening ses på ${esc(KV.kort)} (afholdt, planlagt eller intet) og de afsluttede kvartaler. Intet afholdt eller planlagt er
          <b>kritisk</b>, når der er ${GRAENSE.kritiskDage} dage eller mindre tilbage eller under halvdelen af foreningens rytme (dage mellem arrangementer, se Momentum),
          og en <b>advarsel</b>, når der er højst ${GRAENSE.advarselMinDage} dage eller én rytme tilbage. Afhænger kvartalet af planlagte arrangementer, er det en advarsel de sidste ${GRAENSE.planlagtDage} dage.
          Kritiske og advarsler står også i "Kræver handling nu" i oversigten. Afholdte arrangementer, der ikke lå på Facebook, tæller først, når de er tilføjet under Arrangementer.</p>
        <div class="hbr-oversigt">${Object.entries(NIVEAU).filter(([k]) => antal(k)).map(([k, n]) =>
          `<span title="${esc(n.hint)}"><span class="dot-inline" style="background:${n.farve}"></span>${esc(n.label)} <b>${antal(k)}</b></span>`).join('')}</div>
        <table class="hb-tabel analyse-tabel hbr-tabel"><thead><tr><th>Forening</th><th class="hbr-venstre">Risiko</th><th class="hbr-venstre">${esc(KV.kort)}</th>
          <th title="Dage tilbage til kvartalets sidste dag">Dage tilb.</th><th title="Foreningens rytme: dage mellem arrangementer">Rytme</th>
          <th>Næste planlagte</th><th title="Status pr. kvartal ${HB_AAR - 1} (${HB_KVARTALER.map(k => k.kort).join(', ')})">Kvartaler</th><th>Forklaring</th></tr></thead>
        <tbody>${rows.map(({f, r}) => { const n = NIVEAU[r.niveau]; return `<tr tabindex="0" data-hbr-f="${esc(f.navn)}"${f.navn === selected ? ' class="valgt"' : ''}>
          <td>${esc(f.navn)}</td>
          <td class="hbr-venstre"><span class="hbr-niveau" title="${esc(n.hint)}"><span class="dot-inline" style="background:${n.farve}"></span>${esc(n.label)}</span></td>
          <td class="muted hbr-venstre">${esc(HB_KV[r.status].label)}</td>
          <td class="tal">${aabne.has(r.niveau) ? esc(String(Math.max(0, r.dage))) : '–'}</td>
          <td class="tal">${esc(String(r.rytme))} d</td>
          <td class="hbr-naeste">${esc(trunc(naesteTekst(r.naeste), 48))}</td>
          <td class="hbr-kv">${HB_KVARTALER.map(k => { const s = HB_KV[f.hbKv[k.id]]; return `<span class="kv-dot" style="background:${s.farve}" title="${esc(`${k.kort}: ${s.label}`)}"></span>`; }).join('')}</td>
          <td class="hbr-tekst">${esc(r.forklaring)}</td></tr>`; }).join('')}</tbody></table>
        <div class="chart-legend">${Object.values(HB_KV).map(s => `<span><span class="swatch" style="background:${s.farve}"></span>${esc(s.label)}</span>`).join('')}</div>
        <p class="note">Mangler et afholdt arrangement, fordi det ikke lå på Facebook? <button type="button" class="linkbtn" data-hbr-arr>Tilføj eller bekræft det under Arrangementer</button> – så tæller det med her.</p>`;
    },
    efter(el) {
      el.querySelectorAll('tr[data-hbr-f]').forEach(tr => {
        tr.addEventListener('click', () => openForening(tr.dataset.hbrF));
        tr.addEventListener('keydown', ev => { if (ev.key === 'Enter') openForening(tr.dataset.hbrF); });
      });
      el.querySelector('[data-hbr-arr]').addEventListener('click', () => visFane('arrangementer'));
    },
  });
})();
