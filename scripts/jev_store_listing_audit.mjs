#!/usr/bin/env node
/**
 * TypeSafe Jev audit for the VPNSky Google Play default store listing.
 *
 * Code owns objective rules (dimensions, formats, character limits) and the
 * pass thresholds. Jev supplies calibrated judgments per Play rule and, for
 * images, vision judgments at the uploaded asset resolution. Asking one broad
 * "policy risk" question proved noisy, so every gate is a separate, narrow
 * question and "quality"/"primary issue" stay advisory.
 *
 * Usage: node scripts/jev_store_listing_audit.mjs
 * Key: TYPESAFE_API_KEY or ~/.config/typesafe/api_key
 */
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'docs/store-listing');
const OUT_JSON = resolve(DIR, 'jev-validation.json');
const OUT_MD = resolve(DIR, 'JEV_VALIDATION.md');
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';

const listing = JSON.parse(await readFile(resolve(DIR, 'listing.json'), 'utf8'));

const APP_FACTS = [
  'VPNSky is a WireGuard VPN client for Android 7.0+.',
  'No account, no sign-up, no email, no advertising SDK, no analytics SDK, no crash-reporting SDK.',
  'The published privacy policy states: we do not log, store, inspect, or analyse browsing activity, DNS queries, or payload contents.',
  'A Curve25519 key pair is generated on device. The private key stays in app-private storage; the public key is sent to the VPNSky registry.',
  'Full-tunnel IPv4 and IPv6 by default; DNS requests travel inside the tunnel.',
  'The interface shows live downlink and uplink counters, the assigned tunnel address, and the server location while connected.',
  'The Android VPN service stops when the user disconnects; no idle tunnel remains.',
  'The primary button starts and stops the tunnel; Android asks for VPN permission on first connect.',
  "The tunnel is WireGuard; WireGuard's protocol uses ChaCha20-Poly1305, Curve25519, BLAKE2s, and HKDF.",
  'The app is English-only in this release and needs a VPNSky server configuration from the operator.',
  'The app is not a proxy, browser, or ad blocker.',
];

const PLAY_RULES = [
  'No rankings, awards, testimonials, download counts, price, discount, sale, or promotional claims.',
  'No added calls to action such as download now, install now, play now, or try now.',
  'No misleading or unsupported product claims.',
  'No keyword stuffing; text must read naturally.',
  'App name max 30 characters, short description max 80, full description max 4000, release notes max 500.',
  'Screenshots: actual app experience; no Android status/notification bar; taglines under 20% of the image; no device/provider names.',
  'Feature graphic: 1024x500; key content at least 10% inside the edges; no pure white/black; no device frame.',
  'Icon: 512x512, 32-bit PNG, no text, badges, rankings, price, or category hints.',
];

const COPY_QUESTIONS = {
  ranking_award: {
    type: 'noul',
    instructions: 'Does the listing copy contain rankings, awards, user testimonials, download counts, or similar social proof?',
    criteria: { true: 'At least one is present.', false: 'None are present.' },
  },
  price_promo: {
    type: 'noul',
    instructions: 'Does the listing copy contain price, discount, sale, free-offer, or promotional information?',
    criteria: { true: 'Promotional or price content is present.', false: 'None is present.' },
  },
  added_cta: {
    type: 'noul',
    instructions: 'Does the listing copy contain an added call to action such as download now, install now, play now, or try now?',
    criteria: { true: 'An added marketing CTA is present.', false: 'No added marketing CTA.' },
  },
  keyword_stuffing: {
    type: 'noul',
    instructions: 'Does the listing copy stuff keywords unnaturally or repeat the same terms to game search?',
    criteria: { true: 'Keyword stuffing or unnatural repetition is present.', false: 'The text reads naturally.' },
  },
  misleading_claim: {
    type: 'noul',
    instructions: 'Does the listing copy make a claim that would materially mislead a reasonable user about privacy, security, logging, ads, accounts, or VPN behavior?',
    criteria: { true: 'A materially misleading claim is present.', false: 'No materially misleading claim.' },
  },
  unsupported_claim: {
    type: 'noul',
    instructions: 'Does the listing copy contain any product claim that conflicts with, or goes beyond, the supplied app facts?',
    criteria: { true: 'At least one claim is unsupported or overstated.', false: 'Every product claim is supported.' },
  },
  clarity: {
    type: 'score',
    instructions: 'How clear and compelling is this copy for a privacy-conscious Android user choosing a VPN?',
    criteria: [
      'Unclear or contradictory.',
      'Understandable but generic.',
      'Clear and specific.',
      'Clear, specific, and compelling.',
    ],
  },
  differentiation: {
    type: 'score',
    instructions: 'How well does this copy differentiate VPNSky from a generic VPN listing?',
    criteria: [
      'No differentiation.',
      'Slight differentiation, still generic.',
      'Clearly differentiated by a specific product idea.',
      'Distinctive and memorable.',
    ],
  },
  short_hook: {
    type: 'noul',
    instructions: 'Does the short description give a strong, accurate reason to install within 80 characters?',
    criteria: { true: 'It names the category and a concrete differentiator.', false: 'It is vague or only names the category.' },
  },
};

