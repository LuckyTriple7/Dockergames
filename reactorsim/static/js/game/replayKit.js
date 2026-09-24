// Kit-Tausch für hooks.uiControls().
//
// hooks.uiControls(s, sp, ctx, kit) kennt kein DOM (siehe Dateikopf von
// plants/pwr.js) -- der Kit-Parameter ist die einzige Nahtstelle nach
// außen, "damit die Typdatei nichts über das DOM wissen muss". Genau das
// macht sich hier ein zweites Mal nützlich: wer den Kit ersetzt, bekommt
// entweder
//
//   (a) dieselben Bedienelemente MIT Aufzeichnung jeder Handlung
//       (recordingKit -- Browser, reicht an den echten, DOM bauenden Kit
//       durch), oder
//   (b) gar keine Oberfläche, nur die blanken Mutations-Funktionen zum
//       späteren Anwenden (captureKit -- Server-Nachrechnung, siehe
//       replay.js)
//
// ohne die typspezifische Mutationslogik selbst ein zweites Mal zu
// schreiben. Beide benutzen dieselben Schlüssel ('auto:'+labelKey usw.) --
// sonst findet die Nachrechnung eine aufgezeichnete Handlung nicht wieder.

/** @param {object} kit     die echten, DOM bauenden Fabriken aus ui/controls.js
 *  @param {(id:string, value:*)=>void} record */
export function recordingKit(kit, record) {
  return {
    indicator: (options) => kit.indicator(options),
    autoSwitch: (labelKey, initial, onChange) => kit.autoSwitch(labelKey, initial, (v) => {
      record('auto:' + labelKey, v);
      onChange(v);
    }),
    station: (o) => kit.station({
      ...o,
      write: (v) => { record('write:' + o.labelKey, v); o.write(v); },
      setAuto: (v) => { record('auto:' + o.labelKey, v); o.setAuto(v); },
    }),
    slider: (o) => kit.slider({
      ...o,
      onInput: (v) => { record('write:' + o.labelKey, v); o.onInput(v); },
    }),
    buttonGroup: (labelKey, options, initial, onChange) => kit.buttonGroup(labelKey, options, initial, (v) => {
      record('btn:' + labelKey, v);
      onChange(v);
    }),
  };
}

/** @param {Record<string, (value:*)=>void>} map  wird befüllt: Schlüssel wie
 *  bei recordingKit() oben, Wert die echte Mutations-Funktion, gebunden an
 *  die Engine, mit der hooks.uiControls() aufgerufen wurde. */
export function captureKit(map) {
  const stub = { node: null, set() {} };
  return {
    indicator: () => stub,
    autoSwitch: (labelKey, initial, onChange) => { map['auto:' + labelKey] = onChange; return stub; },
    station: (o) => {
      map['write:' + o.labelKey] = o.write;
      map['auto:' + o.labelKey] = o.setAuto;
      return stub;
    },
    slider: (o) => { map['write:' + o.labelKey] = o.onInput; return stub; },
    buttonGroup: (labelKey, options, initial, onChange) => { map['btn:' + labelKey] = onChange; return stub; },
  };
}
