/* Organiser dashboard: pace vs plan, channel attribution, ambassadors, next actions. */
(function () {
  var cfg = window.APP_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var KEY_STORE = 'aiws_admin_key';
  var DAY = 864e5;
  var rows = [], stats = null, showAllAmb = false;
  var fmt = function (n) { return Math.round(n).toLocaleString('en-IN'); };
  var pct = function (x) { return Math.round(x * 100) + '%'; };
  var SVGNS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function svg(tag, attrs) { var e = document.createElementNS(SVGNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  var toastTimer;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400); }
  function ago(iso) {
    var m = Math.round((Date.now() - Date.parse(iso)) / 6e4);
    if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60); return h < 24 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
  }
  function siteBase() {
    if (cfg.SITE_URL) return cfg.SITE_URL.replace(/\?.*$/, '');
    return location.href.split('?')[0].split('#')[0].replace(/admin\.html$/, 'index.html');
  }
  function niceMax(v) {
    var p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v)))), n = v / p;
    var steps = [1, 1.2, 1.6, 2, 2.4, 3, 4, 6, 8, 10]; // all divide evenly into 4 gridlines
    for (var i = 0; i < steps.length; i++) if (n <= steps[i]) return steps[i] * p;
    return 10 * p;
  }
  function getKey() { try { return sessionStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function setKey(k) { try { if (k) sessionStorage.setItem(KEY_STORE, k); else sessionStorage.removeItem(KEY_STORE); } catch (e) {} }

  // ---------- plan maths ----------

  function planModel() {
    var start = Date.parse(API.campaignStart() + 'T00:00:00+05:30');
    var plan = cfg.PLAN_DAILY, days = cfg.CAMPAIGN_DAYS, cum = [], run = 0;
    for (var i = 0; i < days; i++) { run += plan[i] || 0; cum.push(run); }
    var elapsed = Math.min(days, Math.max(0, (Date.now() - start) / DAY)); // fractional days
    var whole = Math.floor(elapsed), expected = whole ? cum[whole - 1] : 0;
    if (whole < days) expected += (plan[whole] || 0) * (elapsed - whole);
    return { start: start, cum: cum, total: run, elapsed: elapsed, expected: expected };
  }

  // ---------- KPIs ----------

  function kpi(label, value, note, extra) {
    var c = el('div', 'card kpi');
    c.appendChild(el('div', 'label', label));
    var v = el('div', 'value'); v.innerHTML = value; c.appendChild(v);
    if (note) { var n = el('div', 'note'); if (typeof note === 'string') n.textContent = note; else n.appendChild(note); c.appendChild(n); }
    if (extra) c.appendChild(extra);
    return c;
  }
  function statusChip(good, text) { return el('span', 'status ' + (good ? 'good' : 'warn'), (good ? '▲ ' : '▼ ') + text); }

  function renderKpis(pm) {
    var k = $('kpis'); k.textContent = '';
    var bar = el('div', 'bar'); var fill = el('i'); fill.style.width = Math.min(100, stats.total / cfg.TARGET * 100) + '%'; bar.appendChild(fill);
    var dayNote = stats.started ? 'Day ' + (stats.currentDay + 1) + ' of ' + cfg.CAMPAIGN_DAYS + ' · ' + fmt(stats.today) + ' today' : 'Campaign not started';
    k.appendChild(kpi('Registrations', fmt(stats.total) + ' <small>/ ' + cfg.TARGET + '</small>', dayNote, bar));

    var gap = stats.total - pm.expected;
    k.appendChild(kpi('Pace vs plan', (gap >= 0 ? '+' : '−') + fmt(Math.abs(gap)),
      statusChip(gap >= 0, gap >= 0 ? 'Ahead of plan' : 'Behind plan')));

    // Projection follows the plan's shape (front-loaded), not a straight line.
    var projected = pm.expected >= 1 ? stats.total * pm.total / pm.expected : null;
    k.appendChild(kpi('Projected finish', projected ? fmt(projected) : '–',
      projected ? statusChip(projected >= cfg.TARGET, projected >= cfg.TARGET ? 'Hits ' + cfg.TARGET : 'Short by ' + fmt(cfg.TARGET - projected)) : 'Needs a few hours of data'));

    k.appendChild(kpi('Final-year share', pct(stats.finalYearShare), 'Class of ' + cfg.FINAL_YEAR + ', our core audience'));
    k.appendChild(kpi('From referrals', pct(stats.referralShare), fmt(stats.activeReferrers) + ' active ambassadors'));
    var budget = cfg.TOP_PRIZES.reduce(function (a, b) { return a + b; }, 0);
    k.appendChild(kpi('Cost per registration', '₹' + (stats.total ? (budget / Math.max(stats.total, projected || 0)).toFixed(2) : '–'),
      '₹' + fmt(budget) + ' budget' + (projected ? ' ÷ projected' : '')));
  }

  // ---------- charts ----------

  function tooltip(container) {
    var t = container.querySelector('.tip');
    if (!t) { t = el('div', 'tip'); container.appendChild(t); }
    return {
      show: function (x, y, title, lines) {
        t.textContent = ''; t.appendChild(el('b', null, title));
        lines.forEach(function (l) {
          var d = el('div'); var a = el('span'); if (l.color) { var i = el('i'); i.style.background = l.color; a.appendChild(i); }
          a.appendChild(document.createTextNode(l.label)); d.appendChild(a); d.appendChild(el('span', 'tnum', l.value)); t.appendChild(d);
        });
        t.classList.add('show');
        var w = t.offsetWidth, cw = container.clientWidth;
        var left = x + 14; if (left + w > cw) left = x - w - 14; if (left < 0) left = 0;
        t.style.left = left + 'px'; t.style.top = Math.max(0, y - 10) + 'px';
      },
      hide: function () { t.classList.remove('show'); }
    };
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function dayLabel(d) { return new Date(d.date + 'T12:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }); }

  function yAxis(g, m, iw, ih, yMax) {
    var step = yMax / 4;
    for (var i = 0; i <= 4; i++) {
      var y = m.t + ih - (i * step / yMax) * ih;
      g.appendChild(svg('line', { x1: m.l, x2: m.l + iw, y1: y, y2: y, class: i ? 'gridline' : 'axis' }));
      var t = svg('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end' }); t.textContent = fmt(i * step); g.appendChild(t);
    }
  }

  function cumulativeChart(pm) {
    var box = $('cumChart'); box.textContent = '';
    var W = box.clientWidth || 600, H = 270, m = { l: 44, r: 64, t: 16, b: 30 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b, days = stats.daily;
    var lastIdx = stats.started ? stats.currentDay : -1;
    var actual = days.map(function (d, i) { return i <= lastIdx ? d.cumulative : null; });
    var yMax = niceMax(Math.max(cfg.TARGET * 1.1, pm.total, actual[lastIdx] || 0));
    var x = function (i) { return m.l + (days.length > 1 ? i * iw / (days.length - 1) : iw / 2); };
    var y = function (v) { return m.t + ih - v / yMax * ih; };
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, height: H, role: 'img', 'aria-label': 'Cumulative registrations versus plan' });
    yAxis(s, m, iw, ih, yMax);
    days.forEach(function (d, i) {
      var t = svg('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }); t.textContent = 'D' + d.day + ' · ' + dayLabel(d);
      if (i === lastIdx) { t.setAttribute('font-weight', '700'); t.style.fill = cssVar('--ink'); }
      if (W < 520 && i % 2 && i !== lastIdx) t.textContent = 'D' + d.day;
      s.appendChild(t);
    });
    // target
    s.appendChild(svg('line', { x1: m.l, x2: m.l + iw, y1: y(cfg.TARGET), y2: y(cfg.TARGET), stroke: cssVar('--ink'), 'stroke-width': 1 }));
    var tt = svg('text', { x: m.l + iw + 6, y: y(cfg.TARGET) + 4 }); tt.textContent = 'Target ' + cfg.TARGET; tt.style.fill = cssVar('--ink'); tt.setAttribute('font-weight', '600'); s.appendChild(tt);
    // plan
    s.appendChild(svg('polyline', { points: pm.cum.map(function (v, i) { return x(i) + ',' + y(v); }).join(' '), fill: 'none', stroke: cssVar('--plan'), 'stroke-width': 2, 'stroke-dasharray': '5 5', 'stroke-linejoin': 'round' }));
    // actual
    if (lastIdx >= 0) {
      var pts = [];
      for (var i = 0; i <= lastIdx; i++) pts.push(x(i) + ',' + y(actual[i]));
      if (lastIdx === 0) pts.unshift(m.l + ',' + y(0));
      s.appendChild(svg('polyline', { points: pts.join(' '), fill: 'none', stroke: cssVar('--series-1'), 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      s.appendChild(svg('circle', { cx: x(lastIdx), cy: y(actual[lastIdx]), r: 5, fill: cssVar('--series-1'), stroke: cssVar('--surface'), 'stroke-width': 2 }));
      var lbl = svg('text', { x: x(lastIdx) + 10, y: y(actual[lastIdx]) - 8, 'font-weight': '700' });
      lbl.textContent = fmt(actual[lastIdx]); lbl.style.fill = cssVar('--ink'); s.appendChild(lbl);
    }
    // hover layer
    var cross = svg('line', { y1: m.t, y2: m.t + ih, stroke: cssVar('--ink-3'), 'stroke-width': 1, opacity: 0 });
    var dot = svg('circle', { r: 5, fill: cssVar('--series-1'), stroke: cssVar('--surface'), 'stroke-width': 2, opacity: 0 });
    s.appendChild(cross); s.appendChild(dot);
    var hit = svg('rect', { x: m.l - 20, y: m.t, width: iw + 40, height: ih, fill: 'transparent' });
    s.appendChild(hit);
    box.appendChild(s);
    var tip = tooltip(box);
    function move(ev) {
      var r = s.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
      var i = Math.max(0, Math.min(days.length - 1, Math.round((px - m.l) / (iw / (days.length - 1)))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 1);
      var lines = [{ label: 'Plan', value: fmt(pm.cum[i]), color: cssVar('--plan') }];
      if (actual[i] != null) {
        dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(actual[i])); dot.setAttribute('opacity', 1);
        lines.unshift({ label: i === lastIdx ? 'Actual (so far)' : 'Actual', value: fmt(actual[i]), color: cssVar('--series-1') });
        var g = actual[i] - pm.cum[i];
        lines.push({ label: 'vs plan', value: (g >= 0 ? '+' : '−') + fmt(Math.abs(g)) });
      } else { dot.setAttribute('opacity', 0); lines.push({ label: 'Actual', value: 'upcoming' }); }
      tip.show(x(i) * r.width / W, y(actual[i] != null ? actual[i] : pm.cum[i]) * r.height / H, 'Day ' + days[i].day + ' · ' + dayLabel(days[i]), lines);
    }
    hit.addEventListener('mousemove', move);
    hit.addEventListener('touchstart', function (e) { move(e.touches[0]); }, { passive: true });
    hit.addEventListener('mouseleave', function () { cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); tip.hide(); });
  }

  // Path for a bar segment with only the top corners rounded.
  function topRounded(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) +
      'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }

  function dailyChart() {
    var box = $('dayChart'); box.textContent = '';
    var W = box.clientWidth || 500, H = 240, m = { l: 40, r: 8, t: 14, b: 30 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b, days = stats.daily;
    var yMax = niceMax(Math.max.apply(null, days.map(function (d) { return d.total; }).concat(cfg.PLAN_DAILY)) * 1.1);
    var band = iw / days.length, bw = Math.min(44, band * 0.56);
    var y = function (v) { return m.t + ih - v / yMax * ih; };
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, height: H, role: 'img', 'aria-label': 'New registrations per day, organic and referral' });
    yAxis(s, m, iw, ih, yMax);
    var c1 = cssVar('--series-1'), c2 = cssVar('--series-2'), planC = cssVar('--plan');
    var lastIdx = stats.started ? stats.currentDay : -1;
    days.forEach(function (d, i) {
      var cx = m.l + band * i + band / 2, x0 = cx - bw / 2;
      // plan ghost
      var p = cfg.PLAN_DAILY[i] || 0;
      s.appendChild(svg('rect', { x: x0 - 3, y: y(p), width: bw + 6, height: Math.max(0, y(0) - y(p)), fill: 'none', stroke: planC, 'stroke-width': 1.25, 'stroke-dasharray': '3 3', rx: 4 }));
      var hOrg = y(0) - y(d.organic), hRef = y(0) - y(d.referral);
      if (d.organic) s.appendChild(d.referral ? svg('rect', { x: x0, y: y(d.organic), width: bw, height: hOrg, fill: c1 })
                                              : svg('path', { d: topRounded(x0, y(d.organic), bw, hOrg, 4), fill: c1 }));
      if (d.referral) {
        var top = y(d.organic) - hRef;
        s.appendChild(svg('path', { d: topRounded(x0, top, bw, Math.max(0, hRef - 2), 4), fill: c2 })); // 2px surface gap
      }
      var t = svg('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }); t.textContent = 'D' + d.day;
      if (i === lastIdx) { t.setAttribute('font-weight', '700'); t.style.fill = cssVar('--ink'); t.textContent = 'D' + d.day + ' · today'; }
      s.appendChild(t);
      var hit = svg('rect', { x: m.l + band * i, y: m.t, width: band, height: ih, fill: 'transparent' });
      hit.addEventListener('mousemove', function (ev) {
        var r = s.getBoundingClientRect();
        tip.show((ev.clientX - r.left), (ev.clientY - r.top), 'Day ' + d.day + ' · ' + dayLabel(d) + (i === lastIdx ? ' (today)' : ''), [
          { label: 'Organic', value: fmt(d.organic), color: c1 },
          { label: 'Referral', value: fmt(d.referral), color: c2 },
          { label: 'Total', value: fmt(d.total) },
          { label: 'Plan', value: fmt(p) }
        ]);
      });
      hit.addEventListener('mouseleave', function () { tip.hide(); });
      s.appendChild(hit);
    });
    box.appendChild(s);
    var tip = tooltip(box);
  }

  function hbars(container, items, opts) {
    opts = opts || {};
    var box = $(container); box.textContent = '';
    if (!items.length) { box.appendChild(el('div', 'faint', 'No data yet')); return; }
    var max = items[0].value || 1, total = opts.total || items.reduce(function (a, b) { return a + b.value; }, 0);
    items.forEach(function (it) {
      var r = el('div', 'hbar'); r.title = it.label + ': ' + fmt(it.value) + ' (' + pct(it.value / (total || 1)) + ')';
      r.appendChild(el('div', 'l', it.label));
      var t = el('div', 't'); var i = el('i'); i.style.width = (it.value / max * 100) + '%'; if (it.highlight) i.style.background = cssVar('--series-2'); t.appendChild(i); r.appendChild(t);
      var v = el('div', 'v', fmt(it.value)); v.appendChild(el('small', null, pct(it.value / (total || 1)))); r.appendChild(v);
      box.appendChild(r);
    });
  }

  // ---------- insights: the "so what" ----------

  function renderInsights(pm) {
    var out = [], gap = stats.total - pm.expected;
    var todayPlan = cfg.PLAN_DAILY[stats.currentDay] || 0;
    if (!stats.started) out.push(['🕒', 'Campaign starts ' + API.campaignStart() + '. Line up group admins and ambassadors now so Day 1 hits <b>' + cfg.PLAN_DAILY[0] + '</b>.']);
    else if (gap < -0.1 * pm.expected) out.push(['⚠️', '<b>Behind plan by ' + fmt(-gap) + '.</b> Send the reminder broadcast to every WhatsApp group today and nudge the top 10 ambassadors below.']);
    else out.push(['✅', '<b>' + (gap >= 0 ? 'Ahead of plan by ' + fmt(gap) : 'Roughly on plan') + '.</b> Today needs ' + fmt(todayPlan) + ' new registrations; ' + fmt(stats.today) + ' so far.']);

    var ch = stats.channels.filter(function (c) { return c.channel !== 'referral'; })[0];
    if (ch && stats.total) out.push(['📣', '<b>' + (cfg.CHANNELS[ch.channel] || ch.channel) + '</b> brings ' + pct(ch.count / stats.total) + ' of registrations. Double down: recruit 5 more group admins or clubs on that channel.']);

    if (stats.referralShare < 0.25) out.push(['🔁', 'Only <b>' + pct(stats.referralShare) + '</b> come from referrals. Put the invite link + status card in the confirmation message, not just the page.']);
    else out.push(['🔁', '<b>' + pct(stats.referralShare) + '</b> come from referrals: the loop works. Announce the leaderboard in groups to start a race.']);

    var almost = stats.topReferrers.filter(function (a) { return cfg.REWARDS.some(function (r) { return a.count === r.at - 1; }); }).length;
    if (almost) out.push(['🎯', '<b>' + almost + ' ambassador' + (almost > 1 ? 's are' : ' is') + ' one friend away</b> from a reward. Tap Nudge next to their name.']);

    if (stats.finalYearShare < 0.7 && stats.total > 20) out.push(['🎓', 'Only <b>' + pct(stats.finalYearShare) + '</b> are final-year. Shift effort to final-year batch groups and placement cells.']);

    var thin = stats.colleges.filter(function (c) { return c.count <= 2; }).length;
    if (thin >= 3) out.push(['🏫', '<b>' + thin + ' colleges</b> have just 1–2 sign-ups. Each is a seed: invite those students to be campus ambassadors.']);

    var ul = $('insights'); ul.textContent = '';
    out.slice(0, 5).forEach(function (o) {
      var li = el('li'); li.appendChild(el('div', 'ic', o[0])); var t = el('div'); t.innerHTML = o[1]; li.appendChild(t); ul.appendChild(li);
    });
  }

  // ---------- tables ----------

  function nudgeLink(a) {
    var next = null;
    for (var i = 0; i < cfg.REWARDS.length; i++) if (a.count < cfg.REWARDS[i].at) { next = cfg.REWARDS[i]; break; }
    var first = ReferralCore.firstName(a.name);
    var msg = 'Hi ' + first + '! 🔥 You are #' + a.rank + ' on the AI Workshop leaderboard with ' + a.count + ' friend' + (a.count === 1 ? '' : 's') + ' registered. ' +
      (next ? 'Just ' + (next.at - a.count) + ' more to unlock the ' + next.title + '. ' : '') +
      (a.rank <= 5 ? 'Top 3 win ₹' + cfg.TOP_PRIZES.join('/₹') + '! ' : '') +
      'Your link: ' + siteBase() + '?ref=' + a.code;
    return 'https://wa.me/91' + a.phone + '?text=' + encodeURIComponent(msg);
  }

  function renderAmbassadors() {
    var t = $('ambTable'); t.textContent = '';
    var head = el('tr'); ['#', 'Ambassador', 'Code', 'Friends', 'Reward', ''].forEach(function (h, i) { head.appendChild(el('th', i === 3 ? 'num' : null, h)); });
    t.appendChild(head);
    var list = showAllAmb ? stats.topReferrers : stats.topReferrers.slice(0, 8);
    if (!list.length) { var r = el('tr'); var td = el('td', 'faint', 'No referrals yet'); td.colSpan = 6; r.appendChild(td); t.appendChild(r); }
    list.forEach(function (a) {
      var tr = el('tr');
      tr.appendChild(el('td', 'faint tnum', String(a.rank)));
      var who = el('td'); who.appendChild(document.createTextNode(a.name)); who.appendChild(el('span', 'sub', a.college)); tr.appendChild(who);
      tr.appendChild(el('td', 'mono', a.code));
      tr.appendChild(el('td', 'num', String(a.count)));
      tr.appendChild(el('td', 'tier', a.tier || '–'));
      var act = el('td'); var b = el('a', 'btn sm', 'Nudge'); b.href = nudgeLink(a); b.target = '_blank'; b.rel = 'noopener'; act.appendChild(b); tr.appendChild(act);
      t.appendChild(tr);
    });
    $('ambMore').classList.toggle('hidden', stats.topReferrers.length <= 8);
  }

  function renderRecent() {
    var t = $('recentTable'); t.textContent = '';
    var head = el('tr'); ['When', 'Student', 'Year', 'Channel'].forEach(function (h) { head.appendChild(el('th', null, h)); }); t.appendChild(head);
    stats.recent.slice(0, 10).forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', 'faint', ago(r.ts)));
      var who = el('td'); who.appendChild(document.createTextNode(r.name)); who.appendChild(el('span', 'sub', r.college + ' · ' + r.branch)); tr.appendChild(who);
      tr.appendChild(el('td', 'tnum', r.gradYear));
      var c = el('td'); c.appendChild(el('span', 'chip' + (r.channel === 'referral' ? ' ref' : ''), r.channel === 'referral' ? 'ref · ' + r.referredBy : (cfg.CHANNELS[r.channel] || r.channel)));
      tr.appendChild(c); t.appendChild(tr);
    });
  }

  // ---------- render all ----------

  function render() {
    var pm = planModel();
    stats = ReferralCore.adminStats(rows, {
      campaignStart: API.campaignStart(), days: cfg.CAMPAIGN_DAYS, finalYear: cfg.FINAL_YEAR, rewards: cfg.REWARDS
    });
    $('subtitle').textContent = cfg.WORKSHOP.title + ' · campaign ' + API.campaignStart() + ' + ' + cfg.CAMPAIGN_DAYS + ' days';
    renderKpis(pm);
    cumulativeChart(pm);
    dailyChart();
    renderInsights(pm);
    hbars('channelBars', stats.channels.map(function (c) { return { label: cfg.CHANNELS[c.channel] || c.channel, value: c.count, highlight: c.channel === 'referral' }; }));
    hbars('yearBars', stats.gradYears.map(function (g) { return { label: g.gradYear === cfg.FINAL_YEAR ? g.gradYear + ' · final year' : g.gradYear, value: g.count }; }));
    hbars('branchBars', stats.branches.slice(0, 6).map(function (b) { return { label: b.branch, value: b.count }; }), { total: stats.total });
    hbars('collegeBars', stats.colleges.slice(0, 12).map(function (c) { return { label: c.college, value: c.count }; }), { total: stats.total });
    $('collegeNote').textContent = stats.colleges.length + ' colleges reached';
    renderAmbassadors();
    renderRecent();
    $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }

  function load() {
    var key = getKey();
    return API.admin(key).then(function (r) {
      if (!r || !r.ok) {
        setKey(''); showGate(r && r.error ? r.error : 'Could not load');
        return;
      }
      rows = r.rows || [];
      $('gate').classList.add('hidden');
      $('dash').classList.remove('hidden');
      ['refreshBtn', 'csvBtn'].forEach(function (id) { $(id).classList.remove('hidden'); });
      render();
    }).catch(function () { toast('Could not reach the backend'); });
  }

  function showGate(err) {
    $('gate').classList.remove('hidden'); $('dash').classList.add('hidden');
    var f = document.querySelector('#gateForm .field');
    f.classList.toggle('err', !!err); f.querySelector('.msg').textContent = err || '';
  }

  // Leading ' stops spreadsheet apps from executing a cell like =HYPERLINK(...).
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv() {
    var cols = ReferralCore.COLUMNS.concat(['channel']);
    var lines = [cols.join(',')].concat(rows.map(function (r) {
      return cols.map(function (c) { return csvCell(c === 'channel' ? ReferralCore.channelOf(r) : r[c]); }).join(',');
    }));
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'registrations-' + ReferralCore.istDate(Date.now()) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  function init() {
    if (API.live) $('livePill').classList.remove('hidden');
    else { $('demoPill').classList.remove('hidden'); $('gateHint').textContent = 'Demo mode: no backend connected, so any key works (try "demo").'; }

    var sel = $('srcSelect');
    Object.keys(cfg.CHANNELS).filter(function (k) { return k !== 'referral' && k !== 'direct'; }).forEach(function (k) {
      var o = el('option', null, cfg.CHANNELS[k]); o.value = k; sel.appendChild(o);
    });
    $('builder').addEventListener('submit', function (e) {
      e.preventDefault();
      var src = e.target.source.value, label = ReferralCore.collegeKey(e.target.campaign.value).replace(/ /g, '-');
      var q = new URLSearchParams({ utm_source: src, utm_medium: src === 'whatsapp' ? 'group' : 'post' });
      if (label) q.set('utm_campaign', label);
      $('builtLink').value = siteBase() + '?' + q.toString();
      $('built').classList.remove('hidden');
    });
    $('copyBuilt').addEventListener('click', function () {
      var v = $('builtLink').value;
      (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { toast('Link copied'); })
        .catch(function () { $('builtLink').select(); document.execCommand('copy'); toast('Link copied'); });
    });

    $('gateForm').addEventListener('submit', function (e) { e.preventDefault(); setKey(e.target.key.value.trim()); load(); });
    $('refreshBtn').addEventListener('click', load);
    $('csvBtn').addEventListener('click', exportCsv);
    $('ambMore').addEventListener('toggle', function () { showAllAmb = $('ambMore').open; renderAmbassadors(); });
    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (stats) render(); }, 150); });
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (stats) render(); });

    if (getKey()) load(); else showGate('');
    setInterval(function () { if (getKey() && stats) load(); }, 60000);
  }

  init();
})();