const COPY_GATES = {
  ranking_award: 0.5,
  price_promo: 0.5,
  added_cta: 0.5,
  keyword_stuffing: 0.5,
  misleading_claim: 0.5,
  unsupported_claim: 0.5,
  clarity: 2.0,
  differentiation: 1.8,
  short_hook: 0.7,
};

const SLIDES = [
  {
    key: 'phone_01', file: 'assets/phone-01-connect.png', tagline: 'Secure route. Lift off.',
    subline: 'The tunnel comes up while the rocket climbs.', state: 'CONNECTING',
    purpose: 'Connection animation and primary control.',
  },
  {
    key: 'phone_02', file: 'assets/phone-02-connected.png', tagline: 'Your tunnel, live.',
    subline: 'Server, tunnel address, and status in view.', state: 'CONNECTED',
    purpose: 'Connected state, server location, tunnel address.',
  },
  {
    key: 'phone_03', file: 'assets/phone-03-telemetry.png', tagline: 'Live counters.',
    subline: 'VPN downlink and uplink, live on the deck.', state: 'CONNECTED / TELEMETRY',
    purpose: 'Detail view: live downlink and uplink counters with disconnect control.',
    detail: 'telemetry',
  },
  {
    key: 'phone_04', file: 'assets/phone-04-privacy.png', tagline: 'The privacy briefing.',
    subline: 'No ads. No analytics. No account.', state: 'ABOUT SHEET OPEN',
    purpose: 'Detail view: in-app About/privacy information.',
    detail: 'privacy',
  },
  {
    key: 'phone_05', file: 'assets/phone-05-control.png', tagline: 'Back at base, every time.',
    subline: 'Disconnect and the tunnel shuts down.', state: 'READY / DISCONNECTED',
    purpose: 'Resting state with the tunnel stopped.',
  },
];

