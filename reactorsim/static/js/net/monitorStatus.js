// Was der Zweitbildschirm oben in die Zeile schreibt.
//
// Eigene Datei und eine reine Funktion, weil hier die einzige Aussage steht,
// die dieser Schirm ueberhaupt selbst trifft. Alles andere zeigt er nur an.
//
// Der Kern ist die REIHENFOLGE. Ein Leitstand im Hintergrund schickt nichts
// mehr -- sein Bild altert also genauso wie das eines abgerissenen Netzes,
// und wer nur auf das Alter schaut, meldet "keine Verbindung" fuer etwas,
// das voellig in Ordnung ist. Der Grund steht im letzten Bild, das noch
// ankam, und er muss deshalb vor dem Alter kommen: eine Erklaerung schlaegt
// ein Raten.

/** Ab hier gilt das Bild als stehend: die Anzeige wird grau. Zwei Sendetakte
 *  plus Luft -- ein einzelnes verzoegertes Bild soll noch nicht warnen. */
export const STALE_S = 3;
/** Und ab hier als tot. Darunter liegt jede normale Schwankung eines WLANs;
 *  darueber liegt kein Leitstand mehr, der noch rechnet. */
export const LOST_S = 10;

/**
 * @param {object} input
 * @param {string} input.state Was der Empfaenger zuletzt gesehen hat:
 *   'wait' (noch nie etwas), 'offline' (dieser Schirm erreicht den Server
 *   nicht), 'none' (der Server hat kein Bild) oder 'live'.
 * @param {number} input.age Alter des gezeigten Bildes in Sekunden.
 * @param {object|null} input.meta Kopfdaten aus dem letzten Bild.
 * @param {string|null} input.error Grund, aus dem das letzte Bild nicht
 *   uebernommen werden konnte.
 * @returns {{key: string, sev: 'ok'|'warn'|'bad'}}
 */
export function monitorReason({ state, age, meta, error }) {
  // Zuerst die Faelle, in denen es gar kein Bild gibt oder es nicht von
  // diesem Stand stammt -- ein Grund aus einem unbrauchbaren Bild waere
  // selbst unbrauchbar.
  if (state === 'offline') return { key: 'monitor_offline', sev: 'bad' };
  if (state === 'none') return { key: 'monitor_none', sev: 'warn' };
  if (state === 'wait') return { key: 'monitor_wait', sev: 'warn' };
  if (error) return { key: 'monitor_bad_frame', sev: 'bad' };

  // Dann die drei Gruende, die der Leitstand selbst genannt hat. Sie stehen
  // VOR dem Alter, weil sie es erklaeren: nach jedem von ihnen hoert das
  // Senden auf, und das Bild altert ganz zu Recht.
  if (meta?.closed) return { key: 'monitor_closed', sev: 'warn' };
  if (meta?.ended) return { key: 'monitor_ended', sev: 'warn' };
  if (meta?.hidden) return { key: 'monitor_hidden', sev: 'warn' };

  // Erst jetzt das Alter. Hier ist es ohne Erklaerung gewachsen, und genau
  // das ist der Fall, fuer den "keine Verbindung" gedacht ist.
  if (age > LOST_S) return { key: 'monitor_lost', sev: 'bad' };
  // Angehalten kommt NACH der Verlustgrenze: ein Leitstand auf Pause sendet
  // weiter (der Renderlauf laeuft, nur engine.step() nicht) -- bleibt sein
  // Bild trotzdem aus, ist die Pause nicht mehr die Erklaerung.
  if (meta?.speed === 0) return { key: 'monitor_paused', sev: 'warn' };
  if (age > STALE_S) return { key: 'monitor_stale', sev: 'warn' };
  return { key: 'monitor_live', sev: 'ok' };
}
