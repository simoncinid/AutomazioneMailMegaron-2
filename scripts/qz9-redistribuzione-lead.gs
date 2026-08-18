/**
 * QZ9 - Redistribuzione lead "Da Chiamare" oltre soglia giorni
 * Allineato a AutomazioneMailMegaron (ago 2026).
 *
 * Esegui:
 * 1) qz9RunControlloQuotidianoLead   (test/manuale, prima con dryRun: true)
 * 2) qz9InstallTriggerGiornaliero    (una volta)
 *
 * POOL ATTIVI
 * - Pisa:      massimo, davide, eros, samuele, giuseppe, tommaso, mattia, marco, luigi
 * - Pontedera: luis
 * - Livorno:   matteo, viviana, massimiliano, guido
 * - Lucca:     alfredo, mary
 *
 * FERIE (tab sorgente restano attivi; lead nuovi → AG-PISA / AG-PONTEDERA nel backend)
 * - Pisa:      valentina, marta, stefania
 * - Pontedera: fausto, elisabetta, rebecca
 *
 * ═══ RIATTIVARE UN AGENTE AL 100% (es. STEFANIA) ═══
 * Checklist completa anche in src/config/suspendedAgents.ts (backend Node).
 * 1) qz9SuspendedAgentOwnerZone     → rimuovere agente
 * 2) qz9AgentOwnerZoneByCode       → aggiungere agente con zona owner
 * 3) qz9PoolsByZone[zona]          → aggiungere agente al pool round-robin
 * 4) src/config/loadEnv.ts         → zone "FERIE <NOME>": ripristinare tab agente
 * 5) src/services/leadProcessor.ts → decommentare in PISA/PONTEDERA_AGENT_SHEETS
 * 6) src/config/suspendedAgents.ts → rimuovere da elenco sospesi
 * 7) src/services/leadAutoReply.ts → decommentare owner + pool
 */

const qz9Cfg = {
  timezone: "Europe/Rome",
  firstDataRow: 2,
  colDataAssegnazione: 3, // C
  colStato: 8, // H
  colEmail: 1, // A (solo log)
  colListingId: 2, // B (solo log)
  colProvince: 10, // J (enrichment backend)
  daysThreshold: 3,
  targetStatusNorm: "da chiamare",
  graphSheetName: "_graph_processed",
  debug: true,
  dryRun: false, // true = nessuna scrittura/cancellazione/counter
  maxRowLogsPerSheet: 200,
  redistributedRowBackground: "#f4cccc",
};

// Tab AG-* (sorgenti agenzia)
const qz9AgencyZoneBySheet = {
  "AG-PONTEDERA": "pontedera",
  "AG-LIVORNO": "livorno",
  "AG-PISA": "pisa",
  "AG-LUCCA": "lucca",
  "AG-VIAREGGIO": "viareggio",
};

// AG da NON redistribuire (KEEP)
const qz9KeepAgencySheets = new Set(["AG-PISA", "AG-LUCCA", "AG-VIAREGGIO"]);

/**
 * Pool destinazione round-robin (allineato a leadAutoReply.ts / leadProcessor.ts).
 * RIATTIVARE agente in ferie: aggiungerlo qui + qz9AgentOwnerZoneByCode
 * + togliere da qz9SuspendedAgentOwnerZone. V. header e suspendedAgents.ts.
 */
const qz9PoolsByZone = {
  pontedera: ["luis"],
  livorno: ["matteo", "viviana", "massimiliano", "guido"],
  lucca: ["alfredo", "mary"],
  pisa: ["massimo", "davide", "eros", "samuele", "giuseppe", "tommaso", "mattia", "marco", "luigi"],
  viareggio: [],
};

// Agenti attivi — owner zona (routing da tab agente)
const qz9AgentOwnerZoneByCode = {
  // Livorno
  matteo: "livorno",
  viviana: "livorno",
  massimiliano: "livorno",
  guido: "livorno",
  lisa: "livorno", // assegnazione diretta, non in pool AG-LIVORNO

  // Lucca
  alfredo: "lucca",
  mary: "lucca",

  // Pisa — attivi
  massimo: "pisa",
  davide: "pisa",
  eros: "pisa",
  samuele: "pisa",
  giuseppe: "pisa",
  tommaso: "pisa",
  mattia: "pisa",
  marco: "pisa",
  luigi: "pisa",

  // Pontedera — attivi
  luis: "pontedera",
};

