// Tastenkuerzel-Uebersicht.
//
// Reine Datenliste wie beim Glossar (glossary.js) -- Text kommt aus den
// Sprachdateien. Muss von Hand synchron bleiben mit den tatsaechlichen
// keydown-Zuhoerern in main.js (initControls: Leertaste/Ziffern/Stabfahrt;
// initStart: Strg+S/X/Z/M, rundenunabhaengig) und panels.js (buildPanels,
// Meldetafel-Hilfe): hier steht nur die Erklaerung, nicht der Code, der sie
// umsetzt.

export const SHORTCUTS = [
  { key: 'sc_pause', def: 'sc_pause_d' },
  { key: 'sc_rods', def: 'sc_rods_d' },
  { key: 'sc_speed1', def: 'sc_speed1_d' },
  { key: 'sc_speed2', def: 'sc_speed2_d' },
  { key: 'sc_speed3', def: 'sc_speed3_d' },
  { key: 'sc_speed4', def: 'sc_speed4_d' },
  { key: 'sc_save', def: 'sc_save_d' },
  { key: 'sc_menu', def: 'sc_menu_d' },
  { key: 'sc_scram', def: 'sc_scram_d' },
  { key: 'sc_mute', def: 'sc_mute_d' },
  { key: 'sc_escape', def: 'sc_escape_d' },
];
