// Einstieg: Startbildschirm, Aufbau des Leitstands, Verdrahtung der Bedienung.

import { $, $$, el, setText, setAttr } from './ui/dom.js';
import { t, clock } from './ui/i18n.js';
import { Render } from './ui/render.js';
import { buildPanels } from './ui/panels.js';
import { setControlsPaused } from './ui/controls.js';
import { Loop } from './loop.js';
import { createEngine } from './sim/engine.js';
import { getPlant, isAvailable, PLANT_IDS } from './plants/index.js';
import { Session, PHASE } from './game/session.js';
import { gridDeviationTrips } from './game/scenario.js';
import { api } from './net/api.js';
import { pack as packSave, apply as applySave } from './net/persist.js';
import { GLOSSARY } from './ui/glossary.js';
import { SHORTCUTS } from './ui/shortcuts.js';
import { MusicLoop, playClip, setMuted } from './ui/music.js';
import { STATUS_STATS, sanitizeStatusKeys } from './ui/statusStats.js';
import { enableDragReorder } from './ui/dragReorder.js';
import { attachRecorder } from './game/recorder.js';
import { record } from './game/coreActions.js';
import { renderLearning } from './ui/debrief.js';
import { buildTutorial, renderTutorialResult } from './ui/tutorial.js';
import { renderGuidance } from './ui/guidance.js';
import { renderObjectiveResult } from './ui/objectives.js';

// Panel-Buchstaben fuer die Fenster-Tastenkuerzel (siehe initControls():
// Tastatur am Rechner). Ungewandeltes Zeichen statt Kachel-Position, damit
// die Zuordnung unabhaengig von einer per Ziehen geaenderten Statuszeile
// oder Reaktortyp bleibt -- die acht Panels selbst sind immer da, nur ihr
// Inhalt wechselt mit dem Typ (buildPanels()).
const PANEL_KEYS = {
  r: 'rs-p-core', p: 'rs-p-prim', s: 'rs-p-sec', g: 'rs-p-grid',
  a: 'rs-p-mimic', v: 'rs-p-trend', m: 'rs-p-alarm', c: 'rs-p-chem',
};

const app = {
  engine: null,
  loop: null,
  render: new Render(),
  reactor: null,
  controlsReady: false,
  horn: null,
  // Musik: eigene Dauerschleifen fuer Startbildschirm und laufende Runde --
  // introMusic laeuft nur VOR boot(), bgMusic nur WAEHREND, nie beide.
  introMusic: new MusicLoop('game_intro.mp3', 0.4),
  bgMusic: new MusicLoop('game_background_1.mp3', 0.3),
  session: null,
  scenarios: [],
  chosen: null,      // gewaehltes Szenario oder null fuer freies Spiel
  prefs: {},         // gespeicherte Einstellungen des Spielers, siehe /api/prefs
};

// Einmal beim Laden geholt, nicht bei jedem Rundenstart neu: boot() wartet
// darauf, bevor es die Kopfzeile baut, damit die gespeicherte Auswahl schon
// beim allerersten Spiel dieser Sitzung greift. Schlaegt es fehl (kein
// Server, Sitzung abgelaufen), bleibt app.prefs leer -- dieselbe Kopfzeile
// wie eh und je, kein Absturz.
app.prefsPromise = api.readPrefs().then((r) => {
  app.prefs = (r.ok && r.data && typeof r.data === 'object') ? r.data : {};
  applyAudioPrefs();
  return app.prefs;
}).catch(() => app.prefs);

/**
 * Tonzustand aus den Einstellungen herstellen -- die EINZIGE Stelle, die das
 * tut. Vorher stand dieselbe Rechnung dreimal im Code (beim Laden der
 * Einstellungen, beim Speichern im Zahnrad-Dialog, beim Rundenstart fuer die
 * Hupe), und ein vierter Schalter waere ein vierter Ort zum Vergessen
 * gewesen.
 *
 * `muted` ist der Hauptschalter und sticht die Einzelschalter (Hupe, Musik):
 * aus ist aus, ganz gleich was darunter steht. Die Einzelschalter bleiben
 * dabei erhalten, damit sie nach dem Aufdrehen wieder so stehen wie vorher.
 */
function applyAudioPrefs() {
  const a = app.prefs.audio || {};
  const on = (key) => !a.muted && a[key] !== false;
  // Hauptschalter fuer ALLE ueber playClip() abgespielten Klaenge (Schalter-
  // Klick in controls.js, Geigerzaehler-Alarm hier unten) -- die kannten den
  // Mute-Knopf vorher gar nicht, siehe Kommentar in music.js.
  setMuted(!!a.muted);
  app.introMusic.enabled = on('music');
  app.bgMusic.enabled = on('music');
  if (app.horn) app.horn.enabled = on('horn');
  // Kein eigener Schalter im Dialog dafuer -- nur der Hauptschalter sticht,
  // wie bei SCRAM/Kernschmelze (siehe annunciator.js) auch keine eigene Regel.
  if (app.rodSound) app.rodSound.setEnabled(!a.muted);
  if (!on('music')) { app.introMusic.stop(); app.bgMusic.stop(); }
  // Zwei Knoepfe: einer auf dem Startbildschirm, einer in der Kopfzeile des
  // Leitstands. Beide zeigen denselben Zustand.
  const label = t(a.muted ? 'btn_unmute' : 'btn_mute');
  for (const btn of $$('.rs-mute')) {
    setText(btn, a.muted ? '\u{1F507}' : '\u{1F50A}');
    setAttr(btn, 'aria-pressed', a.muted ? 'true' : 'false');
    setAttr(btn, 'title', label);
    setAttr(btn, 'aria-label', label);
  }
}

/** Hauptschalter umlegen -- vom Klick auf einen der beiden .rs-mute-Knoepfe
 *  UND von Strg+M (siehe initStart()) gerufen. */
function toggleMute() {
  app.prefs.audio = { ...(app.prefs.audio || {}), muted: !(app.prefs.audio || {}).muted };
  applyAudioPrefs();
  api.writePrefs(app.prefs);
  if (!app.prefs.audio.muted) {
    (app.session && app.session.phase === PHASE.RUNNING ? app.bgMusic : app.introMusic).start();
  }
}

// ── Startbildschirm ──────────────────────────────────────────────────────────

function initStart() {
  // Startbanner: liegt nur optisch ueber dem Startbildschirm (siehe
  // rs-splash in base.css), der baut sich im Hintergrund unveraendert auf.
  // Klick/Enter/Leertaste blenden es aus -- dieselbe erste-Nutzergeste-Regel
  // wie beim Reaktortyp-Klick gleich danach, deshalb darf hier schon Musik
  // starten (introMusic.start() ist idempotent).
  const splash = $('#rs-splash');
  if (splash) {
    // Logo erscheint erst nach 5s (siehe .rs-splash-logo in base.css), der
    // ROT blinkende Hinweis erst danach zusammen mit ihm -- vorher steht nur
    // das Hintergrundbild da. Ein Klick VOR Ablauf der 5s ueberspringt nur
    // diese Wartezeit (das ist das "beschleunigen"); ein Klick DANACH, wenn
    // beides schon da ist, blendet wie gehabt das ganze Banner aus.
    const logo = splash.querySelector('.rs-splash-logo');
    const hint = splash.querySelector('.rs-splash-hint');
    let appeared = false;
    const showLogo = () => {
      if (appeared) return;
      appeared = true;
      clearTimeout(appearTimer);
      if (logo) logo.classList.add('rs-visible');
      if (hint) hint.classList.add('rs-visible');
    };
    const appearTimer = setTimeout(showLogo, 5000);

    const dismissSplash = () => { splash.hidden = true; app.introMusic.start(); };
    splash.addEventListener('click', () => { appeared ? dismissSplash() : showLogo(); });
    splash.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); dismissSplash(); }
    });
  }

  const cards = $$('.rs-card');
  const go = $('#rs-start-go');

  // Kaltstart-Haekchen dauerhaft merken -- sonst muesste man es bei jedem
  // Besuch neu setzen, obwohl es bei jedem freien Spiel dasselbe sein soll.
  const coldBox = $('#rs-cold-start');
  app.prefsPromise.then((prefs) => { coldBox.checked = !!prefs.coldStart; });
  coldBox.addEventListener('change', () => {
    app.prefs.coldStart = coldBox.checked;
    api.writePrefs(app.prefs);
  });

  // Automatischer Helfer (siehe game/helper.js und panels.js showAlarmHelp):
  // Standard AN, deshalb `!== false` statt `!!` beim Vorbelegen -- ein Spieler,
  // der die Kopfzeile nie angefasst hat, soll den Knopf gleich beim ersten
  // Spiel sehen, nicht erst nach einem bewussten Einschalten.
  const helperBox = $('#rs-helper-toggle');
  app.prefsPromise.then((prefs) => { helperBox.checked = prefs.helper !== false; });
  helperBox.addEventListener('change', () => {
    app.prefs.helper = helperBox.checked;
    api.writePrefs(app.prefs);
  });

  for (const card of cards) {
    const id = card.dataset.reactor;
    card.setAttribute('aria-pressed', 'false');
    if (!isAvailable(id)) {
      // Ausgrauen NUR hier, nie fest im Template: dort blieb die Klasse nach
      // dem Bau von SWR und RBMK stehen, und zwei fertige Reaktortypen sahen
      // monatelang aus wie Vorschau.
      card.disabled = true;
      card.classList.add('rs-card-soon');
      card.title = t('reactor_soon_hint');
      const badge = card.querySelector('.rs-card-badge');
      const soon = document.createElement('span');
      soon.className = 'rs-card-soon-tag';
      soon.textContent = t('reactor_soon');
      if (badge) badge.after(soon); else card.prepend(soon);
    }
    card.addEventListener('click', () => {
      if (!isAvailable(id)) return;
      for (const c of cards) c.setAttribute('aria-pressed', String(c === card));
      // Erste echte Nutzergeste auf dem Startbildschirm -- hier darf Musik
      // ueberhaupt zum ersten Mal loslaufen (start() ist idempotent).
      app.introMusic.start();
      openReactorScreen(id, { push: true });
    });
  }

  $('#rs-reactor-back').addEventListener('click', () => closeReactorScreen({ push: true }));

  // Browser-Zurueck/Vorwaerts auf /reaktor/<typ> <-> / (siehe openReactorScreen()/
  // closeReactorScreen()) -- pushState dort legt genau diese beiden Zustaende
  // an, kein tieferer Verlauf. Waehrend einer laufenden Runde (#rs-app
  // sichtbar) bleibt die URL auf '/' stehen (siehe boot()/toMenu()), ein
  // Zurueck landet also nie mitten in der Simulation.
  window.addEventListener('popstate', () => {
    const m = location.pathname.match(/^\/reaktor\/([a-z0-9]+)$/);
    if (m && isAvailable(m[1])) openReactorScreen(m[1], { push: false });
    else if (!$('#rs-reactor').hidden) closeReactorScreen({ push: false });
  });

  // Direktaufruf/Refresh von /reaktor/<typ> -- siehe reactor_page() in app.py
  // und window.RS_CFG.initialReactor im Template. Ohne Ueberblendung: das ist
  // der allererste Bildaufbau, kein Wechsel von einem sichtbaren Bildschirm.
  if (window.RS_CFG && window.RS_CFG.initialReactor && isAvailable(window.RS_CFG.initialReactor)) {
    $('#rs-start').hidden = true;
    openReactorScreen(window.RS_CFG.initialReactor, { push: false, instant: true });
  }

  go.addEventListener('click', () => {
    if (!app.reactor) return;
    if (app.chosen) loadScenario(app.chosen);
    else boot(app.reactor, null, null, $('#rs-cold-start').checked);
  });

  $('#rs-brief-go').addEventListener('click', () => {
    $('#rs-brief').hidden = true;
    // Waehrend eines laufenden Szenarios ist dieser Knopf ein Schliessen-
    // Knopf (siehe showBriefing()), kein zweiter Start.
    if (app.session && app.session.phase === PHASE.RUNNING) return;
    if (app.briefDef) boot(app.briefDef.reactor, app.briefDef, null, app.briefDef.cold);
  });

  // Ton-Hauptschalter. Der Klick ist zugleich die Nutzergeste, die der
  // Browser fuer Audio verlangt -- wer aufdreht, hoert die Musik sofort und
  // nicht erst nach der naechsten Aktion. Eigene Funktion statt Inline-
  // Callback: Strg+M (siehe initStart() weiter unten) ruft dieselbe Stelle.
  for (const btn of $$('.rs-mute')) {
    btn.addEventListener('click', toggleMute);
  }

  // Zurueck aus der Einweisung, ohne die Schicht anzutreten. Schliesst nur
  // den Dialog -- der Startbildschirm steht ohnehin noch dahinter, samt der
  // getroffenen Szenarienwahl.
  $('#rs-brief-back').addEventListener('click', cancelScenarioLoad);
  $('#rs-start-retry').addEventListener('click', () => {
    const intent = app.scenarioLoad;
    if (intent?.failed) loadScenario(intent.scn, intent.savedMeta);
  });

  $('#rs-debrief-send').addEventListener('click', () => {
    const result = app.pendingResult;
    if (!result || result.tutorial) return;
    if (result.summary.score_mode === 'incident_v1' && !app.engine.recorder) return;
    const session = app.session;
    const nameNode = $('#rs-debrief-name');
    const name = nameNode.value.trim();
    if (!name) { nameNode.focus(); return; }
    try { window.localStorage.setItem('rs-name', name); } catch { /* privates Fenster */ }
    const msg = $('#rs-debrief-msg');
    // Der Punktestand wird bewusst NICHT mitgeschickt -- der Server rechnet ihn
    // aus denselben Kennzahlen selbst nach. Das Protokoll (falls vorhanden --
    // ein geladener Spielstand hat keins, siehe boot()) lässt ihn zusätzlich
    // die Kennzahlen selbst nachrechnen, statt sie nur auf Plausibilität zu
    // prüfen (game/replay.js, verify_run.mjs).
    const log = app.engine.recorder ? app.engine.recorder.serialize() : null;
    api.submitScore(name, result.summary, log).then((r) => {
      if (app.session !== session || app.pendingResult !== result) return;
      if (r.ok) {
        if (r.data?.summary) {
          result.summary = r.data.summary;
          result.score = r.data.score;
          result.parts = r.data.parts;
          if (result.objectives) result.objectives = result.objectives.map(goal => {
            const met = result.summary.objectives.find(v => v.id === goal.id)?.met === true;
            return met === goal.met ? goal : { ...goal, met, held: met ? goal.required : 0, achievedAt: null };
          });
          showDebrief(result, result.summary.failed);
        }
        setText(msg, t('debrief_sent'));
        $('#rs-debrief-submit').hidden = true;
        loadScores(result.summary.reactor, result.summary.scenario);
      } else {
        const why = r.status === 429 ? t('debrief_rate_limited')
          : (r.status === 0 ? t('debrief_offline') : ((r.data && r.data.error) || String(r.status)));
        setText(msg, t('debrief_send_failed', { n: why }));
      }
    });
  });

  $('#rs-debrief-close').addEventListener('click', () => {
    $('#rs-debrief').hidden = true;
    toMenu();
  });

  // Nur das Fenster weg, die Anlage bleibt stehen -- Trends, Meldetafel und
  // Instrumente lassen sich danach in Ruhe ansehen. "Menü" (oben) bleibt der
  // Weg, die Runde wirklich zu verlassen, jederzeit erreichbar.
  $('#rs-debrief-review').addEventListener('click', () => {
    $('#rs-debrief').hidden = true;
  });

  $('#rs-debrief-restart').addEventListener('click', () => {
    $('#rs-debrief').hidden = true;
    restart();
  });

  $('#rs-destroyed-review').addEventListener('click', () => {
    $('#rs-destroyed').hidden = true;
  });

  $('#rs-destroyed-restart').addEventListener('click', () => {
    $('#rs-destroyed').hidden = true;
    restart();
  });

  // Szenarienliste: einmal fuer die ganze Sitzung. Geht sie schief, bleibt
  // das freie Spiel spielbar -- das Spiel muss ohne den Server auskommen, er
  // liefert hier nur Listen.
  app.scenariosPromise = fetch('/api/meta', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => { if (m && m.scenarios) app.scenarios = m.scenarios; })
    .catch(() => {});

  // Abfrage vor Strg+X (siehe Tastatur weiter unten) -- der Menü-Knopf selbst
  // fragt nicht extra nach, ein Fingertipper auf einen extra beschrifteten
  // Knopf gilt schon als Absicht; ein Tastenkuerzel dagegen laden.
  const confirmMenu = $('#rs-confirm-menu');
  $('#rs-confirm-menu-yes').addEventListener('click', () => { confirmMenu.hidden = true; leaveToMenu(); });
  $('#rs-confirm-menu-no').addEventListener('click', () => { confirmMenu.hidden = true; });
  confirmMenu.addEventListener('click', (ev) => { if (ev.target === confirmMenu) confirmMenu.hidden = true; });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !confirmMenu.hidden) confirmMenu.hidden = true;
  });

  // Globale Tastenkuerzel, unabhaengig vom Rundenstatus -- deshalb hier statt
  // in initControls() (Leertaste/1-4/Strg+Pfeiltasten dort, siehe dort):
  // Strg+M soll schon auf dem Startbildschirm wirken, die anderen drei laufen
  // ohnehin ins Leere, solange app.engine noch nicht existiert.
  //
  // Strg+Z haelt fest: erst nach einer vollen Sekunde ausgehaltenem Druck
  // loest SCRAM aus (scramHoldTimer), nicht schon beim Antippen -- ein
  // Fingertipper auf die falsche Taste darf die Anlage nicht abwerfen, genau
  // wie beim zweistufigen Knopf (siehe initControls()). Blinkt waehrenddessen
  // ueber dasselbe data-armed-Attribut wie der Knopf (siehe base.css).
  let scramHoldTimer = 0;
  const cancelScramHold = () => {
    if (!scramHoldTimer) return;
    window.clearTimeout(scramHoldTimer);
    scramHoldTimer = 0;
    $('#rs-scram').dataset.armed = '0';
  };
  document.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement) return;
    if (!ev.ctrlKey) return;
    const key = ev.key.toLowerCase();
    if (key === 'm') {
      ev.preventDefault();
      toggleMute();
    } else if (key === 's') {
      ev.preventDefault();
      if (!app.engine) return;
      openSaveSlots();
    } else if (key === 'x') {
      ev.preventDefault();
      if (!app.engine) return;
      confirmMenu.hidden = false;
    } else if (key === 'z') {
      ev.preventDefault();
      if (ev.repeat || scramHoldTimer || !app.engine) return;
      if (app.horn) app.horn.unlock();
      $('#rs-scram').dataset.armed = '1';
      scramHoldTimer = window.setTimeout(() => {
        scramHoldTimer = 0;
        $('#rs-scram').dataset.armed = '0';
        triggerScram();
      }, 1000);
    }
  });
  document.addEventListener('keyup', (ev) => {
    if (ev.key === 'Control' || ev.key.toLowerCase() === 'z') cancelScramHold();
  });

  refreshResumeList();
}

