// Kernalter beim Start des freien Spiels.
//
// createEngine() kennt den Abbrand seit je als Anfangswert (`opts.burnup`),
// aber nur der Spielstand hat ihn je gesetzt: jedes neue freie Spiel begann
// mit einem frisch beladenen Kern. Dabei ist genau dieser eine Wert der
// billigste Schwierigkeitsregler, den das Modell hergibt -- die
// Überschussreaktivität wird jeden Rechenschritt frisch aus `s.burnup`
// gebildet (siehe sim/reactivity.js, Teil 'excess'), und mit ihr schrumpft
// der Vorrat, aus dem sich Xenon, Temperatur und Lastwechsel bedienen.
//
// Warum drei feste Stufen und kein Schieberegler in EFPD: die Zahl selbst
// sagt niemandem etwas, und ein zu hoher Wert nimmt der Anlage die
// Kritikalität. Dann steht der Spieler vor einem Reaktor, der sich beim
// besten Willen nicht mehr auf Nennleistung bringen lässt -- kein
// Schwierigkeitsgrad, sondern ein kaputter Start.
//
// Warum die Stufen je Reaktortyp andere Anteile sind: die drei Typen halten
// ihren Überschuss unterschiedlich nieder. Der DWR hat Bor und kommt damit
// über zwei Drittel des Zyklus, bevor die Konzentration auf null steht. Der
// SWR hält alles mit Stäben nieder und ist schon nach einem Fünftel am Ende
// seiner Stabreserve; sein echtes Gegengewicht -- abbrennbare Gifte im
// Brennelement -- rechnet dieses Modell nicht. Der RBMK wird in Wirklichkeit
// im Betrieb nachgeladen und steht deshalb dauerhaft nahe seinem
// Gleichgewichtskern; sein Zyklus ist hier nur eine Rechengröße. Die Werte
// sind an der jeweiligen Reserve gemessen (Stabstellung bzw. Borgehalt bei
// Nennleistung), nicht aus einer Brennstoffbilanz hergeleitet.
//
// Fuer den RBMK ist die Stabstellung dafuer seit 0.6.28 NICHT mehr das Mass,
// sondern die Abschaltreserve, die sie erzeugt. Der Grund ist, dass beim
// RBMK dieselbe Stabstellung ueber _voidCoeff (plants/rbmk.js) auch den
// Dampfblasenkoeffizienten setzt -- an der Stabstellung gemessen fiel nicht
// auf, dass 0.35 den Kern auf ORM 5,9 stellte: unterhalb der Alarmschwelle
// dieses Modells (sp.orm.alarm = 15), mit dem Blasenkoeffizienten auf seinem
// schlechtesten Wert von 62 pcm/%, und mit einem positiven Leistungs-
// koeffizienten, gegen den der Leistungsregler dauerhaft anfahren musste.
// Das freie Spiel bot damit als Schwierigkeitsgrad einen Zustand an, den das
// Reglement des Originals zur sofortigen Abschaltung verpflichtet haette.
//
// Die Stufen spannen jetzt das ERLAUBTE Band auf (sp.orm, gemessen bei
// Nennleistung):
//   fresh 0     -> ORM 66,3  volle Reserve
//   mid   0.10  -> ORM 45,8  die nominale Reserve (sp.orm.nominal = 46)
//   late  0.18  -> ORM 33,3  knapp ueber dem Betriebsminimum (sp.orm.min = 30)
// "late" bleibt damit deutlich unangenehmer als "fresh" -- der Blasen-
// koeffizient steht dort bei 37 statt 20 pcm/% --, aber die Anlage ist
// fahrbar. Wer ORM 6 sehen will, findet ihn in der Tschernobyl-Uebung; dort
// gehoert er hin.
const FRACTIONS = {
  pwr: { fresh: 0, mid: 0.35, late: 0.65 },
  bwr: { fresh: 0, mid: 0.10, late: 0.20 },
  rbmk: { fresh: 0, mid: 0.10, late: 0.18 },
};

const DEFAULT = { fresh: 0, mid: 0.2, late: 0.35 };

export const CORE_AGE_IDS = ['fresh', 'mid', 'late'];

/**
 * Abbrand in EFPD für eine gewählte Stufe.
 * @param {object} spec   plant.spec -- liefert Typ und Zykluslänge
 * @param {string} id     'fresh' | 'mid' | 'late'
 * @returns {number} EFPD, 0 bei unbekannter Stufe (frischer Kern)
 */
export function coreAgeBurnup(spec, id) {
  if (!spec) return 0;
  const table = FRACTIONS[spec.id] || DEFAULT;
  const frac = Object.hasOwn(table, id) ? table[id] : 0;
  return frac * (spec.cycleEFPD || 450);
}
