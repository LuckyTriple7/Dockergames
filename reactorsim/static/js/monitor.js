// Einstieg des Zweitbildschirms (/monitor).
//
// Dieselbe Seite wie der Leitstand, dieselben Kacheln, dieselben
// Rundinstrumente -- nur ein anderes Einstiegsmodul (siehe index.html und
// app.py: monitor_page()). Der Grund ist nicht Bequemlichkeit: eine eigene
// Vorlage mit eigenen Anzeigen waere ein zweiter Satz Wertebindungen, und
// beim naechsten Reaktortyp oder beim naechsten neuen Messwert waere genau
// einer davon vergessen worden.
//
// Der Trick, der das moeglich macht: hier entsteht eine ECHTE Engine des
// richtigen Typs -- sie wird nur nie getreten. Statt engine.step() schreibt
// applyFrame() den Zustand aus den ankommenden Bildern hinein, und
// buildPanels() laeuft unveraendert darueber. Kein einziges Instrument steht
// deshalb zweimal im Quelltext.
//
// Gesperrt wird ueber setControlsLocked() (ui/controls.js) -- derselbe
// Vorfuehrmodus, den die Chernobyl-Uebung benutzt. Weggelassene Knoten waeren
// die schlechtere Sperre: tote Stellteile, die unerklaert auf Klicks
// schweigen, sind schlimmer als sichtbar gesperrte.

import { $, setText, setAttr } from './ui/dom.js';
import { t, num } from './ui/i18n.js';
import { Render } from './ui/render.js';
import { buildPanels } from './ui/panels.js';
import { setControlsLocked } from './ui/controls.js';
import { createEngine } from './sim/engine.js';
import { getPlant } from './plants/index.js';
import { gridDeviationTrips } from './game/scenario.js';
import { sanitizeStatusKeys } from './ui/statusStats.js';
import { buildStatusBar, applyStatusSelection, setStatusTileLabel } from './ui/statusBar.js';
import { setMuted } from './ui/music.js';
import { initInstrumentsWindow } from './ui/instruments.js';
import { api } from './net/api.js';
import { applyFrame } from './net/monitorFrame.js';
import { MonitorReceiver } from './net/monitorLink.js';
import { monitorReason } from './net/monitorStatus.js';

const view = {
  engine: null,
  render: new Render(),
  built: null,
  run: null,
  prefs: {},
  /** Letzter uebernommener Protokolleintrag, als Simulationszeit. Der
   *  Vergleich laeuft ueber t_sim und nicht ueber einen Zaehler: das
   *  Meldungsprotokoll ist bei 120 Eintraegen gedeckelt (HISTORY_CAP in
   *  sim/engine.js) und kommt ausserdem nicht in jedem Bild mit, ein Index
   *  waere also bei jedem Ueberlauf falsch. */
  lastLogT: -Infinity,
  status: { state: 'wait', age: 0, meta: null },
  error: null,
};

// ── Aufbau ───────────────────────────────────────────────────────────────────

/**
 * Leitstand fuer einen neuen Lauf aufbauen.
 *
 * Gerufen beim ersten Bild und danach bei jedem Wechsel der Laufkennung --
 * ein neuer Reaktortyp, ein Neustart, eine andere Schicht. Alles darunter
 * (Zeitraffer, Zustand, Meldungen) kommt ueber die Bilder selbst.
 */
function buildFor(frame) {
  const plant = getPlant(frame.reactor);
  if (!plant) return `plant:${frame.reactor}`;
  const meta = frame.meta || {};

  // Die szenarioeigene Netzabweichungs-Meldung laesst sich nicht
  // verschicken: ihre Bedingung ist eine Funktion (siehe
  // gridDeviationTrips()). Der Leitstand schickt deshalb ihre beiden Zahlen,
  // und gebaut wird sie hier noch einmal -- ohne das fehlten auf dem Monitor
  // genau die zwei Kacheln, die in einem Lastfolge-Szenario zuerst kommen.
  const extraTrips = meta.gridFail
    ? gridDeviationTrips({ fail: [{ type: 'grid_deviation', ...meta.gridFail }] })
    : [];

  // burnup MUSS schon hier stehen: beta_eff haengt daran und wird nur einmal
  // gebildet (siehe createEngine()) -- ein spaeteres Ueberschreiben des
  // Zustands holt das nicht nach, und die Reaktivitaetsanzeige liefe um
  // Prozente daneben.
  view.engine = createEngine(plant, {
    burnup: frame.state?.burnup,
    T_cw: frame.state?.T_cw,
    n: 1.0, seed: 1, extraTrips,
  });
  // Der frische Motor hat beim Hochfahren selbst ein paar Meldungen erzeugt.
  // Sie gehoeren nicht zu dem Lauf, den dieser Schirm zeigt.
  view.engine.ctx.log = [];
  view.engine.trips.events = [];
  view.lastLogT = -Infinity;

  buildStatusBar();
  // DNBR/CPR ist derselbe Wert, er heisst nur je nach Kern anders.
  setStatusTileLabel('dnbr', t(plant.spec.marginKey || 'val_dnbr'));
  applyStatusSelection(sanitizeStatusKeys(view.prefs.statusBar
    && view.prefs.statusBar[frame.reactor]));

  view.render.clear();
  // helperEnabled ist hier fest aus: die Auftragshilfe bietet einen Knopf an,
  // der Stellteile BEWEGT (siehe runHelper() in game/helper.js). Auf einem
  // Schirm, der nur zusieht, waere das ein Angebot, das nichts bewirkt --
  // sein Ergebnis ueberschreibt das naechste Bild eine halbe Sekunde spaeter.
  view.built = buildPanels(view.engine, view.render, false);
  silence();
  view.run = frame.meta?.run ?? null;
  return null;
}