// Slot-Schema der zehn Handplaetze (siehe manualSlotName()) -- erkennt, ob
// ein "manual-"-Stand aus dem neuen Auswahldialog kommt (dann zeigt die
// Fortsetzen-Zeile die Slot-Nummer statt nur "manuell gespeichert"). Aeltere
// manuelle Staende aus der Zeit vor CHANGELOG 0.1.1 (Slotname trug noch die
// Szenario-ID statt einer Nummer) matchen hier nicht und fallen auf die
// alte, generische Beschriftung zurueck -- sie bleiben ganz normal ladbar
// und loeschbar, nur eben ohne Slot-Nummer in der Anzeige.
const MANUAL_SLOT_RE = /^manual-[a-z0-9]+-slot(\d+)$/;

/** Fortsetzen-Zeilen der Reaktor-Detailseite (#rs-reactor-resume, siehe
 *  index.html) neu vom Server holen -- nicht nur beim allerersten Laden:
 *  ein Spielstand von eben (Knopf "Speichern") oder ein geloeschter muss
 *  beim naechsten Blick auf die Seite stimmen, siehe toMenu(). Zeigt nur
 *  die Staende DES GERADE OFFENEN Typs (app.reactor) -- die Uebersicht
 *  selbst listet keine Staende mehr, das war die einzige Stelle dafuer.
 *  Collapsed per Default (die Zusammenfassung nennt nur die Anzahl) -- bei
 *  bis zu zehn Handplaetzen plus Autospeicherung waere die Seite sonst
 *  schnell voller Text als Inhalt. Der Szenariotitel braucht die einmalig
 *  geholte Szenarienliste, sonst zeigt der Hinweis nur die rohe ID. */
function refreshResumeList() {
  const detailDetails = $('#rs-reactor-resume');
  const detailSummary = $('#rs-reactor-resume-summary');
  const detailBody = $('#rs-reactor-resume-body');
  if (!detailBody) return;
  Promise.all([app.scenariosPromise, api.listSaves()]).then(([, r]) => {
    const saves = (r.ok && r.data && r.data.saves) || [];
    // Ein Slot je Reaktortyp ("auto-<typ>"), nicht mehr der eine gemeinsame
    // "auto"-Slot von vorher -- ein Stand beim DWR ueberschreibt seither
    // keinen beim SWR mehr. Aeltere Spielstaende aus der Zeit davor (Slot
    // "auto") tauchen hier nicht mehr auf. Seit 0.0.80 zusaetzlich "manual-":
    // der Speichern-Knopf hat seinen eigenen Slot, den die Autospeicherung
    // nie anfasst (siehe saveSlotName()) -- beide stehen hier nebeneinander,
    // an der Beschriftung unterscheidbar. Neuester Stand zuerst statt
    // Server-Reihenfolge (die sortiert nur nach Dateiname, "slot10" liefe
    // dabei alphabetisch VOR "slot2"). Nur der Typ der offenen Seite -- die
    // anderen sieht man wieder, sobald man deren Reaktor oeffnet.
    const autos = saves
      .filter((x) => x.slot && x.reactor === app.reactor
        && (x.slot.startsWith('auto-') || x.slot.startsWith('manual-')))
      .sort((a, b) => b.saved_at - a.saved_at);
    detailBody.replaceChildren();
    for (const sv of autos) {
      const scn = sv.scenario && app.scenarios.find((x) => x.id === sv.scenario);
      const slotMatch = sv.slot.match(MANUAL_SLOT_RE);
      const labelKey = slotMatch ? 'btn_resume_named_slot'
        : (sv.slot.startsWith('manual-') ? 'btn_resume_named_manual' : 'btn_resume_named');
      const btn = el('button.rs-btn.rs-btn-sm', { type: 'button' }, [t(labelKey, {
        reactor: t('reactor_' + sv.reactor),
        n: slotMatch ? slotMatch[1] : '',
        scenario: sv.scenario ? t(scn ? scn.title_key : 'scn_unknown') : t('scn_free'),
        when: new Date(sv.saved_at * 1000).toLocaleString(),
      })]);
      // sv.reactor === app.reactor steht schon durch den Filter oben fest,
      // disabled bleibt trotzdem als Absicherung fuer einen Typ, der spaeter
      // aus PLANTS verschwindet, ohne dass alte Staende geloescht wurden.
      btn.disabled = !isAvailable(sv.reactor);
      // Ein Szenario-Stand muss beim Fortsetzen wieder MIT seiner
      // Szenario-Definition booten (Bedarfskurve, Ereignisse, Wertung) --
      // vorher stand hier immer "boot(sv.reactor, null, sv.slot)", also
      // free=true fuer jeden Stand, auch fuer einen, der aus einem Szenario
      // kam. Derselbe Fetch wie in loadScenario() oben, nur ohne Einweisung
      // dazwischen: wer fortsetzt, hat sie schon gesehen.
      btn.addEventListener('click', () => {
        if (!sv.scenario) { boot(sv.reactor, null, sv.slot, false, sv); return; }
        const scn2 = app.scenarios.find((x) => x.id === sv.scenario)
          || { id: sv.scenario, reactor: sv.reactor };
        loadScenario(scn2, sv);
      });
      detailBody.append(el('div.rs-resume-row', null, [btn, makeDeleteSaveButton(sv.slot)]));
    }
    if (detailDetails) {
      const n = detailBody.childElementCount;
      detailDetails.hidden = !n;
      if (detailSummary) setText(detailSummary, t('resume_summary', { n }));
    }
  });
}

/** Löschen mit Sicherung wie beim SCRAM: erster Klick bewaffnet nur, der
 *  zweite (binnen 4s) löscht wirklich -- kein Modal fuer eine Aktion, die
 *  sich durchs blosse Weiterspielen jederzeit neu erzeugen liesse.
 *  `onDone` faellt auf refreshResumeList() zurueck (Reaktor-Detailseite),
 *  der Speichern-Dialog (openSaveSlots()) uebergibt stattdessen sich selbst
 *  neu -- sonst zeigte er nach dem Loeschen weiter den alten Stand an, bis
 *  man ihn schliesst und neu oeffnet. */
function makeDeleteSaveButton(slot, onDone = refreshResumeList) {
  const btn = el('button.rs-btn.rs-btn-ghost.rs-btn-sm', { type: 'button' }, [t('btn_delete')]);
  let armed = 0;
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = window.setTimeout(() => { armed = 0; setText(btn, t('btn_delete')); }, 4000);
      setText(btn, t('btn_confirm_delete'));
      return;
    }
    window.clearTimeout(armed);
    api.deleteSave(slot).then(() => onDone());
  });
  return btn;
}

/** Ueberblendung zwischen Uebersicht und Reaktorseite (siehe .rs-fade in
 *  base.css) -- eine Sekunde Opacity-Crossfade, `instant` ueberspringt sie
 *  fuer den allerersten Bildaufbau bei Direktaufruf von /reaktor/<typ>. */
// Merkt sich den Timer der zuletzt LAUFENDEN Ueberblendung -- ein zweiter
// Klick (z.B. Reaktor -> Zurueck -> denselben Reaktor wieder, alles
// innerhalb der einen Sekunde Fade) darf den alten Timer nicht einfach
// weiterlaufen lassen. Der hat sein eigenes hideEl noch vom VORIGEN Aufruf
// im Kopf und wuerde eine Sekunde spaeter genau den Bildschirm wegnehmen,
// den der neue Aufruf gerade erst wieder eingeblendet hat -- Ergebnis: nach
// der zweiten Fahrt auf denselben Reaktor blieben #rs-start UND #rs-reactor
// beide hidden, ein leeres/schwarzes Fenster ohne jeden sichtbaren Inhalt.
let fadeTimer = 0;