const SLIDE_QUESTIONS = {
  real_app_screen: {
    type: 'noul',
    instructions: 'Does this image show a mobile app screen with recognizable app UI (app header, status card, counters, or controls) rather than only an illustration, game art, or generic mockup?',
    criteria: { true: 'Recognizable app UI is present and prominent.', false: 'It reads mainly as illustration, game art, or a generic mockup.' },
  },
  status_bar: {
    type: 'noul',
    instructions: 'Is an Android status bar or notification bar (clock, battery, Wi-Fi, provider icons) visible?',
    criteria: { true: 'A status/notification bar is visible.', false: 'No status/notification bar is visible.' },
  },
  device_frame: {
    type: 'noul',
    instructions: 'Is the app screen shown inside a phone or device mockup frame?',
    criteria: { true: 'A phone/device frame surrounds the screen.', false: 'No device frame; the UI is shown directly.' },
  },
  ranking_award: {
    type: 'noul',
    instructions: 'Does the image contain rankings, awards, testimonials, or download counts?',
    criteria: { true: 'At least one is present.', false: 'None are present.' },
  },
  price_promo: {
    type: 'noul',
    instructions: 'Does the image contain price, discount, sale, or promotional information?',
    criteria: { true: 'Promotional or price content is present.', false: 'None is present.' },
  },
  added_cta: {
    type: 'noul',
    instructions: 'Does the image add a marketing call to action (Download now, Install, Try free) that is not part of the app UI?',
    criteria: { true: 'An added marketing CTA is present.', false: 'No added marketing CTA.' },
  },
  headline_readable: {
    type: 'noul',
    instructions: 'Is the large marketing headline at the top readable at the uploaded 1080px width?',
    criteria: { true: 'The headline is comfortably readable.', false: 'It is too small, low contrast, or clipped.' },
  },
  supporting_readable: {
    type: 'noul',
    instructions: 'Is the one-line supporting sentence under the headline readable at the uploaded 1080px width?',
    criteria: { true: 'The supporting sentence is readable.', false: 'It is too small or low contrast.' },
  },
  key_ui_readable: {
    type: 'noul',
    instructions: 'Are the primary app status and values (CONNECTING, CONNECTED, Singapore, 2.9 MB, etc.) readable at the uploaded asset width?',
    criteria: { true: 'Primary status/values are readable.', false: 'They are too small or low contrast.' },
  },
  real_app_elements: {
    type: 'noul',
    instructions: 'Does this detail view show recognizable app UI elements (counters, labels, buttons, sheet headings) rather than only an illustration or game art?',
    criteria: { true: 'Recognizable app UI elements are present and prominent.', false: 'It reads mainly as illustration or game art.' },
  },
  key_content_readable: {
    type: 'noul',
    instructions: 'Are the main UI labels and values/headings shown in this detail view readable at the uploaded asset width?',
    criteria: { true: 'The main labels and values/headings are readable.', false: 'They are too small or low contrast.' },
  },
  misleading: {
    type: 'noul',
    instructions: 'Does the image imply a capability or state the app does not have?',
    criteria: { true: 'There is a misleading implication.', false: 'The image is accurate.' },
  },
  quality: {
    type: 'score',
    instructions: 'How polished and appealing is this screenshot as a Google Play listing asset?',
    criteria: ['Poor', 'Acceptable', 'Polished', 'Exceptional'],
  },
};

const SLIDE_GATES = {
  real_app_screen: { min: 0.6 },
  real_app_elements: { min: 0.6 },
  key_content_readable: { min: 0.55 },
  status_bar: { max: 0.5 },
  device_frame: { max: 0.5 },
  ranking_award: { max: 0.5 },
  price_promo: { max: 0.5 },
  added_cta: { max: 0.5 },
  headline_readable: { min: 0.7 },
  supporting_readable: { min: 0.5 },
  key_ui_readable: { min: 0.55 },
  misleading: { max: 0.5 },
};

const ICON_QUESTIONS = {
  rocket_readable: {
    type: 'noul',
    instructions: 'At a glance, is this icon recognizable as a rocket and clear enough to work at small launcher and Play Store sizes?',
    criteria: { true: 'The rocket silhouette reads immediately.', false: 'The shape is ambiguous or unreadable at small size.' },
  },
  distinct: {
    type: 'noul',
    instructions: 'Is this icon visually distinct from generic VPN icons while remaining credible for a privacy product?',
    criteria: { true: 'Distinctive and still signals privacy/technology.', false: 'Generic, confusing, or off-category.' },
  },
  brand_fit: {
    type: 'noul',
    instructions: 'Does the icon fit the cream/deep-blue/sage editorial palette and the VPNSky flight theme?',
    criteria: { true: 'Palette and flight theme are clearly reflected.', false: 'Colors or theme conflict.' },
  },
  prohibited_icon_content: {
    type: 'noul',
    instructions: 'Does the icon contain text, badges, rankings, price, category hints, or other content Google Play prohibits on app icons?',
    criteria: { true: 'A prohibited element is present.', false: 'No prohibited element is present.' },
  },
  quality: {
    type: 'score',
    instructions: 'How polished is this app icon for a premium Google Play listing?',
    criteria: ['Poor', 'Acceptable', 'Polished', 'Exceptional'],
  },
};

