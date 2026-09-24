// Die Klaenge, die zum Vorgang gehoeren -- nicht zum Endbildschirm.
//
// Bis 0.6.16 kam der Kernzerstoerungs-Klang aus showDestroyed()/showDebrief(),
// also erst mit dem Fenster. Zwischen Brennstoffversagen und Fenster liegen
// aber mindestens drei Sekunden (DESTROY_PAUSE_MS in main.js), beim RBMK bis
// zu fuenfzehn: der Nachlauf soll vorher fertig sein. Der Ton kam damit,
// wenn laengst alles vorbei war.
//
// Hier haengt er an den Zustandsgroessen selbst. Jede Flanke feuert genau
// einmal je Lauf -- gerufen wird step() je Bild, und ein Bild ist kein
// Ereignis.
//
// Eigene Datei, weil zwei Seiten sie brauchen: der Leitstand (main.js) und
// der Zweitbildschirm (monitor.js). Ein zweiter Schirm im Nebenraum, der
// beim Alarm hupt, aber bei der Zerstoerung schweigt, waere die schlechtere
// Haelfte von beidem.

/**
 * @param {{meltdown: () => void, explosion: () => void}} horn
 *   Die Hupe aus buildPanels() -- sie prueft ihr `enabled` selbst, der
 *   Tonzustand des Kontos ist hier also kein Thema.
 */
export function createEndSounds(horn) {
  let destroyed = false;
  let lid = false;
  let h2 = false;

  return {
    /** Je Bild rufen. @param {object} s engine.state */
    step(s) {
      if (!s || !horn) return;
      // Brennstoffversagen: genau ein Klang, im Augenblick des Vorgangs.
      if (s.destroyed && !destroyed) {
        destroyed = true;
        horn.meltdown();
      }
      // Dampfexplosion im Nachlauf: der obere Schild hebt ab (RBMK, siehe
      // engine.js stepAftermath). `done` allein reicht nicht -- haelt der
      // Deckel, ist `lid` falsch, und dann gab es keine Explosion.
      if (s.aftermath && s.aftermath.done && s.aftermath.lid && !lid) {
        lid = true;
        horn.explosion();
      }
      // Wasserstoffexplosion (SWR, bwr.js: s.h2Exploded). Sie haengt NICHT
      // an der Zerstoerung: sie kann auch in einem Lauf kommen, den der
      // Spieler danach noch haelt.
      if (s.h2Exploded && !h2) {
        h2 = true;
        horn.explosion();
      }
    },
  };
}