function fadeScreens(hideEl, showEl, instant = false) {
  window.clearTimeout(fadeTimer);
  fadeTimer = 0;
  if (instant) {
    hideEl.hidden = true;
    hideEl.classList.remove('rs-fade');
    showEl.hidden = false;
    showEl.classList.remove('rs-fade');
    return;
  }
  showEl.hidden = false;
  showEl.classList.add('rs-fade');
  // Erzwingt einen Reflow, bevor die Klasse wieder runtergeht -- sonst sieht
  // der Browser opacity 0 und opacity 1 als eine einzige Zuweisung ohne
  // Uebergang dazwischen (die Klasse kam gerade erst dazu, noch kein Layout
  // seither).
  void showEl.offsetWidth;
  hideEl.classList.add('rs-fade');
  showEl.classList.remove('rs-fade');
  fadeTimer = window.setTimeout(() => {
    fadeTimer = 0;
    hideEl.hidden = true;
    hideEl.classList.remove('rs-fade');
  }, 1000);
}

/** Kopf + Hintergrund der Reaktorseite fuellen -- Kurztext (Karte) und
 *  Langtext (Seite) sind zwei verschiedene Uebersetzungsschluessel, siehe
 *  reactor_<typ>_desc_long in den locales. */
function fillReactorScreen(id) {
  const badge = $('#rs-reactor-badge');
  badge.className = 'rs-card-badge rs-card-badge-' + id;
  setText(badge, t('reactor_' + id + '_short'));
  setText($('#rs-reactor-title'), t('reactor_' + id));
  setText($('#rs-reactor-tag'), t('reactor_' + id + '_tag'));
  setText($('#rs-reactor-desc'), t('reactor_' + id + '_desc_long'));
  const screen = $('#rs-reactor');
  for (const pid of PLANT_IDS) screen.classList.remove('rs-reactor-bg-' + pid);
  screen.classList.add('rs-reactor-bg-' + id);
}

/** Klick auf eine Karte der Uebersicht UND Browser-Vor/Zurueck (siehe
 *  popstate-Listener in initStart()) rufen dieselbe Stelle. `push` legt eine
 *  neue Verlaufsstation an -- beim Zurueckkommen per popstate steht die URL
 *  schon richtig, ein zweites pushState wuerde den Verlauf verdoppeln. */
function openReactorScreen(id, { push = false, instant = false } = {}) {
  if (!isAvailable(id)) return;
  app.reactor = id;
  $('#rs-start-go').disabled = false;
  fillReactorScreen(id);
  renderScenarios(id);
  refreshResumeList();
  if (push) history.pushState({ reactor: id }, '', '/reaktor/' + id);
  fadeScreens($('#rs-start'), $('#rs-reactor'), instant);
}

/** Zurueck-Knopf UND popstate (URL wieder auf '/') rufen dieselbe Stelle. */
function closeReactorScreen({ push = false } = {}) {
  if (push) history.pushState({}, '', '/');
  fadeScreens($('#rs-reactor'), $('#rs-start'));
}

/** Szenarienkarten fuer den gewaehlten Reaktortyp. */
function renderScenarios(reactorId) {
  cancelScenarioLoad();
  const list = $('#rs-scn-list');
  const headline = $('#rs-scn-headline');
  const go = $('#rs-start-go');
  const mine = app.scenarios.filter((x) => x.reactor === reactorId)
    .sort((a, b) => Number(!!b.tutorial) - Number(!!a.tutorial) || a.difficulty - b.difficulty);

  app.chosen = null;
  setText(go, t('start_free_play'));
  list.replaceChildren();
  headline.hidden = mine.length === 0;
  if (!mine.length) return;

  const entries = [{ id: null, title_key: 'scn_free', brief_key: 'scn_free_desc' }, ...mine];
  const buttons = [];
  for (const scn of entries) {
    const meta = scn.id
      ? `${t('brief_duration')} ${Math.round(scn.duration_s / 60)} min · `
        + `${t('brief_difficulty')} ${'\u2605'.repeat(scn.difficulty)}`
        + (scn.guidance ? ` / ${t('scn_level_' + scn.difficulty)}` : '')
      : t('scn_free_desc');
    const btn = el('button.rs-scn', { type: 'button', 'aria-pressed': String(scn.id === null) }, [
      el('span.rs-scn-name', { text: t(scn.title_key) }),
      el('span.rs-scn-meta', { text: meta }),
    ]);
    btn.addEventListener('click', () => {
      cancelScenarioLoad();
      app.chosen = scn.id ? scn : null;
      for (const b of buttons) b.setAttribute('aria-pressed', String(b === btn));
      setText(go, scn.id ? t('brief_title') : t('start_free_play'));
    });
    buttons.push(btn);
    list.append(btn);
  }
}

/** Einweisung fuellen und zeigen -- vor Rundenstart wie waehrend der Runde. */
function showBriefing(def) {
  setText($('#rs-brief-title'), t(def.title_key));
  setText($('#rs-brief-text'), t(def.brief_key));
  const meta = $('#rs-brief-meta');
  const tags = [
    el('span', { text: `${t('brief_duration')}: ${Math.round(def.duration_s / 60)} min` }),
    el('span', { text: `${t('brief_difficulty')}: ${'\u2605'.repeat(def.difficulty || 1)}` }),
  ];
  if (def.cold) tags.push(el('span', { text: t('brief_cold') }));
  meta.replaceChildren(...tags);
  // Waehrend einer laufenden Runde ist der Knopf ein Schliessen-Knopf, kein
  // zweiter Rundenstart (siehe #rs-brief-go-Handler).
  const running = app.session && app.session.phase === PHASE.RUNNING;
  setText($('#rs-brief-go'), running ? t('btn_close') : t('brief_start'));
  // Waehrend der Runde ist "Los" bereits der Schliessen-Knopf -- ein zweiter
  // daneben waere sinnlos.
  $('#rs-brief-back').hidden = running;
  $('#rs-brief').hidden = false;
  renderGuidance($('#rs-brief-guidance'), def, null, {
    objectives: running && app.session.scenario?.id === def.id ? app.session.objectives : null,
  });
  $('#rs-brief .rs-modal-box').scrollTop = 0;
}

function cancelScenarioLoad() {
  // Selection changes also invalidate a save fetch already waiting inside boot().
  app.bootId = (app.bootId || 0) + 1;
  app.scenarioLoad = null;
  app.briefDef = null;
  $('#rs-start-retry').hidden = true;
  $('#rs-brief').hidden = true;
  setText($('#rs-start-message'), '');
  setAttr($('#rs-start-message'), 'data-error', 'false');
}

/** The same immutable load intent drives a new briefing and a saved scenario. */
async function loadScenario(scn, savedMeta = null) {
  cancelScenarioLoad();
  const intent = { scn: { ...scn }, savedMeta: savedMeta ? { ...savedMeta } : null,
    bootId: app.bootId, failed: false };
  app.scenarioLoad = intent;
  const current = () => app.scenarioLoad === intent && app.bootId === intent.bootId;
  const retry = $('#rs-start-retry');
  retry.disabled = true;
  setText($('#rs-start-message'), t('scenario_loading'));
  let errorKey = 'scenario_load_failed';
  try {
    let meta = intent.scn;
    if (!meta.file) {
      const response = await api.meta();
      if (!current()) return;
      if (!response.ok || !Array.isArray(response.data?.scenarios)) throw new Error('metadata');
      app.scenarios = response.data.scenarios;
      meta = app.scenarios.find(x => x.id === intent.scn.id && x.reactor === intent.scn.reactor);
      if (!meta?.file) { errorKey = 'scenario_unavailable'; throw new Error('missing'); }
    }
    const base = window.RS_CFG ? `/s/${window.RS_CFG.version}` : '';
    const response = await fetch(`${base}/data/scenarios/${encodeURIComponent(meta.file)}`);
    if (!current()) return;
    if (!response.ok) throw new Error('http');
    const def = await response.json();
    if (!current()) return;
    const goalTypes = def?.reactor === 'pwr'
      ? ['pwr_feedwater', 'pwr_heat_removal', 'pwr_power_limited']
      : def?.reactor === 'rbmk' ? ['rbmk_inventory', 'rbmk_heat_removal'] : [];
    if (!def || def.id !== intent.scn.id || def.reactor !== intent.scn.reactor
      || (intent.savedMeta && (def.id !== intent.savedMeta.scenario || def.reactor !== intent.savedMeta.reactor))
      || typeof def.title_key !== 'string' || typeof def.brief_key !== 'string'
      || !Number.isFinite(def.duration_s) || def.duration_s <= 0
      || !Array.isArray(def.demand) || !def.demand.every(p => p && Number.isFinite(p.t) && Number.isFinite(p.mw))
      || !Array.isArray(def.events || []) || !(def.events || []).every(e => e && typeof e.id === 'string')
      || !Array.isArray(def.fail || []) || !(def.fail || []).every(f => f && typeof f.type === 'string')
      || (def.preparation !== undefined && (def.preparation !== 'rbmk_post_az5_v1'
        || def.reactor !== 'rbmk' || def.cold || def.score_mode !== 'incident_v1'))
      || (def.score_mode && (def.score_mode !== 'incident_v1' || !Array.isArray(def.objectives)
        || def.objectives.length !== 2 || !def.objectives.every(goal => goal && typeof goal.id === 'string'
          && goalTypes.includes(goal.type)
          && Number.isFinite(goal.hold_s) && goal.hold_s > 0 && Array.isArray(goal.after_events)
          && goal.after_events.length > 0
          && (goal.max_power_fraction === undefined || (Number.isFinite(goal.max_power_fraction)
            && goal.max_power_fraction >= 0 && goal.max_power_fraction <= 1))
          && goal.after_events.every(id => (def.events || []).some(e => e.id === id)))
        || new Set(def.objectives.map(goal => goal.id)).size !== 2))) {
      throw new Error('definition');
    }
    setText($('#rs-start-message'), '');
    if (intent.savedMeta) {
      await boot(def.reactor, def, intent.savedMeta.slot, false, intent.savedMeta);
    } else {
      app.briefDef = def;
      showBriefing(def);
    }
  } catch {
    if (!current()) return;
    intent.failed = true;
    app.briefDef = null;
    setText($('#rs-start-message'), t(errorKey));
    setAttr($('#rs-start-message'), 'data-error', 'true');
    retry.disabled = false;
    retry.hidden = false;
  }
}

// ── Leitstand ────────────────────────────────────────────────────────────────

