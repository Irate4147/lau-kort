'use strict';
/*
 * Udviklingsudvalget – kun for admins. Udvalget hjælper lokalforeningerne, og hver lokalforening har en ansvarlig i
 * udvalget, der kontakter den mindst én gang i kvartalet. Filen er brugerfladen:
 *   - fanen "Udvikling": "Jeg er …", kvartalets fremdrift, mine/alle foreninger sorteret efter, hvem der skal kontaktes
 *     først, åbne opfølgninger, og (for udviklingsformanden) udvalgets medlemmer og fordelingen af foreningerne.
 *   - sektionen "Udviklingsudvalget" øverst i foreningspanelet: ansvarlig, kvartalets kontakt, "Registrér kontakt",
 *     åbne opfølgninger, "Forbered samtalen" (konteksten fra ontologien + spørgsmål) og kontakthistorikken.
 *   - advarsler: overskredne opfølgninger og lokalforeninger uden kontakt, når kvartalet slutter snart.
 * Data: data/admin/udvikling.krypt.json (ADMIN.data.udvikling), gemt for alle via adminserveren (LAU.admin.gem):
 *   {udvalg: [{id, navn, rolle: 'formand' | 'medlem', aktiv}], ansvar: {forening: udvalgsmedlemmets id},
 *    kontakter: [{id, forening, dato, af, form, med, stemning, behov: [...], tekst, opfoelgning, frist, klaret, oprettet, rettet}]}
 * Medlemmerne har stabile id'er, så et navneskift ikke knækker noget, og de slettes ikke (de gøres inaktive), så
 * historikken bevares. Reglen (kvartalets kontakt) står i kernen: kontaktStatus() i kerne/regler.js og egenskaberne
 * kontakt, sidsteKontakt, dageSidenKontakt, stemning og aabneOpfoelgninger på Forening (kerne/lau.js) – så de også kan
 * bruges i Egen analyse og som farvning af kortet. Fase 2 (Supabase) erstatter filen med tabeller og personlige logins.
 * Filen er pakket ind i en funktion, så dens navne ikke støder sammen med app.js eller andre udvidelser.
 */
