// LAU-kernen: ontologi, objektlager, objektsæt og regler. Se kerne/README.md og docs/arkitektur.md.
export {Ontologi, tilladt, ADGANG_NIVEAU} from './ontologi.js';
export {Lager} from './lager.js';
export {koer, valider, boreNed, prObjekt, visVaerdi, slutType, maal, PERIODER, DATO_GRUPPER, MAAL} from './objektsaet.js';
export {LAU, ARR_STATUS, AKTIVITET_STATUS, HB_STATUS} from './lau.js';
export {bygFraJson} from './kilder/json.js';
export * as regler from './regler.js';
export * as tid from './tid.js';