function initControls() {
  // Nur einmal verdrahten: über „Menü" kommt man zurück auf den Startbildschirm
  // und von dort erneut hierher -- ein zweiter Satz Zuhörer würde jeden Klick
  // doppelt auslösen.
  if (app.controlsReady) return;
  app.controlsReady = true;

  for (const btn of $$('.rs-speed-b')) {
    btn.addEventListener('click', () => {
      setSpeed(Number(btn.dataset.speed));
    });
  }

  // Schnellabschaltung in zwei Schritten. Ein versehentlicher Fingertipper auf
  // dem Handy darf keine Anlage abwerfen.
  const scram = $('#rs-scram');
  let armed = 0;
  const disarm = () => {
    if (armed) window.clearTimeout(armed);
    armed = 0;
    scram.dataset.armed = '0';
    setText(scram, scramLabel());
  };
  scram.addEventListener('click', () => {
    if (app.horn) app.horn.unlock();
    if (!armed) {
      armed = window.setTimeout(disarm, 4000);
      scram.dataset.armed = '1';
      setText(scram, t('btn_confirm'));
      return;
    }
    disarm();
    triggerScram();
  });

  $('#rs-menu').addEventListener('click', leaveToMenu);

  $('#rs-fault-reload').addEventListener('click', () => window.location.reload());

  // Grundlagen-Glossar: einmal aus GLOSSARY gebaut, danach nur ein-/
  // ausgeblendet. Kein Tutorial mit Pflichtschritten -- ein Nachschlagewerk,
  // das jederzeit erreichbar ist, für wen die Meldetafel-Hilfe allein nicht
  // reicht.
  const glossaryModal = $('#rs-glossary-modal');
  $('#rs-glossary-list').replaceChildren(...GLOSSARY.flatMap((e) => [
    el('dt', { text: t(e.term) }),
    el('dd', { text: t(e.def) }),
  ]));
  $('#rs-glossary').addEventListener('click', () => { glossaryModal.hidden = false; });
  $('#rs-glossary-close').addEventListener('click', () => { glossaryModal.hidden = true; });
  glossaryModal.addEventListener('click', (ev) => { if (ev.target === glossaryModal) glossaryModal.hidden = true; });

  // Tutorial-Anleitung: der Oeffnen-Knopf steckt in der pro Runde neu
  // gebauten Statusleiste (tutorial.js), Schliessen/Hintergrundklick sind
  // wie beim Glossar hier fest verdrahtet -- die Modalhuelle selbst ist
  // statisches Markup, nicht Teil von buildTutorial().
  const tutorialModal = $('#rs-tutorial-modal');
  $('#rs-tutorial-modal-close').addEventListener('click', () => { tutorialModal.hidden = true; });
  tutorialModal.addEventListener('click', (ev) => { if (ev.target === tutorialModal) tutorialModal.hidden = true; });

  // Tastenkuerzel-Hilfe: statische Liste, einmal aus SHORTCUTS gebaut, wie
  // beim Glossar oben.
  const shortcutsModal = $('#rs-shortcuts-modal');
  $('#rs-shortcuts-list').replaceChildren(...SHORTCUTS.flatMap((e) => [
    el('dt', { text: t(e.key) }),
    el('dd', { text: t(e.def) }),
  ]));
  $('#rs-shortcuts').addEventListener('click', () => { shortcutsModal.hidden = false; });
  $('#rs-shortcuts-close').addEventListener('click', () => { shortcutsModal.hidden = true; });
  shortcutsModal.addEventListener('click', (ev) => { if (ev.target === shortcutsModal) shortcutsModal.hidden = true; });

  // Einweisung waehrend der Runde erneut ansehen -- Knopf ist nur sichtbar,
  // wenn eine Einweisung existiert (siehe boot(), #rs-briefing-btn.hidden).
  // Escape/Klick auf den Hintergrund schliessen sie hier zusaetzlich; vor
  // Rundenstart (app.session existiert noch nicht) bleibt das Verhalten
  // unveraendert, keiner der beiden Zuhoerer greift dann.
  const briefModal = $('#rs-brief');
  $('#rs-briefing-btn').addEventListener('click', () => {
    if (app.briefDef) showBriefing(app.briefDef);
  });
  briefModal.addEventListener('click', (ev) => {
    if (ev.target === briefModal && app.session && app.session.phase === PHASE.RUNNING) briefModal.hidden = true;
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !briefModal.hidden && app.session && app.session.phase === PHASE.RUNNING) {
      briefModal.hidden = true;
    }
  });

  // Kachel als Fenster: Klick auf die Kopfzeile hebt den echten
  // rs-panel-body-Knoten ins Fenster -- verschoben, nicht geklont, also
  // bleiben data-v-Ziele, Knöpfe und IDs eindeutig. Das gewohnte Scrollen im
  // Raster bleibt unverändert, das Fenster ist nur eine zweite Sicht obendrauf.
  // Auf dem Handy zeigt der Reiter das Panel schon voll -- dort bleibt der
  // Klick wirkungslos.
  const panelWindow = $('#rs-panel-window');
  const panelWindowBox = $('.rs-modal-box', panelWindow);
  const panelWindowSlot = $('#rs-panel-window-slot');
  const panelWindowTitle = $('#rs-panel-window-title');
  const panelWindowClose = $('#rs-panel-window-close');
  const desktopMQ = matchMedia('(min-width: 1024px)');
  let openPanel = null; // { section, body, placeholder, actions, actionsPlaceholder }

  const closePanelWindow = () => {
    if (!openPanel) return;
    openPanel.section.insertBefore(openPanel.body, openPanel.placeholder);
    openPanel.placeholder.remove();
    // Kopfzeilen-Knoepfe (Quittieren/Rückstellen bei der Meldetafel) zurueck
    // an ihren Platz im Kachel-Kopf -- nur verschoben, nicht geklont, siehe
    // openPanelWindow() unten, sonst blieben sie doppelt oder gar nicht mehr
    // verdrahtet.
    if (openPanel.actions) {
      openPanel.actionsPlaceholder.replaceWith(openPanel.actions);
    }
    openPanel = null;
    panelWindow.hidden = true;
    panelWindowSlot.replaceChildren();
  };

  const openPanelWindow = (section) => {
    if (!desktopMQ.matches) return;
    if (openPanel) closePanelWindow();
    // Die Instrumentenuebersicht (siehe unten) zieht sich einzelne Knoten
    // (Gauges, Stellteile) aus genau diesem .rs-panel-body -- gleichzeitig
    // offen wanderte die ganze Kachel mitsamt Luecken dorthin, wo die
    // Uebersicht sie sich schon geholt hat. Erst schliessen, dann sauber neu
    // aufbauen.
    if (openInstruments) closeInstrumentsWindow();
    const body = $('.rs-panel-body', section);
    if (!body) return;
    const placeholder = document.createComment('rs-panel-window-slot');
    section.insertBefore(placeholder, body);
    panelWindowSlot.append(body);
    // Eigene Bedienknöpfe im Kachel-Kopf (bisher nur die Meldetafel:
    // Quittieren/Rückstellen) müssen mit ins Fenster -- sonst blieben sie im
    // Ursprungsplatz zurück, während Meldeliste und Protokoll schon im
    // Fenster stehen, und liessen sich von dort aus nicht mehr bedienen.
    const actions = $('.rs-panel-h-actions', section);
    let actionsPlaceholder = null;
    if (actions) {
      actionsPlaceholder = document.createComment('rs-panel-h-actions-slot');
      actions.replaceWith(actionsPlaceholder);
      panelWindowClose.before(actions);
    }
    openPanel = { section, body, placeholder, actions, actionsPlaceholder };
    // .rs-panel-flush nimmt der Kachel ihr Innenpolster -- die Klasse muss mit
    // ins Fenster wandern, sonst bekommt z.B. das Fließbild plötzlich Rand.
    panelWindowBox.classList.toggle('rs-panel-flush', section.classList.contains('rs-panel-flush'));
    let title = '';
    for (const n of $('.rs-panel-h', section).childNodes) {
      if (n.nodeType === Node.TEXT_NODE) title += n.textContent;
    }
    setText(panelWindowTitle, title.trim());
    panelWindow.hidden = false;
  };

  for (const h of $$('.rs-panel-h')) {
    h.setAttribute('title', t('hint_panel_window'));
    h.addEventListener('click', (ev) => {
      if (ev.target.closest('.rs-panel-h-actions')) return;
      openPanelWindow(h.closest('.rs-panel'));
    });
  }
  $('#rs-panel-window-close').addEventListener('click', closePanelWindow);
  panelWindow.addEventListener('click', (ev) => { if (ev.target === panelWindow) closePanelWindow(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !panelWindow.hidden) closePanelWindow();
  });

  // Instrumentenübersicht (Taste O): buendelt die Rundinstrumente
  // (#rs-*-gauges) und alle Stellteile (Staebe, Pumpen, Speisewasser,
  // Sicherheitssysteme, Bor, Netz) aus allen acht Reitern auf einer
  // Flaeche. Dieselbe Verschieben-statt-Kopieren-Regel wie bei
  // openPanelWindow() oben -- jede Karte hier ist der echte Knoten aus
  // seinem Reiter (Wertebindungen aus buildPanels() laufen genau EINMAL
  // gegen diese Knoten, ein Klon liefe stumm mit toten Anzeigen). Anders
  // als openPanelWindow() bewusst NICHT auf Desktop beschraenkt: auf dem
  // Handy zeigt sonst kein Reiter mehrere Kacheln gleichzeitig, dort ist
  // die Buendelung sogar der einzige Weg, Staebe und Pumpen ohne Wechseln
  // nebeneinander zu sehen.
  const instrumentsModal = $('#rs-instruments-modal');
  const instrumentsGrid = $('#rs-instruments-grid');
  // Nur die Gruppen-Optik (Kopfzeile, Innenabstand) wiederverwenden, siehe
  // .rs-group > h3 in panels.css -- eigene Ueberschrift statt der echten
  // <h3> aus dem Reiter, weil mehrere Ziele (Stab-Bedienung, Speisewasser,
  // Sicherheitssysteme) ihre Ueberschrift mit Messwertzeilen teilen, die
  // hier NICHT mitkommen (nur Rundinstrumente + Stellteile, keine reinen
  // Zahlenzeilen, siehe Aufgabenstellung).
  const INSTRUMENT_SECTIONS = [
    [['rs-core-gauges'], 'panel_core'],
    [['rs-prim-gauges'], 'panel_primary'],
    [['rs-sec-gauges'], 'panel_secondary'],
    // Die Stabstellung (rs-rods, dieselben Balken wie im Reiter, inklusive
    // ihrer eigenen %-Anzeige je Bank aus bar() in gauges.js) gehoert mit in
    // dieselbe Karte wie die Stab-Bedienung -- ohne sie liesse sich "Ziehen"/
    // "Einfahren" nur blind bedienen.
    [['rs-rods', 'rs-rod-ctl'], 'panel_core_rods'],
    [['rs-pumps'], 'panel_primary_pumps'],
    [['rs-sec-ctl'], 'panel_secondary_feed'],
    [['rs-safety-ctl'], 'panel_safety'],
    [['rs-chem-ctl'], 'panel_chemistry'],
    [['rs-grid-ctl'], 'panel_grid'],
  ];
  let openInstruments = null; // Array aus { node, placeholder } waehrend das Fenster offen ist

  const closeInstrumentsWindow = () => {
    if (!openInstruments) return;
    for (const { node, placeholder } of openInstruments) placeholder.replaceWith(node);
    openInstruments = null;
    instrumentsModal.hidden = true;
    instrumentsGrid.replaceChildren();
  };

  const openInstrumentsWindow = () => {
    // Zweiter Druck auf O schliesst wieder -- ohne Maus die einzige
    // Rueckmeldung darauf, dass die Taste ueberhaupt etwas tut.
    if (openInstruments) { closeInstrumentsWindow(); return; }
    // Vor dem ersten Rundenstart stehen die Zielknoten leer (buildPanels()
    // hat sie noch nie gefuellt) -- ein leeres Fenster waere nur verwirrend.
    if (!app.engine) return;
    if (!panelWindow.hidden) closePanelWindow();
    openInstruments = [];
    for (const [ids, labelKey] of INSTRUMENT_SECTIONS) {
      // Nicht jeder Typ fuellt jedes Stellteil: RBMK/SWR kennen keine Bor-
      // dosierung (#rs-chem-ctl bleibt leer), der DWR keine Sicherheits-
      // systeme unter #rs-safety-ctl (siehe hooks.uiControls() je Typ in
      // plants/*.js, mount-Namen). Ein leerer Knoten kommt gar nicht erst
      // mit -- eine Karte ganz ohne Inhalt (alle Knoten leer) faellt danach
      // aus wie bisher.
      const nodes = ids.map((id) => $('#' + id)).filter((n) => n && n.childElementCount);
      if (!nodes.length) continue;
      for (const node of nodes) {
        const placeholder = document.createComment('rs-instruments-slot');
        node.before(placeholder);
        openInstruments.push({ node, placeholder });
      }
      instrumentsGrid.append(el('div.rs-group.rs-instruments-section', null, [
        el('h3', { text: t(labelKey) }),
        ...nodes,
      ]));
    }
    instrumentsModal.hidden = false;
  };

  $('#rs-instruments-close').addEventListener('click', closeInstrumentsWindow);
  instrumentsModal.addEventListener('click', (ev) => { if (ev.target === instrumentsModal) closeInstrumentsWindow(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !instrumentsModal.hidden) closeInstrumentsWindow();
  });

  // Kopfzeile anpassen: Checkboxen aus dem Katalog, vorbelegt mit der
  // gespeicherten (oder Standard-) Auswahl fuer den GERADE LAUFENDEN
  // Reaktortyp. Speichern schreibt die Zeile fuer diesen Typ zurueck UND
  // knipst sofort die passenden Kacheln sichtbar -- applyStatusSelection()
  // ersetzt dabei keine Knoten, nur hidden/Reihenfolge, deshalb bleibt
  // panels.js' Wertebindung gueltig und die Aenderung ist sofort sichtbar,
  // ganz ohne Rundenneustart.
  const statsModal = $('#rs-stats-modal');
  const statsList = $('#rs-stats-list');
  // 'dnbr' braucht eine eigene Textstelle statt eines rohen Textknotens: der
  // Abstand zur Siedekrise heisst je nach Kern anders (DNBR beim
  // Druckwasserreaktor, CPR bei den beiden siedenden -- siehe panels.js,
  // sp.marginKey), und diese Liste wird nur EINMAL gebaut (initControls()
  // laeuft nur beim ersten Rundenstart). Ohne Nachfuehrung stuende hier fuer
  // immer "Marge"/generic, egal welcher Typ gerade laeuft -- ein RBMK-Spieler
  // faende "CPR" dann nirgends, weil die Kachel so nie heisst.
  statsList.replaceChildren(...STATUS_STATS.map(({ key, labelKey }) => {
    const box = el('input', { type: 'checkbox', value: key });
    const label = key === 'dnbr'
      ? el('span', { 'data-stat-label': key }, [t(labelKey)])
      : t(labelKey);
    return el('label', null, [box, label]);
  }));
  const audioHornBox = $('#rs-audio-horn');
  const audioMusicBox = $('#rs-audio-music');
  $('#rs-stats-cfg').addEventListener('click', () => {
    const reactorId = app.lastReactor;
    const saved = app.prefs.statusBar ? app.prefs.statusBar[reactorId] : null;
    const keys = new Set(sanitizeStatusKeys(saved));
    for (const box of $$('input', statsList)) box.checked = keys.has(box.value);
    const dnbrLabel = $('[data-stat-label="dnbr"]', statsList);
    if (dnbrLabel) setText(dnbrLabel, t((app.engine && app.engine.spec.marginKey) || 'val_dnbr'));
    const a = app.prefs.audio || {};
    audioHornBox.checked = !a.muted && a.horn !== false;
    audioMusicBox.checked = !a.muted && a.music !== false;
    statsModal.hidden = false;
  });
  $('#rs-stats-save').addEventListener('click', () => {
    const reactorId = app.lastReactor;
    const checked = new Set($$('input', statsList).filter((b) => b.checked).map((b) => b.value));
    // Reihenfolge des Dialogs ist immer die feste Katalogreihenfolge -- eine
    // per Ziehen in der Statuszeile gesetzte eigene Reihenfolge (siehe
    // enableDragReorder in initControls()) bleibt fuer weiterhin angehakte
    // Werte erhalten, statt hier ueberschrieben zu werden. Neu angehakte
    // Werte kommen ans Ende, in Katalogreihenfolge.
    const prevOrder = sanitizeStatusKeys(app.prefs.statusBar && app.prefs.statusBar[reactorId]);
    const ordered = prevOrder.filter((k) => checked.has(k));
    for (const { key } of STATUS_STATS) {
      if (checked.has(key) && !ordered.includes(key)) ordered.push(key);
    }
    const keys = sanitizeStatusKeys(ordered);
    app.prefs.statusBar = { ...(app.prefs.statusBar || {}), [reactorId]: keys };
    // Wer hier einen Einzelschalter anfasst, will Ton -- also den
    // Hauptschalter mit aufdrehen, sonst bliebe es still und niemand wuesste
    // warum.
    app.prefs.audio = {
      horn: audioHornBox.checked, music: audioMusicBox.checked, muted: false,
    };
    api.writePrefs(app.prefs);
    applyStatusSelection(keys);
    applyAudioPrefs();
    flash($('#rs-stats-save'), t('stats_cfg_saved'));
  });
  $('#rs-stats-close').addEventListener('click', () => { statsModal.hidden = true; });
  statsModal.addEventListener('click', (ev) => { if (ev.target === statsModal) statsModal.hidden = true; });

  $('#rs-save').addEventListener('click', openSaveSlots);
  const saveSlotsModal = $('#rs-save-slots');
  $('#rs-save-slots-close').addEventListener('click', closeSaveSlots);
  $('#rs-save-slots-retry').addEventListener('click', openSaveSlots);
  saveSlotsModal.addEventListener('click', (ev) => { if (ev.target === saveSlotsModal) closeSaveSlots(); });

  $('#rs-xenon-skip').addEventListener('click', fastForwardXenon);
  $('#rs-xenon-skip-cancel').addEventListener('click', cancelXenonSkip);

  $('#rs-destroyed-close').addEventListener('click', () => {
    $('#rs-destroyed').hidden = true;
    toMenu();
  });

  // Tastatur am Rechner: Leertaste hält an, Zahlen wählen den Zeitraffer,
  // Strg+Pfeil hoch/runter fährt die Stäbe -- ohne Strg kollidiert Pfeil
  // hoch/runter sonst mit dem Scrollen der Seite. R/P/S/G/A/V/M/C oeffnen ein
  // Panel als Fenster (PANEL_KEYS oben) -- nur auf dem Desktop wirksam,
  // openPanelWindow() selbst prueft das (siehe dort); auf dem Handy zeigt der
  // Reiter das Panel ohnehin schon voll.
  document.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement) return;
    if (ev.code === 'Space' && ev.target.closest?.('button, summary, select, textarea, a[href]')) return;
    if (ev.code === 'Space') { ev.preventDefault(); setSpeed(app.xenonSkipping || app.loop.speed > 0 ? 0 : 1); }
    else if (ev.key === '1') setSpeed(1);
    else if (ev.key === '2') setSpeed(4);
    else if (ev.key === '3') setSpeed(16);
    else if (ev.key === '4') setSpeed(60);
    else if (ev.ctrlKey && ev.key === 'ArrowUp') { ev.preventDefault(); if (app.jogRod) app.jogRod(-1); }
    else if (ev.ctrlKey && ev.key === 'ArrowDown') { ev.preventDefault(); if (app.jogRod) app.jogRod(1); }
    // Q quittiert die Meldetafel wie der Knopf selbst (siehe panels.js
    // '#rs-ack') -- Rückstellen bleibt bewusst ohne Taste, ein Fehlklick dort
    // gibt bei stehendem SCRAM den Reaktorschutz frei.
    else if (!ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.key.toLowerCase() === 'q') {
      $('#rs-ack').click();
    }
    else if (!ev.ctrlKey && !ev.altKey && !ev.metaKey && PANEL_KEYS[ev.key.toLowerCase()]) {
      ev.preventDefault();
      openPanelWindow($('#' + PANEL_KEYS[ev.key.toLowerCase()]));
    }
    // O oeffnet die Instrumentenuebersicht (Rundinstrumente + Stellteile
    // aller Reiter auf einer Flaeche) -- eigene Taste statt Q, das ist schon
    // die Meldetafel-Quittierung (siehe oben).
    else if (!ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.key.toLowerCase() === 'o') {
      ev.preventDefault();
      openInstrumentsWindow();
    }
  });

  // Statuskacheln per Ziehen umsortieren -- gilt je Reaktortyp, unabhaengig
  // von Szenario/freiem Spiel (derselbe Schluessel wie die Auswahl selbst,
  // siehe app.prefs.statusBar). #rs-status-scroll bleibt derselbe Knoten
  // ueber alle Runden hinweg, nur seine Kinder wechseln (buildStatusBar()) --
  // einmaliges Verdrahten hier reicht deshalb fuer die ganze Sitzung.
  enableDragReorder($('#rs-status-scroll'), '.rs-stat:not([hidden])', (items) => {
    const reactorId = app.lastReactor;
    if (!reactorId) return;
    const keys = sanitizeStatusKeys(items.map((n) => n.dataset.key));
    app.prefs.statusBar = { ...(app.prefs.statusBar || {}), [reactorId]: keys };
    api.writePrefs(app.prefs);
    // Die ersten zwei Kacheln stehen groesser (rs-stat-lead) -- nach dem
    // Ziehen kann das jetzt eine andere sein, applyStatusSelection() setzt
    // die Klasse aus der neuen Reihenfolge neu (Wiederanhaengen an den
    // Schluss ist dabei ein no-op, sie stehen ja schon dort).
    applyStatusSelection(keys);
  });
}

