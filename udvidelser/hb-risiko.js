'use strict';
/*
 * HB-risiko (kun admins): hvem skal gøre noget – hvad og hvornår – for at lokalforeningerne kan blive HB-godkendt
 * næste år? Kravet er mindst ét afholdt arrangement i hvert kvartal. Én beregning (hbRisiko) bruges af både advarslen
 * øverst i sidepanelet ("Kræver handling nu") og analysen "HB-risiko". Bygger på hbKvartal()/f.hbKv i app.js.
 *
 * Niveauer for det indeværende HB-kvartal (d = dage tilbage til kvartalets sidste dag):
 *   kritisk     intet afholdt eller planlagt, og d ≤ 14
 *   advarsel    intet afholdt eller planlagt, og d ≤ 45 – eller kvartalet reddes kun af planlagte
 *               arrangementer, og d ≤ 21
 *   opmaerksom  som ovenfor, men der er god tid endnu
 *   ukendt      data dækker ikke hele kvartalet (historik mangler)
 *   tabt        et afsluttet kvartal er uden afholdt arrangement – kan ikke HB-godkendes (ingen advarsel)
 *   sikret      kvartalet er i hus (mindst ét afholdt)
 * Kritisk og advarsel giver højst én advarsel pr. forening. Niveauet og grænserne er kernens (hbRisikoNiveau() og
 * HB_RISIKO_GRAENSE i kerne/regler.js), så scripts/rapport.py bruger de samme.
 *
 * Analysen grupperer foreningerne i "spande" i den rækkefølge, man skal handle (SPANDE): skal afholde et arrangement
 * (kritisk/advarsel uden noget i kalenderen), afhænger af et planlagt arrangement (advarsel), hold øje (opmaerksom),
 * i hus, kan ikke godkendes (tabt) og mangler data. De sidste FREMADBLIK_DAGE af kvartalet vises også, hvem der
 * allerede har noget planlagt i det næste kvartal.
 * Tilgængelig for andre udvidelser som LAU.hbRisiko(f).
 */
