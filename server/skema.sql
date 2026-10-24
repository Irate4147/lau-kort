-- LAU-serverens database (SQLite). Bruges af server/db.js og scripts/admin.py (LAU_DB) – begge kører filen ved start,
-- så den skal kunne køres igen og igen. Se server/README.md.

-- De fortrolige data: ét JSON-dokument pr. navn – de samme navne og former som de krypterede filer i data/admin/
-- (hb, rettelser, noter, stamdata, medlemmer, rapporter, analyser, udvikling, hb_<år>). version tælles op ved hver
-- ændring, så samtidige ændringer opdages (409).
CREATE TABLE IF NOT EXISTS dokumenter (
  navn    TEXT PRIMARY KEY,
  indhold TEXT NOT NULL,
  version INTEGER NOT NULL,
  rettet  TEXT NOT NULL,
  af      TEXT
);

-- Handlingsloggen kan kun skrives til: hvem gjorde hvad hvornår. Ved ændringer af et dokument gemmes den nye udgave, så
-- historikken er fuld (og kan gendannes).
CREATE TABLE IF NOT EXISTS handlinger (
  id       INTEGER PRIMARY KEY,
  tid      TEXT NOT NULL,
  bruger   INTEGER,
  af       TEXT,
  handling TEXT NOT NULL,
  navn     TEXT,
  version  INTEGER,
  besked   TEXT,
  indhold  TEXT
);
CREATE INDEX IF NOT EXISTS handlinger_navn ON handlinger (navn, version);

-- Personlige logins. rolle: admin, udviklingsformand eller udvalg (server/adgang.js). hash: scrypt (null indtil
-- invitationen er brugt).
CREATE TABLE IF NOT EXISTS brugere (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  navn       TEXT NOT NULL,
  rolle      TEXT NOT NULL,
  hash       TEXT,
  aktiv      INTEGER NOT NULL DEFAULT 1,
  oprettet   TEXT NOT NULL,
  sidst_inde TEXT
);

-- Sessioner og invitationer: kun SHA-256 af tokenet gemmes.
CREATE TABLE IF NOT EXISTS sessioner (
  token    TEXT PRIMARY KEY,
  bruger   INTEGER NOT NULL,
  udloeber TEXT NOT NULL,
  oprettet TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invitationer (
  token    TEXT PRIMARY KEY,
  bruger   INTEGER NOT NULL,
  udloeber TEXT NOT NULL
);

-- Planlagte og manuelle kørsler (scraping, HB, rapport, kalendere, backup). noegle: tidspunktet, en planlagt kørsel
-- hører til, så den ikke køres to gange (fx efter en genstart).
CREATE TABLE IF NOT EXISTS koersler (
  id     INTEGER PRIMARY KEY,
  job    TEXT NOT NULL,
  noegle TEXT,
  start  TEXT NOT NULL,
  slut   TEXT,
  ok     INTEGER,
  log    TEXT
);
CREATE INDEX IF NOT EXISTS koersler_job ON koersler (job, noegle);

-- Kørsler, serveren har bedt om, når cron kører dem (LAU_JOBS=cron, fx på cPanel-hosting, hvor webprocessen kan blive
-- lukket midt i en kørsel): "Kør nu" og beregn efter ændringer. tid: tidligst. "lau.js cron" tager dem.
CREATE TABLE IF NOT EXISTS koe (
  job TEXT PRIMARY KEY,
  arg TEXT NOT NULL DEFAULT '',
  tid TEXT NOT NULL
);
