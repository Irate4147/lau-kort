/*
 * LAU-serveren (Cloudflare Worker, gratis). Opsætning: se README.md ("Én kalender for flere foreninger" og "Rettelser").
 *
 * 1) Én abonnerbar kalender for et vilkårligt valg af lokalforeninger + landsforeningen:
 *      https://<worker>/aalborg+fyn.ics   →  landsforeningen.ics + aalborg-kun.ics + fyn-kun.ics, flettet til én kalender
 *    Filerne hentes fra Pages (skrevet af scripts/kalender.py); et arrangement med flere foreninger kommer kun med én
 *    gang (samme UID). Samme fletteregel som flettIcs() i app.js.
 *
 * 2) Gem for alle: admins henter og committer de krypterede filer data/admin/<navn>.krypt.json uden eget GitHub-token.
 *      GET /admin/<navn>                          → {indhold: {v, iv, data} | null, sha}
 *      PUT /admin/<navn>  {indhold, sha, besked}  → {sha} (409, hvis filen er ændret siden sha)
 *    Kræver "Authorization: Bearer <skrivenøgle>", hvis SHA-256 står som "skriv" i data/admin/noegle.json (skrivenøglen
 *    udledes af adminkoden, så kun admins kender den). Worker-secret GITHUB_TOKEN: fine-grained token med kun dette
 *    repo og Contents: Read and write. Serveren kan kun skrive krypterede filer i data/admin/.
 */
const KILDE = 'https://irate4147.github.io/lau-kort/kalender/';
const MAKS = 60;
const REPO = 'Irate4147/lau-kort', GREN = 'main';

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

// ---- Gem for alle

const CORS = {'Access-Control-Allow-Origin': '*'};
const svar = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json; charset=utf-8', ...CORS}});
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

function github(env, sti, init = {}) {
  return fetch(`https://api.github.com/repos/${REPO}/contents/${sti}`, {...init, headers: {
    Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GITHUB_TOKEN.trim()}`, 'User-Agent': 'lau-kort-server'}});
}
/** Forståelig fejl ud fra GitHubs svar (inkl. GitHubs egen besked). */
async function githubFejl(r) {
  const besked = await r.json().then(j => j.message).catch(() => '');
  const hjaelp = r.status === 401 ? 'GITHUB_TOKEN på Cloudflare er forkert eller udløbet'
    : r.status === 403 || r.status === 404 ? `GITHUB_TOKEN mangler adgang: kun ${REPO}, Contents: Read and write`
    : 'GitHub-fejl';
  return new Error(`${hjaelp} (GitHub ${r.status}${besked ? `: ${besked}` : ''})`);
}
/** En fil i repoet: {tekst, sha} (tekst null, hvis den ikke findes – eller en fejl, hvis den skal findes). */
async function hentFil(env, sti, skalFindes = false) {
  const r = await github(env, `${sti}?ref=${GREN}`);
  if (r.status === 404 && !skalFindes) return {tekst: null, sha: null};
  if (!r.ok) throw await githubFejl(r);
  const j = await r.json();
  return {tekst: new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\s/g, '')), c => c.charCodeAt(0))), sha: j.sha};
}
/** Hentes frisk hver gang, så en ny adminkode (scripts/admin.py skift-kode) virker med det samme. */
async function erAdmin(req, env) {
  const m = (req.headers.get('Authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
  if (!m) return false;
  const {tekst} = await hentFil(env, 'data/admin/noegle.json', true);
  const skriv = tekst && JSON.parse(tekst).skriv;
  if (!skriv) return false;
  const bytes = Uint8Array.from(m[1].match(/../g), x => parseInt(x, 16));
  return hex(await crypto.subtle.digest('SHA-256', bytes)) === skriv;
}

async function admin(req, env, navn) {
  if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: {...CORS,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400'}});
  if (!env.GITHUB_TOKEN) return svar({fejl: 'GITHUB_TOKEN er ikke sat på serveren'}, 500);
  if (!/^[a-z0-9_-]{1,40}$/.test(navn)) return svar({fejl: 'Ukendt fil'}, 404);
  if (!(await erAdmin(req, env))) return svar({fejl: 'Forkert eller forældet adminkode'}, 401);
  const sti = `data/admin/${navn}.krypt.json`;
  if (req.method === 'GET') {
    const {tekst, sha} = await hentFil(env, sti);
    return svar({indhold: tekst ? JSON.parse(tekst) : null, sha});
  }
  if (req.method !== 'PUT') return svar({fejl: 'Metoden understøttes ikke'}, 405);
  let krop;
  try { krop = await req.json(); } catch (_) { return svar({fejl: 'Ugyldig JSON'}, 400); }
  const {indhold, sha, besked} = krop || {};
  // Kun en krypteret blob – serveren bygger selv filen, så intet andet end {v, iv, data} kan havne i repoet.
  if (!indhold || indhold.v !== 1 || typeof indhold.iv !== 'string' || !B64.test(indhold.iv) || indhold.iv.length > 32
    || typeof indhold.data !== 'string' || !B64.test(indhold.data) || indhold.data.length > 2e6) return svar({fejl: 'Ugyldigt indhold'}, 400);
  if (sha != null && !/^[0-9a-f]{40}$/.test(sha)) return svar({fejl: 'Ugyldig sha'}, 400);
  const fil = JSON.stringify({v: 1, iv: indhold.iv, data: indhold.data}) + '\n';
  const r = await github(env, sti, {method: 'PUT', body: JSON.stringify({
    message: String(besked || `Opdatér ${navn}`).replace(/[\x00-\x1f]+/g, ' ').slice(0, 200), branch: GREN, content: btoa(fil), ...(sha ? {sha} : {})})});
  if (r.status === 409 || r.status === 422) return svar({fejl: 'Filen er ændret samtidig'}, 409);
  if (!r.ok) return svar({fejl: (await githubFejl(r)).message}, 502);
  return svar({sha: (await r.json()).content.sha});
}

export default {
  async fetch(req, env) {
    const admSti = new URL(req.url).pathname.match(/^\/admin\/([^/]*)$/);
    if (admSti) {
      try { return await admin(req, env, admSti[1]); } catch (err) { return svar({fejl: err.message}, 502); }
    }
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
