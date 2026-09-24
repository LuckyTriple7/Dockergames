// Umsortieren einer Kachelreihe per Zeigergeste -- Touch, Maus und Stift
// gleich. Kein HTML5-Drag&Drop: das kennt keine Touch-Geraete, und genau da
// soll sich die Statuszeile genauso greifen lassen wie am Rechner.
//
// Long-Press haelt fest, statt sofort auf jede Bewegung zu reagieren --
// sonst kollidiert Greifen zum Verschieben mit Wischen zum seitlichen
// Scrollen (dieselbe Zeile ist beides: `.rs-status-scroll` mit
// overflow-x: auto). Erst nach `holdMs` ohne nennenswerte Bewegung beginnt
// das Verschieben; eine schnelle Bewegung vorher bleibt normales Scrollen
// (touch-action bleibt bis dahin unangetastet).

const HOLD_MS = 320;
const MOVE_CANCEL_PX = 8;

/** DOM-Reihenfolge: liegt a vor b? */
function isBefore(a, b) {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/**
 * @param {HTMLElement} container   traegt die Kacheln direkt als Kinder
 * @param {string} itemSelector     welche Kinder ziehbar sind, z.B.
 *                                  '.rs-stat:not([hidden])' -- ausgeblendete
 *                                  Kacheln haben eine leere Boundingbox und
 *                                  wuerden die Mittelpunkt-Rechnung stoeren
 * @param {(items: HTMLElement[]) => void} onReorder  Endzustand nach dem
 *                                  Loslassen, nur wenn wirklich gezogen wurde
 */
export function enableDragReorder(container, itemSelector, onReorder) {
  let dragEl = null;
  let startX = 0;
  let holdTimer = 0;
  let armed = false;

  const onMove = (mv) => {
    if (!armed) {
      if (Math.abs(mv.clientX - startX) > MOVE_CANCEL_PX) window.clearTimeout(holdTimer);
      return;
    }
    mv.preventDefault();
    const dx = mv.clientX - startX;
    dragEl.style.transform = `translateX(${dx}px)`;

    const dragRect = dragEl.getBoundingClientRect();
    const dragMid = dragRect.left + dragRect.width / 2;
    for (const sib of container.querySelectorAll(itemSelector)) {
      if (sib === dragEl) continue;
      const r = sib.getBoundingClientRect();
      const sMid = r.left + r.width / 2;
      // Nur tauschen, wenn die Kachel ihren Nachbarn wirklich ueberholt hat,
      // und nur in die Richtung, in die gerade gezogen wird -- sonst
      // schnappt sie bei jeder Vorbeifahrt in beide Richtungen zugleich hin
      // und her.
      if (dx > 0 && dragMid > sMid && isBefore(dragEl, sib)) {
        container.insertBefore(dragEl, sib.nextSibling);
      } else if (dx < 0 && dragMid < sMid && !isBefore(dragEl, sib)) {
        container.insertBefore(dragEl, sib);
      } else {
        continue;
      }
      // Kachel sitzt jetzt an neuer Stelle -- Nullpunkt mitnehmen, sonst
      // springt sie um die halbe Zeilenbreite.
      startX = mv.clientX;
      dragEl.style.transform = 'translateX(0px)';
      break;
    }
  };

  const onUp = () => {
    window.clearTimeout(holdTimer);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    if (armed && dragEl) {
      dragEl.classList.remove('rs-drag-active');
      dragEl.style.transform = '';
      onReorder([...container.querySelectorAll(itemSelector)]);
    }
    dragEl = null;
    armed = false;
  };

  container.addEventListener('pointerdown', (ev) => {
    // Nur der Haupttaste/Finger/Stift -- ein Rechtsklick soll das Kontextmenue
    // bekommen, keinen Drag-Versuch.
    if (ev.button !== undefined && ev.button !== 0) return;
    const item = ev.target.closest(itemSelector);
    if (!item) return;
    startX = ev.clientX;
    armed = false;
    window.clearTimeout(holdTimer);
    holdTimer = window.setTimeout(() => {
      armed = true;
      dragEl = item;
      item.classList.add('rs-drag-active');
    }, HOLD_MS);
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });
}
