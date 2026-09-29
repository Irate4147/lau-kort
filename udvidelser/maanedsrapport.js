'use strict';
/*
 * Månedsrapport (kun admins): analysen "Månedsrapport" i vinduet Analyser (se README: Udvidelser).
 * Rapporterne laves af scripts/rapport.py (GitHub Actions den 1. i måneden) og ligger krypteret i
 * data/admin/rapporter.krypt.json (ADMIN.data.rapporter): {snapshots: {ÅÅÅÅ-MM: tilstanden ved månedens start},
 * rapporter: {ÅÅÅÅ-MM: {fremad, total, fordeling, hoejdepunkter, foreninger, …}}}.
 * Rapporten har to sektioner:
 *   Fremad – set fra rapportens slutning (den 1. i måneden efter; for "Denne måned indtil nu": i dag): kommende
 *            arrangementer de næste FREMAD_DAGE dage, lokalforeninger uden noget planlagt og risici sorteret efter
 *            alvor, hver med en konkret handling. Gemt i rapporten som "fremad" (lav_fremad() i scripts/rapport.py).
 *   Bagud  – hvad der skete i måneden: afholdte, aflyste, nye og forsvundne arrangementer, fremmøde og ændringer i
 *            momentum og HB-prognose.
 * "Denne måned indtil nu" beregnes i browseren ud fra DATA med samme opbygning som rapporterne – momentum og
 * HB-prognose sammenlignes med månedens snapshot, hvis det findes (ellers vises kun, hvordan de er nu). HB-risikoen i
 * "Fremad" kommer fra LAU.hbRisiko(f) (udvidelser/hb-risiko.js), så reglerne kun står ét sted i browseren.
 */