/** Kurze Rueckmeldung auf einem Knopf, ohne Dialog. */
function flash(node, text) {
  const before = node.textContent;
  setText(node, text);
  window.setTimeout(() => setText(node, before), 2000);
}

/** Beschriftung der Schnellabschaltung -- sie gehört dem Reaktortyp.
 *  RESA im deutschen Leitstand, SCRAM im englischen, AZ-5 beim RBMK. */
function scramLabel() {
  const sp = app.engine && app.engine.spec;
  return t((sp && sp.scram && sp.scram.labelKey) || 'btn_scram');
}

function setSpeed(v) {
  const skip = app.xenonSkip;
  if (skip && skip.engine === app.engine && skip.session === app.session && skip.bootId === app.bootId) {
    if (v > 0) return;
    if (v === 0 && !skip.cancelled) { cancelXenonSkip(); return; }
  }
  if (!app.loop) return;
  app.loop.setSpeed(v);
  for (const b of $$('.rs-speed-b')) b.classList.toggle('rs-on', Number(b.dataset.speed) === v);
  // v === 0 heisst angehalten: kein engine.step() laeuft mehr, also darf auch
  // keine Bedienhandlung mehr durchgreifen (siehe controls.js) -- vorher
  // liessen sich Staebe, Pumpen und Regler auch im Stillstand bewegen.
  setControlsPaused(v === 0);
  document.body.classList.toggle('rs-ctl-paused', v === 0);
}

// Sekunden Sim-Zeit je Innenschritt -- derselbe Takt wie loop.js (DT), sonst
// rechnen Trips und Session hier mit anderen Schrittweiten als im normalen
// Betrieb. In Bloecken statt einem einzigen Riesenschleifendurchlauf, damit
// der Tab zwischendurch atmen kann (Fortschrittstext, kein "eingefroren").
const XENON_SKIP_DT = 0.05;
const XENON_SKIP_CHUNK = 2000;        // 100 Sim-s je Block
const XENON_SKIP_CAP_S = 48 * 3600;   // Notbremse, falls X aus welchem Grund auch immer nicht sinkt
// Ziel ist NICHT "X gegen null", sondern zurueck auf den Vollastwert (X* = 1,
// per Definition der Normierung in poisons.js): X steigt nach dem Abschalten
// erst noch fuer einige Stunden (Jodgrube, das Jod zerfaellt weiter nach),
// erreicht sein Maximum, faellt dann. Nachgemessen an der echten Engine (DWR,
// SCRAM aus Vollast): Maximum ~1,9 nach rund 8h, zurueck auf 1,0 nach rund
// 26h -- nahe an der oft genannten "24 Stunden" fuer den RBMK. Ein Ziel von
// nahe null braeuchte dagegen ueber 80h.
const XENON_SKIP_TARGET = 1.0;

/** Stoppt nur den Zeitsprung, nicht die Sitzung oder ihren aktuellen Zustand. */
function cancelXenonSkip() {
  const skip = app.xenonSkip;
  if (!skip || skip.engine !== app.engine || skip.session !== app.session || skip.bootId !== app.bootId) return false;
  skip.cancelled = true;
  setSpeed(0);
  return true;
}

/** Zeit im Zeitraffer aller Zeitraffer: fuer die Jodgrube muesste ein Spieler
 *  sonst 24 echte Minuten bei 60x abwarten. Nur im freien Spiel (siehe
 *  Sichtbarkeit des Knopfs) -- ein Szenario hat feste Ereigniszeiten und eine
 *  feste Dauer, die ein Tagessprung sinnlos machen wuerde. Laeuft dieselben
 *  Schritte wie der normale Betrieb (engine.step + session.step, siehe
 *  loop.afterStep), nur ohne Bildaufbau dazwischen -- ein echter Stoerfall
 *  waehrenddessen bricht sofort ab und zeigt sich normal, statt stillschweigend
 *  ueberfahren zu werden. */
async function fastForwardXenon() {
  const engine = app.engine;
  const session = app.session;
  const bootId = app.bootId;
  if (app.xenonSkip || app.xenonSkipping || !engine || !app.loop || !session?.free
    || session.phase !== PHASE.RUNNING) return;
  const s = engine.state;
  if (!s.scram.active || !(s.X > XENON_SKIP_TARGET) || s.destroyed || s.fault) return;
  const sampleTrends = app.sampleTrends;
  const btn = $('#rs-xenon-skip');
  const cancelBtn = $('#rs-xenon-skip-cancel');
  const message = $('#rs-xenon-skip-message');
  const before = btn.textContent;
  const skip = { engine, session, bootId, cancelled: false, before };
  const sameRound = () => app.engine === engine && app.session === session && app.bootId === bootId;
  const owns = () => app.xenonSkip === skip && sameRound();
  // Integer ticks avoid a floating-point extra step at the 48-hour limit.
  const maxTicks = Math.floor(XENON_SKIP_CAP_S / XENON_SKIP_DT);
  let ticks = 0;
  const canStep = () => owns() && !skip.cancelled && session.phase === PHASE.RUNNING
    && !s.destroyed && !s.fault && s.X > XENON_SKIP_TARGET && ticks < maxTicks;
  let completed = false;
  let failure = null;
  let cleaned = false;
  try {
    setSpeed(0); // Before assigning the token: pausing must not cancel this skip.
    app.xenonSkip = skip;
    app.xenonSkipping = true;
    btn.disabled = true;
    if (cancelBtn) { cancelBtn.hidden = false; cancelBtn.disabled = false; }
    setText(cancelBtn, t('btn_xenon_skip_cancel'));
    if (message) message.hidden = false;
    setAttr(message, 'role', 'status');
    setText(message, t('xenon_skip_running'));
    setText(btn, t('btn_xenon_skip_progress', { h: '0.0' }));
    while (canStep()) {
      // Yield BEFORE each block, including the first, so Cancel can paint/run.
      await new Promise((resolve) => { window.setTimeout(resolve, 0); });
      for (let i = 0; i < XENON_SKIP_CHUNK && canStep(); i++) {
        engine.step(XENON_SKIP_DT);
        session.step(XENON_SKIP_DT, engine.trips.tiles(), engine.trips.unacknowledgedSeconds());
        sampleTrends();
        ticks++;
      }
      if (!owns()) return;
      setText(btn, t('btn_xenon_skip_progress', { h: (ticks * XENON_SKIP_DT / 3600).toFixed(1) }));
    }
    if (!owns()) return;
    app.render.tick(s, performance.now());
    if (!owns()) return;
    completed = !skip.cancelled && session.phase === PHASE.RUNNING
      && !s.destroyed && !s.fault && s.X <= XENON_SKIP_TARGET;
    if (completed) {
      const event = { t: s.t_sim, key: 'event_time_skip', severity: 1 };
      engine.ctx.trends?.mark({ ...event, kind: 'event' });
      engine.ctx.log.push(event);
    }
  } catch (err) {
    completed = false;
    failure = t('fault_crash_detail', { msg: String(err && err.message ? err.message : err) });
  } finally {
    // An old continuation must never restore controls belonging to a new run.
    if (owns()) {
      cleaned = true;
      app.xenonSkip = null;
      app.xenonSkipping = false;
      btn.disabled = false;
      setText(btn, before);
      if (cancelBtn) { cancelBtn.hidden = true; cancelBtn.disabled = false; }
      const status = failure || s.fault || s.destroyed ? null
        : completed ? 'xenon_skip_complete'
        : !skip.cancelled && session.phase === PHASE.RUNNING && ticks >= maxTicks
          ? 'xenon_skip_limit' : 'xenon_skip_cancelled';
      setText(message, status ? t(status) : '');
      if (message) message.hidden = !status;
    }
  }
  if (!cleaned || !sameRound() || app.xenonSkip) return;
  if (failure || s.fault) {
    showFault(failure || s.fault);
  } else if (s.destroyed) {
    if (!app.endShown) showDestroyed();
  } else if (completed) {
    setSpeed(1);
  }
}