const ICON_GATES = {
  rocket_readable: { min: 0.7 },
  distinct: { min: 0.5 },
  brand_fit: { min: 0.6 },
  prohibited_icon_content: { max: 0.5 },
};

const FEATURE_QUESTIONS = {
  value_clear: {
    type: 'noul',
    instructions: 'Does this feature graphic communicate VPNSky as a private WireGuard VPN with a distinctive flight experience, quickly and credibly?',
    criteria: { true: 'Category and privacy/flight value are clear at a glance.', false: 'Message is unclear or generic.' },
  },
  headline_readable: {
    type: 'noul',
    instructions: 'Is the main headline readable when the 1024x500 graphic is shown at 512px wide?',
    criteria: { true: 'Headline is readable at that size.', false: 'Headline is too small or low contrast.' },
  },
  supporting_readable: {
    type: 'noul',
    instructions: 'Is the supporting line readable when the graphic is shown at 512px wide?',
    criteria: { true: 'Supporting line is readable.', false: 'It is too small or low contrast.' },
  },
  safe_margins: {
    type: 'noul',
    instructions: 'Are the logo, headline, and supporting line at least 10% away from the image edges?',
    criteria: { true: 'All key text is inside a 10% margin.', false: 'Some key text is closer than 10% to an edge.' },
  },
  device_frame: {
    type: 'noul',
    instructions: 'Does the feature graphic place the art inside a phone or device mockup frame?',
    criteria: { true: 'A phone/device frame is present.', false: 'No device frame.' },
  },
  ranking_award: {
    type: 'noul',
    instructions: 'Does the graphic contain rankings, awards, user testimonials, or download counts?',
    criteria: { true: 'At least one is present.', false: 'None are present.' },
  },
  price_promo: {
    type: 'noul',
    instructions: 'Does the graphic contain price, discount, sale, or promotional information?',
    criteria: { true: 'Promotional or price content is present.', false: 'None is present.' },
  },
  added_cta: {
    type: 'noul',
    instructions: 'Does the graphic add a marketing call to action that is not part of the app?',
    criteria: { true: 'An added marketing CTA is present.', false: 'No added marketing CTA.' },
  },
  misleading: {
    type: 'noul',
    instructions: 'Does the graphic imply a capability or state the app does not have?',
    criteria: { true: 'There is a misleading implication.', false: 'The graphic is accurate.' },
  },
  quality: {
    type: 'score',
    instructions: 'How polished and appealing is this feature graphic?',
    criteria: ['Poor', 'Acceptable', 'Polished', 'Exceptional'],
  },
};

const FEATURE_GATES = {
  value_clear: { min: 0.6 },
  headline_readable: { min: 0.7 },
  supporting_readable: { min: 0.5 },
  safe_margins: { min: 0.6 },
  device_frame: { max: 0.5 },
  ranking_award: { max: 0.5 },
  price_promo: { max: 0.5 },
  added_cta: { max: 0.5 },
  misleading: { max: 0.5 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiKey() {
  return process.env.TYPESAFE_API_KEY?.trim() || (await readFile(`${homedir()}/.config/typesafe/api_key`, 'utf8')).trim();
}

async function callJev(key, state, questions, assets) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
      if (assets) headers['TypeSafe-Danger-Zone-Images'] = 'true';
      const body = { model: MODEL, state, questions };
      if (assets) body.assets = assets;
      const res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(500 * attempt);
    }
  }
  throw lastError;
}

function fmt(a) {
  if (!a) return 'n/a';
  if (a.type === 'noul') return a.noul.toFixed(2);
  if (a.type === 'score') return `${a.score.toFixed(2)} / 3 (confidence ${a.confidence.toFixed(2)})`;
  if (a.type === 'choice') return `${a.choice} (${a.confidence.toFixed(2)})`;
  return JSON.stringify(a);
}