/**
 * Dieser Schirm bleibt stumm, ohne Ausnahme und ohne Schalter.
 *
 * Bis 0.6.24 spielte er den Ton des Leitstands mit, nach derselben
 * Kontoeinstellung -- gedacht als Hupe im Nebenzimmer. In der Benutzung ist
 * das falsch herum: ein Zweitschirm steht dort, wo gerade NICHT bedient
 * wird, oft im selben Raum wie der Leitstand. Dann hupt es zweimal, um
 * Sekundenbruchteile versetzt, und die zweite Hupe gehoert zu einem Bild,
 * das eine halbe Sekunde alt ist. Wer den Ton will, hat ihn drueben.
 *
 * Keine Einstellung dafuer: eine, die praktisch immer auf "aus" stuende,
 * waere nur eine Zeile mehr im Dialog.
 */
function silence() {
  setMuted(true);
  if (view.built && view.built.horn) view.built.horn.enabled = false;
  if (view.built && view.built.rodSound) view.built.rodSound.setEnabled(false);
}

// ── Bilder uebernehmen ───────────────────────────────────────────────────────

function onFrame(frame) {
  // `?? null` auf BEIDEN Seiten: ein Bild ohne Laufkennung (ein Sender, der
  // sie einmal nicht mitschickt) wuerde sonst bei jedem einzelnen Bild einen
  // Neuaufbau ausloesen -- undefined ist nie gleich null.
  const run = frame.meta?.run ?? null;
  if (run !== view.run || !view.engine) {
    const err = buildFor(frame);
    if (err) { view.error = err; return; }
    // Ab jetzt gibt es etwas zu zeigen: Kacheln und Instrumente sind gefuellt.
    document.body.classList.remove('rs-monitor-waiting');
  }
  const err = applyFrame(frame, view.engine);
  if (err) {
    // Lieber ein stehendes Bild mit ehrlicher Meldung als eines, das mit
    // halb uebernommenen Werten weiterlaeuft.
    view.error = err;
    return;
  }
  view.error = null;

  // Neue Meldungen in den Eingang legen, nicht direkt in die Meldetafel:
  // buildPanels() hat dafuer schon ein Widget, das je Bild engine.drainLog()
  // leert und dabei auch das rollende Protokoll mitfuehrt.
  if (Array.isArray(frame.history)) {
    for (const entry of frame.history) {
      if (!entry || typeof entry.key !== 'string' || !Number.isFinite(entry.t)) continue;
      if (entry.t <= view.lastLogT) continue;
      view.engine.ctx.log.push({ ...entry });
    }
    const last = frame.history[frame.history.length - 1];
    if (last && Number.isFinite(last.t)) view.lastLogT = Math.max(view.lastLogT, last.t);
  }

  // Eigene Trendhistorie, aus den ankommenden Bildern gebaut. Sie kommt
  // bewusst NICHT mit: acht Stunden Historie sind bis zu 28.800 Abtastungen
  // (game/trendHistory.js), und die zweimal je Sekunde zu verschicken waere
  // das Tausendfache des restlichen Bildes. sample() nimmt ohnehin nur eine
  // Abtastung je Simulationssekunde -- bei zwei Bildern je Sekunde entsteht
  // hier also dieselbe Kurve wie drueben, nur ohne die Zeit vor dem
  // Zuschalten dieses Schirms.
  if (view.built) view.built.sampleTrends();
}

