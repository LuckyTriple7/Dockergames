// Eine Datei im Browser zum Herunterladen anbieten.
//
// Eigene Datei, weil das der einzige Teil des Debug-Protokolls ist, der ein
// DOM braucht -- game/debugTape.js selbst bleibt dadurch unter Node
// testbar.

/**
 * Text packen, sofern der Browser es kann.
 *
 * CompressionStream gibt es in allen aktuellen Browsern, aber nicht in
 * jedem: faellt es aus, geht die Datei ungepackt raus statt gar nicht. Die
 * Endung sagt dann auch, was drin ist -- ein .gz, das keines ist, waere
 * schlimmer als eine grosse Datei.
 *
 * @returns {Promise<{blob: Blob, ext: string}>}
 */
export async function packText(text, type = 'application/x-ndjson') {
  const raw = new Blob([text], { type });
  if (typeof CompressionStream !== 'function' || !raw.stream) {
    return { blob: raw, ext: '' };
  }
  try {
    const packed = await new Response(
      raw.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    return { blob: new Blob([packed], { type: 'application/gzip' }), ext: '.gz' };
  } catch {
    return { blob: raw, ext: '' };
  }
}

/** Blob als Datei anbieten. Der Objekt-URL wird wieder freigegeben --
 *  ohne revokeObjectURL haelt der Reiter die ganze Datei im Speicher fest,
 *  und ein Debug-Protokoll ist kein kleiner Posten. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Erst nach dem Klick freigeben; sofort waere der Download in manchen
  // Browsern abgebrochen, bevor er begonnen hat.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
