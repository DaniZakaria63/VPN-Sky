#!/usr/bin/env node
/**
 * Confirms that the versionCode we just uploaded is actually on the requested Play track.
 *
 * The upload action succeeds once the edit is committed; this reads the track back through the
 * Android Publisher API so CI fails loudly if the AAB was accepted but not attached to the track
 * (for example because the release was left as a draft or the service account lost access).
 *
 * Auth is a service-account JWT signed with Node's crypto, so this needs no extra dependency.
 * Environment: PLAY_SERVICE_ACCOUNT_JSON, PLAY_TRACK, PLAY_VERSION_CODE.
 */
import crypto from 'node:crypto';

const PACKAGE_NAME = process.env.PLAY_PACKAGE_NAME || 'com.wingsheep.vpnsky';
const TRACK = process.env.PLAY_TRACK || 'internal';
const EXPECTED_CODE = String(process.env.PLAY_VERSION_CODE || '');
const SERVICE_ACCOUNT = process.env.PLAY_SERVICE_ACCOUNT_JSON;

if (!SERVICE_ACCOUNT) {
  console.error('play-verify: PLAY_SERVICE_ACCOUNT_JSON is not set');
  process.exit(1);
}
if (!EXPECTED_CODE) {
  console.error('play-verify: PLAY_VERSION_CODE is not set');
  process.exit(1);
}

let account;
try {
  account = JSON.parse(SERVICE_ACCOUNT);
} catch (error) {
  console.error(
    `play-verify: service account JSON is invalid: ${error.message}`,
  );
  process.exit(1);
}
if (!account.client_email || !account.private_key) {
  console.error(
    'play-verify: service account JSON is missing client_email or private_key',
  );
  process.exit(1);
}

const base64url = value => Buffer.from(value).toString('base64url');

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(account.private_key).toString('base64url');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`token request failed (${response.status}): ${body}`);
  }
  return JSON.parse(body).access_token;
}

const apiBase = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
  PACKAGE_NAME,
)}`;

async function api(token, method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${url} failed (${response.status}): ${text}`);
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

async function trackVersionCodes(token) {
  const edit = await api(token, 'POST', `${apiBase}/edits`, {});
  try {
    const track = await api(
      token,
      'GET',
      `${apiBase}/edits/${encodeURIComponent(
        edit.id,
      )}/tracks/${encodeURIComponent(TRACK)}`,
    );
    const releases = track?.releases ?? [];
    return {
      codes: releases
        .flatMap(release => release.versionCodes ?? [])
        .map(String),
      releases: releases.map(release => ({
        name: release.name,
        status: release.status,
        versionCodes: (release.versionCodes ?? []).map(String),
      })),
    };
  } finally {
    // Always discard the read-only edit; never leave it open.
    await api(
      token,
      'DELETE',
      `${apiBase}/edits/${encodeURIComponent(edit.id)}`,
    ).catch(() => {});
  }
}

const token = await accessToken();
let lastCodes = [];
for (let attempt = 1; attempt <= 6; attempt += 1) {
  const { codes, releases } = await trackVersionCodes(token);
  lastCodes = codes;
  if (codes.includes(EXPECTED_CODE)) {
    console.log(
      `play-verify: versionCode ${EXPECTED_CODE} is on the "${TRACK}" track of ${PACKAGE_NAME}`,
    );
    for (const release of releases) {
      console.log(
        `  ${release.name}: status=${
          release.status
        } codes=${release.versionCodes.join(',')}`,
      );
    }
    process.exit(0);
  }
  console.log(
    `play-verify: attempt ${attempt}/6: ${PACKAGE_NAME} (${TRACK}) has versionCodes [${codes.join(
      ', ',
    )}], waiting for ${EXPECTED_CODE}`,
  );
  if (attempt < 6) await new Promise(resolve => setTimeout(resolve, 10000));
}

console.error(
  `play-verify: versionCode ${EXPECTED_CODE} is NOT on the "${TRACK}" track (found [${lastCodes.join(
    ', ',
  )}])`,
);
process.exit(1);
