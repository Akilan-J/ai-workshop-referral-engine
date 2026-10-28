/**
 * Workshop Referral Engine: Google Apps Script backend.
 *
 * Storage is a Google Sheet ("Registrations" tab), so the growth team can
 * filter, export and message registrants without any extra tooling.
 * All business logic lives in Core.gs (a copy of ../core.js).
 *
 * Endpoints (deploy as Web app → Execute as: Me, Who has access: Anyone):
 *   GET  ?action=stats              public counters + leaderboards (cached 20s)
 *   GET  ?action=me&code=PRIYA7KM   one student's referral stats
 *   POST {action:'register', ...}   create or recover a registration
 *   POST {action:'lookup', email, phone}
 *   POST {action:'admin', key}      every row, for the organiser dashboard
 *
 * POST bodies are sent as text/plain JSON so browsers skip the CORS preflight
 * (Apps Script cannot answer OPTIONS requests).
 */

var SHEET_NAME = 'Registrations';
var STATS_CACHE_KEY = 'public_stats_v1';

/** Run once from the editor: creates the sheet and an admin key (see Logs). */
function setup() {
  sheet_();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_KEY')) {
    props.setProperty('ADMIN_KEY', Utilities.getUuid().slice(0, 8));
  }
  Logger.log('Sheet ready: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl());
  Logger.log('Admin key for admin.html: ' + props.getProperty('ADMIN_KEY'));
}

function doGet(e) {
  return respond_(e && e.parameter ? e.parameter : {});
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
  var params = (e && e.parameter) || {};
  for (var k in body) params[k] = body[k];
  return respond_(params);
}

function respond_(p) {
  var out;
  try {
    out = route_(p);
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function route_(p) {
  switch (p.action) {
    case 'stats':
      return cached_(STATS_CACHE_KEY, 20, function () { return ReferralCore.publicStats(readRows_()); });
    case 'me':
      return ReferralCore.me(readRows_(), p.code);
    case 'lookup':
      return ReferralCore.lookup(readRows_(), p.email, p.phone);
    case 'register':
      return register_(p);
    case 'admin':
      var key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
      if (!key || String(p.key || '') !== key) return { ok: false, error: 'Wrong admin key' };
      return { ok: true, rows: readRows_() };
    default:
      return { ok: true, service: 'workshop-referrals', time: new Date().toISOString() };
  }
}

function register_(p) {
  // Honeypot: bots fill the hidden "website" field. Pretend success, store nothing.
  if (p.website) return { ok: true, existing: false, found: true, code: '', referrals: 0 };

  var lock = LockService.getScriptLock();
  lock.waitLock(15000); // serialise writes so two signups can't get the same code
  try {
    var rows = readRows_();
    var res = ReferralCore.register(rows, p, { now: new Date() });
    if (!res.ok) return res;
    if (!res.existing) {
      sheet_().appendRow(ReferralCore.COLUMNS.map(function (c) { return safeCell_(res.row[c]); }));
      rows.push(res.row);
      CacheService.getScriptCache().remove(STATS_CACHE_KEY);
    }
    var mine = ReferralCore.me(rows, res.row.code);
    mine.existing = res.existing;
    return mine;
  } finally {
    lock.releaseLock();
  }
}

// ---------- sheet helpers ----------

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(ReferralCore.COLUMNS);
    sh.setFrozenRows(1);
    // Plain text everywhere, so phones stay phones and timestamps stay ISO strings.
    sh.getRange('A:L').setNumberFormat('@');
  }
  return sh;
}

function readRows_() {
  var values = sheet_().getDataRange().getValues();
  var cols = ReferralCore.COLUMNS, rows = [];
  for (var i = 1; i < values.length; i++) {
    var v = values[i];
    if (!v[0] && !v[7]) continue; // blank line
    var row = {};
    for (var c = 0; c < cols.length; c++) {
      var cell = v[c];
      row[cols[c]] = cell instanceof Date ? cell.toISOString() : String(cell == null ? '' : cell);
    }
    rows.push(row);
  }
  return rows;
}

// Stops a registrant typing "=IMPORTXML(...)" into their name and running it in our sheet.
function safeCell_(v) {
  var s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function cached_(key, seconds, fn) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var value = fn();
  try { cache.put(key, JSON.stringify(value), seconds); } catch (err) { /* >100KB: skip caching */ }
  return value;
}