(() => {
  const REGLER = window.LAU_KERNE.regler;
  const GRAENSE = REGLER.HB_RISIKO_GRAENSE; // {kritiskDage, advarselMinDage, planlagtDage}
  const FREMADBLIK_DAGE = 21; // vis det næste kvartal, når der er så få dage tilbage af det indeværende
  const KV = HB_KVARTALER[HB_NU];
  const SIDST_I_AARET = HB_NU === HB_KVARTALER.length - 1; // Q4: kvartalsslut = årsskiftet = HB-fristen
  const KV_NAESTE = HB_KVARTALER[HB_NU + 1] || null;
  const naesteDag = (dag, n) => { const d = new Date(dag + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  // Kvartalets sidste dag (YYYY-MM-DD) og fristen som tidspunkt: starten af den dag i dansk tid, så "om N dage"
  // i advarslen er antal kalenderdage – det samme som dage tilbage.
  const SIDSTE_DAG = naesteDag(KV.til, -1);
  const FRIST = fraDanskTid(SIDSTE_DAG, '00:00');
  const kalenderdage = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
  const I_DAG = dayKey(NOW);
  const DAGE = kalenderdage(I_DAG, SIDSTE_DAG);

  // Datoer i ord: "30. sep.", "onsdag", "ons. 30. sep."
  const fmtKort = new Intl.DateTimeFormat('da-DK', {day: 'numeric', month: 'short', timeZone: TZ});
  const fmtUgedag = new Intl.DateTimeFormat('da-DK', {weekday: 'long', timeZone: TZ});
  const dato = dag => new Date(dag + 'T12:00:00Z');
  const FRIST_KORT = fmtKort.format(FRIST); // "30. sep."
  const FRIST_LANG = `${fmtUgedag.format(FRIST)} ${FRIST_KORT}`; // "onsdag 30. sep."
  // Den sidste uge er ugedagen nyttig ("senest onsdag 30. sep."); før det er datoen nok.
  const FRIST_I_TEKST = DAGE <= 6 ? FRIST_LANG : FRIST_KORT;
  const omDage = d => (d <= 0 ? 'i dag' : d === 1 ? 'i morgen' : `om ${d} dage`);
  const iKvartal = (e, k) => { const d = dayKey(e.startD); return d >= k.fra && d < k.til; };
  const opremsning = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} og ${a[a.length - 1]}`);
  const antalOrd = (n, en, flere) => `${n} ${n === 1 ? en : flere}`;
  const TAL = ['nul', 'én', 'to', 'tre', 'fire', 'fem', 'seks'];
  const dageIOrd = d => (d % 7 === 0 && TAL[d / 7] ? `${TAL[d / 7]} ${d === 7 ? 'uge' : 'uger'}` : `${d} dage`);
  const MDR = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const kvMdr = k => { const m = +k.fra.slice(5, 7) - 1; return `${MDR[m]}–${MDR[m + 2]}`; };
  const arrTekst = e => `"${trunc(e.navn, 40)}" (${fmtDay.format(e.startD)})`;

  /**
   * Risikoen for, at foreningen mister HB-godkendelsen på grund af det indeværende kvartal:
   * {niveau, spand, dage, frist, status, afholdt, planlagt, naeste, naesteKv, tabte, ukendte, forklaring,
   *  advarsel: {niveau, titel, tekst} | null}
   * (afholdt/planlagt: foreningens arrangementer i kvartalet; naesteKv: planlagte i det næste kvartal samme år;
   * tabte/ukendte: afsluttede kvartaler uden afholdt arrangement / uden data; forklaring: én kort sætning med,
   * hvad der skal gøres; spand: gruppen i analysen).
   */
  function hbRisiko(f) {
    const status = f.hbKv[KV.id];
    const tabte = HB_KVARTALER.slice(0, HB_NU).filter(k => f.hbKv[k.id] === 'nej').map(k => k.kort);
    const ukendte = HB_KVARTALER.slice(0, HB_NU).filter(k => f.hbKv[k.id] === 'ukendt').map(k => k.kort);
    const afholdt = f.afholdt.filter(e => iKvartal(e, KV)), planlagt = f.planlagt.filter(e => iKvartal(e, KV));
    const naesteKv = KV_NAESTE ? f.planlagt.filter(e => iKvartal(e, KV_NAESTE)) : [];
    const ud = {niveau: 'sikret', spand: 'sikret', dage: DAGE, frist: FRIST, status, afholdt, planlagt, naeste: f.naeste,
      naesteKv, tabte, ukendte, forklaring: '', advarsel: null};
    const tidligere = ukendte.length ? ` (${opremsning(ukendte)}: ingen data.)` : '';
    const niveau = REGLER.hbRisikoNiveau(status, DAGE, tabte.length > 0);

    if (tabte.length) {
      ud.niveau = ud.spand = 'tabt';
      ud.forklaring = `Intet afholdt i ${opremsning(tabte)} – kan ikke nå HB-godkendelse ${HB_AAR}.`;
    } else if (status === 'ja') {
      const i = `${KV.kort} er i hus (${antalOrd(afholdt.length, 'afholdt', 'afholdte')}).`;
      ud.forklaring = SIDST_I_AARET
        ? (ukendte.length ? `${i} ${opremsning(ukendte)} kan ikke vurderes (data mangler).` : `${i} Alle fire kvartaler ${HB_AAR - 1} er klaret.`)
        : naesteKv.length === 1 ? `${i} ${KV_NAESTE.kort}: ${arrTekst(naesteKv[0])}.${tidligere}`
        : naesteKv.length ? `${i} ${KV_NAESTE.kort}: ${naesteKv.length} planlagt (det første ${fmtDay.format(naesteKv[0].startD)}).${tidligere}`
        : `${i} Intet planlagt i ${KV_NAESTE.kort} endnu.${tidligere}`;
    } else if (status === 'planlagt') {
      const e = planlagt[0], buffer = kalenderdage(dayKey(e.startD), SIDSTE_DAG);
      ud.niveau = niveau;
      ud.spand = ud.niveau === 'advarsel' ? 'planlagt' : 'hold';
      const hvad = planlagt.length === 1 ? arrTekst(e) : `${planlagt.length} planlagte arrangementer, det første ${arrTekst(e)}`;
      ud.forklaring = `${KV.kort} hviler på ${hvad} – sørg for, at ${planlagt.length === 1 ? 'det' : 'mindst ét'} bliver afholdt, og bekræft det bagefter.`
        + (buffer <= 3 ? ' Aflyses det, er der ikke tid til en erstatning.' : '') + tidligere;
      if (ud.niveau === 'advarsel') {
        ud.advarsel = {niveau: 'advarsel',
          titel: planlagt.length === 1 ? `${KV.kort} hviler på ét arrangement ${fmtDay.format(e.startD)}`
            : `${KV.kort} hviler på ${planlagt.length} planlagte arrangementer`,
          tekst: planlagt.length === 1
            ? `Aflyses "${trunc(e.navn, 40)}", mister foreningen HB-godkendelsen ${HB_AAR}. Bekræft det under Arrangementer (✓ Afholdt), når det er holdt.`
            : `Bliver ingen af dem afholdt (det første er ${fmtDay.format(e.startD)}), mister foreningen HB-godkendelsen ${HB_AAR}. Bekræft det under Arrangementer (✓ Afholdt), når det er holdt.`};
      }
    } else if (status === 'mangler') {
      ud.niveau = niveau;
      ud.spand = ud.niveau === 'opmaerksom' ? 'hold' : 'handle';
      const normalt = DAGE > GRAENSE.kritiskDage ? ' Målet er mindst ét arrangement om måneden.' : '';
      ud.forklaring = ud.niveau === 'opmaerksom'
        ? `Intet afholdt eller planlagt i ${KV.kort} endnu – ${DAGE} dage tilbage. Planlæg et arrangement i god tid.${tidligere}`
        : `Intet afholdt eller planlagt i ${KV.kort} – afhold et arrangement senest ${FRIST_I_TEKST} (${omDage(DAGE)}).${normalt}${tidligere}`;
      if (ud.niveau !== 'opmaerksom') {
        ud.advarsel = {niveau: ud.niveau,
          titel: `Afhold et arrangement senest ${FRIST_KORT}`,
          tekst: `Ellers mister foreningen HB-godkendelsen ${HB_AAR} – intet er afholdt eller planlagt i ${KV.kort}.`};
      }
    } else {
      ud.niveau = ud.spand = 'ukendt';
      ud.forklaring = f.facebook
        ? `Data dækker kun fra ${fmtDate.format(dato(daekketFra(f.navn)))} – tilføj afholdte arrangementer under Arrangementer, eller hent historikken.`
        : 'Ingen Facebook-side – tilføj afholdte arrangementer under Arrangementer, så de tæller med.';
    }
    return ud;
  }
  LAU.hbRisiko = hbRisiko;

  registerAdvarsel({
    id: 'hb-risiko',
    hent: () => DATA.lokale.map(f => ({f, r: hbRisiko(f)})).filter(x => x.r.advarsel).map(({f, r}) => ({
      ...r.advarsel, forening: f.navn, frist: r.frist, analyse: 'hb-risiko'})),
  });

  // ---------------------------------------------------------------- analysen
  const FREMADBLIK = !!KV_NAESTE && DAGE <= FREMADBLIK_DAGE;
  const naesteKvSlut = KV_NAESTE ? fmtKort.format(dato(naesteDag(KV_NAESTE.til, -1))) : '';
  // Spandene i den rækkefølge, man skal handle. tom: kort linje, når spanden er tom (ellers skjules den).
  const SPANDE = [
    {id: 'handle', ikon: '!', kort: 'skal afholde et arrangement', titel: `Skal afholde et arrangement senest ${FRIST_KORT}`,
      tekst: `Intet afholdt eller planlagt i ${KV.kort}. Uden et afholdt arrangement inden kvartalet slutter, mister de HB-godkendelsen ${HB_AAR}. `
        + 'Blev der holdt noget uden om Facebook, så tilføj det under Arrangementer.',
      tom: `Ingen mangler et arrangement i ${KV.kort}.`,
      sort: (a, b) => (a.r.niveau === 'kritisk' ? 0 : 1) - (b.r.niveau === 'kritisk' ? 0 : 1)},
    {id: 'planlagt', ikon: '⏱', kort: 'afhænger af planlagt', titel: 'Afhænger af et planlagt arrangement',
      tekst: `Intet afholdt i ${KV.kort} endnu, men noget i kalenderen. Aflyses det, er godkendelsen i fare. Bekræft det under Arrangementer (✓ Afholdt), når det er holdt.`,
      tom: `Ingen afhænger af et planlagt arrangement i ${KV.kort}.`,
      sort: (a, b) => a.r.planlagt[0].startD - b.r.planlagt[0].startD},
    {id: 'hold', ikon: '•', kort: 'hold øje', titel: 'Hold øje – god tid endnu',
      tekst: `Intet afholdt i ${KV.kort} endnu, men der er god tid: ${DAGE} dage, til kvartalet slutter.`},
    {id: 'sikret', ikon: '✓', kort: `${KV.kort} i hus`, titel: `I hus for ${KV.kort}`,
      tekst: `Mindst ét afholdt arrangement i ${KV.kort} – intet at gøre for ${KV.kort}.${KV_NAESTE ? ` Dem uden noget planlagt i ${KV_NAESTE.kort} står først.` : ''}`,
      sort: (a, b) => !!a.r.naesteKv.length - !!b.r.naesteKv.length},
    {id: 'tabt', ikon: '✕', kort: `kan ikke godkendes i ${HB_AAR}`, titel: `Kan ikke godkendes i ${HB_AAR}`,
      tekst: `Et kvartal, der er slut, havde intet afholdt arrangement – det kan ikke rettes op bagefter. Blev der faktisk holdt et arrangement, der mangler her (fx uden om Facebook), så tilføj det under Arrangementer. Ellers gælder arbejdet nu HB-godkendelse ${HB_AAR + 1}.`},
    {id: 'ukendt', ikon: '?', kort: 'mangler data', titel: 'Mangler data',
      tekst: `Vi kan ikke se, om der er holdt noget i ${KV.kort}, fordi data ikke dækker hele kvartalet.`},
  ];

  // Små felter for Q1–Q4 med status (samme betydning som fanen HB).
  const KV_TEKST = {ja: 'afholdt', planlagt: 'planlagt', mangler: 'intet endnu', nej: 'intet afholdt – kvartalet er slut', ukendt: 'ingen data'};
  const kvFelt = (status, kort, nu) => `<span class="hbr-q hbr-q-${esc(status)}${nu ? ' nu' : ''}" title="${esc(`${kort}: ${KV_TEKST[status]}${nu ? ' (indeværende kvartal)' : ''}`)}">${esc(kort)}</span>`;
  const kvFelter = f => HB_KVARTALER.map((k, i) => kvFelt(f.hbKv[k.id], k.kort, i === HB_NU)).join('');

  function tidslinje() {
    const aarFra = HB_KVARTALER[0].fra;
    const segmenter = HB_KVARTALER.map((k, i) => {
      const laengde = kalenderdage(k.fra, k.til);
      const cls = i < HB_NU ? 'slut' : i === HB_NU ? 'nu' : 'senere';
      const fyld = i < HB_NU ? 100 : i > HB_NU ? 0 : (kalenderdage(k.fra, I_DAG) + 0.5) / laengde * 100;
      const markoer = i !== HB_NU ? '' : `<span class="hbr-idag" style="left:${fyld.toFixed(1)}%"><span class="${fyld > 80 ? 'h' : fyld < 20 ? 'v' : ''}">I dag ${esc(fmtKort.format(NOW))}</span></span>`;
      return `<div class="hbr-seg ${cls}" style="flex:${laengde}"><div class="hbr-seg-fyld" style="width:${fyld.toFixed(1)}%"></div>
        <span class="hbr-seg-navn"><b>${esc(k.kort)}</b> ${esc(kvMdr(k))}${i < HB_NU ? ' · slut' : i === HB_NU ? ' · nu' : ''}</span>${markoer}</div>`;
    }).join('');
    const gaaet = kalenderdage(KV.fra, I_DAG) + 1, laengde = kalenderdage(KV.fra, KV.til);
    const aarDag = kalenderdage(aarFra, I_DAG) + 1, aarLaengde = kalenderdage(aarFra, HB_KVARTALER[HB_KVARTALER.length - 1].til);
    return `<div class="hbr-aar" role="img" aria-label="${esc(`${HB_AAR - 1}: dag ${aarDag} af ${aarLaengde}. ${KV.kort}: dag ${gaaet} af ${laengde}.`)}">${segmenter}</div>
      <div class="hbr-aar-under"><span>${esc(`${HB_AAR - 1}: dag ${aarDag} af ${aarLaengde}`)}</span>
        <span><b>${esc(`${KV.kort}: dag ${gaaet} af ${laengde}`)}</b> – kvartalet slutter ${esc(FRIST_LANG)}</span></div>`;
  }

  function raekke(f, r) {
    return `<li class="hbr-raekke${f.navn === selected ? ' valgt' : ''}" data-f="${esc(f.navn)}" tabindex="0" title="Åbn ${esc(f.navn)}">
      <span class="hbr-navn">${esc(f.navn)}</span><span class="hbr-kv">${kvFelter(f)}</span><span class="hbr-tekst">${esc(r.forklaring)}</span></li>`;
  }

  function fremadblik(rows) {
    const kandidater = rows.filter(x => x.r.niveau !== 'tabt');
    const har = kandidater.filter(x => x.r.naesteKv.length).sort((a, b) => a.r.naesteKv[0].startD - b.r.naesteKv[0].startD);
    const mangler = kandidater.filter(x => !x.r.naesteKv.length);
    const chip = ({f, r}) => `<button type="button" class="hbr-chip" data-f="${esc(f.navn)}"${r.naesteKv.length ? ` title="${esc(r.naesteKv.map(e => `${fmtDay.format(e.startD)}: ${e.navn}`).join('\n'))}"` : ''}>${esc(f.navn)}${
      r.naesteKv.length ? `<span>${esc(fmtKort.format(r.naesteKv[0].startD))}</span>` : ''}</button>`;
    return `<section class="hbr-fremad">
      <h3>Fremadblik: ${esc(KV_NAESTE.kort)} (${esc(fmtKort.format(dato(KV_NAESTE.fra)))}–${esc(naesteKvSlut)})</h3>
      <p>${esc(KV_NAESTE.kort)} begynder ${esc(omDage(DAGE + 1))}${HB_NU + 1 === HB_KVARTALER.length - 1 ? ` og er årets sidste kvartal – fristen for HB-godkendelse ${HB_AAR}` : ''}.
        <b>${har.length} af ${antalOrd(kandidater.length, 'forening', 'foreninger')}</b>, der stadig kan godkendes, har allerede noget planlagt.</p>
      <div class="hbr-fremad-lister">
        <div><h4>Intet planlagt i ${esc(KV_NAESTE.kort)} endnu <span class="hbr-antal">${mangler.length}</span></h4>
          <div class="hbr-chips">${mangler.map(chip).join('') || '<span class="muted">Ingen</span>'}</div></div>
        <div><h4>Har noget planlagt <span class="hbr-antal">${har.length}</span></h4>
          <div class="hbr-chips">${har.map(chip).join('') || '<span class="muted">Ingen endnu</span>'}</div></div>
      </div></section>`;
  }

  function metode() {
    const G = GRAENSE;
    return `<details class="hbr-metode"><summary>Sådan beregnes det</summary>
      <ul>
        <li>HB-godkendelse ${HB_AAR} kræver mindst ét <b>afholdt</b> arrangement i hvert af de fire kvartaler ${HB_AAR - 1} (Organisationshåndbogen 8.2). Om det er fagligt, vurderes ikke.</li>
        <li>For hver lokalforening ser vi på det indeværende kvartal (${esc(KV.kort)}): er der afholdt noget, er der kun noget planlagt, eller er der intet?</li>
        <li><b>Intet afholdt eller planlagt</b> er <b>kritisk</b>, når der er ${dageIOrd(G.kritiskDage)} eller mindre tilbage.
          Det er en <b>advarsel</b>, når der er ${dageIOrd(G.advarselMinDage)} eller mindre tilbage. Ellers er der god tid (hold øje).</li>
        <li><b>Kun planlagt</b> er en advarsel de sidste ${dageIOrd(G.planlagtDage)} af kvartalet – ellers hold øje.</li>
        <li>Har foreningen et <b>afsluttet kvartal uden afholdt arrangement</b>, kan den ikke godkendes i ${HB_AAR} – det giver ingen advarsel, for der er intet at nå.</li>
        <li>Mangler data for en del af kvartalet (historikken er ikke hentet, eller foreningen har ingen Facebook-side), kan det ikke vurderes.</li>
        <li>Kritiske og advarsler står også i "Kræver handling nu" i oversigten og i foreningens panel – højst én pr. forening.</li>
        <li>Arrangementer tæller, når de er afholdt. Arrangementer, der ikke lå på Facebook, tæller først, når de er tilføjet under Arrangementer.</li>
      </ul></details>`;
  }

  registerAnalyse({
    id: 'hb-risiko', titel: 'HB-risiko',
    beskrivelse: `Hvem skal gøre noget – og hvornår – for at lokalforeningerne kan blive HB-godkendt ${HB_AAR}? Klik på en forening for at åbne den.`,
    render() {
      const rows = DATA.lokale.map(f => ({f, r: hbRisiko(f)})).sort((a, b) => a.f.navn.localeCompare(b.f.navn, 'da'));
      const i = Object.fromEntries(SPANDE.map(s => [s.id, rows.filter(x => x.r.spand === s.id)]));
      for (const s of SPANDE) if (s.sort) i[s.id].sort((a, b) => s.sort(a, b) || a.f.navn.localeCompare(b.f.navn, 'da'));
      const n = id => i[id].length;

      // Én sætning om, hvem der skal handle.
      const dele = [];
      // Få foreninger nævnes ved navn: "2 foreninger (Nordsjælland og Aarhus) skal …".
      const navne = id => (n(id) <= 4 ? ` (${esc(opremsning(i[id].map(x => x.f.navn)))})` : '');
      if (n('handle')) dele.push(`<b>${antalOrd(n('handle'), 'forening', 'foreninger')}${navne('handle')} skal afholde et arrangement senest ${esc(FRIST_I_TEKST)}</b>`);
      if (n('planlagt')) dele.push(`${n('planlagt')}${navne('planlagt')} afhænger af et planlagt arrangement`);
      if (n('hold')) dele.push(`${n('hold')} bør holde øje`);
      const saetning = dele.length ? `${opremsning(dele)}.`.replace(/\.(<\/b>)?\.$/, '.$1')
        : `Ingen skal handle for at nå ${esc(KV.kort)}: ${n('sikret')} har kvartalet i hus${n('ukendt') ? `, ${n('ukendt')} mangler data` : ''}.`;
      const hop = SPANDE.filter(s => n(s.id)).map(s => `<button type="button" class="hbr-hop hbr-sp-${s.id}" data-hbr-hop="${s.id}"><span class="hbr-prik"></span><b>${n(s.id)}</b> ${esc(s.kort)}</button>`).join('');

      const spand = s => {
        const liste = i[s.id];
        if (!liste.length) return s.tom ? `<p class="hbr-tom hbr-sp-${s.id}"><span class="hbr-prik"></span>${esc(s.tom)}</p>` : '';
        return `<section class="hbr-spand hbr-sp-${s.id}" id="hbr-sp-${s.id}">
          <header><span class="hbr-ikon" aria-hidden="true">${s.ikon}</span><div><h3>${esc(s.titel)} <span class="hbr-antal">${liste.length}</span></h3>
            <p>${esc(s.tekst)}</p></div></header>
          <ul>${liste.map(({f, r}) => raekke(f, r)).join('')}</ul></section>`;
      };

      return `<section class="hbr-top">
          <p class="hbr-frist">${esc(KV.kort)} slutter ${esc(FRIST_LANG)} – ${esc(omDage(DAGE))}.${SIDST_I_AARET ? ` Det er også fristen for HB-godkendelse ${HB_AAR}.` : ''}</p>
          <p class="hbr-saetning">${saetning}</p>
          ${tidslinje()}
          <div class="hbr-hops">${hop}</div>
        </section>
        ${SPANDE.slice(0, 4).map(spand).join('')}
        ${FREMADBLIK ? fremadblik(rows) : ''}
        ${SPANDE.slice(4).map(spand).join('')}
        <div class="hbr-forklaring"><span>Kvartalerne:</span>${['ja', 'planlagt', 'mangler', 'nej', 'ukendt'].map(s =>
          `<span>${kvFelt(s, 'Q', false)}${esc(KV_TEKST[s])}</span>`).join('')}<span>${kvFelt('mangler', 'Q', true)}indeværende kvartal</span></div>
        <p class="note">Mangler et afholdt arrangement, fordi det ikke lå på Facebook? <button type="button" class="linkbtn" data-hbr-arr>Tilføj eller bekræft det under Arrangementer</button> – så tæller det med her.</p>
        ${metode()}`;
    },
    efter(el) {
      el.querySelectorAll('li.hbr-raekke').forEach(li => li.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openForening(li.dataset.f); }
      }));
      el.querySelectorAll('[data-hbr-hop]').forEach(b => b.addEventListener('click', () => {
        const maal = el.querySelector(`#hbr-sp-${b.dataset.hbrHop}`);
        if (maal) maal.scrollIntoView({behavior: 'smooth', block: 'start'});
      }));
      el.querySelector('[data-hbr-arr]').addEventListener('click', () => visFane('arrangementer'));
    },
  });
})();