// Alle 60 echte Sekunden, unabhaengig vom Zeitraffer -- ein Strg+R oder ein
// Tab-Absturz soll hoechstens eine Minute Spielzeit kosten, nicht den ganzen
// Lauf. Eigener Slot ("auto-...", siehe saveCurrentGame()), getrennt vom
// Speichern-Knopf -- der schrieb bis 0.0.79 in DENSELBEN Slot, und die
// naechste Autospeicherung ueberschrieb einen gerade von Hand gesicherten
// Stand kommentarlos wieder mit dem inzwischen weitergelaufenen Zustand.
const AUTOSAVE_INTERVAL_MS = 60000;

/** Slotname der Autospeicherung: je Reaktortyp UND Szenario (bzw. "-free"
 *  fuers freie Spiel) -- siehe CHANGELOG 0.0.60, vorher teilten sich zwei
 *  Laeufe auf demselben Reaktortyp einen Slot und ueberschrieben sich
 *  stillschweigend. Der Speichern-Knopf hat seit CHANGELOG 0.1.1 keinen
 *  eigenen szenariobezogenen Slot mehr, siehe manualSlotName() -- diese
 *  Funktion bedient nur noch die Autospeicherung. */
function saveSlotName(prefix, context = captureSaveContext()) {
  return prefix + '-' + context.reactorId + '-' + (context.scenarioId || 'free');
}

// Write queues outlive rounds. A stalled server must not grow them indefinitely.
const SAVE_SLOT_QUEUE_LIMIT = 16;
const saveWriteQueues = new Map();
let saveStatus = null;
let saveSlotsToken = 0;

function resetSaveStatus(savedMeta = null) {
  const kind = typeof savedMeta?.slot === 'string'
    ? (/^manual-.+/.test(savedMeta.slot) ? 'manual'
      : (/^auto(?:-.+)?$/.test(savedMeta.slot) ? 'auto' : null)) : null;
  const seconds = savedMeta?.saved_at;
  const valid = kind && Number.isInteger(seconds) && seconds >= 0
    && Number.isFinite(new Date(seconds * 1000).getTime());
  saveStatus = { sequence: 0, lastSequence: 0, pending: false, failed: false,
    last: valid ? { when: seconds * 1000, kind } : null };
  closeSaveSlots();
  renderSaveStatus();
}

function renderSaveStatus() {
  const last = saveStatus?.last;
  const lastText = last ? t('save_last_success', {
    when: new Date(last.when).toLocaleString(), kind: t('save_kind_' + last.kind),
  }) : t('save_none');
  // Visually hidden (rs-sr-only): the text lives in the Speichern button's
  // tooltip instead, so the status row does not cost sidebar space. Sighted
  // feedback is the button itself turning red/green, see flashSaveOk() below
  // and data-error in layout.css -- a visible text row here used to push
  // the workspace down by a line whenever it appeared or disappeared.
  setText($('#rs-save-last'), lastText);
  setAttr($('#rs-save'), 'title', lastText);
  setText($('#rs-save-state'), [saveStatus?.failed ? t('save_failed') : '',
    saveStatus?.pending ? t('save_pending') : ''].filter(Boolean).join(' '));
  setAttr($('#rs-save-status'), 'data-error', saveStatus?.failed ? 'true' : 'false');
  setAttr($('#rs-save'), 'data-error', saveStatus?.failed ? 'true' : 'false');
}

let saveFlashTimer = null;
/** Kurzes gruenes Aufleuchten des Speichern-Knopfs bei Erfolg -- ein
 *  Gegenstueck zum dauerhaften Rot aus data-error oben, das bestehen bleibt,
 *  bis ein Speicherversuch tatsaechlich klappt. */
function flashSaveOk() {
  window.clearTimeout(saveFlashTimer);
  setAttr($('#rs-save'), 'data-flash-ok', 'true');
  saveFlashTimer = window.setTimeout(() => setAttr($('#rs-save'), 'data-flash-ok', 'false'), 2000);
}

function captureSaveContext() {
  if (!saveStatus) resetSaveStatus();
  return { status: saveStatus, engine: app.engine, session: app.session,
    bootId: app.bootId, reactorId: app.engine?.state.reactor, selectedReactor: app.lastReactor,
    scenarioId: app.session?.scenario?.id || null };
}

function isSaveContextCurrent(context) {
  return context.status === saveStatus && context.engine === app.engine
    && context.session === app.session && context.bootId === app.bootId
    && context.selectedReactor === app.lastReactor
    && context.reactorId === app.engine?.state.reactor
    && context.scenarioId === (app.session?.scenario?.id || null);
}

function requestGameSave(slot, kind) {
  const context = captureSaveContext();
  const state = context.status;
  const queue = saveWriteQueues.get(slot) || [];
  const duplicate = kind === 'auto' && queue.find((job) => job.kind === kind
    && job.context.status === state && job.context.engine === context.engine
    && job.context.session === context.session && job.context.bootId === context.bootId
    && job.context.scenarioId === context.scenarioId);
  if (duplicate) return duplicate.promise;
  const sequence = ++state.sequence;
  state.pending = true;
  renderSaveStatus();
  const finish = (ok) => {
    // An older success may update the last backup, but cannot clear a newer error.
    if (isSaveContextCurrent(context)) {
      if (ok && sequence > state.lastSequence) {
        state.lastSequence = sequence;
        state.last = { when: Date.now(), kind };
        flashSaveOk();
      }
      if (sequence === state.sequence) {
        state.pending = false;
        state.failed = !ok;
      }
      renderSaveStatus();
    }
    return ok;
  };
  let snapshot;
  try {
    if (!context.engine || context.reactorId !== context.selectedReactor || !isSaveContextCurrent(context)
      || typeof slot !== 'string' || !slot || queue.length >= SAVE_SLOT_QUEUE_LIMIT) {
      return Promise.resolve(finish(false));
    }
    // pack includes live references (e.g. history); detach before any await/queue.
    snapshot = JSON.parse(JSON.stringify(packSave(context.engine, context.scenarioId,
      context.session && context.session.run, context.session)));
  } catch {
    return Promise.resolve(finish(false));
  }
  const previous = queue.length ? queue[queue.length - 1].promise : Promise.resolve();
  const job = { context, kind, promise: null };
  job.promise = previous.then(async () => {
    let ok = false;
    try {
      const result = await api.writeSave(slot, snapshot);
      ok = result?.ok === true;
    } catch {
      // Refused and thrown writes have the same persistent feedback.
    } finally {
      queue.shift();
      if (!queue.length) saveWriteQueues.delete(slot);
    }
    return finish(ok);
  });
  queue.push(job);
  saveWriteQueues.set(slot, queue);
  return job.promise;
}

/** Automatische Sicherung -- eigener Slot, siehe AUTOSAVE_INTERVAL_MS oben. */
function saveCurrentGame() {
  return requestGameSave(saveSlotName('auto'), 'auto');
}

// Zehn feste Handplaetze je Reaktortyp -- ANDERS als die Autospeicherung
// oben unabhaengig vom Szenario: ein neues ausprobiertes Szenario legt
// keinen elften Slot an, sondern steht zur Auswahl wie jeder andere. Der
// Speichern-Knopf oeffnet dafuer einen Auswahldialog (siehe
// openSaveSlots()) -- der Spieler entscheidet selbst, welchen der zehn er
// ueberschreibt, statt dass main.js das stillschweigend fuer ihn tut.
const MANUAL_SLOTS = 10;
function manualSlotName(reactorId, n) {
  return `manual-${reactorId}-slot${n}`;
}

/** Schreibt in EINEN der zehn Handplaetze -- welchen, hat der Spieler im
 *  Auswahldialog (openSaveSlots()) angeklickt. */
function saveManualGame(slot) {
  return requestGameSave(slot, 'manual');
}

function closeSaveSlots() {
  saveSlotsToken++;
  const modal = $('#rs-save-slots');
  if (modal) modal.hidden = true;
}

/** Speichern-Dialog: zeigt alle zehn Handplaetze DES AKTUELLEN Reaktortyps,
 *  belegt (mit Datum/Szenario) oder frei, und schreibt beim Anklicken sofort
 *  in den gewaehlten Slot -- die angezeigten Metadaten SIND die
 *  Bestaetigung, kein zusaetzliches "Wirklich ueberschreiben?" noetig (das
 *  gibt es nur beim Loeschen, siehe makeDeleteSaveButton()). */
async function openSaveSlots() {
  const modal = $('#rs-save-slots');
  const list = $('#rs-slot-list');
  const message = $('#rs-save-slots-message');
  const retry = $('#rs-save-slots-retry');
  const context = captureSaveContext();
  const token = ++saveSlotsToken;
  const current = () => token === saveSlotsToken && !modal.hidden && isSaveContextCurrent(context);
  const reactorId = context.reactorId;
  const slotRe = new RegExp(`^manual-${reactorId}-slot(\\d+)$`);
  list.replaceChildren();
  modal.hidden = false;
  setText(message, t('save_list_loading'));
  setAttr(message, 'data-error', 'false');
  setText(retry, t('btn_retry'));
  if (retry) retry.hidden = true;
  try {
    const [, r] = await Promise.all([app.scenariosPromise, api.listSaves()]);
    if (!current()) return false;
    if (!r?.ok || !Array.isArray(r.data?.saves)) throw new Error('save_list_failed');
    const saves = r.data.saves;
    const bySlot = new Map();
    for (const sv of saves) {
      const m = sv.slot && sv.slot.match(slotRe);
      if (m) bySlot.set(Number(m[1]), sv);
    }
    let writing = false;
    const buttons = [];
    for (let n = 1; n <= MANUAL_SLOTS; n++) {
      const slot = manualSlotName(reactorId, n);
      const sv = bySlot.get(n);
      const scn = sv && sv.scenario && app.scenarios.find((x) => x.id === sv.scenario);
      const label = sv
        ? t('save_slot_used', {
            n,
            scenario: sv.scenario ? t(scn ? scn.title_key : 'scn_unknown') : t('scn_free'),
            when: new Date(sv.saved_at * 1000).toLocaleString(),
          })
        : t('save_slot_free', { n });
      const btn = el('button.rs-btn', { type: 'button' }, [label]);
      btn.addEventListener('click', async () => {
        if (writing || !current()) return;
        writing = true;
        for (const button of buttons) button.disabled = true;
        setText(message, t('save_pending'));
        const ok = await saveManualGame(slot);
        if (!current()) return;
        if (ok) {
          closeSaveSlots();
          refreshResumeList();
        } else {
          writing = false;
          for (const button of buttons) button.disabled = false;
          setText(message, t('save_failed'));
          setAttr(message, 'data-error', 'true');
        }
      });
      const row = [btn];
      // Loeschen nur anbieten, wo etwas zum Loeschen da ist -- ein leerer
      // Slot hat nichts, das verschwinden koennte.
      if (sv) row.push(makeDeleteSaveButton(slot, () => {
        if (current() && !writing) openSaveSlots();
      }));
      buttons.push(...row);
      list.append(el('div.rs-resume-row', null, row));
    }
    setText(message, '');
    return true;
  } catch {
    if (!current()) return false;
    list.replaceChildren();
    setText(message, t('save_list_failed'));
    setAttr(message, 'data-error', 'true');
    if (retry) retry.hidden = false;
    return false;
  }
}

function showFault(detail) {
  if (app.loop) app.loop.stop();
  setText($('#rs-fault-detail'), detail || '');
  $('#rs-fault').hidden = false;
}

/**
 * Schwerer Störfall. Der Lauf endet hier -- mit der Zeitleiste der Meldungen,
 * die dorthin geführt haben. Das ist der Punkt des Spiels: nicht das Ende zu
 * zeigen, sondern den Weg.
 */
function showDestroyed() {
  $('#rs-debrief').hidden = true;
  app.endShown = true;
  setSpeed(0);
  app.bgMusic.stop();
  if (app.horn) app.horn.meltdown();
  const s = app.engine.state;
  // Der Grund gehoert auf den Endbildschirm. Es gibt inzwischen vier Wege,
  // eine Anlage zu verlieren (siehe engine.js checkLoss) -- vorher stand hier
  // immer "Kernzerstoerung / die Brennstoffenthalpie hat 963 J/g
  // ueberschritten", auch wenn der Sicherheitsbehaelter geborsten oder der
  // Kern trockengefallen war. Wer nicht erfaehrt, woran er gescheitert ist,
  // lernt daraus nichts.
  const key = s.destroyedKey || 'event_fuel_dispersal';
  setText($('#rs-destroyed-title'), t('end_lost_title'));
  setText($('#rs-destroyed-body'), t(key + '_body'));
  setText($('#rs-destroyed-detail'),
    `${t('val_fuel_temp')}: ${Math.round(s.T_f - 273.15)} °C · `
    + `${Math.round(s.enthalpy)} J/g · ${clock(s.t_sim)}`);
  const list = $('#rs-destroyed-log');
  list.replaceChildren();
  // Die letzten Einträge der Meldetafel, neueste zuerst.
  const log = $('#rs-log');
  for (let i = 0; i < Math.min(log.children.length, 8); i++) {
    list.append(log.children[i].cloneNode(true));
  }
  $('#rs-destroyed').hidden = false;
}