(() => {
  const MR = {valgt: null}; // valgt måned ('ÅÅÅÅ-MM' eller 'nu'); null = den nyeste afsluttede
  // Bedst først. HB som HB_ORDEN i scripts/rapport.py ('ukendt' sammenlignes ikke).
  const MOM_RAEKKE = ['godt', 'stabil', 'fremad', 'faldende', 'hjaelp', 'ukendt', 'ingenfb'];
  const HB_ORDEN = ['plus_naeste', 'alle', 'planlagt_nu', 'mangler_nu', 'ikke'];
  const HB_KORT = {plus_naeste: 'Alle + næste', alle: 'Alle kvartaler', planlagt_nu: 'Planlagt nu', mangler_nu: 'Mangler nu',
    ikke: 'Kan ikke godkendes', ukendt: 'Historik mangler'};
  const fmtKort = new Intl.DateTimeFormat('da-DK', {day: 'numeric', month: 'short', timeZone: TZ});
  const dagD = d => new Date(d + 'T12:00:00Z'); // 'ÅÅÅÅ-MM-DD' -> Date midt på dagen
  const naesteMaaned = m => { const [y, mm] = m.split('-').map(Number); return `${y + (mm === 12)}-${String(mm % 12 + 1).padStart(2, '0')}`; };
  const maanedNavn = m => fmtMaaned.format(new Date(m + '-15T12:00:00Z'));
  const gemt = () => ADMIN.data.rapporter || null;
  const kvartalAf = d => `${dayKey(d).slice(0, 4)}-${Math.floor((+dayKey(d).slice(5, 7) - 1) / 3)}`;
  // Fremad: som FREMAD_DAGE, RISIKO_ORDEN og RISIKO_TYPE i scripts/rapport.py.
  const FREMAD_DAGE = 35;
  const RISIKO = {kritisk: {orden: 0, label: 'Kritisk'}, advarsel: {orden: 1, label: 'Advarsel'}, opmaerksom: {orden: 2, label: 'Hold øje'}};
  const RISIKO_TYPE = ['aarsskifte', 'hb', 'hb_planlagt', 'hjaelp', 'faldende'];
  const plusDage = (d, n) => { const x = dagD(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const kalenderdage = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
  const dageTekst = d => (d <= 0 ? 'sidste dag i dag' : d === 1 ? '1 dag tilbage' : `${d} dage tilbage`);
  const opremsning = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} og ${a[a.length - 1]}`);
  const kortDato = d => fmtKort.format(dagD(d)); // 'ÅÅÅÅ-MM-DD' -> "30. sep."
  const punktum = t => (t.endsWith('.') ? t : t + '.');

  /** Er foreningen faldet eller forbedret? Samme regel som lav_rapport() i scripts/rapport.py. */
  function sammenlign(rf, hbSamme, kvSamme) {
    const [a, b] = [rf.momentum.start, rf.momentum.slut], [ha, hb] = [rf.hb.start, rf.hb.slut];
    const mom = a && b && a !== b && ![a, b].some(x => x === 'ukendt' || x === 'ingenfb') ? [a, b] : null;
    // Et nyt kvartal nulstiller HB-prognosen: så tæller kun et skift til "ikke" (kan ikke godkendes).
    const hbx = hbSamme && HB_ORDEN.includes(ha) && HB_ORDEN.includes(hb) && ha !== hb && (kvSamme || hb === 'ikke') ? [ha, hb] : null;
    const ned = (mom && MOM_ORDEN[b] < MOM_ORDEN[a]) || (hbx && HB_ORDEN.indexOf(hb) > HB_ORDEN.indexOf(ha));
    const op = (mom && MOM_ORDEN[b] > MOM_ORDEN[a]) || (hbx && HB_ORDEN.indexOf(hb) < HB_ORDEN.indexOf(ha));
    return {ned, op, mom, hb: hbx};
  }

  /** Denne måned indtil nu – samme opbygning som rapporterne fra scripts/rapport.py, beregnet ud fra DATA. */
  function liveRapport() {
    const m = monthKey(NOW), fra = `${m}-01`, til = `${naesteMaaned(m)}-01`;
    const iMd = d => { const k = dayKey(d); return k >= fra && k < til; };
    const snap = ((gemt() || {}).snapshots || {})[m] || null, s0 = n => (snap && snap.foreninger[n]) || {};
    const hbSamme = !!snap && snap.hb_aar === HB_AAR, kvSamme = !!snap && kvartalAf(new Date(snap.tid)) === kvartalAf(NOW);
    const kort = (e, x = {}) => ({id: e.id, dato: dayKey(e.startD), navn: e.navn || '', ...x});
    const alle = {afholdt: new Map(), aflyst: new Map(), nye: new Map(), forsvundet: new Map()};
    const hoejde = {faldet: [], forbedret: [], uden_aktivitet: [], nye_aflysninger: []};
    const foreninger = {};
    let udenData = 0;
    for (const f of DATA.foreninger) {
      const r = {
        afholdt: f.afholdt.filter(e => iMd(e.startD)),
        aflyst: f.events.filter(e => e.aflyst && iMd(e.startD)),
        // Nye på Facebook i måneden – ikke hentet bagudrettet, manuelle eller fundet ved den første kørsel.
        nye: f.events.filter(e => !e.historisk && !e.manuel && iMd(e.firstD) && e.firstD - DATA.firstRun > DAY),
        forsvundet: f.events.filter(e => e.forsvundet && e.sidst_set && iMd(new Date(e.sidst_set))),
      };
      for (const [k, l] of Object.entries(r)) for (const e of l) alle[k].set(e.id, e);
      const moedt = r.afholdt.filter(e => e.fremmoede != null).map(e => e.fremmoede);
      const daekket = !!f.facebook && daekketFra(f.navn) <= fra;
      const rf = {
        afholdt: r.afholdt.map(e => kort(e, e.fremmoede != null ? {fremmoede: e.fremmoede} : {})),
        aflyst: r.aflyst.map(e => kort(e)), nye: r.nye.map(e => kort(e, {oprettet: dayKey(e.firstD)})),
        forsvundet: r.forsvundet.map(e => kort(e)), fremmoede: moedt.length ? moedt.reduce((a, b) => a + b, 0) : null, daekket,
      };
      if (snap) for (const e of f.events) if (e.aflyst && !(s0(f.navn).aflyste || []).includes(e.id)) hoejde.nye_aflysninger.push({forening: f.navn, ...kort(e)});
      if (!f.national) {
        rf.momentum = {start: s0(f.navn).niveau || null, slut: f.mom.niveau};
        rf.hb = {start: s0(f.navn).hb || null, slut: f.hb};
        const s = sammenlign(rf, hbSamme, kvSamme);
        if (s.ned || s.op) hoejde[s.ned ? 'faldet' : 'forbedret'].push({forening: f.navn, momentum: s.mom, hb: s.hb});
        if (!r.afholdt.length && daekket) {
          const foer = f.afholdt.filter(e => dayKey(e.startD) < fra);
          hoejde.uden_aktivitet.push({forening: f.navn, niveau: f.mom.niveau, sidste: foer.length ? dayKey(foer[foer.length - 1].startD) : null});
        } else if (!r.afholdt.length) udenData++;
      }
      foreninger[f.navn] = rf;
    }
    const moedt = [...alle.afholdt.values()].filter(e => e.fremmoede != null).map(e => e.fremmoede);
    const fordel = (keys, v) => Object.fromEntries(keys.map(k => [k, DATA.lokale.filter(f => v(f) === k).length]));
    const iso = d => d.toISOString().replace(/\.\d+Z$/, 'Z');
    return {
      maaned: m, fra, til, foreloebig: true, live: true, beregnet: iso(NOW),
      start: snap ? {tid: snap.tid, rekonstrueret: !!snap.rekonstrueret, hb_aar: snap.hb_aar} : null,
      slut: {tid: iso(NOW), rekonstrueret: false, hb_aar: HB_AAR},
      total: {
        afholdt: alle.afholdt.size, aflyst: alle.aflyst.size, nye: alle.nye.size, forsvundet: alle.forsvundet.size,
        fremmoede: moedt.length ? moedt.reduce((a, b) => a + b, 0) : null, med_fremmoede: moedt.length,
        lokale: DATA.lokale.length, aktive: DATA.lokale.filter(f => foreninger[f.navn].afholdt.length).length,
        uden_aktivitet: hoejde.uden_aktivitet.length, uden_data: udenData,
        faldet: hoejde.faldet.length, forbedret: hoejde.forbedret.length, nye_aflysninger: snap ? hoejde.nye_aflysninger.length : null,
      },
      fordeling: {
        momentum: {start: snap ? fordel(MOM_RAEKKE, f => s0(f.navn).niveau) : null, slut: fordel(MOM_RAEKKE, f => f.mom.niveau)},
        hb: {start: snap ? fordel([...HB_ORDEN, 'ukendt'], f => s0(f.navn).hb) : null, slut: fordel([...HB_ORDEN, 'ukendt'], f => f.hb)},
      },
      hoejdepunkter: hoejde, foreninger,
    };
  }

  /**
   * Fremad fra i dag – samme opbygning og tekster som lav_fremad() i scripts/rapport.py. HB-risikoen kommer fra
   * LAU.hbRisiko(f) (niveau, dage, forklaring); mangler den, er kun kvartaler, der hænger på planlagte, med.
   */
  function liveFremad() {
    const fra = dayKey(NOW), til = plusDage(fra, FREMAD_DAGE); // til: første dag efter perioden
    const iPeriode = e => { const d = dayKey(e.startD); return d >= fra && d < til; };
    const KV = HB_KVARTALER[HB_NU], sidste = plusDage(KV.til, -1), kvDage = kalenderdage(fra, sidste);
    const iKv = e => { const d = dayKey(e.startD); return d >= KV.fra && d < KV.til; };
    const hbRisiko = window.LAU && typeof window.LAU.hbRisiko === 'function' ? window.LAU.hbRisiko : null;
    const kort = e => ({id: e.id, dato: dayKey(e.startD), navn: e.navn || ''});
    const kommende = {}, udenPlanlagt = [], risici = [], alle = new Set(), manglerQ4 = [];
    let hbFejl = !hbRisiko;
    for (const f of DATA.foreninger) {
      const mine = f.planlagt.filter(iPeriode);
      if (mine.length) { kommende[f.navn] = mine.map(kort); mine.forEach(e => alle.add(e.id)); }
      if (f.national) continue;
      const m = f.mom, status = f.hbKv[KV.id];
      if (!mine.length) {
        const efter = f.planlagt.find(e => dayKey(e.startD) >= til);
        udenPlanlagt.push({forening: f.navn, niveau: m.niveau, facebook: !!f.facebook,
          sidste: f.sidste ? dayKey(f.sidste) : null, naeste: efter ? dayKey(efter.startD) : null});
      }
      let r = null;
      if (hbRisiko) { try { r = hbRisiko(f); } catch (err) { console.error('LAU.hbRisiko:', err); hbFejl = true; } }
      const dage = r && Number.isFinite(r.dage) ? r.dage : kvDage;
      if (r && status === 'mangler' && (r.niveau === 'kritisk' || r.niveau === 'advarsel')) {
        risici.push({forening: f.navn, niveau: r.niveau, type: 'hb', dage,
          tekst: `HB ${HB_AAR} i fare – intet afholdt eller planlagt i ${KV.kort}, ${dageTekst(dage)}.`,
          handling: punktum(`Afhold et arrangement senest ${kortDato(sidste)}`),
          forklaring: r.forklaring || ''});
      }
      // Teksterne er de samme som i lav_fremad() i scripts/rapport.py.
      const planlagt = f.planlagt.filter(iKv);
      const niveau = r ? r.niveau : 'opmaerksom';
      if (status === 'planlagt' && planlagt.length && (niveau === 'advarsel' || niveau === 'opmaerksom') && dage < FREMAD_DAGE) {
        const e = planlagt[0];
        const hvad = planlagt.length === 1 ? `ét planlagt arrangement: "${trunc(e.navn || 'uden titel', 50)}" ${kortDato(dayKey(e.startD))}`
          : `${planlagt.length} planlagte arrangementer (det første ${kortDato(dayKey(e.startD))})`;
        risici.push({forening: f.navn, niveau, type: 'hb_planlagt', dage,
          tekst: `${KV.kort} hænger på ${hvad} – ${dageTekst(dage)}.`,
          handling: 'Sørg for, at det bliver afholdt, og bekræft det bagefter (✓ Afholdt).',
          forklaring: r ? r.forklaring || '' : ''});
      }
      // Q4 er ikke i hus (og ikke tabt): mangler til årsskiftet.
      if (KV.id === 'Q4' && (status === 'mangler' || status === 'planlagt') && f.hb !== 'ikke') manglerQ4.push(f.navn);
      if (m.niveau === 'hjaelp' || m.niveau === 'faldende') {
        const hjaelp = m.niveau === 'hjaelp';
        const siden = m.sidsteDage != null ? `${m.sidsteDage} dage siden sidste arrangement` : `intet afholdt siden ${kortDato(daekketFra(f.navn))}`;
        const faerre = m.trend === 'ned' ? ', færre end normalt' : '';
        risici.push({forening: f.navn, niveau: hjaelp ? 'advarsel' : 'opmaerksom', type: m.niveau,
          tekst: `${hjaelp ? 'Brug for hjælp' : 'Mister fart'} – ${siden}${faerre}, intet i kalenderen.`,
          handling: hjaelp ? 'Kontakt foreningen, og hjælp med at planlægge næste arrangement.' : 'Spørg til næste arrangement, før foreningen går i stå.'});
      }
    }
    const aarFrist = `${fra.slice(0, 4)}-12-31`;
    if (fra <= aarFrist && aarFrist < til && manglerQ4.length) {
      risici.push({forening: null, niveau: 'advarsel', type: 'aarsskifte', dage: kalenderdage(fra, aarFrist),
        tekst: `Årsskiftet: 31. dec. er fristen for HB-godkendelse ${HB_AAR} – ${manglerQ4.length} ${manglerQ4.length === 1 ? 'lokalforening' : 'lokalforeninger'} mangler stadig et afholdt arrangement i Q4 (${opremsning(manglerQ4)}).`,
        handling: 'Sørg for, at de afholder et arrangement før jul, og at arrangementer uden for Facebook er tilføjet under Arrangementer.'});
    }
    risici.sort((a, b) => RISIKO[a.niveau].orden - RISIKO[b.niveau].orden || RISIKO_TYPE.indexOf(a.type) - RISIKO_TYPE.indexOf(b.type)
      || (a.dage ?? 999) - (b.dage ?? 999) || (a.forening || '').localeCompare(b.forening || '', 'da'));
    const iso = d => d.toISOString().replace(/\.\d+Z$/, 'Z');
    return {
      tid: iso(NOW), fra, til, dage: FREMAD_DAGE, rekonstrueret: false, ufuldstaendig: false, kendt_fra: dayKey(DATA.firstRun),
      kvartal: {navn: KV.kort, hb_aar: HB_AAR, sidste_dag: sidste, dage: kvDage}, live: true, hbMangler: hbFejl,
      total: {arrangementer: alle.size, foreninger_med: DATA.lokale.filter(f => kommende[f.navn]).length, lokale: DATA.lokale.length,
        uden_planlagt: udenPlanlagt.length, ...Object.fromEntries(Object.keys(RISIKO).map(k => [k, risici.filter(x => x.niveau === k).length]))},
      risici, kommende, uden_planlagt: udenPlanlagt,
    };
  }

  // ---------------------------------------------------------------- små byggesten

  const momPrik = k => (k ? `<span class="mr-prik" style="background:${MOM_FILL[k]}" title="${esc(`${MOM_STATUS[k].ikon} ${MOM_STATUS[k].label}`)}"></span>` : '<span class="mr-prik tom" title="Intet snapshot"></span>');
  const hbFirkant = k => (k ? `<span class="mr-hb" style="background:${HB_FILL[k]}" title="${esc(HB_STATUS[k].label)}"></span>` : '<span class="mr-hb tom" title="Intet snapshot"></span>');
  /** Start → slut med prikker og slutniveauet i ord; kun slut, hvis start mangler. */
  function skift(a, b, prik, tekst) {
    const pil = a && a !== b ? '<span class="mr-pil" aria-label="til">▸</span>' : '';
    return `<span class="mr-skift">${a && a !== b ? prik(a) + pil : ''}${prik(b)}<span class="mr-skift-tekst">${esc(tekst(b))}</span></span>`;
  }
  const momTekst = k => (k ? MOM_STATUS[k].label : '–'); // uden ikon: stabils → forveksles med pilen
  const hbTekst = k => (k ? HB_KORT[k] : '–');
  const foreningKnap = navn => `<button class="forening-link" data-f="${esc(navn)}">${esc(navn)}</button>`;

  /** Fordelingen ved start og slut som stablede søjler (momentum- eller HB-farver). */
  function fordelingDiagram(r, felt, raekke, farver, status, titel) {
    const d = r.fordeling[felt], rows = [];
    const tip = (lbl, x) => [lbl, ...raekke.filter(k => x[k]).map(k => `${felt === 'momentum' ? MOM_STATUS[k].ikon + ' ' : ''}${status[k].label}: ${x[k]}`)].join('|');
    const naar = s => (s.tid ? fmtKort.format(new Date(s.tid)) : '');
    if (d.start) rows.push({label: `Start ${naar(r.start)}`, values: raekke.map(k => d.start[k] || 0), tip: tip(`${titel} ved start (${naar(r.start)})`, d.start)});
    rows.push({label: r.live ? 'Nu' : `Slut ${naar(r.slut)}`, values: raekke.map(k => d.slut[k] || 0), tip: tip(`${titel} ${r.live ? 'nu' : `ved slut (${naar(r.slut)})`}`, d.slut)});
    return hbars(rows, {width: 760, labelW: 90, colors: raekke.map(k => farver[k]), aria: titel})
      + `<div class="chart-legend">${raekke.filter(k => (d.start && d.start[k]) || d.slut[k]).map(k =>
        `<span><span class="swatch" style="background:${farver[k]}"></span>${esc(felt === 'momentum' ? `${MOM_STATUS[k].ikon} ${MOM_STATUS[k].label}` : HB_KORT[k])}</span>`).join('')}</div>`;
  }

  function hoejdeKort(titel, liste, tom, linje, klasse = '', fod = '') {
    return `<section class="mr-kort ${klasse}"><h4>${esc(titel)} <span class="mr-antal">${liste ? liste.length : '–'}</span></h4>${
      !liste ? `<p class="empty">${esc(tom)}</p>` : liste.length ? `<ul>${liste.map(x => `<li>${linje(x)}</li>`).join('')}</ul>` : `<p class="empty">Ingen.</p>`}${
      fod ? `<p class="mr-sub mr-fod">${esc(fod)}</p>` : ''}</section>`;
  }
  const aendring = x => `${foreningKnap(x.forening)}${x.momentum ? skift(x.momentum[0], x.momentum[1], momPrik, momTekst) : ''}${
    x.hb ? `<span class="mr-hb-skift">HB: ${skift(x.hb[0], x.hb[1], hbFirkant, hbTekst)}</span>` : ''}`;

  /** Arrangementerne i måneden for én forening (rækken under foreningen i tabellen). */
  function detaljer(f) {
    const dato = e => esc(fmtKort.format(dagD(e.dato)));
    const dele = [
      ...f.afholdt.map(e => `<span class="mr-ev afholdt"><b>${dato(e)}</b> ${esc(e.navn)}${e.fremmoede != null ? ` <em>${esc(num1(e.fremmoede))} mødt</em>` : ''}</span>`),
      ...f.aflyst.map(e => `<span class="mr-ev aflyst"><b>${dato(e)}</b> <s>${esc(e.navn)}</s> <em>aflyst</em></span>`),
      ...f.nye.map(e => `<span class="mr-ev ny"><b>${dato(e)}</b> ${esc(e.navn)} <em>ny ${esc(fmtKort.format(dagD(e.oprettet)))}</em></span>`),
      ...f.forsvundet.map(e => `<span class="mr-ev forsvundet"><b>${dato(e)}</b> ${esc(e.navn)} <em>forsvundet</em></span>`),
    ];
    return dele.join('');
  }

  // ---------------------------------------------------------------- visning

  /** Fremad: risici (grupperet pr. forening, de alvorligste først), kommende arrangementer og foreninger uden noget planlagt. */
  function visFremad(fr, r) {
    const head = under => `<header class="mr-sektion-head"><h3>Fremad</h3><span>${esc(under)}</span></header>`;
    if (!fr) {
      return `<section class="mr-sektion mr-fremad">${head(`fra ${fmtDate.format(dagD(r.til))}`)}
        <div class="mr-info"><b>Rapporten er lavet, før den fik en fremadskuende del.</b> Genberegn den med
          <code>python3 scripts/rapport.py alle</code> – eller Actions → Månedsrapport → <i>Run workflow</i> med "alle".</div></section>`;
    }
    const t = fr.total, kv = fr.kvartal, sidsteDag = plusDage(fr.til, -1);
    const noter = [
      kv && `<b>${esc(kv.navn)} slutter ${esc(fmtDate.format(dagD(kv.sidste_dag)))}</b> (${esc(dageTekst(kv.dage))}) – HB ${esc(kv.hb_aar)} kræver et afholdt arrangement i hvert kvartal.`,
      fr.rekonstrueret && `Som man vidste det ${esc(fmtDate.format(dagD(fr.fra)))}: kun arrangementer, der da lå på Facebook, tæller som planlagte.`,
      fr.ufuldstaendig && `<b>Ufuldstændigt:</b> indsamlingen af kommende arrangementer startede først ${esc(fmtDate.format(dagD(fr.kendt_fra)))}, så planlagte arrangementer var ukendte – listerne og risiciene herunder undervurderer, hvad der var planlagt.`,
      fr.hbMangler && '<b>HB-risikoen kunne ikke beregnes</b> (udvidelsen HB-risiko er ikke indlæst) – kun kvartaler, der hænger på planlagte arrangementer, er med.',
    ].filter(Boolean);

    // Risici pr. forening i rækkefølge efter den alvorligste (listen er sorteret efter alvor).
    const grupper = new Map();
    for (const x of fr.risici) {
      const k = x.forening || '';
      if (!grupper.has(k)) grupper.set(k, {forening: x.forening, items: []});
      grupper.get(k).items.push(x);
    }
    const risikoHtml = !fr.risici.length ? '<p class="empty">Ingen risici – ingen HB-kvartaler i fare, og ingen foreninger mister fart.</p>'
      : `<ul class="mr-risici">${[...grupper.values()].map(g => `<li class="mr-risiko ${esc(g.items[0].niveau)}">
          <div class="mr-risiko-navn">${g.forening ? foreningKnap(g.forening) : '<b>Alle lokalforeninger</b>'}</div>
          <div>${g.items.map(x => `<div class="mr-risiko-punkt"${x.forklaring ? ` title="${esc(x.forklaring)}"` : ''}>
            <span class="mr-niv ${esc(x.niveau)}">${esc(RISIKO[x.niveau].label)}</span>
            <span class="mr-risiko-tekst">${esc(x.tekst)}</span>
            <span class="mr-handling">${esc(x.handling)}</span></div>`).join('')}</div></li>`).join('')}</ul>${
        fr.risici.some(x => x.type === 'hb' || x.type === 'aarsskifte') ? '<p class="note">Blev et arrangement holdt uden for Facebook, så tilføj det under Arrangementer – så tæller det med til HB.</p>' : ''}`;

    const navne = Object.keys(fr.kommende).sort((a, b) => (a === NATIONAL) - (b === NATIONAL) || a.localeCompare(b, 'da'));
    const kommendeHtml = !navne.length ? '<p class="empty">Intet planlagt i perioden.</p>'
      : `<ul class="mr-kommende">${navne.map(n => `<li><div class="mr-k-navn">${foreningKnap(n)}</div><div>${fr.kommende[n].map(e =>
        `<span class="mr-ev"><b>${esc(fmtDay.format(dagD(e.dato)))}</b><span>${esc(trunc(e.navn || '(uden titel)', 70))}</span></span>`).join('')}</div></li>`).join('')}</ul>`;
    const uden = [...fr.uden_planlagt].sort((a, b) => (MOM_ORDEN[a.niveau] ?? 9) - (MOM_ORDEN[b.niveau] ?? 9) || a.forening.localeCompare(b.forening, 'da'));
    const udenHtml = !uden.length ? '<p class="empty">Alle lokalforeninger har noget planlagt.</p>'
      : `<ul class="mr-uden">${uden.map(x => `<li>${momPrik(x.niveau)}${foreningKnap(x.forening)}<span class="mr-sub">${esc([
        x.sidste ? `sidst ${kortDato(x.sidste)}` : 'intet afholdt',
        x.naeste ? `næste ${kortDato(x.naeste)}` : !x.facebook ? 'ingen Facebook-side' : ''].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>
        <p class="mr-sub mr-fod">Prikken er foreningens momentum.</p>`;
    const antal = k => (t[k] ? `<span class="mr-tal-risiko"><span class="mr-niv ${k}">${esc(RISIKO[k].label)}</span> ${t[k]}</span>` : '');

    return `<section class="mr-sektion mr-fremad">
      ${head(`${r.live ? 'fra i dag' : `fra ${fmtDate.format(dagD(fr.fra))}`} · de næste ${fr.dage} dage (til og med ${kortDato(sidsteDag)})`)}
      ${noter.map(n => `<p class="note">${n}</p>`).join('')}
      <div class="mr-fremad-tal">
        <span><b>${esc(num1(t.arrangementer))}</b> ${t.arrangementer === 1 ? 'arrangement' : 'arrangementer'} planlagt i ${t.foreninger_med} af ${t.lokale} lokalforeninger</span>
        <span><b>${esc(num1(t.uden_planlagt))}</b> uden noget planlagt</span>
        ${antal('kritisk')}${antal('advarsel')}${antal('opmaerksom')}
      </div>
      <h3>Risici – det skal der handles på</h3>
      ${risikoHtml}
      <div class="mr-fremad-grid">
        <div><h3>Kommende arrangementer</h3>${kommendeHtml}</div>
        <div><h3>Intet planlagt <span class="mr-antal">${uden.length}</span></h3>${udenHtml}</div>
      </div>
    </section>`;
  }

  /** Bagud: hvad der skete i måneden (afholdte, aflyste, nye og forsvundne, fremmøde, momentum og HB). */
  function visBagud(r) {
    const t = r.total, fra = dagD(r.fra), til = new Date(dagD(r.til) - DAY);
    const tal = n => (n ? `<td class="tal">${esc(num1(n))}</td>` : '<td class="tal nul">·</td>');
    const rek = [r.start && r.start.rekonstrueret && 'start', !r.live && r.slut.rekonstrueret && 'slut'].filter(Boolean);
    const periode = r.live ? `${fmtKort.format(fra)} – i dag`
      : r.foreloebig ? `${fmtKort.format(fra)} – ${fmtDate.format(new Date(r.beregnet))} (foreløbig)` : `${fmtKort.format(fra)} – ${fmtDate.format(til)}`;
    const sammenligning = !r.start ? 'Intet snapshot fra månedens start – momentum og HB-prognose vises kun, som de er nu.'
      : `Momentum og HB-prognose ${fmtDate.format(new Date(r.start.tid))} → ${r.live ? 'nu' : fmtDate.format(new Date(r.slut.tid))}`
        + (rek.length ? ` (${rek.join(' og ')} rekonstrueret ud fra data)` : '') + '.';
    const navne = Object.keys(r.foreninger).sort((a, b) => (a === NATIONAL) - (b === NATIONAL) || a.localeCompare(b, 'da'));
    const h = r.hoejdepunkter;
    return `<section class="mr-sektion mr-bagud">
      <header class="mr-sektion-head"><h3>Bagud</h3><span>${esc(r.live ? `${maanedNavn(r.maaned)} indtil nu` : maanedNavn(r.maaned))} · ${esc(periode)}</span></header>
      <p class="note mr-periode">${esc(sammenligning)}${r.live ? '' : ` Beregnet ${esc(fmtStamp.format(new Date(r.beregnet)))}.`}</p>
      <div class="tiles">
        ${tile('Afholdte arrangementer', num1(t.afholdt), `i ${t.aktive} af ${t.lokale} lokalforeninger`)}
        ${tile('Aflyst / ikke afholdt', num1(t.aflyst), t.nye_aflysninger != null ? `${t.nye_aflysninger} ${t.nye_aflysninger === 1 ? 'ny aflysning' : 'nye aflysninger'}` : '')}
        ${tile('Nye / forsvundne', `${num1(t.nye)} / ${num1(t.forsvundet)}`, 'på Facebook i måneden')}
        ${tile('Registreret fremmøde', t.fremmoede == null ? '–' : num1(t.fremmoede), t.med_fremmoede ? `på ${t.med_fremmoede} ${t.med_fremmoede === 1 ? 'arrangement' : 'arrangementer'}` : 'intet registreret')}
      </div>
      <h3>Højdepunkter</h3>
      <div class="mr-hoejde">
        <div>
          ${hoejdeKort('Faldet i momentum eller HB', r.start ? h.faldet : null, 'Kræver et snapshot fra månedens start.', aendring, 'ned')}
          ${hoejdeKort(r.live ? 'Uden afholdt aktivitet endnu' : 'Uden afholdt aktivitet', h.uden_aktivitet, '', x =>
            `${foreningKnap(x.forening)}${skift(null, x.niveau, momPrik, momTekst)}<span class="mr-sub">${x.sidste ? `sidst ${esc(fmtDate.format(dagD(x.sidste)))}` : 'intet afholdt'}</span>`,
            '', t.uden_data ? `+ ${t.uden_data} uden data for hele måneden` : '')}
          ${hoejdeKort('Nye aflysninger', r.start ? h.nye_aflysninger : null, 'Kræver et snapshot fra månedens start.', x =>
            `${foreningKnap(x.forening)}<span class="mr-sub">${esc(fmtKort.format(dagD(x.dato)))} · ${esc(x.navn)}</span>`)}
        </div>
        <div>${hoejdeKort('Forbedret', r.start ? h.forbedret : null, 'Kræver et snapshot fra månedens start.', aendring, 'op')}</div>
      </div>
      <h3>Momentum</h3>
      ${fordelingDiagram(r, 'momentum', MOM_RAEKKE, MOM_FILL, MOM_STATUS, 'Momentum')}
      <h3>HB-prognose ${esc(r.slut.hb_aar)}</h3>
      ${r.start && r.start.hb_aar !== r.slut.hb_aar ? `<p class="note">Prognosen ved start gælder HB ${esc(r.start.hb_aar)} og sammenlignes ikke.</p>` : ''}
      ${fordelingDiagram({...r, fordeling: {hb: r.start && r.start.hb_aar !== r.slut.hb_aar ? {start: null, slut: r.fordeling.hb.slut} : r.fordeling.hb}}, 'hb', [...HB_ORDEN, 'ukendt'], HB_FILL, HB_STATUS, 'HB-prognose')}
      <h3>Pr. forening</h3>
      <p class="note">Klik på en forening for at åbne den. Under hver forening: månedens arrangementer (afholdt, <s>aflyst</s>, nye og forsvundne).</p>
      <table class="hb-tabel analyse-tabel mr-tabel"><thead><tr>
        <th>Forening</th><th title="Afholdte arrangementer i måneden">Afholdt</th><th title="Aflyste eller ikke afholdte">Aflyst</th>
        <th title="Nye på Facebook i måneden">Nye</th><th title="Forsvundet fra Facebook i måneden">Væk</th><th title="Registreret fremmøde">Mødt</th>
        <th>Momentum</th><th>HB-prognose</th></tr></thead>
      <tbody>${navne.map(navn => {
        const f = r.foreninger[navn], d = detaljer(f), m = f.momentum, hbp = f.hb;
        const s = m && m.start && m.slut && m.start !== m.slut ? (MOM_ORDEN[m.slut] < MOM_ORDEN[m.start] ? ' ned' : ' op') : '';
        return `<tr tabindex="0" data-f="${esc(navn)}" class="${d ? 'har-detaljer' : ''}">
          <td>${esc(navn)}${f.daekket === false && !DATA.byName.get(navn)?.national ? ' <span class="mr-sub" title="Data dækker ikke hele måneden">(delvis data)</span>' : ''}</td>
          ${tal(f.afholdt.length)}${tal(f.aflyst.length)}${tal(f.nye.length)}${tal(f.forsvundet.length)}
          ${f.fremmoede == null ? '<td class="tal nul">·</td>' : `<td class="tal">${esc(num1(f.fremmoede))}</td>`}
          <td class="mr-celle${s}">${m ? skift(m.start, m.slut, momPrik, momTekst) : ''}</td>
          <td class="mr-celle">${hbp ? skift(hbp.start, hbp.slut, hbFirkant, hbTekst) : ''}</td></tr>${
          d ? `<tr class="mr-detaljer" data-f="${esc(navn)}"><td colspan="8">${d}</td></tr>` : ''}`;
      }).join('')}</tbody></table></section>`;
  }

  registerAnalyse({
    id: 'maanedsrapport', titel: 'Månedsrapport',
    beskrivelse: 'Fremad: kommende arrangementer og risici, der skal handles på. Bagud: hvad der skete i måneden – afholdte, aflyste og nye arrangementer, fremmøde og ændringer i momentum og HB-prognose.',
    render() {
      const g = gemt(), alle = (g && g.rapporter) || {}, nu = monthKey(NOW);
      // Nyeste først; indeværende måned vises altid live (en gemt foreløbig rapport for den er forældet).
      const maaneder = Object.keys(alle).filter(m => m !== nu).sort().reverse();
      if (!MR.valgt || (MR.valgt !== 'nu' && !alle[MR.valgt])) MR.valgt = maaneder[0] || 'nu';
      const r = MR.valgt === 'nu' ? {...liveRapport(), fremad: liveFremad()} : alle[MR.valgt];
      const valg = [`<option value="nu"${MR.valgt === 'nu' ? ' selected' : ''}>Denne måned indtil nu (${esc(maanedNavn(nu))})</option>`,
        ...maaneder.map(m => `<option value="${esc(m)}"${m === MR.valgt ? ' selected' : ''}>${esc(maanedNavn(m))}${alle[m].foreloebig ? ' (foreløbig)' : ''}</option>`)];
      return `<div class="mr-top"><label class="sort">Måned <select data-mr-maaned>${valg.join('')}</select></label></div>
        ${g ? '' : `<div class="mr-info"><b>Ingen månedsrapporter endnu.</b> De laves automatisk af GitHub Actions ("Månedsrapport") den 1. i hver
          måned for den foregående måned – eller manuelt under Actions → Månedsrapport → <i>Run workflow</i> (en bestemt måned eller "alle").
          Indtil da kan du se denne måned indtil nu.</div>`}
        ${visFremad(r.fremad, r)}
        ${visBagud(r)}`;
    },
    efter(el) {
      el.querySelector('[data-mr-maaned]').addEventListener('change', ev => { MR.valgt = ev.target.value; renderAnalyser(); });
      // Klik åbner foreningen (bindForeningLinks); Enter gør det samme.
      el.querySelectorAll('tr[data-f]').forEach(tr => tr.addEventListener('keydown', ev => { if (ev.key === 'Enter') openForening(tr.dataset.f); }));
    },
  });
})();
