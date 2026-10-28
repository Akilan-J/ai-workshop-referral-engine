/* Student page: registration → referral hub → share loop. */
(function () {
  var cfg = window.APP_CONFIG;
  var W = cfg.WORKSHOP;
  var $ = function (id) { return document.getElementById(id); };
  var ME_KEY = 'aiws_me_v1', ATTR_KEY = 'aiws_attr_v1';
  var me = null;          // { code, firstName, college, referrals, rank, ... }
  var lastStats = null;
  var lbTab = 'people';

  // ---------- small helpers ----------

  function store(kind, key, val) {
    try {
      var s = kind === 'local' ? localStorage : sessionStorage;
      if (val === undefined) return JSON.parse(s.getItem(key) || 'null');
      if (val === null) s.removeItem(key); else s.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }
  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function ago(iso) {
    var s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60) return 'just now';
    var m = Math.round(s / 60); if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' hr ago' : ' hrs ago');
    return Math.round(h / 24) + 'd ago';
  }
  var start = new Date(W.startISO);
  var dateLabel = start.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  var timeLabel = start.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).toUpperCase();

  function siteBase() {
    if (cfg.SITE_URL) return cfg.SITE_URL.replace(/\?.*$/, '');
    return location.href.split('?')[0].split('#')[0];
  }
  function myLink() { return siteBase() + '?ref=' + encodeURIComponent(me.code); }

  // ---------- static content ----------

  function renderStatic() {
    if (W.title) $('title').innerHTML = W.title.replace(/AI Project/i, '<em>AI Project</em>');
    $('hostLine').textContent = 'Free · Live · by ' + W.host;
    $('footHost').textContent = W.host + ' · ' + W.title;
    var meta = $('meta');
    [['📅', dateLabel], ['⏰', timeLabel + ' IST'], ['⏱', W.durationMin + ' min'], ['💻', W.platform], ['🎟', 'Free']].forEach(function (m) {
      meta.appendChild(el('span', 'pill', m[0] + ' ' + m[1]));
    });

    var sel = document.querySelector('select[name=branch]');
    cfg.BRANCHES.forEach(function (b) { var o = el('option', null, b); o.value = b; sel.appendChild(o); });
    var years = $('years');
    cfg.GRAD_YEARS.forEach(function (y, i) {
      var l = el('label'); var inp = el('input'); inp.type = 'radio'; inp.name = 'gradYear'; inp.value = y.value;
      if (i === 0) inp.checked = true; // final-year is the default: it's who this is for
      l.appendChild(inp); l.appendChild(el('span', null, y.label)); years.appendChild(l);
    });

    var rl = $('rewardList');
    cfg.REWARDS.forEach(function (r) {
      var li = el('li'); var at = el('div', 'at'); at.textContent = r.at; at.appendChild(el('small', null, 'FRIENDS'));
      var body = el('div'); body.appendChild(el('b', null, r.title)); body.appendChild(el('span', null, r.detail));
      li.appendChild(at); li.appendChild(body); rl.appendChild(li);
    });
    var li = el('li'); var at = el('div', 'at', '🏆'); var body = el('div');
    body.appendChild(el('b', null, 'Top 3 ambassadors win ₹' + cfg.TOP_PRIZES.join(' / ₹')));
    body.appendChild(el('span', null, 'Ranked by friends who register with your link. Closes when registrations close.'));
    li.appendChild(at); li.appendChild(body); rl.appendChild(li);

    if (!API.live) { $('demoPill').classList.remove('hidden'); $('livePill').classList.add('hidden'); }
  }

  function tickCountdown() {
    var ms = start - Date.now(), cd = $('countdown');
    cd.textContent = '';
    if (ms <= 0) {
      var live = ms > -W.durationMin * 60e3;
      cd.appendChild(el('div', null, live ? '🔴 Live now' : 'This workshop has ended'));
      return;
    }
    var parts = [[Math.floor(ms / 864e5), 'days'], [Math.floor(ms / 36e5) % 24, 'hrs'], [Math.floor(ms / 6e4) % 60, 'min'], [Math.floor(ms / 1e3) % 60, 'sec']];
    parts.forEach(function (p) { var d = el('div'); d.appendChild(el('b', null, String(p[0]).padStart(2, '0'))); d.appendChild(el('span', null, p[1])); cd.appendChild(d); });
  }

  // ---------- public stats ----------

  var tickerItems = [], tickerIdx = 0;
  function renderStats(s) {
    lastStats = s;
    $('regCount').textContent = s.total.toLocaleString('en-IN');
    $('topCount').textContent = s.total.toLocaleString('en-IN');
    $('colCount').textContent = s.collegeCount;
    var pct = Math.min(100, s.total / cfg.TARGET * 100);
    $('seatBar').querySelector('i').style.width = pct + '%';
    $('seatBar').setAttribute('aria-valuenow', Math.round(pct));
    var left = cfg.TARGET - s.total;
    $('seatsLeft').textContent = left > 0 ? left + ' of ' + cfg.TARGET + ' seats left' : 'Bonus seats open';
    tickerItems = s.recent || [];

    var dl = $('collegeList'); dl.textContent = '';
    (s.topColleges || []).forEach(function (c) { var o = el('option'); o.value = c.college; dl.appendChild(o); });
    renderBoard();
  }

  function rotateTicker() {
    if (!tickerItems.length) return;
    var t = $('ticker'), r = tickerItems[tickerIdx++ % tickerItems.length];
    t.style.opacity = 0;
    setTimeout(function () {
      t.textContent = '';
      t.appendChild(el('b', null, r.name)); t.appendChild(document.createTextNode(' from ' + r.college + ' registered · ' + ago(r.ts)));
      t.style.opacity = 1;
    }, 250);
  }

  function renderBoard() {
    var lb = $('lb'); lb.textContent = '';
    if (!lastStats) return;
    var list = lbTab === 'people' ? lastStats.topReferrers : lastStats.topColleges;
    if (!list.length) {
      lb.appendChild(el('li', 'empty', lbTab === 'people' ? 'No referrals yet. Share your link and take the #1 spot.' : 'No registrations yet.'));
      return;
    }
    var max = list[0].count || 1;
    list.forEach(function (x, i) {
      var li = el('li');
      li.appendChild(el('div', 'rk', String(i + 1)));
      var who = el('div', 'who');
      who.appendChild(el('b', null, lbTab === 'people' ? x.name : x.college));
      if (lbTab === 'people') who.appendChild(el('span', null, x.college));
      var mini = el('div', 'mini'); var fill = el('i'); fill.style.width = (x.count / max * 100) + '%'; mini.appendChild(fill); who.appendChild(mini);
      li.appendChild(who);
      var n = el('div', 'n', String(x.count)); n.appendChild(el('small', null, lbTab === 'people' ? (x.count === 1 ? 'friend' : 'friends') : 'students'));
      li.appendChild(n);
      lb.appendChild(li);
    });
  }

  function refreshStats() {
    return API.stats().then(function (s) { if (s && s.ok) renderStats(s); }).catch(function () { /* keep last */ });
  }

  // ---------- attribution ----------

  // Capture ?ref and utm_* once and keep them for the session, so a student who
  // browses around before registering still credits the friend who sent the link.
  function captureAttribution() {
    var q = new URLSearchParams(location.search);
    var attr = store('session', ATTR_KEY) || {};
    ['ref', 'utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) { if (q.get(k)) attr[k] = q.get(k); });
    store('session', ATTR_KEY, attr);
    return attr;
  }

  function showInvite(ref) {
    if (!ref) return;
    API.me(ref).then(function (r) {
      if (!r || !r.found || (me && me.code === r.code)) return;
      $('inviteAvatar').textContent = r.firstName.charAt(0);
      $('inviteText').textContent = r.firstName + ' from ' + r.college + ' invited you. Grab your seat next to them.';
      $('invite').classList.remove('hidden');
      // Friends usually share a college: pre-fill it (still editable).
      var c = document.querySelector('input[name=college]');
      if (!c.value) c.value = r.college;
    }).catch(function () {});
  }

  // ---------- registration ----------

  function setErrors(form, errors, prefix) {
    form.querySelectorAll('.field').forEach(function (f) {
      var key = f.getAttribute('data-f'), msg = errors[prefix ? key.replace(prefix, '') : key];
      f.classList.toggle('err', !!msg);
      var m = f.querySelector('.msg'); if (m) m.textContent = msg || '';
    });
    var first = form.querySelector('.field.err .input, .field.err input');
    if (first) first.focus();
  }

  function onRegister(e) {
    e.preventDefault();
    var form = e.target, fd = new FormData(form);
    var input = {};
    fd.forEach(function (v, k) { input[k] = v; });
    var attr = store('session', ATTR_KEY) || {};
    Object.assign(input, attr);

    if (!input.website) {
      var v = ReferralCore.validate(input);
      if (!v.ok) { setErrors(form, v.errors); return; }
    }
    setErrors(form, {});
    var btn = $('submitBtn'); btn.disabled = true; btn.textContent = 'Reserving…';
    API.register(input).then(function (r) {
      if (!r.ok) { setErrors(form, r.errors || {}); if (r.error) toast(r.error); return; }
      if (!r.code) { toast('Something went wrong. Please try again.'); return; }
      enterHub(r, r.existing ? 'welcome-back' : 'new');
      refreshStats();
    }).catch(function () {
      toast('Network hiccup. Your details are still here, so tap again.');
    }).finally(function () { btn.disabled = false; btn.textContent = 'Reserve my free seat →'; });
  }

  function onLookup(e) {
    e.preventDefault();
    var form = e.target, email = form.email.value, phone = form.phone.value;
    var errs = {};
    if (!ReferralCore.normEmail(email)) errs.email = 'Enter your email';
    if (!/^[6-9]\d{9}$/.test(ReferralCore.normPhone(phone))) errs.phone = 'Enter your 10-digit number';
    setErrors(form, errs, 'l');
    if (Object.keys(errs).length) return;
    API.lookup(email, phone).then(function (r) {
      if (r && r.found) enterHub(r, 'welcome-back');
      else setErrors(form, { email: 'No registration found with this email + number' }, 'l');
    }).catch(function () { toast('Network hiccup. Try again.'); });
  }

  // ---------- referral hub ----------

  function enterHub(r, mode) {
    me = r;
    store('local', ME_KEY, { code: r.code });
    $('regView').classList.add('hidden');
    $('hubView').classList.remove('hidden');
    $('hubTitle').textContent = mode === 'new' ? "You're in, " + r.firstName + '! 🎉' : 'Welcome back, ' + r.firstName + '!';
    $('hubSub').textContent = 'Your seat for ' + dateLabel + ', ' + timeLabel + ' is confirmed. The joining link comes on WhatsApp and email.';
    $('myCode').textContent = r.code;
    $('myLink').value = myLink();

    var msg = cfg.SHARE_MESSAGE.replace('{link}', myLink()).replace('{name}', r.firstName);
    $('waBtn').href = 'https://wa.me/?text=' + encodeURIComponent(msg);
    $('tgBtn').href = 'https://t.me/share/url?url=' + encodeURIComponent(myLink()) + '&text=' + encodeURIComponent(msg.replace(myLink(), '').trim());
    $('liBtn').href = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(myLink());
    if (navigator.share) $('nativeShare').classList.remove('hidden');
    $('calBtn').href = calendarUrl();
    if (!API.live) $('demoBox').classList.remove('hidden');
    renderMe();
    if (window.innerWidth < 900) $('panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderMe() {
    var n = me.referrals || 0;
    $('sRefs').textContent = n;
    $('sRank').textContent = me.rank ? '#' + me.rank : '–';
    var next = null;
    for (var i = 0; i < cfg.REWARDS.length; i++) if (n < cfg.REWARDS[i].at) { next = cfg.REWARDS[i]; break; }
    $('sNext').textContent = next ? next.at - n : '✓';
    $('sNextLabel').textContent = next ? 'to next reward' : 'all unlocked';

    // Milestone ladder, scaled to the last tier.
    var maxAt = cfg.REWARDS[cfg.REWARDS.length - 1].at;
    var track = $('ladderTrack');
    track.querySelectorAll('.ladder-stop').forEach(function (s) { s.remove(); });
    cfg.REWARDS.forEach(function (r) {
      var s = el('div', 'ladder-stop' + (n >= r.at ? ' hit' : ''), String(r.at));
      s.style.left = (r.at / maxAt * 100) + '%'; s.title = r.title; track.appendChild(s);
    });
    $('ladderFill').style.width = Math.min(100, n / maxAt * 100) + '%';
    var ln = $('ladderNext'); ln.textContent = '';
    if (next) {
      ln.appendChild(document.createTextNode((next.at - n) + ' more ' + (next.at - n === 1 ? 'friend' : 'friends') + ' to unlock '));
      ln.appendChild(el('b', null, next.title));
    } else {
      ln.appendChild(el('b', null, 'Every reward unlocked. You are a campus legend.'));
    }

    var pl = $('prizeLine'); pl.textContent = '';
    pl.appendChild(document.createTextNode('🏆 Top 3 ambassadors win '));
    pl.appendChild(el('b', null, '₹' + cfg.TOP_PRIZES.join(' / ₹')));
    if (me.rank && me.rank <= 3) pl.appendChild(document.createTextNode('. You are in the top 3 right now. Keep going!'));
    else if (me.rank) pl.appendChild(document.createTextNode('. You are #' + me.rank + ' of ' + me.totalReferrers + '.'));
    else pl.appendChild(document.createTextNode('. Your first friend puts you on the board.'));
  }

  function refreshMe() {
    if (!me) return Promise.resolve();
    return API.me(me.code).then(function (r) {
      if (!r || !r.found) return;
      var gained = r.referrals - (me.referrals || 0);
      me = r; renderMe();
      if (gained > 0) toast('🎉 ' + gained + (gained === 1 ? ' friend' : ' friends') + ' just joined with your link!');
    }).catch(function () {});
  }

  function calendarUrl() {
    var s = new Date(W.startISO), e = new Date(s.getTime() + W.durationMin * 60e3);
    var f = function (d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(W.title) +
      '&dates=' + f(s) + '/' + f(e) + '&details=' + encodeURIComponent('Free live workshop by ' + W.host + '. Bring a laptop. Joining link on WhatsApp.\n\nInvite friends: ' + myLink());
  }

  function copyLink() {
    var v = $('myLink').value;
    (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { toast('Link copied. Paste it in your class group!'); })
      .catch(function () { $('myLink').select(); document.execCommand('copy'); toast('Link copied'); });
  }

  // ---------- WhatsApp Status / Instagram story card ----------

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function wrapText(ctx, text, x, y, maxW, lh) {
    var words = text.split(' '), line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); line = words[i]; y += lh; } else line = test;
    }
    ctx.fillText(line, x, y); return y;
  }

  function makeStoryCard() {
    var c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 1080, 1920);
    g.addColorStop(0, '#1e1b6b'); g.addColorStop(1, '#4338ca');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1920);
    // soft grid texture
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 2;
    for (var x = 0; x <= 1080; x += 90) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1920); ctx.stroke(); }
    for (var y = 0; y <= 1920; y += 90) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1080, y); ctx.stroke(); }

    var F = "'Plus Jakarta Sans', system-ui, sans-serif";
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; roundRect(ctx, 90, 170, 520, 70, 35); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = '700 32px ' + F; ctx.fillText('FREE LIVE WORKSHOP', 125, 218);

    ctx.font = '800 104px ' + F; ctx.fillStyle = '#ffffff';
    var yEnd = wrapText(ctx, 'I\'m building my first AI project in 60 minutes.', 90, 400, 900, 118);
    ctx.font = '500 44px ' + F; ctx.fillStyle = 'rgba(255,255,255,0.82)';
    wrapText(ctx, 'Join me: free for final-year engineering students. GitHub-ready project, before placements.', 90, yEnd + 100, 880, 60);

    ctx.fillStyle = 'rgba(255,255,255,0.14)'; roundRect(ctx, 90, 1060, 900, 110, 24); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = '700 46px ' + F;
    ctx.fillText('📅 ' + dateLabel + '  ·  ' + timeLabel + ' IST', 130, 1132);

    // QR panel
    ctx.fillStyle = '#ffffff'; roundRect(ctx, 90, 1230, 900, 520, 36); ctx.fill();
    var qrDrawn = false;
    if (window.qrcode) {
      var qr = qrcode(0, 'M'); qr.addData(myLink()); qr.make();
      var n = qr.getModuleCount(), size = 400, cell = size / n, ox = 140, oy = 1290;
      ctx.fillStyle = '#141413';
      for (var r = 0; r < n; r++) for (var col = 0; col < n; col++) if (qr.isDark(r, col)) ctx.fillRect(ox + col * cell, oy + r * cell, Math.ceil(cell), Math.ceil(cell));
      qrDrawn = true;
    }
    var tx = qrDrawn ? 590 : 140;
    ctx.fillStyle = '#52514e'; ctx.font = '600 34px ' + F; ctx.fillText(qrDrawn ? 'Scan to register' : 'Register with code', tx, 1380);
    ctx.fillStyle = '#141413'; ctx.font = '800 54px ' + F; ctx.fillText('with my code', tx, 1450);
    ctx.fillStyle = '#4338ca'; ctx.font = "700 60px 'JetBrains Mono', monospace"; ctx.fillText(me.code, tx, 1540);
    ctx.fillStyle = '#85837c'; ctx.font = '500 30px ' + F;
    wrapText(ctx, me.firstName + ' · ' + (me.college || ''), tx, 1620, 360, 40);

    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '600 34px ' + F;
    ctx.fillText('by ' + W.host, 90, 1840);
    return c;
  }

  function shareStory() {
    var go = function () {
      var c = makeStoryCard();
      c.toBlob(function (blob) {
        var file = new File([blob], 'ai-workshop-' + me.code + '.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], text: 'Join me: ' + myLink() }).catch(function () {});
        } else {
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
          toast('Card saved. Post it on your WhatsApp Status!');
        }
      }, 'image/png');
    };
    document.fonts && document.fonts.ready ? document.fonts.ready.then(go) : go();
  }

  // ---------- wire up ----------

  function init() {
    renderStatic();
    tickCountdown(); setInterval(tickCountdown, 1000);
    var attr = captureAttribution();

    $('regForm').addEventListener('submit', onRegister);
    $('lookupForm').addEventListener('submit', onLookup);
    $('showLookup').addEventListener('click', function () { $('regForm').classList.add('hidden'); $('lookupForm').classList.remove('hidden'); });
    $('hideLookup').addEventListener('click', function () { $('lookupForm').classList.add('hidden'); $('regForm').classList.remove('hidden'); });
    $('copyBtn').addEventListener('click', copyLink);
    $('myLink').addEventListener('focus', function (e) { e.target.select(); });
    $('storyBtn').addEventListener('click', shareStory);
    $('nativeShare').addEventListener('click', function () {
      navigator.share({ title: W.title, text: cfg.SHARE_MESSAGE.replace('{link}', '').trim(), url: myLink() }).catch(function () {});
    });
    $('switchUser').addEventListener('click', function () {
      store('local', ME_KEY, null); me = null;
      $('hubView').classList.add('hidden'); $('regView').classList.remove('hidden');
      $('regForm').reset(); document.querySelector('input[name=gradYear]').checked = true;
    });
    $('simBtn').addEventListener('click', function () {
      var b = $('simBtn'); b.disabled = true;
      API.demo.simulateReferral(me.code).then(function () { return Promise.all([refreshMe(), refreshStats()]); })
        .finally(function () { b.disabled = false; });
    });
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        lbTab = b.getAttribute('data-tab');
        document.querySelectorAll('.tabs button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
        renderBoard();
      });
    });
    // Clear a field's error as soon as the student edits it.
    document.querySelectorAll('form').forEach(function (f) {
      f.addEventListener('input', function (e) { var fld = e.target.closest('.field'); if (fld) fld.classList.remove('err'); });
    });

    var saved = store('local', ME_KEY);
    if (saved && saved.code) {
      API.me(saved.code).then(function (r) { if (r && r.found) enterHub(r, 'welcome-back'); else showInvite(attr.ref); })
        .catch(function () { showInvite(attr.ref); });
    } else {
      showInvite(attr.ref);
    }

    refreshStats().then(rotateTicker);
    setInterval(rotateTicker, 4000);
    setInterval(refreshStats, API.live ? 30000 : 15000);
    setInterval(refreshMe, 20000);
  }

  init();
})();