/**
 * FERIE: tab restano sorgenti (lead da redistribuire), fuori pool attivo.
 * RIATTIVARE: spostare in qz9AgentOwnerZoneByCode + pool + suspendedAgents.ts.
 */
const qz9SuspendedAgentOwnerZone = {
  // Pisa — RIATTIVARE: valentina, marta, stefania
  valentina: "pisa",
  marta: "pisa",
  stefania: "pisa",
  // Pontedera — RIATTIVARE: fausto, elisabetta, rebecca
  fausto: "pontedera",
  elisabetta: "pontedera",
  rebecca: "pontedera",
};

// Mappa codice agente -> nome tab reale nel file
const qz9AgentTabByCode = {
  // Pontedera — attivi
  luis: "luis",

  // Pontedera — FERIE
  rebecca: "rebecca",
  elisabetta: "elisabetta",
  fausto: "fausto",

  // Livorno
  matteo: "matteo",
  viviana: "viviana",
  massimiliano: "massimiliano",
  guido: "guido",
  lisa: "lisa",

  // Lucca
  alfredo: "alfredo",
  mary: "mary",

  // Pisa — attivi
  massimo: "massimo",
  davide: "davide",
  eros: "eros",
  samuele: "samuele",
  giuseppe: "giuseppe",
  tommaso: "TOMMASO",
  mattia: "mattia",
  marco: "marco",
  luigi: "luigi",

  // Pisa — FERIE (RIATTIVARE: spostare in blocco attivi sopra)
  stefania: "stefania",
  valentina: "valentina",
  marta: "Marta",
};

// Rebecca (ferie): tab sorgente; pool destinazione da provincia col. J
const qz9ProvinceRoutedAgents = new Set(["rebecca"]);

// provincia -> zona pool
const qz9ProvinceToZone = {
  pi: "pisa",
  pisa: "pisa",

  li: "livorno",
  livorno: "livorno",

  lu: "lucca",
  lucca: "lucca",

  pt: "pontedera",
  pontedera: "pontedera",

  viareggio: "viareggio",
  versilia: "viareggio",
};

