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
import { save as saveGame, load as loadGame } from './net/persist.js';
import { GLOSSARY } from './ui/glossary.js';
import { SHORTCUTS } from './ui/shortcuts.js';
import { MusicLoop, playClip, setMuted } from './ui/music.js';
import { STATUS_STATS, sanitizeStatusKeys } from './ui/statusStats.js';
import { enableDragReorder } from './ui/dragReorder.js';
import { attachRecorder } from './game/recorder.js';
import { record } from './game/coreActions.js';

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
      app.reactor = id;
      go.disabled = false;
      renderScenarios(id);
      // Erste echte Nutzergeste auf dem Startbildschirm -- hier darf Musik
      // ueberhaupt zum ersten Mal loslaufen (start() ist idempotent).
      app.introMusic.start();
    });
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
    boot(app.reactor, app.briefDef, null, app.briefDef && app.briefDef.cold);
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
  $('#rs-brief-back').addEventListener('click', () => { $('#rs-brief').hidden = true; });

  $('#rs-debrief-send').addEventListener('click', () => {
    const result = app.pendingResult;
    if (!result) return;
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
      if (r.ok) {
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

  $('#rs-debrief-restart').addEventListener('click', () => {
    $('#rs-debrief').hidden = true;
    restart();
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

/** Fortsetzen-Zeilen neu vom Server holen -- nicht nur beim allerersten
 *  Laden: ein Spielstand von eben (Knopf "Speichern") oder ein geloeschter
 *  muss beim naechsten Blick auf den Startbildschirm stimmen, siehe
 *  toMenu(). Der Szenariotitel braucht die einmalig geholte Szenarienliste,
 *  sonst zeigt der Hinweis nur die rohe ID.
 *
 *  Ein <details> je Reaktortyp (#rs-card-resume-<id>, siehe index.html),
 *  direkt unter dessen eigener Karte -- nicht mehr eine gemeinsame Liste
 *  unten fuer alle Typen. Wer RBMK gespielt hat und danach die DWR-Karte
 *  anschaut, soll den RBMK-Stand trotzdem noch sehen: er steht unveraendert
 *  bei der RBMK-Karte, ganz ohne von der Auswahl abzuhaengen. Collapsed per
 *  Default (die Zusammenfassung nennt nur die Anzahl) -- bei bis zu zehn
 *  Handplaetzen plus Autospeicherung waere die Karte sonst schnell voller
 *  Text als Inhalt. */
function refreshResumeList() {
  const details = new Map(PLANT_IDS.map((id) => [id, $('#rs-card-resume-' + id)]));
  const summaries = new Map(PLANT_IDS.map((id) => [id, $('#rs-card-resume-' + id + '-summary')]));
  const bodies = new Map(PLANT_IDS.map((id) => [id, $('#rs-card-resume-' + id + '-body')]));
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
    // dabei alphabetisch VOR "slot2").
    const autos = saves
      .filter((x) => x.slot && (x.slot.startsWith('auto-') || x.slot.startsWith('manual-')))
      .sort((a, b) => b.saved_at - a.saved_at);
    for (const body of bodies.values()) { if (body) body.replaceChildren(); }
    for (const sv of autos) {
      const body = bodies.get(sv.reactor);
      if (!body) continue; // unbekannter/kuenftiger Typ -- keine Karte dafuer da
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
      // Reactor stimmt hier immer mit der Karte ueberein (Container-Wahl
      // oben), disabled bleibt trotzdem als Absicherung fuer einen Typ, der
      // spaeter aus PLANTS verschwindet, ohne dass alte Staende geloescht
      // wurden.
      btn.disabled = !isAvailable(sv.reactor);
      // Ein Szenario-Stand muss beim Fortsetzen wieder MIT seiner
      // Szenario-Definition booten (Bedarfskurve, Ereignisse, Wertung) --
      // vorher stand hier immer "boot(sv.reactor, null, sv.slot)", also
      // free=true fuer jeden Stand, auch fuer einen, der aus einem Szenario
      // kam. Derselbe Fetch wie in loadScenario() oben, nur ohne Einweisung
      // dazwischen: wer fortsetzt, hat sie schon gesehen.
      btn.addEventListener('click', () => {
        if (!sv.scenario) { boot(sv.reactor, null, sv.slot); return; }
        const scn2 = app.scenarios.find((x) => x.id === sv.scenario);
        if (!scn2) { boot(sv.reactor, null, sv.slot); return; }
        const base = window.RS_CFG ? `/s/${window.RS_CFG.version}` : '';
        fetch(`${base}/data/scenarios/${scn2.file}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('scenario'))))
          .then((def) => {
            // app.briefDef nachziehen -- sonst bleibt es beim Fortsetzen leer
            // (oder auf einem alten Stand von vorher) und der
            // Einweisung-Knopf waehrend der Runde (#rs-briefing-btn) tut
            // dann still gar nichts, obwohl eine Einweisung existiert.
            app.briefDef = def;
            boot(sv.reactor, def, sv.slot);
          })
          .catch(() => boot(sv.reactor, null, sv.slot));
      });
      body.append(el('div.rs-resume-row', null, [btn, makeDeleteSaveButton(sv.slot)]));
    }
    for (const id of PLANT_IDS) {
      const box = details.get(id);
      const n = bodies.get(id) ? bodies.get(id).childElementCount : 0;
      if (box) box.hidden = !n;
      const summary = summaries.get(id);
      if (summary) setText(summary, t('resume_summary', { n }));
    }
  });
}

/** Löschen mit Sicherung wie beim SCRAM: erster Klick bewaffnet nur, der
 *  zweite (binnen 4s) löscht wirklich -- kein Modal fuer eine Aktion, die
 *  sich durchs blosse Weiterspielen jederzeit neu erzeugen liesse.
 *  `onDone` faellt auf refreshResumeList() zurueck (Startbildschirm-Liste),
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

/** Szenarienkarten fuer den gewaehlten Reaktortyp. */
function renderScenarios(reactorId) {
  const list = $('#rs-scn-list');
  const headline = $('#rs-scn-headline');
  const go = $('#rs-start-go');
  const mine = app.scenarios.filter((x) => x.reactor === reactorId);

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
      : t('scn_free_desc');
    const btn = el('button.rs-scn', { type: 'button', 'aria-pressed': String(scn.id === null) }, [
      el('span.rs-scn-name', { text: t(scn.title_key) }),
      el('span.rs-scn-meta', { text: meta }),
    ]);
    btn.addEventListener('click', () => {
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
}

/** Szenariodatei nachladen und die Einweisung zeigen. */
function loadScenario(scn) {
  const base = window.RS_CFG ? `/s/${window.RS_CFG.version}` : '';
  fetch(`${base}/data/scenarios/${scn.file}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('scenario'))))
    .then((def) => {
      app.briefDef = def;
      showBriefing(def);
    })
    .catch(() => { boot(app.reactor, null); });
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
  $('#rs-save-slots-close').addEventListener('click', () => { saveSlotsModal.hidden = true; });
  saveSlotsModal.addEventListener('click', (ev) => { if (ev.target === saveSlotsModal) saveSlotsModal.hidden = true; });

  $('#rs-xenon-skip').addEventListener('click', fastForwardXenon);

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
    if (ev.code === 'Space') { ev.preventDefault(); setSpeed(app.loop.speed > 0 ? 0 : 1); }
    else if (ev.key === '1') setSpeed(1);
    else if (ev.key === '2') setSpeed(4);
    else if (ev.key === '3') setSpeed(16);
    else if (ev.key === '4') setSpeed(60);
    else if (ev.ctrlKey && ev.key === 'ArrowUp') { ev.preventDefault(); if (app.jogRod) app.jogRod(-1); }
    else if (ev.ctrlKey && ev.key === 'ArrowDown') { ev.preventDefault(); if (app.jogRod) app.jogRod(1); }
    else if (!ev.ctrlKey && !ev.altKey && !ev.metaKey && PANEL_KEYS[ev.key.toLowerCase()]) {
      ev.preventDefault();
      openPanelWindow($('#' + PANEL_KEYS[ev.key.toLowerCase()]));
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
const XENON_SKIP_CHUNK = 20000;       // ~1000 Sim-s je Block
const XENON_SKIP_CAP_S = 48 * 3600;   // Notbremse, falls X aus welchem Grund auch immer nicht sinkt
// Ziel ist NICHT "X gegen null", sondern zurueck auf den Vollastwert (X* = 1,
// per Definition der Normierung in poisons.js): X steigt nach dem Abschalten
// erst noch fuer einige Stunden (Jodgrube, das Jod zerfaellt weiter nach),
// erreicht sein Maximum, faellt dann. Nachgemessen an der echten Engine (DWR,
// SCRAM aus Vollast): Maximum ~1,9 nach rund 8h, zurueck auf 1,0 nach rund
// 26h -- nahe an der oft genannten "24 Stunden" fuer den RBMK. Ein Ziel von
// nahe null braeuchte dagegen ueber 80h.
const XENON_SKIP_TARGET = 1.0;

/** Zeit im Zeitraffer aller Zeitraffer: fuer die Jodgrube muesste ein Spieler
 *  sonst 24 echte Minuten bei 60x abwarten. Nur im freien Spiel (siehe
 *  Sichtbarkeit des Knopfs) -- ein Szenario hat feste Ereigniszeiten und eine
 *  feste Dauer, die ein Tagessprung sinnlos machen wuerde. Laeuft dieselben
 *  Schritte wie der normale Betrieb (engine.step + session.step, siehe
 *  loop.afterStep), nur ohne Bildaufbau dazwischen -- ein echter Stoerfall
 *  waehrenddessen bricht sofort ab und zeigt sich normal, statt stillschweigend
 *  ueberfahren zu werden. */
async function fastForwardXenon() {
  const s = app.engine.state;
  const btn = $('#rs-xenon-skip');
  const before = btn.textContent;
  app.xenonSkipping = true;
  setSpeed(0);
  btn.disabled = true;
  let elapsed = 0;
  while (elapsed < XENON_SKIP_CAP_S && s.X > XENON_SKIP_TARGET && !s.destroyed && !s.fault) {
    for (let i = 0; i < XENON_SKIP_CHUNK; i++) {
      app.engine.step(XENON_SKIP_DT);
      app.session.step(XENON_SKIP_DT, app.engine.trips.tiles(), app.engine.trips.unacknowledgedSeconds());
      elapsed += XENON_SKIP_DT;
      if (s.destroyed || s.fault) break;
    }
    setText(btn, t('btn_xenon_skip_progress', { h: (elapsed / 3600).toFixed(1) }));
    // Dem Tab eine Gelegenheit geben, das Bild und Eingaben zu bedienen --
    // sonst haengt der Browser bei 72h Notbremse mehrere Sekunden am Stueck.
    await new Promise((resolve) => { window.setTimeout(resolve, 0); });
  }
  btn.disabled = false;
  setText(btn, before);
  app.xenonSkipping = false;
  app.render.tick(s, performance.now());
  // Genau einer der drei Ausgaenge -- ein Stoerfall waehrend des Vorspulens
  // darf nie zugleich als "Xenon abgeklungen, weiter geht's" im Protokoll
  // landen.
  //
  // Der zweite Zweig fragt NUR nach s.destroyed, nicht zusaetzlich nach
  // !app.endShown: die rAF-Schleife laeuft waehrend der await-Pausen dieser
  // Funktion weiter und kann showDestroyed() selbst ausloesen. Dann stand
  // endShown schon, der Zweig fiel durch, und der else-Zweig setzte nach der
  // Kernzerstoerung "Zeitsprung" ins Protokoll und die Anlage wieder auf 1x --
  // mit offenem Kernzerstoerungs-Dialog davor.
  if (s.fault) {
    showFault(s.fault);
  } else if (s.destroyed) {
    if (!app.endShown) showDestroyed();
  } else {
    app.engine.ctx.log.push({ t: s.t_sim, key: 'event_time_skip', severity: 1 });
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
function saveSlotName(prefix) {
  const scnId = app.session && app.session.scenario ? app.session.scenario.id : null;
  return prefix + '-' + app.lastReactor + '-' + (scnId || 'free');
}

/** Automatische Sicherung -- eigener Slot, siehe AUTOSAVE_INTERVAL_MS oben. */
function saveCurrentGame() {
  const scnId = app.session && app.session.scenario ? app.session.scenario.id : null;
  return saveGame(app.engine, scnId, saveSlotName('auto'), app.session && app.session.run);
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
  const scnId = app.session && app.session.scenario ? app.session.scenario.id : null;
  return saveGame(app.engine, scnId, slot, app.session && app.session.run);
}

/** Speichern-Dialog: zeigt alle zehn Handplaetze DES AKTUELLEN Reaktortyps,
 *  belegt (mit Datum/Szenario) oder frei, und schreibt beim Anklicken sofort
 *  in den gewaehlten Slot -- die angezeigten Metadaten SIND die
 *  Bestaetigung, kein zusaetzliches "Wirklich ueberschreiben?" noetig (das
 *  gibt es nur beim Loeschen, siehe makeDeleteSaveButton()). */
function openSaveSlots() {
  const modal = $('#rs-save-slots');
  const list = $('#rs-slot-list');
  const reactorId = app.lastReactor;
  const slotRe = new RegExp(`^manual-${reactorId}-slot(\\d+)$`);
  list.replaceChildren();
  Promise.all([app.scenariosPromise, api.listSaves()]).then(([, r]) => {
    const saves = (r.ok && r.data && r.data.saves) || [];
    const bySlot = new Map();
    for (const sv of saves) {
      const m = sv.slot && sv.slot.match(slotRe);
      if (m) bySlot.set(Number(m[1]), sv);
    }
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
      btn.addEventListener('click', () => {
        saveManualGame(slot).then((ok) => {
          modal.hidden = true;
          flash($('#rs-save'), t(ok ? 'save_ok' : 'save_failed'));
          if (ok) refreshResumeList();
        });
      });
      const row = [btn];
      // Loeschen nur anbieten, wo etwas zum Loeschen da ist -- ein leerer
      // Slot hat nichts, das verschwinden koennte.
      if (sv) row.push(makeDeleteSaveButton(slot, openSaveSlots));
      list.append(el('div.rs-resume-row', null, row));
    }
    modal.hidden = false;
  });
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
  if (app.horn) app.horn.scram();
  record(app.engine, 'scram', null);
  setSpeed(1);
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

function toMenu() {
  if (app.loop) app.loop.stop();
  if (app.autosaveTimer) { window.clearInterval(app.autosaveTimer); app.autosaveTimer = null; }
  // Die Sirene laeuft als eigene Dauerschleife unabhaengig von loop/bgMusic
  // (siehe Horn in annunciator.js) -- ohne silence() hupt eine unquittierte
  // Meldung im Hauptmenue weiter, obwohl die Runde laengst verlassen ist.
  if (app.horn) app.horn.silence();
  app.bgMusic.stop();
  app.introMusic.start();
  $('#rs-app').hidden = true;
  $('#rs-start').hidden = false;
  refreshResumeList();
}

/** Auswertung am Ende eines Szenarios. */
function showDebrief(result, failed) {
  setSpeed(0);
  app.bgMusic.stop();
  const verdict = $('#rs-debrief-verdict');
  const ok = !failed;
  setAttr(verdict, 'data-ok', ok ? '1' : '0');
  setText(verdict, ok ? t('debrief_completed') : `${t('debrief_failed')} — ${t(failed)}`);
  setText($('#rs-debrief-score'), result ? String(result.score) : '—');

  const parts = $('#rs-debrief-parts');
  parts.replaceChildren();
  if (result) {
    const sum = result.summary;
    const p = result.parts || {};
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
  submit.hidden = !result;
  if (result) {
    app.pendingResult = result;
    const name = $('#rs-debrief-name');
    try { name.value = window.localStorage.getItem('rs-name') || ''; } catch { /* privates Fenster */ }
    loadScores(result.summary.reactor, result.summary.scenario);
  }
  $('#rs-debrief').hidden = false;
}

/** Bestenliste zum gerade gespielten Szenario nachladen. */
function loadScores(reactor, scenario) {
  api.listScores(reactor, scenario, 10).then((r) => {
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

async function boot(reactorId, scenarioDef, loadSlot, cold) {
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
  const isColdStart = !!cold && !loadSlot;

  // Für den Neustart-Knopf in Auswertung und Kernzerstörung gemerkt -- ein
  // Spielstand zählt dabei nicht als Szenario, "Neustart" fängt dann frei an.
  app.lastReactor = reactorId;
  app.lastScenarioDef = loadSlot ? null : (scenarioDef || null);
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

  $('#rs-start').hidden = true;
  $('#rs-app').hidden = false;

  // Wartet auf die einmal beim Laden gestartete Abfrage (siehe oben) --
  // praktisch immer schon fertig, sobald der Spieler bis hierher geklickt
  // hat. buildStatusBar() MUSS vor buildPanels() laufen: dessen
  // Wertebindungen sammelt es per querySelectorAll('[data-v]') genau einmal,
  // aus dem, was zu dem Zeitpunkt im DOM steht.
  const prefs = await app.prefsPromise;
  buildStatusBar();
  // Gleicher Grund wie beim '[data-stat-label="dnbr"]' im Einstellungen-
  // Dialog: DNBR/CPR ist derselbe Wert, der Name wechselt nur mit dem Typ.
  const marginTile = statusTiles.get('dnbr');
  if (marginTile) setText($('.rs-stat-k', marginTile), t(plant.spec.marginKey || 'val_dnbr'));
  applyStatusSelection(sanitizeStatusKeys(prefs.statusBar && prefs.statusBar[reactorId]));

  app.endShown = false;
  app.engine = createEngine(plant, {
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
  // wieder verworfen (siehe loadGame()-Aufruf am Ende dieser Funktion): ein
  // Sprung auf einen gespeicherten Zustand lässt sich nicht aus Schritten
  // plus Protokoll nachrechnen.
  attachRecorder(app.engine);
  app.session = new Session(app.engine, scenarioDef);
  app.session.onEnd = (result, failed) => showDebrief(result, failed);
  // Akustische Vorwarnung, 2-5 Minuten vor einem geplanten Ereignis -- nur
  // bei Szenarien relevant, dueAlerts() bleibt im freien Spiel leer.
  app.session.onAlert = () => playClip('geiger_game_alert.mp3', 0.6);
  app.session.start();
  // Nur ein Szenario hat eine Einweisung, die es wert ist, erneut
  // aufzurufen -- im freien Spiel gibt es keine, der Knopf bleibt weg.
  $('#rs-briefing-btn').hidden = app.session.free;
  app.render.clear();
  // prefs.helper ist ungesetzt bei jedem Spieler, der die Kopfzeile im
  // Startbildschirm nie angefasst hat -- Standard ist AN, siehe rs-helper-
  // toggle in initStart().
  const built = buildPanels(app.engine, app.render, app.prefs.helper !== false);
  app.horn = built.horn;
  app.jogRod = built.jogRod;
  app.rodSound = built.rodSound;
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
    if (state.destroyed && !app.endShown) showDestroyed();

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

  // Einen Spielstand erst anwenden, wenn die Anlage steht: die Regler und
  // Pumpen schwingen sich dann aus dem geladenen Zustand von selbst ein.
  if (loadSlot) {
    // app.session.run ist optional (null im freien Spiel, siehe
    // Session-Konstruktor) -- persist.js restore() ueberspringt es dann
    // einfach, wie bei jedem Feld ohne Gegenstueck.
    loadGame(app.engine, loadSlot, app.session && app.session.run).then((err) => {
      if (err) { flash($('#rs-save'), t('load_failed')); return; }
      // Ein geladener Spielstand springt auf einen fremden Zustand -- das
      // Protokoll bis hierher (leer oder nicht) reicht dann nicht mehr, um
      // den Lauf aus Schritten plus Handlungen nachzurechnen. app.engine.
      // recorder wird dadurch null; api.submitScore() schickt dann kein
      // Protokoll mit, und der Server faellt auf die reine
      // Plausibilitaetspruefung zurueck (siehe scoring.py).
      app.engine.recorder = null;
      // Quittierstatus der Meldetafel zeigt sich von selbst im naechsten
      // Bild (annun.update() liest jeden Takt engine.trips.tiles() neu, das
      // restore() oben schon veraendert hat) -- nur das Log-Panel muss
      // einmalig nachgetragen werden, es haengt nur an, statt neu zu lesen.
      if (app.engine.ctx.history.length) built.annun.log(app.engine.ctx.history);
    });
  }
}

// ── Start ────────────────────────────────────────────────────────────────────

initStart();
setAttr(document.documentElement, 'data-rs-version', window.RS_CFG ? window.RS_CFG.version : '0');
