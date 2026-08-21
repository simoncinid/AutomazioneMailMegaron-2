/**
 * Ordina tab lead per data in colonna C (dd/MM/yyyy HH:mm:ss).
 *
 * 1) Imposta sortLeadSheetName sotto (o usa sortAllAgentSheetsByColC)
 * 2) Esegui sortLeadByData()
 * 3) sortLeadInstallDailyTrigger() — ordinamento automatico ogni giorno alle 3:00
 */

// ═══ MODIFICA QUI ═══
const sortLeadSheetName = "TOMMASO"; // nome tab esatto (es. "stefania", "TOMMASO")
const sortLeadAscending = true; // true = più vecchi in alto | false = più recenti in alto
// ═══════════════════

const sortLeadCfg = {
  firstDataRow: 2, // riga 1 = header
  colDataAssegnazione: 3, // C
  timezone: "Europe/Rome",
};

const sortLeadAgentTabs = [
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
  "Marta",
];

/** Ordina il tab impostato in sortLeadSheetName. */
function sortLeadByData() {
  const name = String(sortLeadSheetName || "").trim();
  if (!name) throw new Error("Imposta sortLeadSheetName in cima al file");

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Foglio non trovato: "' + name + '"');

  sortSheetByColC_(sh, sortLeadAscending !== false);
}

/** Ordina tutti i tab agente. */
function sortAllAgentSheetsByColC() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const seen = {};
  let count = 0;

  for (let i = 0; i < sortLeadAgentTabs.length; i++) {
    const tabName = String(sortLeadAgentTabs[i]).trim();
    const key = tabName.toLowerCase();
    if (!tabName || seen[key]) continue;
    seen[key] = true;

    const sh = ss.getSheetByName(tabName);
    if (!sh) continue;

    const rows = sortSheetByColC_(sh, sortLeadAscending !== false);
    if (rows > 0) count++;
  }

  ss.toast("Ordinati " + count + " tab agente", "Sort lead", 6);
}

/** Trigger giornaliero alle 3:00 (dopo QZ9 alle 2:00). */
function sortLeadInstallDailyTrigger() {
  const handler = "sortAllAgentSheetsByColC";
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger(handler).timeBased().everyDays(1).atHour(3).create();
  SpreadsheetApp.getActiveSpreadsheet().toast("Trigger sort 3:00 installato", "Sort lead", 5);
}

function sortSheetByColC_(sh, ascending) {
  const lastRow = sortFindLastDataRow_(sh);
  if (lastRow < sortLeadCfg.firstDataRow) {
    SpreadsheetApp.getActiveSpreadsheet().toast("Nessun dato in " + sh.getName(), "Sort lead", 4);
    return 0;
  }

  const lastCol = Math.max(sh.getLastColumn(), sortLeadCfg.colDataAssegnazione);
  const a1 =
    "A" +
    sortLeadCfg.firstDataRow +
    ":" +
    sortColToLetter_(lastCol) +
    lastRow;
  const range = sh.getRange(a1);
  const values = range.getValues();
  const backgrounds = range.getBackgrounds();

  const indexed = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const dtRaw = row[sortLeadCfg.colDataAssegnazione - 1];
    indexed.push({
      idx: i,
      row: row,
      bg: backgrounds[i],
      ts: sortParseDate_(dtRaw),
    });
  }

  indexed.sort(function (a, b) {
    const ta = a.ts;
    const tb = b.ts;
    const aMissing = ta == null;
    const bMissing = tb == null;
    if (aMissing && bMissing) return a.idx - b.idx;
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (ta === tb) return a.idx - b.idx;
    return ascending ? ta - tb : tb - ta;
  });

  range.setValues(
    indexed.map(function (x) {
      return x.row;
    }),
  );
  range.setBackgrounds(
    indexed.map(function (x) {
      return x.bg;
    }),
  );

  sortClearFilterSort_(sh);

  SpreadsheetApp.getActiveSpreadsheet().toast(
    sh.getName() + ": " + values.length + " righe ordinate (" + (ascending ? "↑ data" : "↓ data") + ")",
    "Sort lead",
    5,
  );

  return values.length;
}

function sortFindLastDataRow_(sh) {
  const lastRow = sh.getLastRow();
  if (lastRow < sortLeadCfg.firstDataRow) return sortLeadCfg.firstDataRow - 1;

  const col = sortLeadCfg.colDataAssegnazione;
  const vals = sh.getRange(sortLeadCfg.firstDataRow, col, lastRow, col).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    const cell = vals[i][0];
    if (cell !== null && cell !== undefined && String(cell).trim() !== "") {
      return sortLeadCfg.firstDataRow + i;
    }
  }
  return sortLeadCfg.firstDataRow - 1;
}

function sortClearFilterSort_(sh) {
  try {
    const filter = sh.getFilter();
    if (!filter) return;
    const range = filter.getRange();
    sh.getRange(range.getRow(), range.getColumn(), range.getNumRows(), range.getNumColumns()).createFilter();
  } catch (e) {
    Logger.log("[sort] clear filter sort skip " + sh.getName() + ": " + e);
  }
}

/** Parse dd/MM/yyyy[ HH:mm[:ss]] e Date/seriali foglio. */
function sortParseDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getTime();

  if (typeof v === "number" && isFinite(v)) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const dNum = new Date(ms);
    if (!isNaN(dNum.getTime())) return dNum.getTime();
  }

  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]) - 1;
    let yy = Number(m[3]);
    if (yy < 100) yy += 2000;
    const hh = Number(m[4] || 0);
    const mi = Number(m[5] || 0);
    const ss = Number(m[6] || 0);
    const d = new Date(yy, mm, dd, hh, mi, ss);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  const dIso = new Date(s);
  return isNaN(dIso.getTime()) ? null : dIso.getTime();
}

function sortColToLetter_(col) {
  let n = Number(col);
  if (!Number.isFinite(n) || n < 1) return "A";
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