(() => {
  const R = K.regler;
  // filter: mine/alle/uden; aaben/ret: foreningen med kontaktformularen og kontakten, der rettes; fordeling: ændringer, der
  // ikke er gemt; udvalgAaben: er "Udvalg og fordeling" foldet ud (huskes, når fanen tegnes igen).
  const UDV = {filter: null, aaben: null, ret: null, fordeling: null, udvalgAaben: null};
  const MIG = 'lau-udvalg-mig';
  const STATUS_ORDEN = {snart: 0, mangler: 1, kontaktet: 2};
  const STATUS_KORT = {snart: 'Kvartalet slutter snart', mangler: 'Ikke kontaktet', kontaktet: 'Kontaktet'};

  const data = () => ADMIN.data.udvikling || {};
  const udvalg = () => data().udvalg || [];
  const medlem = id => udvalg().find(u => u.id === id) || null;
  const ansvarligFor = navn => medlem((data().ansvar || {})[navn]);
  /** Udvalgsmedlemmet, brugeren er: valgt under "Jeg er" – på serveren ellers medlemmet med brugerens navn. */
  const mig = () => {
    try { const v = localStorage.getItem(MIG); if (v) return v; } catch (_) { /* fx privat vindue */ }
    const b = LAU.admin.bruger, u = b && udvalg().find(x => x.navn.trim().toLowerCase() === b.navn.trim().toLowerCase());
    return u ? u.id : '';
  };
  // Udvalgets medlemmer og fordelingen: på serveren kun admins og udviklingsformanden (server/adgang.js).
  const maaFordele = () => kanGemme() && (!LAU.admin.rettigheder || LAU.admin.rettigheder.fordeling);
  const idag = () => K.tid.dagNoegle(NOW);
  const dato = d => (d ? fmtDate.format(new Date(d + 'T12:00:00Z')) : '');
  const nytId = p => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const objekt = f => DATA.lager.hent('Forening', f.navn);
  /** Kvartalets kontakt (kontaktStatus i kernen) – null for Landsforeningen. */
  const detaljer = f => vaerdi(objekt(f), 'kontaktDetaljer');
  const kvartalTekst = d => `${d.kvartal} slutter ${dato(d.sidsteDag)} (${d.dage === 0 ? 'i dag' : d.dage === 1 ? 'i morgen' : `om ${d.dage} dage`})`;
  const navnPaa = id => (medlem(id) || {navn: 'ukendt'}).navn;

  /** Gemmer udvalgets data for alle og tegner alt igen (kortets farvning, panelet og fanen). */
  async function gem(aendr, besked) {
    await gemAdmin('udvikling', d => {
      const ny = structuredClone(d || {});
      ny.udvalg = ny.udvalg || [];
      ny.ansvar = ny.ansvar || {};
      ny.kontakter = ny.kontakter || [];
      aendr(ny);
      ny.ansvar = sorter(ny.ansvar);
      return ny;
    }, `Udvikling: ${besked}`);
    opdater();
  }
  const ikkeOpsat = () => (kanGemme() ? '' : '<p class="warn">Gem for alle er ikke sat op (se README: Rettelser), så udvalgets data kan ikke gemmes.</p>');

  const stemningPrik = s => (s ? `<span class="udv-prik ${esc(s)}" title="${esc(R.STEMNINGER[s])}" aria-label="${esc(R.STEMNINGER[s])}"></span>` : '');
  const behovTags = b => (b && b.length ? `<span class="udv-tags">${b.map(x => `<span class="udv-tag">${esc(R.BEHOV[x] || x)}</span>`).join('')}</span>` : '');

  // ------------------------------------------------------------------ fanen Udvikling

  /** Lokalforeningerne i det valgte udsnit, dem der skal kontaktes først øverst. */
  function udsnit(filter) {
    const minId = mig();
    return DATA.lokale.filter(f => {
      const a = ansvarligFor(f.navn);
      if (filter === 'mine') return a && a.id === minId;
      if (filter === 'uden') return !a || a.aktiv === false;
      return true;
    }).map(f => ({f, d: detaljer(f), a: ansvarligFor(f.navn)})).sort((x, y) =>
      STATUS_ORDEN[x.d.status] - STATUS_ORDEN[y.d.status] || (y.d.dageSiden ?? 1e9) - (x.d.dageSiden ?? 1e9)
      || x.f.navn.localeCompare(y.f.navn, 'da'));
  }

  function raekke({f, d, a}, visAnsvarlig) {
    const s = d.sidste, mom = f.mom && MOM_STATUS[f.mom.niveau];
    const meta = [
      visAnsvarlig ? (a ? esc(a.navn) + (a.aktiv === false ? ' (inaktiv)' : '') : '<i>Ingen ansvarlig</i>') : '',
      s ? `Sidst ${esc(dato(s.dato))} (${esc(dageTekst(d.dageSiden, true))}${s.form ? ', ' + esc((R.KONTAKT_FORMER[s.form] || s.form).toLowerCase()) : ''})`
        : 'Aldrig kontaktet',
      d.aabne.length ? `<span class="${d.overskredne.length ? 'udv-overskredet' : ''}">${d.aabne.length} ${d.aabne.length === 1 ? 'opfølgning' : 'opfølgninger'}</span>` : '',
      mom ? `<span title="${esc(mom.hint)}">${esc(mom.ikon)} ${esc(mom.label)}</span>` : '',
    ].filter(Boolean).join(' · ');
    return `<li class="udv-raekke"><button type="button" class="udv-aabn" data-f="${esc(f.navn)}">
      <span class="udv-navn">${stemningPrik(d.stemning)}${esc(f.navn)}</span>
      <span class="udv-pill ${esc(d.status)}">${esc(STATUS_KORT[d.status])}</span>
      <span class="udv-meta">${meta}</span></button></li>`;
  }

  function opfoelgningerHtml(liste, {visForening = true} = {}) {
    if (!liste.length) return '';
    return `<ul class="udv-opf">${liste.map(({f, k}) => `<li class="${k.frist && k.frist < idag() ? 'udv-overskredet' : ''}">
      <label><input type="checkbox" data-klaret="${esc(k.id)}"${kanGemme() ? '' : ' disabled'}>
        <span>${visForening ? `<b>${esc(f.navn)}:</b> ` : ''}${esc(k.opfoelgning)}</span></label>
      <span class="udv-meta">${k.frist ? `Frist ${esc(dato(k.frist))} · ` : ''}fra kontakten ${esc(dato(k.dato))}${k.af ? ` (${esc(navnPaa(k.af))})` : ''}</span></li>`).join('')}</ul>`;
  }
  function bindOpfoelgninger(el) {
    el.querySelectorAll('[data-klaret]').forEach(cb => cb.addEventListener('change', async () => {
      cb.disabled = true;
      try {
        await gem(d => { const k = d.kontakter.find(x => x.id === cb.dataset.klaret); if (k) { k.klaret = idag(); k.rettet = isoZ(new Date()); } },
          'opfølgning klaret');
      } catch (err) { cb.checked = false; cb.disabled = false; alert(err.message); }
    }));
  }

  function renderFane(el) {
    const minId = mig(), jeg = medlem(minId), alle = udsnit('alle');
    const filter = UDV.filter || (jeg ? 'mine' : 'alle');
    const liste = udsnit(filter), d0 = alle[0] && alle[0].d;
    const antal = {mine: udsnit('mine').length, alle: alle.length, uden: udsnit('uden').length};
    const kontaktet = liste.filter(x => x.d.status === 'kontaktet').length;
    const opf = liste.flatMap(({f, d}) => d.aabne.map(k => ({f, k})))
      .sort((a, b) => String(a.k.frist || '9').localeCompare(String(b.k.frist || '9')));
    const overskredne = opf.filter(x => x.k.frist && x.k.frist < idag()).length;
    const aktive = udvalg().filter(u => u.aktiv !== false);
    el.innerHTML = `<header class="side-head"><h1>Udviklingsudvalget${forklar(
      'Hver lokalforening har en ansvarlig i udviklingsudvalget, der kontakter den mindst én gang i kvartalet: hører, hvordan det går, og hvad de har brug for hjælp til. Klik på en forening for at forberede samtalen og registrere kontakten. Interne noter tæller ikke som kontakt.')}</h1>
        ${d0 ? `<p class="updated">${esc(kvartalTekst(d0))}</p>` : ''}</header>
      ${ikkeOpsat()}
      ${!udvalg().length ? `<p class="note udv-intro">Kom i gang: tilføj udvalgets medlemmer og fordel lokalforeningerne under
        <b>Udvalg og fordeling</b> nederst. Derefter vælger hvert medlem sig selv under "Jeg er", så de ser deres egne foreninger.</p>` : ''}
      ${aktive.length ? `<label class="sort">Jeg er <select data-mig><option value="">Vælg dig selv …</option>${aktive.map(u =>
        `<option value="${esc(u.id)}"${u.id === minId ? ' selected' : ''}>${esc(u.navn)}</option>`).join('')}</select></label>` : ''}
      <div class="udv-fremdrift" role="img" aria-label="${kontaktet} af ${liste.length} kontaktet">
        <div class="udv-bar"><span style="width:${liste.length ? Math.round(kontaktet / liste.length * 100) : 0}%"></span></div>
        <p class="note"><b>${kontaktet} af ${liste.length}</b> ${filter === 'mine' ? 'af dine foreninger' : 'lokalforeninger'} kontaktet i ${esc(d0 ? d0.kvartal : '')}${
          opf.length ? ` · ${opf.length} ${opf.length === 1 ? 'åben opfølgning' : 'åbne opfølgninger'}${overskredne ? ` (<span class="udv-overskredet">${overskredne} overskredet</span>)` : ''}` : ''}</p>
      </div>
      <div class="udv-filtre" role="group" aria-label="Vis">${[['mine', 'Mine'], ['alle', 'Alle'], ['uden', 'Uden ansvarlig']]
        .filter(([id]) => id !== 'mine' || jeg).map(([id, t]) => `<button type="button" class="chip small" data-udv-filter="${id}"
          aria-pressed="${filter === id}">${t} (${antal[id]})</button>`).join('')}</div>
      ${liste.length ? `<ul class="udv-liste">${liste.map(x => raekke(x, filter !== 'mine')).join('')}</ul>`
        : `<p class="empty">${filter === 'mine' ? 'Du er ikke ansvarlig for nogen lokalforeninger endnu.' : 'Ingen lokalforeninger her.'}</p>`}
      ${opf.length ? `<h2>Åbne opfølgninger</h2>${opfoelgningerHtml(opf)}` : ''}
      <details class="udv-admin"${UDV.udvalgAaben ?? !udvalg().length ? ' open' : ''}><summary><h2>Udvalg og fordeling</h2></summary>
        <p class="note">Udviklingsformanden fordeler lokalforeningerne. Medlemmer slettes ikke, men gøres inaktive, så historikken
          bevares – en inaktivs foreninger står under "Uden ansvarlig", til de er fordelt igen.</p>
        ${maaFordele() ? udvalgHtml() + fordelingHtml() : `<p class="note">Kun udviklingsformanden og admins kan ændre udvalget og fordelingen.</p>${udvalgListe()}`}
      </details>`;
    bindForeningLinks(el);
    bindOpfoelgninger(el);
    const fold = el.querySelector('.udv-admin');
    fold.addEventListener('toggle', () => { UDV.udvalgAaben = fold.open; });
    const vaelg = el.querySelector('[data-mig]');
    if (vaelg) vaelg.addEventListener('change', () => {
      try {
        localStorage.setItem(MIG, vaelg.value);
        // Navnet står ved ændringerne (commit-beskeden), som "Dit navn" under Admin.
        if (vaelg.value) localStorage.setItem('lau-navn', navnPaa(vaelg.value));
      } catch (_) { /* fx privat vindue */ }
      UDV.filter = null;
      renderFane(el);
    });
    el.querySelectorAll('[data-udv-filter]').forEach(b => b.addEventListener('click', () => { UDV.filter = b.dataset.udvFilter; renderFane(el); }));
    bindUdvalg(el);
    bindFordeling(el);
  }

  /** Udvalget og deres foreninger (til dem, der ikke må ændre fordelingen). */
  function udvalgListe() {
    const af = id => DATA.lokale.filter(f => (data().ansvar || {})[f.navn] === id).map(f => f.navn);
    return `<ul class="udv-fakta">${udvalg().filter(u => u.aktiv !== false).map(u => `<li><b>${esc(u.navn)}</b>${u.rolle === 'formand' ? ' (formand)' : ''}: ${
      esc(af(u.id).join(', ') || 'ingen foreninger')}</li>`).join('')}</ul>`;
  }

  // Udvalgets medlemmer: navn, rolle og aktiv kan rettes; nye tilføjes nederst. Gemmes samlet.
  function udvalgHtml() {
    const n = id => Object.values(data().ansvar || {}).filter(x => x === id).length;
    return `<h3>Udvalgets medlemmer</h3><form class="udv-udvalg" data-udvalg>
      ${udvalg().map(u => `<div class="udv-medlem" data-id="${esc(u.id)}">
        <input type="text" name="navn" value="${esc(u.navn)}" maxlength="60" aria-label="Navn" required>
        <select name="rolle" aria-label="Rolle">${Object.entries({formand: 'Formand', medlem: 'Medlem'}).map(([k, t]) =>
          `<option value="${k}"${(u.rolle || 'medlem') === k ? ' selected' : ''}>${t}</option>`).join('')}</select>
        <label class="opt"><input type="checkbox" name="aktiv"${u.aktiv !== false ? ' checked' : ''}>Aktiv</label>
        <span class="udv-meta">${n(u.id)} for.</span></div>`).join('')}
      <div class="udv-medlem udv-ny"><input type="text" name="nyt" maxlength="60" placeholder="Nyt medlem (navn)" aria-label="Nyt medlem"></div>
      <div class="form-actions"><button class="chip small primary" type="submit"${kanGemme() ? '' : ' disabled'}>Gem udvalget</button>
        <span class="note-status" aria-live="polite"></span></div></form>`;
  }
  function bindUdvalg(el) {
    const form = el.querySelector('[data-udvalg]');
    if (!form) return;
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const status = form.querySelector('.note-status');
      const rettet = [...form.querySelectorAll('.udv-medlem[data-id]')].map(r => ({id: r.dataset.id,
        navn: r.querySelector('[name=navn]').value.trim(), rolle: r.querySelector('[name=rolle]').value, aktiv: r.querySelector('[name=aktiv]').checked}));
      const nyt = form.querySelector('[name=nyt]').value.trim();
      status.textContent = 'Gemmer …';
      try {
        await gem(d => {
          for (const r of rettet) { const u = d.udvalg.find(x => x.id === r.id); if (u && r.navn) Object.assign(u, r); }
          if (nyt) d.udvalg.push({id: nytId('u'), navn: nyt, rolle: 'medlem', aktiv: true});
        }, nyt ? `nyt udvalgsmedlem ${nyt}` : 'udvalgets medlemmer');
      } catch (err) { status.textContent = err.message; }
    });
  }

  // Fordelingen: én linje pr. lokalforening med dens ansvarlige. Ændringerne gemmes samlet (én commit).
  function fordelingHtml() {
    const aktive = udvalg().filter(u => u.aktiv !== false);
    if (!aktive.length) return '';
    const valg = UDV.fordeling || {};
    return `<h3>Fordeling af lokalforeningerne</h3><div class="udv-fordeling" data-fordeling>
      ${DATA.lokale.map(f => {
        const nu = f.navn in valg ? valg[f.navn] : (data().ansvar || {})[f.navn] || '', inaktiv = nu && !aktive.some(u => u.id === nu);
        return `<label><span>${esc(f.navn)}</span><select data-fordel="${esc(f.navn)}"><option value="">– ingen –</option>
          ${inaktiv ? `<option value="${esc(nu)}" selected>${esc(navnPaa(nu))} (inaktiv)</option>` : ''}
          ${aktive.map(u => `<option value="${esc(u.id)}"${u.id === nu ? ' selected' : ''}>${esc(u.navn)}</option>`).join('')}</select></label>`;
      }).join('')}</div>
      <div class="form-actions"><button class="chip small primary" type="button" data-fordel-gem disabled>Gem fordelingen</button>
        <span class="note-status" aria-live="polite"></span></div>`;
  }
  function bindFordeling(el) {
    const knap = el.querySelector('[data-fordel-gem]');
    if (!knap) return;
    const status = knap.parentElement.querySelector('.note-status');
    const tael = () => {
      const n = Object.keys(UDV.fordeling || {}).length;
      knap.disabled = !n || !kanGemme();
      status.textContent = n ? `${n} ${n === 1 ? 'ændring' : 'ændringer'} ikke gemt` : '';
    };
    el.querySelectorAll('[data-fordel]').forEach(s => s.addEventListener('change', () => {
      UDV.fordeling = {...(UDV.fordeling || {})};
      if (s.value === ((data().ansvar || {})[s.dataset.fordel] || '')) delete UDV.fordeling[s.dataset.fordel];
      else UDV.fordeling[s.dataset.fordel] = s.value;
      tael();
    }));
    tael();
    knap.addEventListener('click', async () => {
      const aendringer = UDV.fordeling || {};
      knap.disabled = true;
      status.textContent = 'Gemmer …';
      try {
        await gem(d => { for (const [navn, id] of Object.entries(aendringer)) { if (id) d.ansvar[navn] = id; else delete d.ansvar[navn]; } },
          `fordeling (${Object.keys(aendringer).join(', ')})`);
        UDV.fordeling = null;
        renderFane(el);
      } catch (err) { knap.disabled = false; status.textContent = err.message; }
    });
  }

  LAU.registerFane({id: 'udvikling', label: 'Udvikling', titel: 'Udviklingsudvalget: kontakt med lokalforeningerne', admin: true, render: renderFane});

  // ------------------------------------------------------------------ foreningspanelet

  /** Konteksten til samtalen: det, man skal vide, før man ringer – fra ontologien og seneste kontakt. */
  function forberedHtml(f, o, d) {
    const a = aktivitetAf(o), sidsteArr = a.afholdt[a.afholdt.length - 1], naeste = a.naeste, mom = f.mom && MOM_STATUS[f.mom.niveau];
    const risiko = vaerdi(o, 'hbRisiko'), pletter = vaerdi(o, 'hvidePletter'), sidste = d.sidste;
    const kontakt = {...(f.stamdata || {}), ...fortroligeStamdata(f)};
    const fakta = [
      mom ? `<b>Momentum:</b> ${esc(mom.ikon)} ${esc(mom.label)} – ${esc(f.mom.grund)}.` : '',
      sidsteArr ? `<b>Seneste arrangement:</b> ${esc(sidsteArr.navn)} (${esc(fmtDate.format(sidsteArr.startD))}).` : '<b>Intet afholdt</b> i perioden, data dækker.',
      naeste ? `<b>Næste:</b> ${esc(naeste.navn)} (${esc(fmtDate.format(naeste.startD))}).` : '<b>Intet i kalenderen.</b>',
      risiko && risiko !== 'sikret' ? `<b>HB-kvartalet:</b> ${esc(K.regler.HB_RISIKO_NIVEAUER[risiko])}.` : '',
      pletter ? `<b>Kommuner uden aktivitet (12 mdr.):</b> ${pletter}.` : '',
      sidste ? `<b>Sidste kontakt</b> ${esc(dato(sidste.dato))}${sidste.af ? ` (${esc(navnPaa(sidste.af))})` : ''}${sidste.behov && sidste.behov.length
        ? ` – brug for hjælp til ${esc(sidste.behov.map(b => (R.BEHOV[b] || b).toLowerCase()).join(', '))}` : ''}.` : '',
    ].filter(Boolean);
    const spm = [
      'Hvordan går det i bestyrelsen – er der nok hænder, og er nogen på vej ud?',
      naeste ? 'Hvad har I ellers planlagt det næste kvartal?' : 'I har intet i kalenderen – hvad bliver det næste arrangement, og hvornår?',
      'Hvordan går det med at få nye medlemmer – og bliver de nye aktive?',
      'Er der noget, I mangler hjælp til: ideer, oplægsholdere, økonomi, materialer, kommunikation?',
      ...(risiko === 'kritisk' || risiko === 'advarsel' ? ['Kvartalet mangler et afholdt arrangement for HB-godkendelsen – hvornår holder I det?'] : []),
      ...(pletter ? [`Der er ${pletter} kommuner i jeres område uden aktivitet det seneste år – kan I lave noget dér?`] : []),
      ...d.aabne.map(k => `Opfølgning fra ${dato(k.dato)}: "${k.opfoelgning}" – hvordan står det til?`),
    ];
    return `<ul class="udv-fakta">${fakta.map(x => `<li>${x}</li>`).join('')}</ul>
      ${Object.keys(kontakt).length ? `<p class="udv-kontakt"><b>Kontakt:</b> ${Object.entries(kontakt).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ')}</p>`
        : '<p class="udv-kontakt udv-meta">Ingen kontaktoplysninger endnu – tilføj dem under "Stamdata og kontaktoplysninger" længere nede.</p>'}
      <h4 class="udv-label">Spørgsmål at stille</h4><ol class="udv-spm">${spm.map(x => `<li>${esc(x)}</li>`).join('')}</ol>`;
  }

  function formHtml(f, k) {
    const v = k || {dato: idag(), form: 'telefon', af: mig(), behov: []};
    const aktive = udvalg().filter(u => u.aktiv !== false || u.id === v.af);
    return `<form class="udv-form" data-udv-form>
      <div class="udv-felter">
        <label>Dato<input type="date" name="dato" value="${esc(v.dato)}" max="${esc(idag())}" required></label>
        <label>Form<select name="form">${Object.entries(R.KONTAKT_FORMER).map(([id, t]) =>
          `<option value="${id}"${v.form === id ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label>Af<select name="af"><option value="">–</option>${aktive.map(u =>
          `<option value="${esc(u.id)}"${u.id === v.af ? ' selected' : ''}>${esc(u.navn)}</option>`).join('')}</select></label>
        <label>Talte med<input type="text" name="med" value="${esc(v.med || '')}" maxlength="80" placeholder="fx formanden"></label>
      </div>
      <fieldset class="udv-valg"><legend>Hvordan går det?</legend>${Object.entries(R.STEMNINGER).map(([id, t]) =>
        `<label class="opt"><input type="radio" name="stemning" value="${id}"${v.stemning === id ? ' checked' : ''}>${stemningPrik(id)}${esc(t)}</label>`).join('')}</fieldset>
      <fieldset class="udv-valg"><legend>Brug for hjælp til</legend>${Object.entries(R.BEHOV).map(([id, t]) =>
        `<label class="opt"><input type="checkbox" name="behov" value="${id}"${(v.behov || []).includes(id) ? ' checked' : ''}>${esc(t)}</label>`).join('')}</fieldset>
      <label>Noter<textarea name="tekst" rows="4" placeholder="Hvordan går det? Hvad fylder? Hvad kan blive bedre?">${esc(v.tekst || '')}</textarea></label>
      <div class="udv-felter">
        <label class="udv-bred">Opfølgning<input type="text" name="opfoelgning" value="${esc(v.opfoelgning || '')}" maxlength="200" placeholder="Hvad skal følges op – og af hvem?"></label>
        <label>Frist<input type="date" name="frist" value="${esc(v.frist || '')}"></label>
      </div>
      <p class="note">Skriv om foreningen, ikke om enkeltpersoner – alle med adminkoden kan læse noterne.</p>
      <div class="form-actions"><button class="chip small primary" type="submit"${kanGemme() ? '' : ' disabled'}>${k ? 'Gem ændringer' : 'Gem kontakten'}</button>
        <button class="chip small" type="button" data-udv-annuller>Annuller</button><span class="note-status" aria-live="polite"></span></div>
    </form>`;
  }

  function historikHtml(liste) {
    return `<ul class="udv-historik">${liste.map(k => `<li>
      <div class="udv-hist-top">${stemningPrik(k.stemning)}<b>${esc(dato(k.dato))}</b> · ${esc(R.KONTAKT_FORMER[k.form] || k.form || '')}${
        k.af ? ` · ${esc(navnPaa(k.af))}` : ''}${k.med ? ` · med ${esc(k.med)}` : ''}
        <span class="udv-knapper"><button type="button" class="linkbtn" data-udv-ret="${esc(k.id)}">Ret</button>
          <button type="button" class="linkbtn" data-udv-slet="${esc(k.id)}">Slet</button></span></div>
      ${behovTags(k.behov)}
      ${k.tekst ? `<p class="udv-tekst">${esc(k.tekst)}</p>` : ''}
      ${k.opfoelgning ? `<p class="udv-meta">Opfølgning: ${esc(k.opfoelgning)}${k.frist ? ` (frist ${esc(dato(k.frist))})` : ''} – ${
        k.klaret ? `klaret ${esc(dato(k.klaret))}` : '<b>åben</b>'}</p>` : ''}</li>`).join('')}</ul>`;
  }

  LAU.registerSection({
    id: 'udvikling', titel: 'Udviklingsudvalget', admin: true,
    info: 'Lokalforeningens ansvarlige i udviklingsudvalget kontakter den mindst én gang i kvartalet. Se fanen Udvikling.',
    viser: ['kontakt', 'sidsteKontakt', 'dageSidenKontakt', 'stemning', 'aabneOpfoelgninger', 'ansvarlig', 'kontakter'],
    synlig: f => !f.national && !!detaljer(f),
    render(f, o) {
      const d = detaljer(f), a = ansvarligFor(f.navn), aktive = udvalg().filter(u => u.aktiv !== false);
      const alle = R.kontakterFor(data(), f.navn), s = d.sidste, ret = UDV.ret && alle.find(k => k.id === UDV.ret);
      const formAaben = UDV.aaben === f.navn;
      return `${ikkeOpsat()}
        <div class="udv-top">
          <label class="sort">Ansvarlig <select data-udv-ansvarlig${maaFordele() && aktive.length ? '' : ' disabled'}>
            <option value="">${aktive.length ? '– ingen –' : 'Tilføj udvalget under fanen Udvikling'}</option>
            ${a && a.aktiv === false ? `<option value="${esc(a.id)}" selected>${esc(a.navn)} (inaktiv)</option>` : ''}
            ${aktive.map(u => `<option value="${esc(u.id)}"${a && a.id === u.id ? ' selected' : ''}>${esc(u.navn)}</option>`).join('')}</select></label>
          <span class="note-status" aria-live="polite"></span>
        </div>
        <p class="udv-status ${esc(d.status)}">${d.status === 'kontaktet'
          ? `✓ Kontaktet i ${esc(d.kvartal)} – ${esc(dato(s.dato))}${s.af ? ` af ${esc(navnPaa(s.af))}` : ''}`
          : `${d.status === 'snart' ? '! ' : ''}Ikke kontaktet i ${esc(d.kvartal)} – kvartalet slutter ${esc(dato(d.sidsteDag))} (${esc(dageTekst(d.dage, false))})`}${
          s && d.status !== 'kontaktet' ? `<span class="udv-meta">Sidst kontaktet ${esc(dato(s.dato))} (${esc(dageTekst(d.dageSiden, true))})</span>` : ''}</p>
        ${s && (s.stemning || (s.behov && s.behov.length)) ? `<p class="udv-seneste">${stemningPrik(s.stemning)}${esc(R.STEMNINGER[s.stemning] || '')} ${behovTags(s.behov)}</p>` : ''}
        ${d.aabne.length ? `<h4 class="udv-label">Åbne opfølgninger</h4>${opfoelgningerHtml(d.aabne.map(k => ({f, k})), {visForening: false})}` : ''}
        ${formAaben ? formHtml(f, ret) : `<div class="form-actions"><button type="button" class="chip small primary" data-udv-ny${kanGemme() ? '' : ' disabled'}>+ Registrér kontakt</button></div>`}
        <details class="udv-forbered"><summary>Forbered samtalen</summary>${forberedHtml(f, o, d)}</details>
        ${alle.length ? `<details class="udv-hist"><summary>Kontakthistorik (${alle.length})</summary>${historikHtml(alle)}</details>` : ''}`;
    },
    efter(el, f) {
      bindOpfoelgninger(el);
      const tegn = () => renderForening(f);
      const sel = el.querySelector('[data-udv-ansvarlig]');
      if (sel) sel.addEventListener('change', async () => {
        const status = el.querySelector('.udv-top .note-status');
        sel.disabled = true;
        status.textContent = 'Gemmer …';
        try { await gem(d => { if (sel.value) d.ansvar[f.navn] = sel.value; else delete d.ansvar[f.navn]; }, `ansvarlig for ${f.navn}`); }
        catch (err) { sel.disabled = false; status.textContent = err.message; }
      });
      const ny = el.querySelector('[data-udv-ny]');
      if (ny) ny.addEventListener('click', () => { UDV.aaben = f.navn; UDV.ret = null; tegn(); });
      el.querySelectorAll('[data-udv-ret]').forEach(b => b.addEventListener('click', () => { UDV.aaben = f.navn; UDV.ret = b.dataset.udvRet; tegn(); }));
      el.querySelectorAll('[data-udv-slet]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Slet kontakten? Det kan ikke fortrydes.')) return;
        try { await gem(d => { d.kontakter = d.kontakter.filter(k => k.id !== b.dataset.udvSlet); }, `slet kontakt med ${f.navn}`); }
        catch (err) { alert(err.message); }
      }));
      const form = el.querySelector('[data-udv-form]');
      if (!form) return;
      form.querySelector('[data-udv-annuller]').addEventListener('click', () => { UDV.aaben = UDV.ret = null; tegn(); });
      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        const status = form.querySelector('.form-actions .note-status'), knap = form.querySelector('[type=submit]');
        const v = name => form.elements[name].value.trim();
        const felter = {forening: f.navn, dato: v('dato'), form: v('form'), af: v('af') || null, med: v('med') || null,
          stemning: (form.querySelector('[name=stemning]:checked') || {}).value || null,
          behov: [...form.querySelectorAll('[name=behov]:checked')].map(x => x.value), tekst: v('tekst') || null,
          opfoelgning: v('opfoelgning') || null, frist: v('frist') || null};
        const id = UDV.ret, nu = isoZ(new Date());
        knap.disabled = true;
        status.textContent = 'Gemmer …';
        try {
          await gem(d => {
            const gl = id && d.kontakter.find(k => k.id === id);
            if (gl) Object.assign(gl, felter, {rettet: nu, klaret: felter.opfoelgning === gl.opfoelgning ? gl.klaret || null : null});
            else d.kontakter.push({id: nytId('k'), ...felter, klaret: null, oprettet: nu});
          }, `${id ? 'ret kontakt' : 'kontakt'} med ${f.navn}`);
          UDV.aaben = UDV.ret = null;
          tegn();
        } catch (err) { knap.disabled = false; status.textContent = err.message; }
      });
    },
  }, {efter: 'overblik'});

  // ------------------------------------------------------------------ advarsler

  LAU.registerAdvarsel({
    id: 'udvikling',
    hent() {
      if (!DATA.lokale.some(f => ansvarligFor(f.navn)) && !(data().kontakter || []).length) return []; // udvalget er ikke i gang endnu
      const ud = [];
      for (const f of DATA.lokale) {
        const d = detaljer(f);
        if (!d) continue;
        for (const k of d.overskredne) {
          ud.push({niveau: 'advarsel', forening: f.navn, titel: `Opfølgning: ${k.opfoelgning}`,
            tekst: `Fristen var ${dato(k.frist)} (fra kontakten ${dato(k.dato)}${k.af ? `, ${navnPaa(k.af)}` : ''}).`});
        }
      }
      const snart = DATA.lokale.filter(f => (detaljer(f) || {}).status === 'snart');
      if (snart.length) {
        const d = detaljer(snart[0]);
        ud.push({niveau: 'advarsel', titel: `${snart.length} ${snart.length === 1 ? 'lokalforening er' : 'lokalforeninger er'} ikke kontaktet af udviklingsudvalget i ${d.kvartal}`,
          tekst: snart.map(f => f.navn + (ansvarligFor(f.navn) ? ` (${ansvarligFor(f.navn).navn})` : '')).join(', '),
          frist: new Date(d.sidsteDag + 'T12:00:00Z')});
      }
      return ud;
    },
  });
})();
