/**
 * Ripara righe lead shiftate a destra (dati da col. B invece che A).
 *
 * Per ogni tab agente: se una riga dati (da riga 2) ha valore in colonna K,
 * sposta l'intera riga di una cella a sinistra (B→A, C→B, …, K→J).
 *
 * 1) Imposta fixShiftedDryRun = false quando sei pronto
 * 2) Esegui fixShiftedLeadRows()
 *
 * Tab processati: solo fogli agente (allineati a qz9AgentTabByCode).
 */

// ═══ MODIFICA QUI ═══
const fixShiftedDryRun = true; // true = solo conteggio, nessuna scrittura
// ═══════════════════

const fixShiftedCfg = {
  firstDataRow: 2,
  colK: 11, // K = indicatore riga shiftata (lead normali A:J)
};

/** Nomi tab agente (stesso elenco di qz9AgentTabByCode). */
const fixShiftedAgentTabs = [
  "luis",
  "rebecca",
  "elisabetta",
  "fausto",
  "matteo",
  "viviana",
  "massimiliano",
  "guido",
  "lisa",
  "alfredo",
  "mary",
  "massimo",
  "davide",
  "eros",
  "samuele",
  "giuseppe",
  "TOMMASO",
  "mattia",
  "marco",
  "luigi",
  "stefania",
  "valentina",
];

/** Esegui per riparare tutti i tab agente. */
function fixShiftedLeadRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dryRun = fixShiftedDryRun === true;
  const sheets = fixShiftedGetAgentSheets_(ss);

  if (sheets.length === 0) {
    throw new Error("Nessun tab agente trovato nel file");
  }

  let totalRows = 0;
  const details = [];

  for (let s = 0; s < sheets.length; s++) {
    const sh = sheets[s];
    const fixed = fixShiftedSheet_(sh, dryRun);
    totalRows += fixed;
    if (fixed > 0) {
      details.push(sh.getName() + ": " + fixed);
    }
  }

  const msg =
    (dryRun ? "[DRY RUN] " : "") +
    "Righe riparate: " +
    totalRows +
    (details.length ? " (" + details.join(", ") + ")" : "");

  Logger.log(msg);
  ss.toast(msg, "Fix righe shiftate", 8);
}

function fixShiftedGetAgentSheets_(ss) {
  const wanted = {};
  for (let i = 0; i < fixShiftedAgentTabs.length; i++) {
    wanted[String(fixShiftedAgentTabs[i]).trim().toLowerCase()] = true;
  }

  return ss.getSheets().filter(function (sh) {
    return wanted[sh.getName().trim().toLowerCase()] === true;
  });
}

function fixShiftedSheet_(sh, dryRun) {
  const lastRow = sh.getLastRow();
  if (lastRow < fixShiftedCfg.firstDataRow) return 0;

  const lastCol = Math.max(sh.getLastColumn(), fixShiftedCfg.colK);
  const numRows = lastRow - fixShiftedCfg.firstDataRow + 1;
  const range = sh.getRange(fixShiftedCfg.firstDataRow, 1, numRows, lastCol);
  const values = range.getValues();
  const backgrounds = range.getBackgrounds();
  let fixed = 0;

  for (let i = 0; i < values.length; i++) {
    if (!fixShiftedHasValueInColK_(values[i])) continue;

    values[i] = fixShiftedShiftRowLeftOne_(values[i]);
    backgrounds[i] = fixShiftedShiftRowLeftOne_(backgrounds[i]);
    fixed++;
  }

  if (fixed > 0 && !dryRun) {
    range.setValues(values);
    range.setBackgrounds(backgrounds);
  }

  return fixed;
}

function fixShiftedHasValueInColK_(row) {
  const v = row[fixShiftedCfg.colK - 1];
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "number") return !isNaN(v);
  if (v instanceof Date) return !isNaN(v.getTime());
  return true;
}

/** Sposta tutti i valori di una cella a sinistra; l'ultima colonna viene svuotata. */
function fixShiftedShiftRowLeftOne_(row) {
  const out = row.slice(1);
  while (out.length < row.length) out.push("");
  return out;
}
