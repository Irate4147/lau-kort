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
 * "Denne måned indtil nu" beregnes i browseren af kernen (kerne/rapport.js: maanedIndtilNu og fremad) med samme
 * opbygning og tekster som rapporterne – momentum og HB-prognose sammenlignes med månedens snapshot, hvis det findes
 * (ellers vises kun, hvordan de er nu). HB-risikoen i "Fremad" er kernens hbRisiko; forklaringen til hver risiko er
 * teksten fra LAU.hbRisiko(f) (udvidelser/hb-risiko.js). Filen her er brugerfladen.
 */
(() => {
  const MR = {valgt: null}; // valgt måned ('ÅÅÅÅ-MM' eller 'nu'); null = den nyeste afsluttede
  // Bedst først (kerne/rapport.js, som i scripts/rapport.py).
  const {MOM_RAEKKE, HB_ORDEN} = K.rapport;
  const HB_KORT = {plus_naeste: 'Alle + næste', alle: 'Alle kvartaler', planlagt_nu: 'Planlagt nu', mangler_nu: 'Mangler nu',
    ikke: 'Kan ikke godkendes', ukendt: 'Historik mangler'};
  const fmtKort = new Intl.DateTimeFormat('da-DK', {day: 'numeric', month: 'short', timeZone: TZ});
  const dagD = d => new Date(d + 'T12:00:00Z'); // 'ÅÅÅÅ-MM-DD' -> Date midt på dagen
  const maanedNavn = m => fmtMaaned.format(new Date(m + '-15T12:00:00Z'));
  const gemt = () => ADMIN.data.rapporter || null;
  // Risikoernes niveauer (rækkefølgen er RISIKO_ORDEN i kerne/rapport.js).
  const RISIKO = {kritisk: {label: 'Kritisk'}, advarsel: {label: 'Advarsel'}, opmaerksom: {label: 'Hold øje'}};
  const plusDage = K.tid.dagPlus;
  const dageTekst = d => (d <= 0 ? 'sidste dag i dag' : d === 1 ? '1 dag tilbage' : `${d} dage tilbage`);
  const kortDato = d => fmtKort.format(dagD(d)); // 'ÅÅÅÅ-MM-DD' -> "30. sep."

  /** Denne måned indtil nu: kernens maanedIndtilNu (kerne/rapport.js), sammenlignet med månedens snapshot, hvis det findes. */
  function liveRapport() {
    const snap = ((gemt() || {}).snapshots || {})[monthKey(NOW)] || null;
    return {...K.rapport.maanedIndtilNu(DATA.lager, snap), live: true};
  }

  /**
   * Fremad fra i dag: kernens fremad() (kerne/rapport.js). Forklaringen på HB-risiciene (vises, når musen holdes over)
   * er teksten fra LAU.hbRisiko(f) i udvidelser/hb-risiko.js.
   */
  function liveFremad() {
    const fr = K.rapport.fremad(DATA.lager);
    const hbRisiko = window.LAU && typeof window.LAU.hbRisiko === 'function' ? window.LAU.hbRisiko : null;
    for (const x of fr.risici) {
      if (x.type !== 'hb' && x.type !== 'hb_planlagt') continue;
      x.forklaring = '';
      if (hbRisiko) { try { x.forklaring = hbRisiko(DATA.byName.get(x.forening)).forklaring || ''; } catch (err) { console.error('LAU.hbRisiko:', err); } }
    }
    return {...fr, live: true};
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
