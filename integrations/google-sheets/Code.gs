/**
 * Court Piece → Google Sheets money ledger sync.
 *
 * Paste this into the Sheet's Extensions → Apps Script editor, set SYNC_SECRET,
 * then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * The game posts the whole ledger here after every recorded game or payment
 * change; each sync rewrites the Summary, Settle now, Games, Player results,
 * Payments and Days tabs. Add your own tabs for anything custom — those are
 * never touched.
 */
const SYNC_SECRET = "PASTE-THE-SECRET-HERE";

function doPost(e) {
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    const payload = JSON.parse(e.postData.contents);
    if (!SYNC_SECRET || SYNC_SECRET.indexOf("PASTE-") === 0 || payload.secret !== SYNC_SECRET) {
      return json_({ ok: false, error: "Wrong or missing secret" });
    }
    lock.waitLock(30000);
    locked = true;
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    spreadsheet.setSpreadsheetTimeZone("Asia/Kolkata");
    payload.sheets.forEach(function (table, index) {
      writeTable_(spreadsheet, table, index);
    });
    return json_({ ok: true, sheets: payload.sheets.length, exportedAt: payload.exportedAt });
  } catch (error) {
    return json_({ ok: false, error: String((error && error.message) || error) });
  } finally {
    if (locked) lock.releaseLock();
  }
}

// Visit the web app URL in a browser to check the deployment is live.
function doGet() {
  return json_({ ok: true, service: "court-piece-sheet-sync" });
}

function writeTable_(spreadsheet, table, index) {
  const sheet = spreadsheet.getSheetByName(table.name) || spreadsheet.insertSheet(table.name);
  spreadsheet.setActiveSheet(sheet);
  spreadsheet.moveActiveSheet(index + 1);

  const width = table.headers.length;
  const rows = [table.headers].concat(table.rows).map(function (row) {
    const out = row.slice(0, width);
    while (out.length < width) out.push("");
    return out;
  });

  if (sheet.getMaxRows() < rows.length) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length - sheet.getMaxRows());
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  sheet.clear();

  const isFormula = function (cell) { return typeof cell === "string" && cell.charAt(0) === "="; };
  sheet.getRange(1, 1, rows.length, width).setValues(rows.map(function (row) {
    return row.map(function (cell) { return isFormula(cell) ? "" : cell; });
  }));
  rows.forEach(function (row, r) {
    row.forEach(function (cell, c) {
      if (isFormula(cell)) sheet.getRange(r + 1, c + 1).setFormula(cell);
    });
  });

  sheet.getRange(1, 1, 1, width).setFontWeight("bold").setBackground("#1f2937").setFontColor("#ffffff");
  sheet.setFrozenRows(1);
  Object.keys(table.formats || {}).forEach(function (column) {
    sheet.getRange(column + "2:" + column).setNumberFormat(table.formats[column]);
  });
  if (rows.length <= 2000) sheet.autoResizeColumns(1, width);
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