function qz9RunControlloQuotidianoLead() {
  const lock = LockService.getScriptLock();
  lock.waitLock(28000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const now = new Date();
    const thresholdMs = qz9Cfg.daysThreshold * 24 * 60 * 60 * 1000;

    const sourceSheets = qz9BuildAllSourceSheets();
    const agentCodeBySheetNorm = qz9BuildAgentCodeBySheetNorm();

    const graphIncrements = new Map();
    const rrRunCursor = new Map();

    let totalScanned = 0;
    let totalCandidates = 0;
    let totalMoved = 0;
    let totalKept = 0;

    qz9Log(
      "START run=" +
        qz9FmtDate(now) +
        " threshold_days=" +
        qz9Cfg.daysThreshold +
        " dry_run=" +
        qz9Cfg.dryRun +
        " sources=" +
        sourceSheets.join(","),
    );

    for (let s = 0; s < sourceSheets.length; s++) {
      const sourceName = sourceSheets[s];
      const sourceSh = ss.getSheetByName(sourceName);

      if (!sourceSh) {
        qz9Log("[WARN] Foglio non trovato: " + sourceName);
        continue;
      }

      const lastRow = sourceSh.getLastRow();
      const lastCol = sourceSh.getLastColumn();
      if (lastRow < qz9Cfg.firstDataRow) {
        qz9Log("[INFO] Nessun dato in " + sourceName);
        continue;
      }

      const numRows = lastRow - qz9Cfg.firstDataRow + 1;
      const rows = sourceSh.getRange(qz9Cfg.firstDataRow, 1, numRows, lastCol).getValues();

      let sheetScanned = 0;
      let sheetCandidates = 0;
      let sheetMoved = 0;
      let sheetKept = 0;
      let sheetLogs = 0;

      qz9Log("[SHEET] " + sourceName + " rows=" + numRows);

      for (let i = rows.length - 1; i >= 0; i--) {
        sheetScanned++;
        const row = rows[i];
        const realRow = qz9Cfg.firstDataRow + i;

        const dtRaw = row[qz9Cfg.colDataAssegnazione - 1];
        const stRaw = row[qz9Cfg.colStato - 1];
        const leadEmail = String(row[qz9Cfg.colEmail - 1] || "");
        const listingId = String(row[qz9Cfg.colListingId - 1] || "");
        const provinceRaw = row[qz9Cfg.colProvince - 1];

        const assignedAt = qz9ParseDate(dtRaw);
        if (!assignedAt) continue;

        const statusNorm = qz9Norm(stRaw);
        if (statusNorm !== qz9Cfg.targetStatusNorm) continue;

        const ageMs = now.getTime() - assignedAt.getTime();
        if (ageMs <= thresholdMs) continue;

        sheetCandidates++;

        const route = qz9ComputeRouteForSource(sourceName, agentCodeBySheetNorm, provinceRaw);

        if (route.mode === "keep") {
          sheetKept++;
          if (sheetLogs < qz9Cfg.maxRowLogsPerSheet) {
            qz9Log(
              "[KEEP] " + sourceName + " row=" + realRow + " email=" + leadEmail + " id=" + listingId,
            );
            sheetLogs++;
          }
          continue;
        }

        if (route.mode === "skip") {
          if (sheetLogs < qz9Cfg.maxRowLogsPerSheet) {
            qz9Log("[SKIP] " + sourceName + " row=" + realRow + " reason=" + route.reason);
            sheetLogs++;
          }
          continue;
        }

        const rrKey = "qz9_rr_src_" + qz9Slug(route.routeKey || sourceName);
        const destCode = qz9PickRoundRobinCode(route.destPoolCodes, rrKey, !qz9Cfg.dryRun, rrRunCursor);
        const destSheetName = qz9AgentTabByCode[destCode] || destCode;
        const destSh = ss.getSheetByName(destSheetName);

        if (!destSh) throw new Error("Foglio destinazione non trovato: " + destSheetName);

        const movedRow = row.slice();
        movedRow[qz9Cfg.colDataAssegnazione - 1] = Utilities.formatDate(
          now,
          qz9Cfg.timezone,
          "dd/MM/yyyy HH:mm:ss",
        );
        movedRow[qz9Cfg.colStato - 1] = "Da Chiamare";

        if (!qz9Cfg.dryRun) {
          destSh.appendRow(movedRow);

          const newDestRow = destSh.getLastRow();
          destSh
            .getRange(newDestRow, 1, 1, movedRow.length)
            .setBackground(qz9Cfg.redistributedRowBackground);

          sourceSh.deleteRow(realRow);
        }

        sheetMoved++;

        if (route.sourceType === "agent") {
          const prev = graphIncrements.get(sourceName) || 0;
          graphIncrements.set(sourceName, prev + 1);
        }

        if (sheetLogs < qz9Cfg.maxRowLogsPerSheet) {
          qz9Log(
            "[MOVE] " +
              sourceName +
              " -> " +
              destSheetName +
              " row=" +
              realRow +
              " email=" +
              leadEmail +
              " id=" +
              listingId +
              " province=" +
              qz9SafeStr(provinceRaw) +
              " routeZone=" +
              (route.routeZone || "") +
              " routeReason=" +
              (route.routeReason || "") +
              " oldDate=" +
              qz9FmtDate(assignedAt) +
              " newDate=" +
              qz9FmtDate(now) +
              (qz9Cfg.dryRun ? " [DRY-RUN]" : ""),
          );
          sheetLogs++;
        }
      }

      totalScanned += sheetScanned;
      totalCandidates += sheetCandidates;
      totalMoved += sheetMoved;
      totalKept += sheetKept;

      qz9Log(
        "[SHEET-END] " +
          sourceName +
          " scanned=" +
          sheetScanned +
          " candidates=" +
          sheetCandidates +
          " moved=" +
          sheetMoved +
          " kept=" +
          sheetKept,
      );
    }

    if (!qz9Cfg.dryRun) {
      qz9ApplyGraphCounters(ss, graphIncrements, now);
    } else {
      qz9Log("[GRAPH] dry-run attivo: counter non aggiornati.");
    }

    qz9Log(
      "END scanned=" +
        totalScanned +
        " candidates=" +
        totalCandidates +
        " moved=" +
        totalMoved +
        " kept=" +
        totalKept,
    );
  } finally {
    lock.releaseLock();
  }
}