/** Gleicher Reaktortyp, gleiches Szenario (oder freies Spiel), sofort von
 *  vorn -- ohne den Umweg über Menü, Typwahl und Einweisung. */
function restart() {
  if (!app.lastReactor) { toMenu(); return; }
  boot(app.lastReactor, app.lastScenarioDef, null, app.lastCold);
}

/** Zwei-Klick-Knopf UND Strg+Z gehalten (siehe initStart()) rufen dieselbe
 *  Stelle. record() (game/coreActions.js) zeichnet die Handlung auf UND
 *  loest sie aus -- dieselbe Stelle, die auch die Server-Nachrechnung
 *  (game/replay.js) fuer 'scram' anspringt. */
function triggerScram() {
  const skipping = cancelXenonSkip();
  if (app.horn) app.horn.scram();
  record(app.engine, 'scram', null);
  if (!skipping) setSpeed(1);
}

/** Menü-Knopf UND Strg+X (siehe initStart()) rufen dieselbe Stelle -- ein
 *  laufendes Szenario (nicht das freie Spiel) gilt als abgebrochen, statt
 *  einfach zu verschwinden. */
function leaveToMenu() {
  if (app.session && app.session.phase === PHASE.RUNNING && !app.session.free) {
    app.session.abort();
    return;
  }
  toMenu();
}

function clearEndDialogs() {
  $('#rs-debrief').hidden = true;
  $('#rs-destroyed').hidden = true;
  $('#rs-tutorial-modal').hidden = true;
  app.pendingResult = null;
  app.endPending = false;
  if (app.xenonSkip) {
    app.xenonSkip.cancelled = true;
    setText($('#rs-xenon-skip'), app.xenonSkip.before);
  }
  app.xenonSkip = null;
  app.xenonSkipping = false;
  $('#rs-xenon-skip').disabled = false;
  $('#rs-xenon-skip-cancel').hidden = true;
  setText($('#rs-xenon-skip-message'), '');
  $('#rs-xenon-skip-message').hidden = true;
}

function toMenu() {
  cancelScenarioLoad();
  closeSaveSlots();
  app.bootId = (app.bootId || 0) + 1;
  app.session = null;
  clearEndDialogs();
  if (app.loop) app.loop.stop();
  if (app.autosaveTimer) { window.clearInterval(app.autosaveTimer); app.autosaveTimer = null; }
  // Die Sirene laeuft als eigene Dauerschleife unabhaengig von loop/bgMusic
  // (siehe Horn in annunciator.js) -- ohne silence() hupt eine unquittierte
  // Meldung im Hauptmenue weiter, obwohl die Runde laengst verlassen ist.
  if (app.horn) app.horn.silence();
  app.bgMusic.stop();
  app.introMusic.start();
  $('#rs-app').hidden = true;
  $('#rs-reactor').hidden = true;
  $('#rs-start').hidden = false;
  // Zurueck aus einer laufenden Runde landet immer auf der Uebersicht, auch
  // wenn der Aufruf ueber /reaktor/<typ> hereinkam -- die URL soll das
  // widerspiegeln, sonst zeigt ein spaeteres Neuladen wieder die
  // Detailseite statt des Menues, das gerade sichtbar ist. `typeof` statt
  // direktem Zugriff: die Lifecycle-Tests (test-lifecycle.mjs) fuehren
  // toMenu()/boot() in einem vm.createContext() ohne location/history aus --
  // ein direkter Zugriff waere dort ein ReferenceError.
  if (typeof location !== 'undefined' && location.pathname !== '/') history.replaceState({}, '', '/');
  refreshResumeList();
}

// Der Ausschlag, der zur Kernzerstoerung fuehrt, braucht nach dem
// Erkennen (s.destroyed) noch einen Moment, um auf den Anzeigen SICHTBAR
// zu werden (session.js beendet den Lauf im selben Rechenschritt, in dem
// s.destroyed wahr wird -- siehe Nutzerrueckmeldung: ohne Pause friert das
// Bild im selben Bildschirmtakt ein). 3s bei 1x (siehe triggerScram(),
// setzt beim Druecken ohnehin auf 1x zurueck) lassen die Anlage sichtbar
// weiterlaufen, bevor angehalten und die Auswertung gezeigt wird.
const DESTROY_PAUSE_MS = 3000;

/** Einmal angestossen, hoechstens einmal wirksam: `app.endPending` haelt
 *  sowohl showDebrief() als auch den Renderloop-Auslöser fuer showDestroyed()
 *  (freies Spiel) gleichzeitig zurueck, sonst zeigt einer der beiden das
 *  Fenster trotzdem sofort, waehrend der andere noch wartet. */
function deferEnd(fn) {
  if (app.endShown || app.endPending) return;
  app.endPending = true;
  const bootId = app.bootId;
  window.setTimeout(() => {
    app.endPending = false;
    // Ein Menü-/Neustart-Klick waehrend der Pause hat laengst eine neue Runde
    // (oder keine mehr) -- ein verspaeteter Aufruf darf sich dann nicht mehr
    // ueber deren Bild legen.
    if (app.bootId !== bootId || !app.session || app.endShown) return;
    fn();
  }, DESTROY_PAUSE_MS);
}

/** Auswertung am Ende eines Szenarios. */
function showDebrief(result, failed) {
  $('#rs-tutorial-modal').hidden = true;
  // Free play has no score: its loss screen is opened after the next render.
  if (!result && app.engine.state.destroyed) return;
  if (app.engine.state.destroyed && !app.endShown) {
    // Ruft NICHT showDebrief() erneut auf: das wuerde denselben Zweig hier
    // wieder treffen (endShown ist ja noch false) und die Pause endlos
    // neu anstossen, statt sie nach einmaligem Ablauf zu zeigen.
    deferEnd(() => showDebriefNow(result, failed));
    return;
  }
  showDebriefNow(result, failed);
}

function showDebriefNow(result, failed) {
  setSpeed(0);
  app.bgMusic.stop();
  const verdict = $('#rs-debrief-verdict');
  const ok = !failed;
  setAttr(verdict, 'data-ok', ok ? '1' : '0');
  setText(verdict, ok ? t('debrief_completed') : `${t('debrief_failed')} — ${t(failed)}`);
  setText($('#rs-debrief-score'), result?.tutorial ? t('tut_unranked_short') : result ? String(result.score) : '—');

  const parts = $('#rs-debrief-parts');
  parts.replaceChildren();
  if (app.engine.state.destroyed) {
    // Keep loss details and score in one screen, including score submission.
    app.endShown = true;
    $('#rs-destroyed').hidden = true;
    if (app.horn) app.horn.meltdown();
    const key = app.engine.state.destroyedKey || 'event_fuel_dispersal';
    parts.append(el('p', { text: t(key + '_body') }));
    app.engine.drainLog();
    parts.append(el('ol.rs-log', null, app.engine.ctx.history.slice(-8).reverse().map((e) =>
      el('li', { text: `${clock(e.t)} · ${t(e.key)}` }))));
  }
  if (result) {
    renderObjectiveResult(parts, result);
    renderTutorialResult(parts, result);
    renderLearning(parts, result.learning);
  }
  if (result && !result.tutorial) {
    const sum = result.summary;
    const p = result.parts || {};
    if (sum.score_mode === 'incident_v1') {
      parts.append(el('h3', { text: t('incident_scoring') }),
        el('p', { text: t('incident_scoring_help') }),
        el('p', { text: t('incident_leaderboard') }));
    }
    // Vorzeichen von Hand statt num(): dieselbe Schreibweise wie schon vorher
    // hier (Math.round() statt lokalisierter Zahl) -- eine Punktezeile ist
    // kein Messwert, der eine Einheit braucht.
    const pts = (v) => (v > 0 ? '+' : '') + String(Math.round(v));
    const row = (label, value) => el('div.rs-row', null, [
      el('span', { text: label }), el('b', { text: value }),
    ]);
    // Messwert UND Punktewirkung nebeneinander, wo es einen echten Messwert
    // gibt (Energie, Abweichung, Alarme, SCRAM-Anzahl) -- reine Punkte
    // sonst (Mission, Bonus, Katastrophenflags), da es dort keine zweite
    // Zahl gibt, die die Punkte nicht schon selbst waeren.
    const rowWithPts = (label, rawText, ptsVal) => row(label, `${rawText} (${pts(ptsVal)})`);

    // Vollstaendige Zerlegung, direkt aus result.parts -- keine zweite
    // Rechnung, die vom tatsaechlichen Score abweichen koennte.
    parts.append(el('div.rs-debrief-breakdown', null, [
      ...(sum.score_mode === 'incident_v1' ? [row(t('debrief_objectives'), pts(p.objectives))] : []),
      row(t('debrief_mission'), pts(p.mission)),
      rowWithPts(t('debrief_energy'),
        `${Math.round(sum.energy_mwh_delivered)} / ${Math.round(sum.energy_mwh_demanded)} ${t('unit_mwh')}`,
        p.energy),
      rowWithPts(t('debrief_deviation'), `${sum.deviation_mwh.toFixed(1)} ${t('unit_mwh')}`, p.deviation),
      rowWithPts(t('debrief_alarms'), `${sum.alarm_seconds_unacked} ${t('unit_seconds')}`, p.alarms),
      row(t('debrief_bonus'), pts(p.bonus)),
      rowWithPts(t('debrief_scram'), String(sum.scram_count), p.scram),
      rowWithPts(t('debrief_fuel'), sum.fuel_damage ? t('state_on') : t('state_off'), p.fuel),
      row(t('debrief_cont_failed'), pts(p.cont_failed)),
      row(t('debrief_h2_exploded'), pts(p.h2_exploded)),
      // Nur sichtbar, wenn die Bodenregel wirklich etwas angehoben hat --
      // sonst waere jede saubere Schicht mit einer sinnlosen "+0"-Zeile
      // zugepflastert. rounding_adjustment bleibt IMMER unsichtbar (siehe
      // scoring.py-Kommentar): keine Debrief-Zeile fuer Bruchteilspunkte.
      ...(Math.round(p.floor_adjustment) !== 0 ? [row(t('debrief_floor'), pts(p.floor_adjustment))] : []),
      el('div.rs-row.rs-debrief-total', null, [
        el('span', { text: t('debrief_total') }), el('b', { text: String(result.score) }),
      ]),
    ]));

    // Betriebszustaende: Zeit UND Punktewirkung nebeneinander -- der ganze
    // Grund fuer diesen Umbau war "keine Ahnung, wofuer die Punkte weg sind".
    const vs = sum.violation_seconds || {};
    const severities = [[1, 'violations_info'], [2, 'violations_warn'], [3, 'violations_trip']];
    parts.append(el('h3', { text: t('debrief_violations') }));
    parts.append(el('div.rs-debrief-violations', null, severities.map(([sev, partKey]) => row(
      `${t(`debrief_sev_${sev}`)} · ${clock(vs[sev] || 0)}`, pts(p[partKey]),
    ))));

    // Hauptursachen: welche Kachel(n) so lange stand/standen -- result.causes
    // liegt bewusst NEBEN summary (siehe session.js), geht nie zum Server.
    if (result.causes && result.causes.length) {
      parts.append(el('h3', { text: t('debrief_causes') }));
      parts.append(el('div.rs-debrief-causes', null, result.causes.map((c) => row(
        t(c.key), clock(c.seconds),
      ))));
    }

    // min_dnbr/min_orm werden schon laenger mitgezaehlt (RunState.summary()),
    // standen aber nirgends in der Auswertung -- eine Einweisung, die "Ziel:
    // ... ohne die Reserve unter 30 zu sehen" verspricht, muss hinterher auch
    // zeigen, wie nah man dran war. Beide nur, wenn der Typ den Wert ueberhaupt
    // kennt (min_dnbr/min_orm bleiben sonst null, siehe RunState.summary()).
    if (Number.isFinite(sum.min_dnbr)) {
      const marginKey = (app.engine && app.engine.spec.marginKey) || 'val_dnbr';
      parts.append(el('div.rs-row', null, [
        el('span', { text: `${t('debrief_min_prefix')} ${t(marginKey)}` }),
        el('b', { text: sum.min_dnbr.toFixed(2) }),
      ]));
    }
    if (Number.isFinite(sum.min_orm)) {
      parts.append(el('div.rs-row', null, [
        el('span', { text: t('debrief_min_orm') }), el('b', { text: sum.min_orm.toFixed(1) }),
      ]));
    }
  }
  // Eintragen nur, wenn es eine Wertung gibt und es ein Szenario war.
  const submit = $('#rs-debrief-submit');
  const msg = $('#rs-debrief-msg');
  setText(msg, '');
  $('#rs-debrief-scores').replaceChildren();
  app.pendingResult = null;
  const localOnly = result?.summary?.score_mode === 'incident_v1' && !app.engine.recorder;
  submit.hidden = !result || !!result.tutorial || localOnly;
  if (localOnly) setText(msg, t('incident_local_only'));
  if (result && !result.tutorial) {
    app.pendingResult = result;
    const name = $('#rs-debrief-name');
    try { name.value = window.localStorage.getItem('rs-name') || ''; } catch { /* privates Fenster */ }
    loadScores(result.summary.reactor, result.summary.scenario);
  }
  $('#rs-debrief').hidden = false;
  $('#rs-debrief .rs-modal-box').scrollTop = 0;
}

