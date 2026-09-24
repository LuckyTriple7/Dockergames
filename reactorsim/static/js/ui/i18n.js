// Übersetzungen und Zahlenformate.
//
// Die Tabelle kommt als Ganzes aus dem Template (window.RS_I18N). Fehlt ein
// Schlüssel, steht der Schlüsselname da -- sichtbar, aber nicht kaputt.

const TABLE = (typeof window !== 'undefined' && window.RS_I18N) || {};
export const LANG = (typeof window !== 'undefined' && window.RS_CFG && window.RS_CFG.lang) || 'en';

/** t('key') oder t('key', {n: 3}) für Platzhalter der Form {n}. */
export function t(key, vars) {
  let s = TABLE[key];
  if (s === undefined) return key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(String(v));
  }
  return s;
}

/** Ob ein Schlüssel wirklich in der Tabelle steht -- t() allein lässt sich
 *  von einem fehlenden Schlüssel nicht unterscheiden, der zufällig genauso
 *  aussieht wie sein eigener Name. */
export function has(key) { return TABLE[key] !== undefined; }

const _fmt = new Map();

/** Zahl mit fester Nachkommastelle in der Sprache des Spielers. */
export function num(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  let f = _fmt.get(digits);
  if (!f) {
    f = new Intl.NumberFormat(LANG, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    _fmt.set(digits, f);
  }
  return f.format(value);
}

/** Zahl plus Einheit; die Einheit bekommt eine eigene, kleinere Auszeichnung. */
export function val(node, value, digits, unitKey) {
  const text = num(value, digits);
  if (!unitKey) return text;
  return text + ' ' + t(unitKey);
}

/** Sekunden als Tageszeit hh:mm:ss -- fuer Anzeigen, die nicht die
 *  Betriebszeit ab null meinen, sondern eine Uhr (siehe status_wallclock und
 *  chernobylTutorial.js: die Nacht zum 26.04.). Rechnet in den Tag zurueck,
 *  damit ein Versatz ueber Mitternacht hinaus nicht "25:03:11" anzeigt. */
export function clockOfDay(seconds) {
  const s = Number.isFinite(seconds) ? seconds : 0;
  return clock(((s % 86400) + 86400) % 86400);
}

/** Sekunden als hh:mm:ss -- die Betriebszeit läuft über viele Stunden. */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(r)}`;
}