function qz9BuildAllSourceSheets() {
  const out = [];
  const seen = new Set();

  function add(name) {
    const s = String(name || "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  }

  Object.keys(qz9AgencyZoneBySheet).forEach(add);
  Object.keys(qz9AgentTabByCode).forEach(function (code) {
    add(qz9AgentTabByCode[code]);
  });

  return out;
}

function qz9BuildAgentCodeBySheetNorm() {
  const m = new Map();
  Object.keys(qz9AgentTabByCode).forEach(function (code) {
    m.set(qz9Norm(qz9AgentTabByCode[code]), code);
  });
  return m;
}

function qz9ResolveOwnerZone(sourceCode) {
  if (qz9AgentOwnerZoneByCode[sourceCode]) {
    return qz9AgentOwnerZoneByCode[sourceCode];
  }
  if (qz9SuspendedAgentOwnerZone[sourceCode]) {
    return qz9SuspendedAgentOwnerZone[sourceCode];
  }
  return "";
}

function qz9ComputeRouteForSource(sourceSheetName, agentCodeBySheetNorm, provinceRaw) {
  const agencyZone = qz9AgencyZoneBySheet[sourceSheetName];
  if (agencyZone) {
    if (qz9KeepAgencySheets.has(sourceSheetName)) return { mode: "keep" };

    const pool = (qz9PoolsByZone[agencyZone] || []).slice();
    if (!pool.length) return { mode: "skip", reason: "pool_vuoto_" + agencyZone };

    return {
      mode: "move",
      sourceType: "agency",
      destPoolCodes: pool,
      routeKey: "agency_" + sourceSheetName,
      routeZone: agencyZone,
      routeReason: "agency_pool",
    };
  }

  const sourceCode = agentCodeBySheetNorm.get(qz9Norm(sourceSheetName));
  if (!sourceCode) return { mode: "skip", reason: "sorgente_non_mappata" };

  const ownerZone = qz9ResolveOwnerZone(sourceCode);
  if (!ownerZone) return { mode: "skip", reason: "owner_zone_mancante_" + sourceCode };

  let routeZone = ownerZone;
  let routeReason = "owner_zone";

  if (qz9ProvinceRoutedAgents.has(sourceCode)) {
    const zoneFromProvince = qz9ResolveZoneFromProvince(provinceRaw);
    if (zoneFromProvince) {
      routeZone = zoneFromProvince;
      routeReason = "province_col_J";
    } else {
      routeReason = "province_unmapped_fallback_owner_zone";
    }
  }

  let zonePool = qz9PoolsByZone[routeZone] || [];
  let destPool = zonePool.filter(function (code) {
    return qz9Norm(code) !== qz9Norm(sourceCode);
  });

  if (!destPool.length && routeZone !== ownerZone) {
    zonePool = qz9PoolsByZone[ownerZone] || [];
    destPool = zonePool.filter(function (code) {
      return qz9Norm(code) !== qz9Norm(sourceCode);
    });
    routeZone = ownerZone;
    routeReason = routeReason + "_fallback";
  }

  if (!destPool.length) return { mode: "skip", reason: "no_altri_agenti_in_" + routeZone };

  return {
    mode: "move",
    sourceType: "agent",
    destPoolCodes: destPool,
    routeKey: "agent_" + sourceCode + "_" + routeZone,
    routeZone: routeZone,
    routeReason: routeReason,
  };
}

function qz9ResolveZoneFromProvince(rawProvince) {
  const raw = qz9Norm(rawProvince)
    .replace(/^provincia di\s+/, "")
    .replace(/^prov\.\s*/, "")
    .trim();

  if (!raw) return "";

  if (qz9ProvinceToZone[raw]) return qz9ProvinceToZone[raw];

  const tokens = raw.split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (qz9ProvinceToZone[t]) return qz9ProvinceToZone[t];
  }

  return "";
}

function qz9PickRoundRobinCode(poolCodes, cursorKey, persistCursor, rrRunCursor) {
  const props = PropertiesService.getScriptProperties();

  let cursor;
  if (rrRunCursor.has(cursorKey)) {
    cursor = rrRunCursor.get(cursorKey);
  } else {
    const raw = props.getProperty(cursorKey);
    cursor = Number(raw || "0");
    if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
  }

  const idx = cursor % poolCodes.length;
  const next = (idx + 1) % poolCodes.length;
  const dest = poolCodes[idx];

  rrRunCursor.set(cursorKey, next);
  if (persistCursor) props.setProperty(cursorKey, String(next));

  qz9Log(
    "[RR] key=" +
      cursorKey +
      " cursor_in=" +
      cursor +
      " idx=" +
      idx +
      " dest=" +
      dest +
      " cursor_out=" +
      next +
      (persistCursor ? "" : " [NO-COMMIT]"),
  );

  return dest;
}

function qz9ApplyGraphCounters(ss, incrementsMap, now) {
  if (!incrementsMap || incrementsMap.size === 0) {
    qz9Log("[GRAPH] Nessun incremento.");
    return;
  }

  let sh = ss.getSheetByName(qz9Cfg.graphSheetName);
  if (!sh) sh = ss.insertSheet(qz9Cfg.graphSheetName);

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 3).setValues([["agent_sheet", "redistributed_total", "last_update"]]);
  }

  const idxByAgentNorm = new Map();
  const lastRow = sh.getLastRow();

  if (lastRow >= 2) {
    const data = sh.getRange(2, 1, lastRow - 1, 3).getValues();
    for (let i = 0; i < data.length; i++) {
      const agentSheet = String(data[i][0] || "").trim();
      if (!agentSheet) continue;
      const total = Number(data[i][1] || 0);
      idxByAgentNorm.set(qz9Norm(agentSheet), {
        row: i + 2,
        agentSheet: agentSheet,
        total: Number.isFinite(total) ? total : 0,
      });
    }
  }

  incrementsMap.forEach(function (inc, agentSheet) {
    const key = qz9Norm(agentSheet);
    const found = idxByAgentNorm.get(key);

    if (found) {
      const nextTotal = found.total + inc;
      sh.getRange(found.row, 2, 1, 2).setValues([[nextTotal, now]]);
      sh.getRange(found.row, 3).setNumberFormat("dd/MM/yyyy HH:mm:ss");
      qz9Log("[GRAPH] update " + found.agentSheet + " +" + inc + " -> " + nextTotal);
    } else {
      sh.appendRow([agentSheet, inc, now]);
      const newRow = sh.getLastRow();
      sh.getRange(newRow, 3).setNumberFormat("dd/MM/yyyy HH:mm:ss");
      qz9Log("[GRAPH] insert " + agentSheet + " +" + inc);
    }
  });
}

function qz9ParseDate(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;

  if (typeof v === "number" && isFinite(v)) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const dNum = new Date(ms);
    if (!isNaN(dNum.getTime())) return dNum;
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
    return isNaN(d.getTime()) ? null : d;
  }

  const dIso = new Date(s);
  return isNaN(dIso.getTime()) ? null : dIso;
}

function qz9Norm(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function qz9Slug(v) {
  return qz9Norm(v)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function qz9FmtDate(d) {
  return Utilities.formatDate(d, qz9Cfg.timezone, "yyyy-MM-dd HH:mm:ss");
}

function qz9SafeStr(v) {
  const s = String(v || "").trim();
  return s || "-";
}

function qz9Log(msg) {
  if (!qz9Cfg.debug) return;
  Logger.log("[QZ9] " + msg);
}

function qz9InstallTriggerGiornaliero() {
  const handler = "qz9RunControlloQuotidianoLead";
  const triggers = ScriptApp.getProjectTriggers();

  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger(handler).timeBased().everyDays(1).atHour(2).create();
  qz9Log("Trigger installato: " + handler);
}
