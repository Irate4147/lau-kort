// Roller og rettigheder på LAU-serveren. Håndhæves af serveren (api.js); brugerfladen får dem fra /api/mig, så den kan
// skjule det, man ikke må. Alle roller kan læse alle fortrolige data (udvalget skal bruge momentum, HB osv. som
// kontekst) – rollerne styrer, hvad man må ændre.

export const ROLLER = {
  admin: {label: 'Admin', beskrivelse: 'Alt: rettelser af arrangementer, HB, brugere og kørsler'},
  udviklingsformand: {label: 'Udviklingsformand', beskrivelse: 'Udviklingsudvalget inkl. medlemmer og fordeling; kan invitere udvalgsmedlemmer'},
  udvalg: {label: 'Udvalgsmedlem', beskrivelse: 'Kontakter, noter og kontaktoplysninger; ser alt'},
};

// Dokumenter, rollen må ændre (admin må alle).
const SKRIV = {
  udviklingsformand: ['udvikling', 'stamdata', 'noter', 'analyser'],
  udvalg: ['udvikling', 'stamdata', 'noter', 'analyser'],
};
// Dele af udvikling, kun admin og udviklingsformanden må ændre: udvalgets medlemmer og fordelingen af foreningerne.
const FORDELING = ['udvalg', 'ansvar'];

const lig = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const gyldigRolle = r => Object.hasOwn(ROLLER, r);
export const erAdmin = b => !!b && b.rolle === 'admin';
export const kanLaese = b => !!b && gyldigRolle(b.rolle);

/**
 * Må brugeren gemme dokumentet? foer/efter er indholdet før og efter (til regler for dele af et dokument).
 * @returns {string|null} null, hvis det er tilladt – ellers grunden
 */
export function maaGemme(b, navn, foer, efter) {
  if (!kanLaese(b)) return 'Kræver login';
  if (erAdmin(b)) return null;
  if (!(SKRIV[b.rolle] || []).includes(navn)) return `${ROLLER[b.rolle].label} må ikke ændre ${navn}`;
  if (navn === 'udvikling' && b.rolle === 'udvalg' && FORDELING.some(k => !lig((foer || {})[k], (efter || {})[k]))) {
    return 'Kun udviklingsformanden og admins kan ændre udvalgets medlemmer og fordelingen';
  }
  return null;
}

/** Må brugeren oprette eller ændre en bruger med rollen (og den nuværende rolle, hvis brugeren findes)? */
export function maaStyreBruger(b, rolle, nuvaerende = null) {
  if (erAdmin(b)) return gyldigRolle(rolle);
  return !!b && b.rolle === 'udviklingsformand' && rolle === 'udvalg' && (nuvaerende == null || nuvaerende === 'udvalg');
}

/** Det, brugerfladen skal vide om brugerens rettigheder. */
export function rettigheder(b) {
  return {
    skriv: erAdmin(b) ? '*' : SKRIV[b.rolle] || [],
    fordeling: erAdmin(b) || b.rolle === 'udviklingsformand',
    brugere: erAdmin(b) || b.rolle === 'udviklingsformand',
    koersler: erAdmin(b),
  };
}
