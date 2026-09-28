'use strict';
/*
 * Fremmøde (kun admins): fra tilkendegivelser på Facebook ("deltager" + "interesseret") til forventet fremmøde.
 * Omregningsfaktoren er fremmøde ÷ tilkendegivelser for afholdte arrangementer, hvor begge kendes (fremmøde noteres
 * under Arrangementer, svar > 0). Grundlaget for en forening og en kategori, bedst først:
 *   1. foreningens egne arrangementer (median, når der er mindst 2)
 *   2. arrangementer i samme kategori på tværs af foreningerne (mindst 2)
 *   3. alle arrangementer på tværs af foreningerne (mindst 1)
 * Forventet fremmøde = tilkendegivelser × faktor – som interval (tilkendegivelser × nedre/øvre kvartil), når grundlaget
 * har mindst MIN_INTERVAL målinger, ellers som punktestimat ("ca."). Grundlaget og antallet vises altid.
 * Tilgængelig for andre udvidelser som LAU.fremmoede.{faktor(f, kat), forventet(e, f)}.
 */
(() => {
  const MIN_EGNE = 2, MIN_KATEGORI = 2, MIN_INTERVAL = 4, KOMMENDE_DAGE = 30;
  const num2 = n => (n == null ? '–' : n.toLocaleString('da-DK', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
  /** Kvantil (0–1) af en sorteret liste med lineær interpolation. */
  const kvantil = (s, p) => { const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  const statistik = liste => {
    const s = liste.map(x => x.faktor).sort((a, b) => a - b);
    return {n: s.length, median: s.length ? kvantil(s, 0.5) : null, q1: s.length ? kvantil(s, 0.25) : null, q3: s.length ? kvantil(s, 0.75) : null};
  };
  const afholdt = e => !e.forsvundet && !e.aflyst && e.slutD < NOW;
  const flertal = (n, en, flere) => `${n} ${n === 1 ? en : flere}`;

  // Grundlaget beregnes én gang pr. DATA (beregn() laver et nyt objekt, når en rettelse gemmes).
  const cache = new WeakMap();
  function grundlag() {
    if (cache.has(DATA)) return cache.get(DATA);
    const maalt = DATA.events.filter(e => afholdt(e) && e.fremmoede != null && e.svar > 0).map(e => ({e, faktor: e.fremmoede / e.svar}));
    const g = {
      maalt, alle: statistik(maalt),
      forening: new Map(DATA.foreninger.map(f => [f.navn, statistik(maalt.filter(x => x.e.foreninger.includes(f.navn)))])),
      kategori: new Map(KAT_NAVNE.map(k => [k, statistik(maalt.filter(x => x.e.kat === k))])),
    };
    cache.set(DATA, g);
    return g;
  }

  /** Den faktor, der bruges for foreningen (og evt. en kategori): {n, median, q1, q3, kilde, kort, tekst} eller null. */
  function faktor(f, kat) {
    const g = grundlag(), egne = g.forening.get(f.navn), k = kat && g.kategori.get(kat);
    if (egne && egne.n >= MIN_EGNE) return {...egne, kilde: 'forening', kort: `egne (${egne.n})`, tekst: `foreningens egne ${egne.n} arrangementer`};
    if (k && k.n >= MIN_KATEGORI) return {...k, kilde: 'kategori', kort: `${kat} (${k.n})`, tekst: `${flertal(k.n, 'arrangement', 'arrangementer')} i kategorien ${kat} på tværs af foreningerne`};
    if (g.alle.n) return {...g.alle, kilde: 'alle', kort: `alle (${g.alle.n})`, tekst: `${flertal(g.alle.n, 'arrangement', 'arrangementer')} på tværs af alle foreninger`};
    return null;
  }

  /** Forventet fremmøde for et (planlagt) arrangement: {punkt, lav, hoej, tekst, faktor} eller {tekst: '–', grund}. */
  function forventet(e, f = DATA.byName.get(e.forening)) {
    if (e.svar == null) return {tekst: '–', grund: 'Tilkendegivelser kendes ikke'};
    if (!e.svar) return {tekst: '–', grund: 'Ingen tilkendegivelser endnu'};
    const fk = f && faktor(f, e.kat);
    if (!fk) return {tekst: '–', grund: 'Intet registreret fremmøde at regne ud fra'};
    const punkt = Math.round(e.svar * fk.median);
    if (fk.n >= MIN_INTERVAL) {
      const lav = Math.round(e.svar * fk.q1), hoej = Math.round(e.svar * fk.q3);
      if (lav !== hoej) return {punkt, lav, hoej, tekst: `${lav}–${hoej}`, faktor: fk};
    }
    return {punkt, tekst: `ca. ${punkt}`, faktor: fk};
  }
  LAU.fremmoede = {faktor, forventet, grundlag};

  // Filter under Arrangementer, så skubbet "mangler registreret fremmøde" åbner præcis de arrangementer.
  ARR_FILTRE.uden_fremmoede = {label: 'Afholdte uden fremmøde', vis: e => ['afholdt', 'bekraeftet'].includes(arrStatus(e)) && e.fremmoede == null};
  const tilArrangementer = forening => {
    Object.assign(ARR, {forening, filter: 'uden_fremmoede', q: '', aaben: null});
    visFane('arrangementer');
  };
  const forklaringKort = fk => `${num2(fk.median)} (${fk.kort})`;

  const METODE = `Omregningsfaktoren er fremmøde ÷ tilkendegivelser ("deltager" + "interesseret" på Facebook) for afholdte arrangementer, hvor fremmødet er noteret under Arrangementer.
    Der bruges medianen af foreningens egne arrangementer, når der er mindst ${MIN_EGNE}; ellers arrangementer i samme kategori på tværs af foreningerne (mindst ${MIN_KATEGORI}); ellers alle.
    Forventet fremmøde = tilkendegivelser × faktoren – som interval ud fra kvartilerne, når grundlaget har mindst ${MIN_INTERVAL} målinger, ellers "ca.".
    Tilkendegivelserne stiger typisk frem mod arrangementet, så forventningen for arrangementer langt ude er i underkanten.`;

  registerSection({
    id: 'fremmoede', titel: 'Fremmøde', admin: true, synlig: f => f.afholdt.length > 0 || f.planlagt.length > 0,
    render(f) {
      const g = grundlag(), egne = f.afholdt.filter(e => e.fremmoede != null), mangler = f.afholdt.length - egne.length;
      const sum = egne.reduce((a, e) => a + e.fremmoede, 0), fk = faktor(f);
      const kommende = f.planlagt.slice(0, 5), naeste = kommende.find(e => e.svar);
      const naesteF = naeste && forventet(naeste, f);
      // Uden noget registreret fremmøde vises blot tilkendegivelserne (i stedet for "–" og samme forklaring på hver linje).
      const liste = !kommende.length ? '' : `<ul class="fm-liste">${kommende.map(e => {
        const x = forventet(e, f);
        return `<li><span class="fm-dato">${esc(fmtDay.format(e.startD))}</span><span class="fm-navn">${esc(e.navn)}
          ${!g.alle.n ? '' : `<span class="fm-grundlag">${x.faktor ? `${esc(e.svar)} tilk. × ${esc(num2(x.faktor.median))} · grundlag: ${esc(x.faktor.kort)}` : esc(x.grund)}</span>`}</span>
          ${g.alle.n ? `<b class="fm-tal">${esc(x.tekst)}</b>` : `<span class="fm-tal fm-svar">${esc(e.svar ?? '–')} tilk.</span>`}</li>`;
      }).join('')}</ul>`;
      return `<div class="tiles">
          ${tile('Registreret fremmøde', egne.length ? `${egne.length} af ${f.afholdt.length}` : '–',
            egne.length ? `afholdte · ${sum} ${sum === 1 ? 'person' : 'personer'} i alt` : f.afholdt.length ? 'Intet registreret endnu' : 'Intet afholdt endnu')}
          ${tile('Median fremmøde', egne.length ? num1(median(egne.map(e => e.fremmoede))) : '–', egne.length ? `pr. arrangement (${egne.length} målt)` : null)}
          ${tile('Fremmøde pr. tilkendegivelse', fk ? num2(fk.median) : '–', fk ? `Grundlag: ${fk.tekst}` : 'Ingen data endnu')}
          ${tile('Forventet, næste', naesteF && naesteF.faktor ? naesteF.tekst : '–',
            naeste ? `${fmtDate.format(naeste.startD)} · ${naeste.svar} tilkendegivelser` : kommende.length ? 'Ingen tilkendegivelser endnu' : 'Intet i kalenderen')}
        </div>
        ${kommende.length ? `<h4 class="fm-h">${g.alle.n ? 'Forventet fremmøde, kommende' : 'Kommende (tilkendegivelser)'}</h4>${liste}` : ''}
        ${!g.alle.n ? '<p class="note">Der er endnu ikke registreret fremmøde for nogen arrangementer med tilkendegivelser, så forventet fremmøde kan ikke beregnes.</p>'
          : !fk || fk.kilde !== 'forening' ? `<p class="note">Foreningen har under ${MIN_EGNE} arrangementer med både fremmøde og tilkendegivelser, så faktoren kommer fra kategorien eller alle foreninger.</p>` : ''}
        ${mangler ? `<p class="fm-skub">${esc(flertal(mangler, 'afholdt arrangement mangler', 'afholdte arrangementer mangler'))} registreret fremmøde.
          <button type="button" class="linkbtn" data-fm-arr>Registrér under Arrangementer →</button></p>` : ''}`;
    },
    efter(el, f) {
      const knap = el.querySelector('[data-fm-arr]');
      if (knap) knap.addEventListener('click', () => tilArrangementer(f.navn));
      el.querySelectorAll('.fm-navn').forEach(n => { n.title = n.textContent.replace(/\s+/g, ' ').trim(); });
    },
  }, {efter: 'noegletal'});

  registerAnalyse({
    id: 'fremmoede', titel: 'Fremmøde vs. tilkendegivelser',
    beskrivelse: 'Hvor mange møder op i forhold til tilkendegivelserne på Facebook – og hvad kan de planlagte arrangementer forvente? Klik på en forening for at åbne den.',
    render() {
      const g = grundlag(), afh = DATA.events.filter(afholdt), medF = afh.filter(e => e.fremmoede != null);
      const udenF = afh.length - medF.length;
      const til = new Date(NOW.getTime() + KOMMENDE_DAGE * DAY);
      const kommende = DATA.events.filter(e => !e.forsvundet && !e.aflyst && e.slutD >= NOW && e.startD <= til).sort((a, b) => a.startD - b.startD);
      const foreninger = DATA.foreninger.filter(f => f.afholdt.length || f.planlagt.length)
        .sort((a, b) => (!!a.national - !!b.national) || a.navn.localeCompare(b.navn, 'da'));
      const interval = s => (s.n >= MIN_INTERVAL ? `${num2(s.q1)}–${num2(s.q3)}` : '–');

      const tomt = !g.alle.n ? `<p class="fm-skub">Der er endnu ikke registreret fremmøde for nogen afholdte arrangementer med tilkendegivelser, så der er intet at regne ud fra.
        Notér fremmødet under Arrangementer (Redigér → Faktisk fremmøde) – ${esc(flertal(udenF, 'afholdt arrangement mangler', 'afholdte arrangementer mangler'))} det.
        <button type="button" class="linkbtn" data-fm-arr="">Åbn Arrangementer →</button></p>` : '';

      return `<p class="note">${esc(METODE)}</p>${tomt}
        <div class="tiles">
          ${tile('Registreret fremmøde', `${medF.length} af ${afh.length}`, `afholdte arrangementer · ${medF.reduce((a, e) => a + e.fremmoede, 0)} personer i alt`)}
          ${tile('Median fremmøde', medF.length ? num1(median(medF.map(e => e.fremmoede))) : '–', medF.length ? 'pr. arrangement med registreret fremmøde' : 'Ingen data endnu')}
          ${tile('Fremmøde pr. tilkendegivelse', g.alle.n ? num2(g.alle.median) : '–',
            g.alle.n ? `Median af ${flertal(g.alle.n, 'arrangement', 'arrangementer')}${g.alle.n >= MIN_INTERVAL ? ` · kvartiler ${interval(g.alle)}` : ''}` : 'Ingen data endnu')}
          ${tile('Afholdte uden fremmøde', String(udenF), 'Kan noteres under Arrangementer')}
        </div>
        <h3>Pr. forening</h3>
        <table class="hb-tabel analyse-tabel fm-tabel"><thead><tr><th>Forening</th>
          <th class="tal" title="Afholdte arrangementer">Afholdt</th><th class="tal" title="Afholdte med registreret fremmøde">Registreret</th>
          <th class="tal" title="Median af det registrerede fremmøde">Median fremmøde</th><th class="tal" title="Fremmøde pr. tilkendegivelse, der bruges for foreningen">Faktor</th>
          <th>Grundlag</th><th class="tal" title="Afholdte arrangementer uden registreret fremmøde">Uden fremmøde</th></tr></thead>
        <tbody>${foreninger.map(f => {
          const egne = f.afholdt.filter(e => e.fremmoede != null), fk = faktor(f), uden = f.afholdt.length - egne.length;
          return `<tr tabindex="0" data-fm-f="${esc(f.navn)}"><td>${esc(f.national ? '◆ Landsforeningen' : f.navn)}</td>
            <td class="tal">${f.afholdt.length}</td><td class="tal">${egne.length || '–'}</td>
            <td class="tal">${egne.length ? esc(num1(median(egne.map(e => e.fremmoede)))) : '–'}</td>
            <td class="tal${fk && fk.kilde !== 'forening' ? ' fm-laant' : ''}">${fk ? esc(num2(fk.median)) : '–'}</td>
            <td class="muted">${fk ? esc(fk.kilde === 'forening' ? `egne (${fk.n})` : `alle foreninger (${fk.n})`) : 'ingen data'}</td>
            <td class="tal">${uden ? `<button type="button" class="linkbtn" data-fm-arr="${esc(f.navn)}" title="Registrér under Arrangementer">${uden}</button>` : '–'}</td></tr>`;
        }).join('')}</tbody></table>
        <h3>Faktor pr. kategori</h3>
        <table class="hb-tabel analyse-tabel fm-tabel"><thead><tr><th>Kategori</th><th class="tal">Målt</th><th class="tal" title="Median af fremmøde ÷ tilkendegivelser">Faktor</th>
          <th class="tal" title="Nedre–øvre kvartil (vises fra ${MIN_INTERVAL} målinger)">Interval</th><th class="tal">Median fremmøde</th><th title="Bruges for foreninger med under ${MIN_EGNE} egne målinger">Bruges som reserve</th></tr></thead>
        <tbody>${KAT_NAVNE.map(k => { const s = g.kategori.get(k), fm = g.maalt.filter(x => x.e.kat === k).map(x => x.e.fremmoede);
          return `<tr class="fm-stille"><td>${esc(k)}</td><td class="tal">${s.n || '–'}</td><td class="tal">${s.n ? esc(num2(s.median)) : '–'}</td>
            <td class="tal">${esc(interval(s))}</td><td class="tal">${fm.length ? esc(num1(median(fm))) : '–'}</td>
            <td class="muted">${s.n >= MIN_KATEGORI ? 'Ja' : `Nej – under ${MIN_KATEGORI} målt`}</td></tr>`; }).join('')}
          <tr class="fm-stille fm-total"><td>Alle</td><td class="tal">${g.alle.n || '–'}</td><td class="tal">${g.alle.n ? esc(num2(g.alle.median)) : '–'}</td>
            <td class="tal">${esc(interval(g.alle))}</td><td class="tal">${medF.length ? esc(num1(median(g.maalt.map(x => x.e.fremmoede)))) : '–'}</td><td class="muted">Sidste udvej</td></tr></tbody></table>
        <h3>De næste ${KOMMENDE_DAGE} dage</h3>
        ${!kommende.length ? '<p class="empty">Ingen planlagte arrangementer de næste 30 dage.</p>' : `<table class="hb-tabel analyse-tabel fm-tabel"><thead><tr>
          <th>Dato</th><th>Forening</th><th>Arrangement</th><th class="tal" title="Tilkendegivelser på Facebook nu">Tilk.</th><th class="tal">Forventet</th><th>Faktor (grundlag)</th></tr></thead>
        <tbody>${kommende.map(e => { const f = DATA.byName.get(e.forening), x = forventet(e, f);
          return `<tr tabindex="0" data-fm-f="${esc(e.forening)}"><td>${esc(fmtDay.format(e.startD))}</td><td>${esc(f ? (f.national ? '◆ Landsforeningen' : f.navn) : e.forening)}</td>
            <td class="fm-titel" title="${esc(e.navn)}">${esc(trunc(e.navn, 44))}</td><td class="tal">${e.svar ?? '–'}</td><td class="tal"><b>${esc(x.tekst)}</b></td>
            <td class="muted">${x.faktor ? esc(forklaringKort(x.faktor)) : esc(x.grund)}</td></tr>`; }).join('')}</tbody></table>`}`;
    },
    efter(el) {
      el.querySelectorAll('tr[data-fm-f]').forEach(tr => {
        tr.addEventListener('click', () => openForening(tr.dataset.fmF));
        tr.addEventListener('keydown', ev => { if (ev.key === 'Enter') openForening(tr.dataset.fmF); });
      });
      el.querySelectorAll('[data-fm-arr]').forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); tilArrangementer(b.dataset.fmArr); }));
    },
  });

  // Kolonne i den indbyggede analyse "Aktivitet pr. forening".
  const aktivitet = ANALYSER.find(a => a.id === 'foreninger');
  if (aktivitet) aktivitet.kolonner.push(['Faktor', f => { const s = grundlag().forening.get(f.navn); return s && s.n >= MIN_EGNE ? s.median : null; },
    `Fremmøde pr. tilkendegivelse (median af foreningens egne arrangementer; vises fra ${MIN_EGNE} målte)`]);
})();