function imagePathToJpeg(file, maxW) {
  const jpg = `/tmp/jev-${file.split('/').pop().replace(/\.\w+$/, '')}.jpg`;
  execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open(${JSON.stringify(file)}).convert('RGB')
w, h = im.size
if w > ${maxW}:
    im = im.resize((${maxW}, round(h * ${maxW} / w)), Image.LANCZOS)
im.save(${JSON.stringify(jpg)}, quality=90)
`]);
  return jpg;
}

async function imageCall(key, file, state, questions, maxW) {
  const jpg = imagePathToJpeg(file, maxW);
  const b64 = (await readFile(jpg)).toString('base64');
  return callJev(key, { ...state, image: 'ASSET' }, questions, {
    ASSET: { type: 'image', format: 'jpg', data_base64: b64 },
  });
}

function gate(answers, gates) {
  const issues = [];
  for (const [name, rule] of Object.entries(gates)) {
    const a = answers[name];
    if (!a) continue;
    if (rule.min != null && a.noul < rule.min) issues.push(`${name} ${a.noul.toFixed(2)} < ${rule.min}`);
    if (rule.max != null && a.noul >= rule.max) issues.push(`${name} ${a.noul.toFixed(2)} >= ${rule.max}`);
  }
  return issues;
}

function table(questions, answers) {
  const lines = ['| Check | Result |', '| --- | --- |'];
  for (const q of Object.keys(questions)) lines.push(`| ${q} | ${fmt(answers[q])} |`);
  return lines;
}

function advisory(answers) {
  const notes = [];
  // Aesthetic quality is the only subjective signal retained; it is advisory only.
  // Low-confidence scores are ignored rather than presented as findings.
  if (answers.quality && answers.quality.score < 2.0 && answers.quality.confidence >= 0.5) {
    notes.push(`subjective quality ${answers.quality.score.toFixed(2)}/3 (confidence ${answers.quality.confidence.toFixed(2)})`);
  }
  return notes;
}

const key = await apiKey();
const report = { generated_at: new Date().toISOString(), model: MODEL, steps: {} };

/* copy */
process.stderr.write('jeving copy\n');
const copyState = {
  app: 'VPNSky',
  platform: 'Android',
  store: 'Google Play',
  app_facts: APP_FACTS,
  play_rules: PLAY_RULES,
  listing: {
    app_name: listing.app_name,
    short_description: listing.short_description,
    full_description: listing.full_description,
    whats_new: listing.whats_new,
  },
};
const copyRes = await callJev(key, copyState, COPY_QUESTIONS);
report.steps.copy = {
  answers: copyRes.answers,
  usage: copyRes.usage,
  issues: gate(copyRes.answers, COPY_GATES),
  advisory: advisory(copyRes.answers),
};

/* icon */
process.stderr.write('jeving icon\n');
const iconRes = await imageCall(key, resolve(DIR, 'assets/app-icon-512.png'), {
  purpose: 'Google Play app icon, 512x512',
  brand: 'VPNSky, a WireGuard VPN for Android with a rocket flight theme.',
  palette: ['#3368A0 deep blue', '#66A3BF sky blue', '#C8DFDB sage', '#F2EFE7 cream'],
  play_rules: PLAY_RULES,
}, ICON_QUESTIONS, 512);
report.steps.icon = { answers: iconRes.answers, usage: iconRes.usage, issues: gate(iconRes.answers, ICON_GATES), advisory: advisory(iconRes.answers) };

/* feature */
process.stderr.write('jeving feature\n');
const featureRes = await imageCall(key, resolve(DIR, 'assets/feature-graphic-1024x500.png'), {
  purpose: 'Google Play feature graphic, 1024x500',
  brand: 'VPNSky, a private WireGuard VPN for Android with a rocket flight deck.',
  palette: ['#3368A0 deep blue', '#66A3BF sky blue', '#C8DFDB sage', '#F2EFE7 cream'],
  play_rules: PLAY_RULES,
}, FEATURE_QUESTIONS, 1024);
report.steps.feature = { answers: featureRes.answers, usage: featureRes.usage, issues: gate(featureRes.answers, FEATURE_GATES), advisory: advisory(featureRes.answers) };

/* slides */
for (const slide of SLIDES) {
  process.stderr.write(`jeving ${slide.key}\n`);
  const detail = Boolean(slide.detail);
  const questions = { ...SLIDE_QUESTIONS };
  if (detail) {
    delete questions.real_app_screen;
    delete questions.key_ui_readable;
  } else {
    delete questions.real_app_elements;
    delete questions.key_content_readable;
  }
  const res = await imageCall(key, resolve(DIR, slide.file), {
    app: 'VPNSky',
    app_facts: APP_FACTS,
    play_rules: PLAY_RULES,
    slide: {
      tagline: slide.tagline,
      subline: slide.subline,
      visible_app_state: slide.state,
      purpose: slide.purpose,
      is_detail_view: detail,
    },
  }, questions, 720);
  report.steps[slide.key] = {
    slide,
    questions,
    answers: res.answers,
    usage: res.usage,
    issues: gate(res.answers, SLIDE_GATES),
    advisory: advisory(res.answers),
  };
}

/* objective specs */
function stat(p) {
  const out = execFileSync('python3', ['-c', `
from PIL import Image
import os
path = ${JSON.stringify(p)}
im = Image.open(path)
print(im.size[0], im.size[1], im.mode, os.path.getsize(path))
`]).toString().trim().split(' ');
  return { w: +out[0], h: +out[1], mode: out[2], bytes: +out[3] };
}
const specs = {
  app_name_chars: listing.app_name.length,
  short_chars: listing.short_description.length,
  full_chars: listing.full_description.length,
  whats_new_chars: listing.whats_new.length,
  icon: stat(resolve(DIR, 'assets/app-icon-512.png')),
  feature: stat(resolve(DIR, 'assets/feature-graphic-1024x500.png')),
  screenshots: SLIDES.map((s) => ({ key: s.key, ...stat(resolve(DIR, s.file)) })),
  alt_text_lengths: Object.fromEntries(Object.entries(listing.alt_text).map(([k, v]) => [k, v.length])),
};
const specIssues = [];
if (specs.app_name_chars > 30) specIssues.push('app name > 30');
if (specs.short_chars > 80) specIssues.push('short description > 80');
if (specs.full_chars > 4000) specIssues.push('full description > 4000');
if (specs.whats_new_chars > 500) specIssues.push("what's new > 500");
if (specs.icon.w !== 512 || specs.icon.h !== 512) specIssues.push('icon not 512x512');
if (specs.icon.mode !== 'RGBA') specIssues.push('icon not 32-bit RGBA');
if (specs.icon.bytes > 1024 * 1024) specIssues.push('icon > 1 MB');
if (specs.feature.w !== 1024 || specs.feature.h !== 500) specIssues.push('feature not 1024x500');
if (specs.feature.mode !== 'RGB') specIssues.push('feature not 24-bit RGB');
if (specs.screenshots.length < 2 || specs.screenshots.length > 8) specIssues.push('screenshot count outside 2-8');
for (const s of specs.screenshots) {
  if (s.w !== 1080 || s.h !== 1920) specIssues.push(`${s.key} not 1080x1920`);
  if (s.mode !== 'RGB') specIssues.push(`${s.key} has alpha`);
  if (s.bytes > 8 * 1024 * 1024) specIssues.push(`${s.key} > 8 MB`);
}
for (const [k, n] of Object.entries(specs.alt_text_lengths)) if (n > 140) specIssues.push(`${k} alt text > 140`);
specs.issues = specIssues;
report.specs = specs;

/* report */
const lines = [];
lines.push('# VPNSky — TypeSafe Jev validation');
lines.push('');
lines.push(`Generated: ${report.generated_at}`);
lines.push(`Model: \`${copyRes.model || MODEL}\``);
lines.push('');
lines.push('## Method');
lines.push('');
lines.push('Jev is used as a set of narrow judgments, not as a single vote. Every Play rule is a separate question with its own threshold in `scripts/jev_store_listing_audit.mjs`; objective rules (dimensions, format, character limits) are enforced in code. Images are sent to the Jev vision model at the API-safe preview resolution: 720×1280 for the 1080×1920 screenshots, 1024×500 for the feature graphic, and 512×512 for the icon. All Play rules are gated separately. A single "biggest issue" aggregate was removed after it contradicted the rule-specific answers; the aesthetic `quality` score is advisory only, and low-confidence aesthetic scores are ignored.');
lines.push('');
lines.push('## Listing copy');
lines.push('');
lines.push(...table(COPY_QUESTIONS, copyRes.answers));
lines.push('');
lines.push(`**Verdict: ${report.steps.copy.issues.length ? 'REVIEW' : 'PASS'}**${report.steps.copy.issues.length ? ` — ${report.steps.copy.issues.join('; ')}` : ''}`);
if (report.steps.copy.advisory.length) lines.push(`Advisory: ${report.steps.copy.advisory.join('; ')}.`);
lines.push('');
lines.push('## App icon');
lines.push('');
lines.push(...table(ICON_QUESTIONS, iconRes.answers));
lines.push('');
lines.push(`**Verdict: ${report.steps.icon.issues.length ? 'REVIEW' : 'PASS'}**${report.steps.icon.issues.length ? ` — ${report.steps.icon.issues.join('; ')}` : ''}`);
if (report.steps.icon.advisory.length) lines.push(`Advisory: ${report.steps.icon.advisory.join('; ')}.`);
lines.push('');
lines.push('## Feature graphic');
lines.push('');
lines.push(...table(FEATURE_QUESTIONS, featureRes.answers));
lines.push('');
lines.push(`**Verdict: ${report.steps.feature.issues.length ? 'REVIEW' : 'PASS'}**${report.steps.feature.issues.length ? ` — ${report.steps.feature.issues.join('; ')}` : ''}`);
if (report.steps.feature.advisory.length) lines.push(`Advisory: ${report.steps.feature.advisory.join('; ')}.`);
lines.push('');
lines.push('## Screenshots');
for (const slide of SLIDES) {
  const step = report.steps[slide.key];
  lines.push('');
  lines.push(`### ${slide.key} — “${slide.tagline}”`);
  lines.push('');
  lines.push(...table(step.questions, step.answers));
  lines.push('');
  lines.push(`**Verdict: ${step.issues.length ? 'REVIEW' : 'PASS'}**${step.issues.length ? ` — ${step.issues.join('; ')}` : ''}`);
  if (step.advisory.length) lines.push(`Advisory: ${step.advisory.join('; ')}.`);
}
lines.push('');
lines.push('## Objective checks');
lines.push('');
lines.push('```json');
lines.push(JSON.stringify(specs, null, 2));
lines.push('```');
lines.push('');
lines.push('## Overall');
lines.push('');
const allIssues = [
  ...report.steps.copy.issues.map((x) => `copy: ${x}`),
  ...report.steps.icon.issues.map((x) => `icon: ${x}`),
  ...report.steps.feature.issues.map((x) => `feature: ${x}`),
  ...SLIDES.flatMap((s) => report.steps[s.key].issues.map((x) => `${s.key}: ${x}`)),
  ...specs.issues.map((x) => `spec: ${x}`),
];
lines.push(allIssues.length ? `**${allIssues.length} rule(s) need review:** ${allIssues.join('; ')}` : '**All Play-rule gates pass.**');
const advisories = [
  ...report.steps.copy.advisory.map((x) => `copy: ${x}`),
  ...report.steps.icon.advisory.map((x) => `icon: ${x}`),
  ...report.steps.feature.advisory.map((x) => `feature: ${x}`),
  ...SLIDES.flatMap((s) => report.steps[s.key].advisory.map((x) => `${s.key}: ${x}`)),
];
if (advisories.length) lines.push(`Advisory notes: ${advisories.join('; ')}.`);
lines.push('');

await writeFile(OUT_JSON, JSON.stringify(report, null, 2));
await writeFile(OUT_MD, lines.join('\n'));
console.log(lines.join('\n'));
console.error('\nWrote', OUT_JSON, 'and', OUT_MD);