/** Bestenliste zum gerade gespielten Szenario nachladen. */
function loadScores(reactor, scenario) {
  const session = app.session;
  api.listScores(reactor, scenario, 10).then((r) => {
    if (app.session !== session) return;
    const list = $('#rs-debrief-scores');
    list.replaceChildren();
    if (!r.ok || !r.data || !r.data.scores) return;
    for (const e of r.data.scores) {
      list.append(el('li', null, [
        // textContent, nie innerHTML: der Name kommt von einem anderen Spieler.
        el('span.rs-score-name', { text: e.name }),
        el('span.rs-score-v', { text: String(e.score) }),
      ]));
    }
  });
}

// Kachel je Katalogeintrag, ueber Rundenstarts hinweg gemerkt: applyStatus-
// Selection() knipst nur hidden um, baut aber nichts neu. Das ist der Grund,
// warum die Einstellungen-Kachel sofort wirkt, ganz ohne Rundenneustart --
// panels.js sammelt seine data-v-Bindungen einmal beim Rundenstart aus dem
// DOM und haette bei neu gebauten Knoten nur die alten weiterbeschrieben,
// unsichtbar, waehrend die neuen fuer immer auf "—" stehen (dieselbe Klasse
// Fehler wie die doppelten Rundinstrumente aus 0.0.30).
let statusTiles = null;

/** Alle 46 moeglichen Kacheln einmal bauen (verdeckt) -- einmal je
 *  Rundenstart, weil buildPanels() gleich danach seine Wertebindungen aus
 *  genau diesem DOM einsammelt. */
function buildStatusBar() {
  // data-key: haelt fest, welche Kachel welcher Statuswert ist -- die
  // Zeigergesten-Umsortierung (enableDragReorder in initControls()) liest
  // die neue Reihenfolge nur aus dem DOM zurueck, ohne die Map hier zu kennen.
  statusTiles = new Map(STATUS_STATS.map(({ key, labelKey }) => [key,
    el('div.rs-stat', { hidden: true, 'data-key': key }, [
      el('span.rs-stat-k', { text: t(labelKey) }),
      el('span.rs-stat-v', { 'data-v': key, text: '—' }),
    ])]));
  $('#rs-status-scroll').replaceChildren(...statusTiles.values());
}

/** Auswahl anzeigen: nur hidden/Reihenfolge aendern, nie Knoten ersetzen --
 *  wirkt deshalb auch mitten in einer laufenden Runde sofort. */
function applyStatusSelection(keys) {
  if (!statusTiles) return;
  for (const node of statusTiles.values()) node.hidden = true;
  const scroll = $('#rs-status-scroll');
  keys.forEach((key, i) => {
    const node = statusTiles.get(key);
    if (!node) return;
    node.hidden = false;
    node.classList.toggle('rs-stat-lead', i < 2);
    scroll.append(node); // an den Schluss, in Auswahlreihenfolge
  });
}

async function boot(reactorId, scenarioDef, loadSlot, cold, savedMeta = null) {
  cancelScenarioLoad();
  app.briefDef = scenarioDef || null;
  resetSaveStatus();
  const plant = getPlant(reactorId);
  if (!plant) return;

  // boot() laeuft immer synchron aus einem echten Klick heraus (Los,
  // Fortsetzen, Einweisung akzeptieren) -- die einzige verlaessliche Stelle
  // fuer eine Nutzergeste, die der Browser fuer Audio verlangt. Vor dem
  // ersten await, damit sie noch als "waehrend der Geste" zaehlt.
  app.introMusic.stop();
  app.bgMusic.start();

  // Kaltstart gilt fuer freies Spiel (Haekchen) und fuer ein Szenario, das
  // sein eigenes `cold: true` mitbringt -- ein Spielstand ueberschreibt den
  // Zustand ohnehin gleich wieder, trim() liefe da nur fuer einen
  // Wimpernschlag unbeobachtet mit.
  const isColdStart = !!(cold || scenarioDef?.cold) && !loadSlot;
  const bootId = app.bootId = (app.bootId || 0) + 1;
  clearEndDialogs();

  // Auch nach dem Fortsetzen startet "Neustart" wieder denselben Auftrag.
  app.lastReactor = reactorId;
  app.lastScenarioDef = scenarioDef || null;
  app.lastCold = isColdStart;

  // Eine laufende Schleife MUSS stehen, bevor eine neue entsteht. app.loop
  // zeigt danach auf ein neues Objekt, aber die alte Schleife lief bis dahin
  // mit setSpeed(0) weiter (Kernzerstörung pausiert nur, sie stoppt nicht) --
  // ihr rAF-Takt hätte sonst beim nächsten Bild noch einmal
  // state.destroyed && !app.endShown gesehen und die eben erst zurückgesetzte
  // Anzeige sofort wieder auf "Kernzerstörung" gestellt, mit dem neuen Motor.
  if (app.loop) app.loop.stop();
  if (app.autosaveTimer) { window.clearInterval(app.autosaveTimer); app.autosaveTimer = null; }
  // Dieselbe Sirene abstellen wie in toMenu(): buildPanels() erzeugt gleich
  // ein NEUES Horn-Objekt (siehe unten), das alte spielt sonst -- unquittiert
  // aus der verlassenen Runde -- einfach im <audio>-Element weiter.
  if (app.horn) app.horn.silence();

  app.session = null;
  // Kein Bildschirmwechsel hier: boot() laeuft waehrend die Reaktorseite
  // schon sichtbar ist (Klick auf Fortsetzen/Los/Einweisung-Los dort) -- nur
  // die Ladeanzeige (unten auf derselben Seite) und am Ende der Sprung zu
  // #rs-app, siehe dort.
  $('#rs-app').hidden = true;
  const startMessage = $('#rs-start-message');
  setText(startMessage, loadSlot ? t('loading_save') : '');

  // Wartet auf die einmal beim Laden gestartete Abfrage (siehe oben) --
  // praktisch immer schon fertig, sobald der Spieler bis hierher geklickt
  // hat. buildStatusBar() MUSS vor buildPanels() laufen: dessen
  // Wertebindungen sammelt es per querySelectorAll('[data-v]') genau einmal,
  // aus dem, was zu dem Zeitpunkt im DOM steht.
  const prefs = await app.prefsPromise;
  if (bootId !== app.bootId) return;
  let saved = null;
  if (loadSlot) {
    const response = await api.readSave(loadSlot);
    if (bootId !== app.bootId) return;
    if (!response.ok || !response.data) {
      app.bgMusic.stop();
      setText(startMessage, t('load_failed'));
      setAttr(startMessage, 'data-error', 'true');
      return;
    }
    saved = response.data;
  }
  buildStatusBar();
  // Gleicher Grund wie beim '[data-stat-label="dnbr"]' im Einstellungen-
  // Dialog: DNBR/CPR ist derselbe Wert, der Name wechselt nur mit dem Typ.
  const marginTile = statusTiles.get('dnbr');
  if (marginTile) setText($('.rs-stat-k', marginTile), t(plant.spec.marginKey || 'val_dnbr'));
  applyStatusSelection(sanitizeStatusKeys(prefs.statusBar && prefs.statusBar[reactorId]));

  app.endShown = false;
  app.endPending = false;
  app.engine = createEngine(plant, {
    burnup: saved?.state?.burnup,
    n: isColdStart ? 1e-6 : 1.0, cold: isColdStart, seed: scenarioDef ? scenarioDef.seed : 1,
    // Meldetafel-Vorwarnung fuer die szenarioeigene Fail-Bedingung
    // 'grid_deviation' (siehe game/scenario.js) -- ohne sie fiel eine Runde
    // bisher ganz ohne Alarm aus, sobald die Anforderung laenger verfehlt war.
    extraTrips: scenarioDef ? gridDeviationTrips(scenarioDef) : [],
  });
  // Zeichnet jede Bedienhandlung auf (game/coreActions.js record(), plus
  // panels.js' recordingKit() für die typspezifische Bedienung) -- Grundlage
  // der Server-Nachrechnung beim Einreichen einer Wertung, siehe
  // '#rs-debrief-send' weiter unten. Wird bei einem geladenen Spielstand
  // wieder verworfen (siehe applySave()-Aufruf vor dem Panelaufbau): ein
  // Sprung auf einen gespeicherten Zustand lässt sich nicht aus Schritten
  // plus Protokoll nachrechnen.
  attachRecorder(app.engine);
  app.session = new Session(app.engine, scenarioDef);
  app.session.onEnd = (result, failed) => showDebrief(result, failed);
  // Akustische Vorwarnung, 2-5 Minuten vor einem geplanten Ereignis -- nur
  // bei Szenarien relevant, dueAlerts() bleibt im freien Spiel leer.
  app.session.onAlert = () => playClip('geiger_game_alert.mp3', 0.6);
  app.session.start();
  if (saved) {
    const error = applySave(saved, app.engine, app.session.run, app.session);
    if (error) {
      app.session = null;
      app.bgMusic.stop();
      setText(startMessage, t('load_failed'));
      setAttr(startMessage, 'data-error', 'true');
      return;
    }
    app.engine.recorder = null;
    app.session.scenario?.catchUp(app.engine.state.t_sim);
    resetSaveStatus(savedMeta);
  }
  setText(startMessage, '');
  $('#rs-start').hidden = true;
  $('#rs-reactor').hidden = true;
  // Siehe Kommentar in toMenu(): dieselbe typeof-Absicherung fuer dieselben
  // sandboxed Tests.
  if (typeof location !== 'undefined' && location.pathname !== '/') history.replaceState({}, '', '/');
  $('#rs-app').hidden = false;
  // Nur ein Szenario hat eine Einweisung, die es wert ist, erneut
  // aufzurufen -- im freien Spiel gibt es keine, der Knopf bleibt weg.
  $('#rs-briefing-btn').hidden = app.session.free;
  app.render.clear();
  // prefs.helper ist ungesetzt bei jedem Spieler, der die Kopfzeile im
  // Startbildschirm nie angefasst hat -- Standard ist AN, siehe rs-helper-
  // toggle in initStart().
  const built = buildPanels(app.engine, app.render,
    app.prefs.helper !== false && scenarioDef?.guidance?.auto_helper !== false);
  buildTutorial(app.session, app.render);
  app.horn = built.horn;
  app.jogRod = built.jogRod;
  app.rodSound = built.rodSound;
  app.sampleTrends = built.sampleTrends;
  built.sampleTrends();
  if (app.engine.ctx.history.length) built.annun.log(app.engine.ctx.history);
  // Die Hupe wird bei jeder Runde neu gebaut (buildPanels()), die Einstellung
  // muss also jedes Mal neu uebertragen werden -- ueber applyAudioPrefs(),
  // damit auch der Hauptschalter greift.
  applyAudioPrefs();

  const xenonSkipBtn = $('#rs-xenon-skip');
  app.loop = new Loop(app.engine, (state, now) => {
    try {
      app.render.tick(state, now);
    } catch (err) {
      showFault(String(err && err.message ? err.message : err));
    }
    // Die Engine hält bei einem unmöglichen Zustand von selbst an und legt den
    // Grund ab; hier wird er nur sichtbar gemacht.
    if (state.fault) showFault(state.fault);
    if (state.destroyed && !app.endShown && !app.endPending) deferEnd(showDestroyed);

    // Nur im freien Spiel: ein Szenario hat eine feste Dauer und Ereignisse
    // zu festen Zeiten, ein Tagessprung wuerde beides aushebeln. X > 0,05
    // heisst noch spuerbar ueber dem Vollastwert, keine willkuerliche Zahl --
    // dieselbe Grenze, die die Vorspul-Schleife selbst als Ziel nimmt.
    if (!app.xenonSkipping) {
      xenonSkipBtn.hidden = !(app.session && app.session.free
        && state.scram.active && state.X > XENON_SKIP_TARGET);
    }
  });
  app.loop.onSlip = (slipping) => { $('#rs-slip').hidden = !slipping; };
  // Absicherung gegen lautloses Einfrieren: jeder Fehler, der die rAF-Kette
  // sonst unbemerkt gerissen haette, landet hier als sichtbarer Stoerfall
  // mit Reload-Knopf statt als stehende Kopfzeile ohne jede Erklaerung.
  app.loop.onCrash = (err) => {
    showFault(t('fault_crash_detail', { msg: String(err && err.message ? err.message : err) }));
  };
  // Die Spielschicht sieht jeden Simulationsschritt, nicht jedes Bild.
  app.loop.afterStep = (dt) => {
    app.session.step(dt, app.engine.trips.tiles(), app.engine.trips.unacknowledgedSeconds());
    built.sampleTrends();
  };

  initControls();
  const scramBtn = $('#rs-scram');
  setText(scramBtn, scramLabel());
  setAttr(scramBtn, 'title', t((plant.spec.scram && plant.spec.scram.titleKey) || 'btn_scram'));
  setSpeed(1);
  app.loop.start();
  // Gegen Strg+R/Tab-Absturz: hoechstens eine Minute Fortschritt verloren,
  // nicht der ganze Lauf. Nur waehrend PHASE.RUNNING -- speichert also nicht
  // ueber ein Debriefing oder eine Kernzerstoerung hinweg, phase wechselt vor
  // dem naechsten Tick schon weg.
  app.autosaveTimer = window.setInterval(() => {
    if (app.session && app.session.phase === PHASE.RUNNING) saveCurrentGame();
  }, AUTOSAVE_INTERVAL_MS);
}

// ── Start ────────────────────────────────────────────────────────────────────

initStart();
setAttr(document.documentElement, 'data-rs-version', window.RS_CFG ? window.RS_CFG.version : '0');
