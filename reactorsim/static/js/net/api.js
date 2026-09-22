// Dünne Hülle um fetch.
//
// Das Spiel muss ohne den Server laufen -- er liefert Szenarienliste,
// Spielstände und Bestenliste, aber keine Physik. Jeder Fehler hier ist
// deshalb ein Achselzucken und kein Abbruch: die Aufrufer bekommen null und
// machen weiter.

const BASE = '';

async function request(method, path, body) {
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' }
                    : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      // Sitzung abgelaufen. Ohne diesen Zweig laufen alle weiteren Aufrufe
      // still ins Leere, und der Spieler sieht nur, dass nichts mehr
      // gespeichert wird -- ohne zu erfahren warum.
      window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
      return { ok: false, status: 401, data: null };
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, data };
    return { ok: true, status: res.status, data };
  } catch {
    // Kein Server erreichbar: offline weiterspielen.
    return { ok: false, status: 0, data: null };
  }
}

export const api = {
  meta: () => request('GET', '/api/meta'),
  listSaves: () => request('GET', '/api/saves'),
  readSave: (slot) => request('GET', `/api/saves/${encodeURIComponent(slot)}`),
  writeSave: (slot, blob) => request('PUT', `/api/saves/${encodeURIComponent(slot)}`, blob),
  deleteSave: (slot) => request('DELETE', `/api/saves/${encodeURIComponent(slot)}`),
  listScores: (reactor, scenario, limit = 20) => {
    const q = new URLSearchParams();
    if (reactor) q.set('reactor', reactor);
    if (scenario) q.set('scenario', scenario);
    q.set('limit', String(limit));
    return request('GET', `/api/highscores?${q}`);
  },
  // `log` ist optional (null bei einem geladenen Spielstand, siehe main.js
  // boot()) -- das aufgezeichnete Protokoll erlaubt dem Server, den Lauf
  // selbst nachzurechnen statt der Zusammenfassung nur auf Plausibilität zu
  // vertrauen (siehe scoring.py, verify_run.mjs).
  submitScore: (name, summary, log) => request('POST', '/api/highscores', { name, summary, log }),
  // Ein beendeter Lauf fuer die Spielhistorie im Admin-Panel -- unabhaengig
  // davon, ob jemals eine Wertung eingereicht wird (siehe main.js
  // reportRun(), app.py /api/runs). Scheitert der Aufruf, geht der Lauf
  // verloren und sonst nichts: das Spiel selbst haengt nicht daran.
  recordRun: (run) => request('POST', '/api/runs', run),
  // Den BEGINN eines Laufs melden, damit der Server seine Dauer selbst misst
  // statt der gemeldeten zu glauben (siehe app.py /api/runs/start, OpenRuns).
  // Die Antwort traegt eine Kennung, die recordRun() als `run` zurueckgibt.
  // Scheitert der Aufruf, laeuft alles wie vorher -- ohne Messung, mit dem
  // alten Deckel; das Spiel haengt daran nicht.
  startRun: (run) => request('POST', '/api/runs/start', run),
  // Einen Xenon-Zeitsprung anmelden (main.js fastForwardXenon(), app.py
  // /api/runs/skip). Der Knopf rechnet schneller als der Bildtakt; ohne
  // diese Meldung kuerzt der Server die gemeldete simulierte Dauer am Ende
  // auf das, was bei 60x moeglich gewesen waere. Scheitert der Aufruf,
  // bleibt der Sprung selbst davon unberuehrt.
  noteSkip: (run, seconds) => request('POST', '/api/runs/skip', { run, seconds }),
  readAccount: () => request('GET', '/api/account'),
  changePassword: (current, next) =>
    request('POST', '/api/account/password', { current, new: next }),
  // Ein Bild des laufenden Leitstands fuer ein zweites Geraet ablegen bzw.
  // abholen (siehe net/monitorLink.js, app.py MonitorRelay). Der Server haelt
  // genau EIN Bild je Konto, nur im Arbeitsspeicher. `seq` sagt beim Abholen,
  // welches der Monitor schon hat -- steht das Bild still, kommt nur das
  // Alter zurueck und keine Nutzlast.
  sendMonitor: (frame) => request('POST', '/api/monitor', frame),
  readMonitor: (seq) => request('GET', `/api/monitor?seq=${encodeURIComponent(seq || 0)}`),
  readPrefs: () => request('GET', '/api/prefs'),
  writePrefs: (blob) => request('PUT', '/api/prefs', blob),
};
