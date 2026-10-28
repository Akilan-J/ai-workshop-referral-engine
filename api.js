/*
 * API: one interface, two backends.
 *   LIVE: talks to the Apps Script web app at APP_CONFIG.API_URL
 *   DEMO: runs ReferralCore against a seeded store in this browser's localStorage
 * Pages call API.* and never care which one is active.
 */
var API = (function () {
  var cfg = window.APP_CONFIG;
  var live = !!cfg.API_URL;

  // ---------- live ----------

  async function get(action, params) {
    var q = new URLSearchParams(Object.assign({ action: action }, params || {}));
    var res = await fetch(cfg.API_URL + '?' + q.toString());
    return res.json();
  }
  // text/plain keeps it a "simple request": no CORS preflight, which Apps Script can't answer.
  async function post(action, body) {
    var res = await fetch(cfg.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action }, body || {}))
    });
    return res.json();
  }

  // ---------- demo ----------

  var STORE_KEY = 'aiws_demo_rows_v3';
  var memory = null;

  // In demo mode the campaign "started" 2.6 to 3.6 days ago, so the dashboard always has a live, part-filled day.
  function demoCampaignStart() {
    return ReferralCore.istDate(Date.now() - 2.6 * 864e5);
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var FIRST = ['Aarav','Priya','Rahul','Sneha','Karthik','Ananya','Vikram','Divya','Arjun','Meera','Rohit','Kavya',
    'Aditya','Pooja','Siddharth','Nithya','Harsha','Lakshmi','Varun','Swathi','Manoj','Ishita','Tejas','Bhavana',
    'Nikhil','Revathi','Sai','Keerthana','Abhishek','Deepika','Pranav','Harini','Gokul','Sanjana','Yash','Akshaya'];
  var LAST = ['Reddy','Sharma','Iyer','Nair','Kumar','Rao','Patel','Menon','Gupta','Krishnan','Das','Pillai','Verma','Shetty','Naidu'];
  var COLLEGES = [['CBIT Hyderabad', 9], ['VNR VJIET', 8], ['SRM KTR', 7], ['KL University', 6], ['GRIET', 6],
    ['Vasavi College of Engineering', 5], ['PSG Tech', 5], ['Amrita Coimbatore', 4], ['BMS College of Engineering', 4],
    ['RVCE', 3], ['MVSR Engineering College', 3], ['Anurag University', 3], ['KIIT', 2], ['VIT-AP', 2], ['SNIST', 2],
    ['Malla Reddy Engineering College', 2], ['CMR College', 1], ['JNTU Kakinada', 1]];
  var SOURCES = [['whatsapp', 46], ['club', 18], ['linkedin', 10], ['tpo', 9], ['instagram', 7], ['email', 5], ['', 5]];
  var BRANCH_W = [['CSE', 34], ['AI & DS / AI & ML', 16], ['IT', 14], ['ECE', 16], ['EEE', 7], ['Mechanical', 7], ['Civil', 3], ['Other', 3]];
  var YEAR_W = [['2027', 78], ['2028', 14], ['2029', 5], ['Graduated', 3]];

  function pick(rand, weighted) {
    var total = 0, i;
    for (i = 0; i < weighted.length; i++) total += weighted[i][1];
    var x = rand() * total;
    for (i = 0; i < weighted.length; i++) { x -= weighted[i][1]; if (x <= 0) return weighted[i][0]; }
    return weighted[weighted.length - 1][0];
  }

  // ~240 realistic registrations from campaign start until now. A handful of
  // "power ambassadors" drive most referrals (preferential attachment), like real campaigns.
  function seed() {
    var rand = mulberry32(20261101);
    var start = Date.parse(demoCampaignStart() + 'T00:00:00+05:30');
    var span = Date.now() - start - 30 * 60e3;
    var rows = [], used = {};
    var N = 236;
    for (var i = 0; i < N; i++) {
      // Front-loaded arrivals with an evening bump each day.
      var t = start + Math.pow(i / N, 1.08) * span + (rand() - 0.5) * 90 * 60e3;
      t = Math.min(Date.now() - 60e3, Math.max(start + 60e3, t));
      var fn = FIRST[Math.floor(rand() * FIRST.length)], ln = LAST[Math.floor(rand() * LAST.length)];
      var phone = '9' + String(Math.floor(rand() * 1e9)).padStart(9, '0');
      var row = {
        ts: new Date(t).toISOString(), name: fn + ' ' + ln,
        email: (fn + '.' + ln + i).toLowerCase() + '@example.edu', phone: phone,
        college: pick(rand, COLLEGES), branch: pick(rand, BRANCH_W), gradYear: pick(rand, YEAR_W),
        code: ReferralCore.makeCode(fn, used, rand), referredBy: '', source: '', medium: '', campaign: ''
      };
      used[row.code] = true;
      if (i > 12 && rand() < 0.38) {
        // Weight earlier registrants by (referrals + 1)^1.3, so the rich get (a bit) richer.
        var counts = {}, weights = [];
        for (var j = 0; j < rows.length; j++) if (rows[j].referredBy) counts[rows[j].referredBy] = (counts[rows[j].referredBy] || 0) + 1;
        for (var k = 0; k < rows.length; k++) weights.push([rows[k], Math.pow((counts[rows[k].code] || 0) + 1, 1.3) * (k < 40 ? 1.5 : 1)]);
        var referrer = pick(rand, weights);
        row.referredBy = referrer.code;
        // Friends tend to share a college.
        if (rand() < 0.7) row.college = referrer.college;
      } else {
        row.source = pick(rand, SOURCES);
        if (row.source) row.medium = row.source === 'whatsapp' ? 'group' : 'post';
      }
      rows.push(row);
    }
    return rows;
  }

  function load() {
    if (memory) return memory;
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) { memory = JSON.parse(raw); return memory; }
    } catch (e) { /* storage blocked: fall through to fresh seed in memory */ }
    memory = seed();
    save();
    return memory;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(memory)); } catch (e) { /* memory only */ }
  }
  function delay(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 180 + Math.random() * 200); }); }

  function demoRegister(input) {
    var rows = load();
    if (input.website) return delay({ ok: true, found: true, code: '', referrals: 0 });
    var res = ReferralCore.register(rows, input);
    if (!res.ok) return delay(res);
    if (!res.existing) { rows.push(res.row); save(); }
    var mine = ReferralCore.me(rows, res.row.code);
    mine.existing = res.existing;
    return delay(mine);
  }

  // Demo-only: pretend a friend clicked your link and registered.
  function simulateReferral(code) {
    var rand = Math.random;
    var fn = FIRST[Math.floor(rand() * FIRST.length)], ln = LAST[Math.floor(rand() * LAST.length)];
    var referrer = ReferralCore.me(load(), code);
    return demoRegister({
      name: fn + ' ' + ln,
      email: (fn + '.' + ln + Date.now()).toLowerCase() + '@example.edu',
      phone: '9' + String(Math.floor(rand() * 1e9)).padStart(9, '0'),
      college: referrer.college || 'CBIT Hyderabad', branch: 'CSE', gradYear: '2027', ref: code
    });
  }

  function resetDemo() {
    memory = null;
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  }

  // ---------- public interface ----------

  return {
    live: live,
    campaignStart: function () { return live ? cfg.CAMPAIGN_START : demoCampaignStart(); },
    stats: function () { return live ? get('stats') : delay(ReferralCore.publicStats(load())); },
    me: function (code) { return live ? get('me', { code: code }) : delay(ReferralCore.me(load(), code)); },
    register: function (input) { return live ? post('register', input) : demoRegister(input); },
    lookup: function (email, phone) {
      return live ? post('lookup', { email: email, phone: phone }) : delay(ReferralCore.lookup(load(), email, phone));
    },
    // Returns raw rows; the dashboard computes stats with ReferralCore.adminStats.
    admin: function (key) {
      if (live) return post('admin', { key: key });
      return delay(key ? { ok: true, rows: load().slice() } : { ok: false, error: 'Enter any key in demo mode' });
    },
    demo: { simulateReferral: simulateReferral, reset: resetDemo }
  };
})();