// ── Zustand der Leitung ──────────────────────────────────────────────────────

function onStatus(status) { view.status = status; }

/** Alter als Text. Unter einer Minute reichen Sekunden; darueber wird aus
 *  "214 s" eine Zahl, die niemand mehr im Kopf umrechnet. */
function ago(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return num(seconds, seconds < 10 ? 1 : 0) + ' ' + t('unit_seconds');
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')} ${t('unit_minutes')}`;
}

function paintBar() {
  const bar = $('#rs-monitor-bar');
  const { key, sev } = monitorReason({
    state: view.status.state, age: receiver.age(),
    meta: view.status.meta, error: view.error,
  });
  setAttr(bar, 'data-sev', sev);
  setText($('#rs-monitor-msg'), t(key));
  // Das Alter steht IMMER da, auch im guten Fall. Ein Instrument, das sich
  // nicht bewegt, sieht aus wie eine ruhige Anlage -- der einzige Weg, diese
  // beiden Faelle auseinanderzuhalten, ist eine Zahl, die weiterlaeuft.
  setText($('#rs-monitor-age'), t('monitor_age', { age: ago(receiver.age()) }));
}

// ── Start ────────────────────────────────────────────────────────────────────

document.title = `${t('monitor_title')} — ${t('app_title')}`;
// rs-monitor-waiting faellt beim ersten Bild weg (siehe onFrame): bis dahin
// stehen alle Kacheln leer, und leere Instrumente sehen aus wie kaputte.
// Sichtbar ist so lange nur die Zeile oben, und die sagt, worauf gewartet
// wird.
document.body.classList.add('rs-monitor', 'rs-monitor-waiting', 'rs-ctl-locked');
// Der Ton-Hauptschalter gehoert dem Leitstand: main.js verdrahtet ihn, und
// main.js laeuft hier nicht. Er stuende also als toter Knopf da -- und auf
// einem Schirm, der grundsaetzlich stumm ist (siehe silence()), waere er
// ausserdem ein Versprechen, das er nicht halten kann.
for (const btn of document.querySelectorAll('.rs-mute')) btn.remove();
setMuted(true);

// Der Startbanner gehoert dem Leitstand: er wartet auf die erste Nutzergeste,
// weil danach Musik laufen darf (initStart() in main.js). Auf einem Schirm,
// der nur zusieht, wartet er auf eine Geste, die nie kommt -- und liegt per
// z-index ueber allem, auch ueber der Zeile, die erklaeren soll warum. Er
// faellt hier deshalb sofort weg, ohne Ton und ohne Klick.
$('#rs-splash').hidden = true;
// Reaktorauswahl und Reaktorseite genauso: ihre Knoepfe sind auf diesem
// Schirm tot (initStart() laeuft nie), und tote Knoepfe sind schlimmer als
// keine.
$('#rs-start').hidden = true;
$('#rs-reactor').hidden = true;
$('#rs-app').hidden = false;
$('#rs-monitor-bar').hidden = false;
// Dauerhaft, nicht als Merker: es gibt auf diesem Schirm keinen Zustand, in
// dem eine Bedienhandlung durchgreifen duerfte.
setControlsLocked(() => true);

// Taste O: dieselbe Uebersicht wie im Leitstand, aus derselben Datei. Auf
// diesem Schirm ist sie der eigentliche Zweck -- alle Rundinstrumente
// nebeneinander, ohne dass jemand drueben einen Reiter wechseln muss.
const instruments = initInstrumentsWindow(() => !!view.engine);
document.addEventListener('keydown', (ev) => {
  if (ev.target instanceof HTMLInputElement) return;
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
  if (ev.key.toLowerCase() !== 'o') return;
  ev.preventDefault();
  instruments.open();
});

const receiver = new MonitorReceiver(onFrame, onStatus);

// Erst die Einstellungen, dann abholen: die Kopfzeile des Spielers wird beim
// ersten Bild gebaut (buildFor()), und ohne sie stuenden dort die Standard-
// Kacheln statt der gewaehlten -- bis zum naechsten Laufwechsel.
api.readPrefs().then((r) => { if (r.ok && r.data) view.prefs = r.data; })
  .finally(() => receiver.start());

window.setInterval(paintBar, 250);
paintBar();

function frameLoop(now) {
  if (view.engine) {
    try {
      view.render.tick(view.engine.state, now);
    } catch (err) {
      // Ein Fehler im Zeichnen darf die rAF-Kette nicht abreissen -- sonst
      // friert der Schirm lautlos ein, und genau das soll er ja melden.
      view.error = String(err && err.message ? err.message : err);
    }
  }
  requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);
