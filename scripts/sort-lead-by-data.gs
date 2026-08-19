/**
 * Ordina un tab lead per data in colonna C (dd/MM/yyyy HH:mm:ss).
 *
 * 1) Imposta sortLeadSheetName sotto
 * 2) Esegui sortLeadByData() da Apps Script
 */

// ═══ MODIFICA QUI ═══
const sortLeadSheetName = "TOMMASO"; // nome tab esatto (es. "stefania", "TOMMASO")
const sortLeadAscending = true; // true = più vecchi in alto | false = più recenti in alto
// ═══════════════════

const sortLeadCfg = {
  firstDataRow: 2, // riga 1 = header
  colDataAssegnazione: 3, // C
};

/** Esegui questa funzione dopo aver impostato sortLeadSheetName. */
function sortLeadByData() {
  const name = String(sortLeadSheetName || "").trim();
  if (!name) throw new Error("Imposta sortLeadSheetName in cima al file");

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Foglio non trovato: "' + name + '"');

  sortSheetByColC_(sh, sortLeadAscending !== false);
}

function sortSheetByColC_(sh, ascending) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < sortLeadCfg.firstDataRow) {
    SpreadsheetApp.getActiveSpreadsheet().toast("Nessun dato in " + sh.getName(), "Sort lead", 4);
    return;
  }

  const numRows = lastRow - sortLeadCfg.firstDataRow + 1;
  const range = sh.getRange(sortLeadCfg.firstDataRow, 1, numRows, lastCol);
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

  SpreadsheetApp.getActiveSpreadsheet().toast(
    sh.getName() + ": " + numRows + " righe ordinate (" + (ascending ? "↑ data" : "↓ data") + ")",
    "Sort lead",
    5,
  );
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
