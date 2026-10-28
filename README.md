# Workshop Referral Engine

A registration + referral system built for one goal: **get 500 final-year engineering students to register for "Build Your First AI Project in 60 Minutes" in 7 days, on a ₹2,000 budget.**

₹2,000 can't buy 500 registrations through ads. It *can* fund a referral race. So instead of another landing page, this turns every registrant into a distribution channel and gives the organiser a control room to steer the campaign day by day.

## What it does

**Student page** (`index.html`)
- 30-second registration (name, email, WhatsApp, college, branch, graduating year), with final-year as the default
- Every registrant instantly gets a personal invite link + code (`?ref=PRIYA7KM`)
- One-tap sharing: WhatsApp (pre-written message), Telegram, LinkedIn, native share sheet
- **WhatsApp Status card**: a personalised 1080×1920 image with a QR code to their link, made for Status/Stories
- Reward ladder at 3 / 5 / 10 friends (₹0 digital rewards) + **top 3 win ₹1,000 / ₹600 / ₹400** (the whole budget)
- Live leaderboards: top ambassadors and **college vs college**
- Social proof: live registration count, seats left, "Priya from GRIET registered · 2 min ago" ticker, countdown
- Invite banner when arriving via a friend's link, with the friend's college pre-filled
- Add to Google Calendar (protects show-up rate, not just sign-ups)
- "Already registered? Get my link" recovery (email + phone must both match)

**Organiser dashboard** (`admin.html`, key-protected)
- Registrations vs target, **pace vs plan**, plan-shaped **projected finish**, cost per registration
- Cumulative vs plan chart and daily organic/referral bars against the daily plan
- Channel attribution (utm_source + referrals), audience quality (final-year %, branches), colleges
- **"What to do next"**: rule-based actions generated from today's numbers
- Top ambassadors with a **Nudge** button that opens WhatsApp with their progress pre-written
- **Tracked link builder**: one link per WhatsApp group/club, so every channel is measurable
- CSV export

**Fair-play and safety**
- No self-referrals; duplicate email/phone can't register twice
- Public leaderboards show "Priya S." only, never emails or phones
- Honeypot field against bots; spreadsheet formula injection neutralised (sheet + CSV)
- Write lock so concurrent signups can't collide on a code

## Architecture

```
index.html / admin.html  ──fetch──▶  Google Apps Script web app  ──▶  Google Sheet
        │                                   │
        └─────────── core.js ◀──────────────┘   (same logic file runs in the browser, Apps Script and tests)
```

| File | Role |
|---|---|
| `core.js` | All business logic: validation, codes, referral credit, ranking, stats. Pure functions. |
| `api.js` | One API for the pages: **live** (Apps Script) or **demo** (seeded data in localStorage) |
| `app.js` | Student page |
| `admin.js` | Organiser dashboard + SVG charts |
| `config.js` | Workshop details, target, daily plan, rewards, share message, channels |
| `apps-script/Code.gs` | Backend: routes, Sheet storage, locking, caching |
| `tests/core.test.js` | 12 tests: core logic + the backend against a fake Sheet |

No build step, no framework, no paid services. Static hosting + a free Google Sheet.

## Run it locally (demo mode)

With `API_URL` empty in `config.js`, everything runs in the browser with ~240 seeded registrations.

```bash
python3 -m http.server 8000
```

Open http://localhost:8000. To see the loop work, register, then press **Simulate a friend joining**. The dashboard is at `/admin.html` (any key works in demo mode).

## Go live (about 10 minutes, free)

1. **Sheet + backend**
   - Create a Google Sheet → *Extensions → Apps Script*
   - Replace `Code.gs` with `apps-script/Code.gs`
   - Add a file named `Core` (it becomes `Core.gs`) and paste in the contents of `core.js`
   - Run `setup` once and approve permissions. *View → Logs* shows your **admin key**
   - *Deploy → New deployment → Web app*: Execute as **Me**, Who has access **Anyone** → copy the `/exec` URL
2. **Point the site at it**: in `config.js` set `API_URL` to the `/exec` URL (and optionally `SITE_URL`)
3. **Host it** on GitHub Pages: push this repo → *Settings → Pages → Deploy from branch → main / root*. Netlify Drop or Vercel also work, since it's just static files.
4. Open `admin.html`, enter the admin key, build a tracked link for each WhatsApp group/club, and launch.

When you change `Code.gs` or `Core.gs` later, use *Deploy → Manage deployments → Edit → New version* so the same URL serves the new code.

## Tests

```bash
node --test tests/
```

## Customising

Everything campaign-specific is in `config.js`: dates, `TARGET`, `PLAN_DAILY` (the daily plan the dashboard measures pace against), `REWARDS`, `TOP_PRIZES`, `SHARE_MESSAGE`, channels, branches.
