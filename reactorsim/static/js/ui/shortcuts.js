// Tastenkuerzel-Uebersicht.
//
// Reine Datenliste wie beim Glossar (glossary.js) -- Text kommt aus den
// Sprachdateien. Muss von Hand synchron bleiben mit den tatsaechlichen
// keydown-Zuhoerern in main.js (initControls: Leertaste/Ziffern/Stabfahrt/
// Q fuer Quittieren/Panel-Fenster ueber PANEL_KEYS/O fuer die
// Instrumentenuebersicht; initStart: Strg+S/X/Z/M,
// rundenunabhaengig) und panels.js (buildPanels, Meldetafel-Hilfe): hier
// steht nur die Erklaerung, nicht der Code, der sie umsetzt.

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
  { key: 'sc_ack', def: 'sc_ack_d' },
  { key: 'sc_panel_core', def: 'sc_panel_core_d' },
  { key: 'sc_panel_prim', def: 'sc_panel_prim_d' },
  { key: 'sc_panel_sec', def: 'sc_panel_sec_d' },
  { key: 'sc_panel_grid', def: 'sc_panel_grid_d' },
  { key: 'sc_panel_mimic', def: 'sc_panel_mimic_d' },
  { key: 'sc_panel_trend', def: 'sc_panel_trend_d' },
  { key: 'sc_panel_alarm', def: 'sc_panel_alarm_d' },
  { key: 'sc_panel_chem', def: 'sc_panel_chem_d' },
  { key: 'sc_instruments', def: 'sc_instruments_d' },
  { key: 'sc_escape', def: 'sc_escape_d' },
];
