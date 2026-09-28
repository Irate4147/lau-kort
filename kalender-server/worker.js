/*
 * Én abonnerbar kalender for et vilkårligt valg af lokalforeninger + landsforeningen (Cloudflare Worker, gratis).
 *
 *   https://<worker>/aalborg+fyn.ics   →  landsforeningen.ics + aalborg-kun.ics + fyn-kun.ics, flettet til én kalender
 *
 * Filerne hentes fra Pages (skrevet af scripts/kalender.py); et arrangement med flere foreninger kommer kun med én gang
 * (samme UID). Samme fletteregel som flettIcs() i app.js. Opsætning: se README.md ("Én kalender for flere foreninger").
 */
const KILDE = 'https://irate4147.github.io/lau-kort/kalender/';
const MAKS = 60;

const tekst = s => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,');
/** Linjer må højst være 75 oktetter (RFC 5545); fortsættelseslinjer starter med et mellemrum. */
function fold(linje) {
  const ud = []; let cur = '', n = 0;
  for (const c of linje) {
    const b = new TextEncoder().encode(c).length;
    if (n + b > (ud.length ? 74 : 75)) { ud.push(cur); cur = ''; n = 0; }
    cur += c; n += b;
  }
  ud.push(cur);
  return ud.join('\r\n ');
}

function flettIcs(tekster, navn, beskrivelse) {
  const set = new Set(), ev = [];
  for (const t of tekster) for (const b of t.match(/BEGIN:VEVENT\r?\n[\s\S]*?END:VEVENT/g) || []) {
    const ufoldet = b.replace(/\r?\n[ \t]/g, '');
    const uid = (ufoldet.match(/^UID:(.*)$/m) || [])[1] || b;
    if (set.has(uid)) continue;
    set.add(uid);
    ev.push({start: (ufoldet.match(/^DTSTART[^:]*:(.*)$/m) || [])[1] || '', uid, b: b.replace(/\r?\n/g, '\r\n')});
  }
  ev.sort((a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid));
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LAU//lau-kort//DA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${tekst(navn)}`), fold(`X-WR-CALDESC:${tekst(beskrivelse)}`), 'X-WR-TIMEZONE:Europe/Copenhagen',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H', ...ev.map(e => e.b), 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

async function hent(fil) {
  const r = await fetch(KILDE + fil, {cf: {cacheTtl: 900, cacheEverything: true}});
  return r.ok ? r.text() : null;
}

export default {
  async fetch(req) {
    const sti = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '').replace(/\.ics$/, '');
    const slugs = [...new Set(sti.split(/[+, ]/).filter(s => /^[a-z0-9-]+$/.test(s) && s !== 'landsforeningen'))].sort();
    if (!slugs.length || slugs.length > MAKS) {
      return new Response('Angiv foreningerne i stien, fx /aalborg+fyn.ics\n', {status: 400, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
    }
    const [nat, ...lokale] = await Promise.all(['landsforeningen.ics', ...slugs.map(s => `${s}-kun.ics`)].map(hent));
    if (!nat || lokale.some(t => !t)) {
      const ukendte = slugs.filter((_, i) => !lokale[i]);
      return new Response(`Kunne ikke hente ${ukendte.length ? ukendte.join(', ') : 'landsforeningen'}\n`, {status: 404, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
    }
    const navne = lokale.map(t => ((t.replace(/\r?\n[ \t]/g, '').match(/^X-WR-CALNAME:LAU (.*?) \(kun lokalt\)\s*$/m) || [])[1] || '').replace(/\\(.)/g, '$1'));
    const navn = `LAU ${navne.filter(Boolean).join(', ')} + Landsforeningen`;
    const ics = flettIcs([nat, ...lokale], navn, `${navn}. https://irate4147.github.io/lau-kort/`);
    return new Response(ics, {headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="lau-${slugs.join('+')}.ics"`,
      'Cache-Control': 'public, max-age=900',
      'Access-Control-Allow-Origin': '*',
    }});
  },
};
