/*
 * ReferralCore: the shared registration + referral logic.
 *
 * One file, three runtimes:
 *   1. The browser (demo mode runs entirely on this, no backend needed)
 *   2. Google Apps Script (paste this file in as Core.gs next to Code.gs)
 *   3. Node tests (tests/core.test.js loads it with vm)
 *
 * So it is a plain script with no imports/exports, and every function is pure:
 * it takes the current list of rows and returns a result. Storage is the caller's job.
 */
var ReferralCore = (function () {
  'use strict';

  // Column order of the Google Sheet. Append new columns at the end only.
  var COLUMNS = ['ts', 'name', 'email', 'phone', 'college', 'branch', 'gradYear',
                 'code', 'referredBy', 'source', 'medium', 'campaign'];

  // No 0/O/1/I/L so codes survive being read out loud or typed from a poster.
  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var IST_OFFSET_MS = 330 * 60 * 1000;
  var DAY_MS = 24 * 60 * 60 * 1000;

  // ---------- normalisation ----------

  function clean(s, max) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max || 120);
  }
  function normEmail(s) { return clean(s, 120).toLowerCase(); }
  function normPhone(s) {
    var d = String(s == null ? '' : s).replace(/\D/g, '');
    if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2);
    if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);
    return d;
  }
  function normCode(s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); }
  function normTag(s) { return clean(s, 40).toLowerCase().replace(/[^a-z0-9_\-]/g, ''); }
  // "SRM, KTR" / "srm ktr" / "SRM-KTR " all group together on leaderboards.
  function collegeKey(s) { return clean(s, 100).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  function firstName(name) {
    var f = clean(name, 60).split(' ')[0] || '';
    return f.charAt(0).toUpperCase() + f.slice(1).toLowerCase();
  }
  // Public leaderboards never show full names: "Priya S."
  function displayName(name) {
    var parts = clean(name, 60).split(' ');
    var out = firstName(name);
    if (parts.length > 1 && parts[parts.length - 1]) out += ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.';
    return out;
  }

  function toTime(ts) {
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts === 'number') return ts;
    var t = Date.parse(ts);
    return isNaN(t) ? 0 : t;
  }
  // YYYY-MM-DD in IST, the calendar the campaign actually runs on.
  function istDate(ts) { return new Date(toTime(ts) + IST_OFFSET_MS).toISOString().slice(0, 10); }

  // ---------- validation ----------

  function validate(input) {
    input = input || {};
    var v = {
      name: clean(input.name, 60),
      email: normEmail(input.email),
      phone: normPhone(input.phone),
      college: clean(input.college, 100),
      branch: clean(input.branch, 40),
      gradYear: clean(input.gradYear, 12)
    };
    var errors = {};
    if (v.name.length < 2 || !/[a-zA-Z]/.test(v.name)) errors.name = 'Enter your full name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) errors.email = 'Enter a valid email';
    if (!/^[6-9]\d{9}$/.test(v.phone)) errors.phone = 'Enter a 10-digit Indian mobile number';
    if (v.college.length < 2) errors.college = 'Enter your college';
    if (!v.branch) errors.branch = 'Pick your branch';
    if (!v.gradYear) errors.gradYear = 'Pick your graduation year';
    return { ok: Object.keys(errors).length === 0, errors: errors, value: v };
  }

  // ---------- indexing ----------

  function index(rows) {
    var byCode = {}, byEmail = {}, byPhone = {}, referrals = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.code) byCode[r.code] = r;
      if (r.email) byEmail[normEmail(r.email)] = r;
      if (r.phone) byPhone[normPhone(r.phone)] = r;
      if (r.referredBy) referrals[r.referredBy] = (referrals[r.referredBy] || 0) + 1;
    }
    return { byCode: byCode, byEmail: byEmail, byPhone: byPhone, referrals: referrals };
  }

  // Referrers sorted by count desc; ties go to whoever registered first.
  function rankReferrers(rows, idx) {
    idx = idx || index(rows);
    var list = [];
    for (var code in idx.referrals) {
      var r = idx.byCode[code];
      if (r) list.push({ row: r, count: idx.referrals[code] });
    }
    list.sort(function (a, b) { return b.count - a.count || toTime(a.row.ts) - toTime(b.row.ts); });
    return list;
  }

  function makeCode(name, taken, rand) {
    rand = rand || Math.random;
    var prefix = firstName(name).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
    if (prefix.length < 2) prefix = 'AI';
    for (var attempt = 0; attempt < 50; attempt++) {
      var suffix = '';
      for (var i = 0; i < 3; i++) suffix += CODE_CHARS.charAt(Math.floor(rand() * CODE_CHARS.length));
      var code = prefix + suffix;
      if (!taken[code]) return code;
    }
    throw new Error('Could not generate a unique code');
  }

  // ---------- writes ----------

  /*
   * Returns one of:
   *   { ok:false, errors:{field:msg} }
   *   { ok:true, existing:true,  row }   same email + phone already registered: give them their code back
   *   { ok:true, existing:false, row }   new row; the caller must persist it
   */
  function register(rows, input, opts) {
    opts = opts || {};
    var check = validate(input);
    if (!check.ok) return { ok: false, errors: check.errors };
    var v = check.value;
    var idx = index(rows);

    var byEmail = idx.byEmail[v.email], byPhone = idx.byPhone[v.phone];
    if (byEmail && byEmail === byPhone) return { ok: true, existing: true, row: byEmail };
    if (byEmail) return { ok: false, errors: { email: 'This email is already registered with a different number' } };
    if (byPhone) return { ok: false, errors: { phone: 'This number is already registered with a different email' } };

    // Credit the referrer only for a real, different person: no self-referrals.
    var ref = normCode(input.ref), referredBy = '';
    var referrer = ref && idx.byCode[ref];
    if (referrer && normEmail(referrer.email) !== v.email && normPhone(referrer.phone) !== v.phone) referredBy = ref;

    var now = opts.now ? new Date(opts.now) : new Date();
    var row = {
      ts: now.toISOString(),
      name: v.name, email: v.email, phone: v.phone, college: v.college,
      branch: v.branch, gradYear: v.gradYear,
      code: makeCode(v.name, idx.byCode, opts.rand),
      referredBy: referredBy,
      source: normTag(input.utm_source || input.source),
      medium: normTag(input.utm_medium || input.medium),
      campaign: normTag(input.utm_campaign || input.campaign)
    };
    return { ok: true, existing: false, row: row };
  }

  // ---------- reads ----------

  // What a student sees about themselves (and what a referral link reveals about its owner).
  function me(rows, code) {
    code = normCode(code);
    var idx = index(rows);
    var r = idx.byCode[code];
    if (!r) return { ok: true, found: false };
    var ranked = rankReferrers(rows, idx), rank = null;
    for (var i = 0; i < ranked.length; i++) if (ranked[i].row.code === code) { rank = i + 1; break; }
    return {
      ok: true, found: true, code: code,
      firstName: firstName(r.name), college: r.college,
      referrals: idx.referrals[code] || 0,
      rank: rank, totalReferrers: ranked.length
    };
  }

  // "Already registered? Get my link": both email AND phone must match.
  function lookup(rows, email, phone) {
    var e = normEmail(email), p = normPhone(phone);
    for (var i = 0; i < rows.length; i++) {
      if (normEmail(rows[i].email) === e && normPhone(rows[i].phone) === p) return me(rows, rows[i].code);
    }
    return { ok: true, found: false };
  }

  function groupColleges(rows) {
    var groups = {};
    for (var i = 0; i < rows.length; i++) {
      var k = collegeKey(rows[i].college);
      if (!k) continue;
      if (!groups[k]) groups[k] = { college: clean(rows[i].college, 100), count: 0 };
      groups[k].count++;
    }
    var list = [];
    for (var key in groups) list.push(groups[key]);
    list.sort(function (a, b) { return b.count - a.count || a.college.localeCompare(b.college); });
    return list;
  }

  // Safe for anyone to see: no emails, no phones, no full surnames.
  function publicStats(rows, opts) {
    opts = opts || {};
    var limit = opts.limit || 10;
    var colleges = groupColleges(rows);
    var ranked = rankReferrers(rows);
    var sorted = rows.slice().sort(function (a, b) { return toTime(b.ts) - toTime(a.ts); });
    return {
      ok: true,
      total: rows.length,
      collegeCount: colleges.length,
      topReferrers: ranked.slice(0, limit).map(function (x) {
        return { name: displayName(x.row.name), college: x.row.college, count: x.count };
      }),
      topColleges: colleges.slice(0, limit),
      recent: sorted.slice(0, 8).map(function (r) { return { name: firstName(r.name), college: r.college, ts: new Date(toTime(r.ts)).toISOString() }; })
    };
  }

  function channelOf(row) { return row.referredBy ? 'referral' : (row.source || 'direct'); }

  function tierFor(count, rewards) {
    var best = null;
    for (var i = 0; i < (rewards || []).length; i++) if (count >= rewards[i].at) best = rewards[i];
    return best;
  }

  /*
   * Everything the organiser dashboard needs, computed from the full rows.
   * opts: { campaignStart:'YYYY-MM-DD' (IST), days:7, finalYear:'2027', rewards:[{at,title}], now }
   */
  function adminStats(rows, opts) {
    opts = opts || {};
    var days = opts.days || 7;
    var start = Date.parse(opts.campaignStart + 'T00:00:00+05:30');
    var now = opts.now ? toTime(opts.now) : Date.now();
    var idx = index(rows);

    var daily = [];
    for (var d = 0; d < days; d++) {
      daily.push({ day: d + 1, date: istDate(start + d * DAY_MS + 1), organic: 0, referral: 0, total: 0, cumulative: 0 });
    }
    var channels = {}, branches = {}, gradYears = {}, referralCount = 0, finalYearCount = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      // Pre-launch tests count toward day 1, stragglers after the last day toward day 7.
      var di = Math.min(days - 1, Math.max(0, Math.floor((toTime(r.ts) - start) / DAY_MS)));
      if (r.referredBy) { daily[di].referral++; referralCount++; } else daily[di].organic++;
      daily[di].total++;
      var ch = channelOf(r);
      channels[ch] = (channels[ch] || 0) + 1;
      branches[r.branch || 'Unknown'] = (branches[r.branch || 'Unknown'] || 0) + 1;
      var gy = String(r.gradYear || 'Unknown');
      gradYears[gy] = (gradYears[gy] || 0) + 1;
      if (opts.finalYear && gy === String(opts.finalYear)) finalYearCount++;
    }
    var run = 0;
    for (var j = 0; j < daily.length; j++) { run += daily[j].total; daily[j].cumulative = run; }

    // Which campaign day are we on? (0-based, clamped). Used for pace + projection.
    var elapsedDays = Math.floor((now - start) / DAY_MS);
    var currentDay = Math.min(days - 1, Math.max(0, elapsedDays));

    function sortedPairs(obj, keyName) {
      var out = [];
      for (var k in obj) { var o = { count: obj[k] }; o[keyName] = k; out.push(o); }
      out.sort(function (a, b) { return b.count - a.count; });
      return out;
    }

    var ranked = rankReferrers(rows, idx);
    var todayKey = istDate(now);
    var today = 0;
    for (var t = 0; t < rows.length; t++) if (istDate(rows[t].ts) === todayKey) today++;

    return {
      total: rows.length,
      today: today,
      currentDay: currentDay,
      started: now >= start,
      daily: daily,
      channels: sortedPairs(channels, 'channel'),
      branches: sortedPairs(branches, 'branch'),
      gradYears: sortedPairs(gradYears, 'gradYear'),
      colleges: groupColleges(rows),
      referralCount: referralCount,
      referralShare: rows.length ? referralCount / rows.length : 0,
      activeReferrers: ranked.length,
      finalYearShare: rows.length ? finalYearCount / rows.length : 0,
      topReferrers: ranked.map(function (x, n) {
        var tier = tierFor(x.count, opts.rewards);
        return {
          rank: n + 1, name: x.row.name, email: x.row.email, phone: x.row.phone,
          college: x.row.college, code: x.row.code, count: x.count, tier: tier ? tier.title : ''
        };
      }),
      recent: rows.slice().sort(function (a, b) { return toTime(b.ts) - toTime(a.ts); }).slice(0, 25)
        .map(function (r) {
          return { ts: new Date(toTime(r.ts)).toISOString(), name: r.name, college: r.college, branch: r.branch,
                   gradYear: r.gradYear, channel: channelOf(r), referredBy: r.referredBy };
        })
    };
  }

  return {
    COLUMNS: COLUMNS,
    validate: validate, register: register, makeCode: makeCode,
    me: me, lookup: lookup, publicStats: publicStats, adminStats: adminStats,
    channelOf: channelOf, tierFor: tierFor, istDate: istDate,
    firstName: firstName, displayName: displayName,
    normCode: normCode, normPhone: normPhone, normEmail: normEmail, collegeKey: collegeKey
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ReferralCore;
