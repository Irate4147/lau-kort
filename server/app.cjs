// Startfil til cPanel-hosting ("Setup Node.js App" på LiteSpeed/Passenger): de kræver (require) startfilen, så den er
// CommonJS og henter serveren (ESM) bagefter. Indstillingerne – også hemmeligheder som APIFY_TOKEN – læses fra
// LAU_ENV (standard ~/lau/lau.env, chmod 600), så de ikke står i cPanels app-indstillinger. Se server/README.md (cPanel).
const {homedir} = require('node:os');
const {join} = require('node:path');

process.loadEnvFile(process.env.LAU_ENV || join(homedir(), 'lau', 'lau.env'));
import('./server.js').then(({konfiguration, start}) => start(konfiguration()));
