/*
 * Everything a campaign owner would want to change lives here.
 * Leave API_URL empty to run in DEMO MODE (seeded data in this browser only).
 */
window.APP_CONFIG = {
  // Paste the Apps Script Web app URL (ends in /exec) to go live.
  API_URL: '',

  // Optional: the public URL of index.html, used in referral links.
  // Empty = use the URL the page is currently served from.
  SITE_URL: '',

  WORKSHOP: {
    title: 'Build Your First AI Project in 60 Minutes',
    host: 'NxtWave',
    startISO: '2026-11-08T11:00:00+05:30', // Sunday 11 AM IST: no classes, no labs
    durationMin: 60,
    platform: 'Live online'
  },

  TARGET: 500,
  CAMPAIGN_START: '2026-11-01',            // Day 1, IST
  CAMPAIGN_DAYS: 7,
  // Planned registrations per day. Sums to 520 (a 4% buffer over the 500 target).
  // Front-loaded by the seeding push, a dip mid-week, and a last-day deadline surge.
  PLAN_DAILY: [90, 85, 70, 60, 60, 65, 90],
  FINAL_YEAR: '2027',                       // graduating class we are targeting

  // Free, digital-only milestone rewards (₹0 marginal cost).
  REWARDS: [
    { at: 3,  title: 'AI Project Starter Kit', detail: 'Prompt pack + 5 resume-ready project ideas with datasets' },
    { at: 5,  title: 'Campus AI Ambassador certificate', detail: 'Verified certificate you can add to LinkedIn' },
    { at: 10, title: 'Live shout-out + priority Q&A', detail: 'Your name on screen and your question answered first' }
  ],
  // The ₹2,000 budget: cash prizes for the top 3 referrers when the campaign closes.
  TOP_PRIZES: [1000, 600, 400],

  // {link} and {name} are filled in per student.
  SHARE_MESSAGE:
    "Hey! I just grabbed a free seat for a live workshop: *Build Your First AI Project in 60 Minutes* 🤖\n\n" +
    "We'll build a real AI project in one hour: GitHub-ready, and something to put on our resumes before placements.\n\n" +
    "📅 Sun, 8 Nov · 11 AM · Free\n" +
    "Register with my link: {link}",

  // utm_source values the link builder offers, with readable labels.
  CHANNELS: {
    whatsapp: 'WhatsApp groups',
    club: 'College clubs',
    linkedin: 'LinkedIn',
    instagram: 'Instagram',
    email: 'Email',
    tpo: 'Placement cell / TPO',
    referral: 'Student referrals',
    direct: 'Direct / unknown'
  },

  BRANCHES: ['CSE', 'IT', 'AI & DS / AI & ML', 'ECE', 'EEE', 'Mechanical', 'Civil', 'Other'],
  GRAD_YEARS: [
    { value: '2027', label: '2027 · Final year' },
    { value: '2028', label: '2028' },
    { value: '2029', label: '2029' },
    { value: 'Graduated', label: 'Graduated' }
  ]
};
