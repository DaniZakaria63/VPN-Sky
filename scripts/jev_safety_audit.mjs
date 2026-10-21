#!/usr/bin/env node
/**
 * Jev safety audit for VPNSky.
 *
 * Sends each runtime-critical source file to TypeSafe's Jev as *state* and asks
 * four narrow, typed questions about thread safety and runtime safety. Code owns
 * the policy (thresholds, aggregation); Jev only supplies calibrated judgments.
 *
 * Usage:
 *   TYPESAFE_API_KEY=... node scripts/jev_safety_audit.mjs [--out artifacts/jev.json]
 *   (falls back to ~/.config/typesafe/api_key)
 *
 * Exit code is 0 even when hazards are found: this is a report, not a gate.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MODEL = 'jev-latest';
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const CONCURRENCY = 4;

const SYSTEM_CONTEXT = [
  'VPNSky is a React Native 0.86 Android VPN client (new architecture, Hermes).',
  'UI state lives in React hooks; a legacy ReactContextBaseJavaModule ("VpnConnectManager")',
  'wraps the WireGuard GoBackend. Promise methods are invoked on the React Native native-modules',
  'queue (not the UI thread, but any long block there stalls bridge traffic).',
  'connect()/disconnect() are dispatched to one single-thread executor; GoBackend.setState()',
  'blocks until the tunnel is up or down. Tunnel state changes arrive on a backend thread and are',
  'emitted to JS through RCTDeviceEventEmitter. The app must survive lifecycle teardown, missing',
  'network, malformed remote config, and repeated user taps. This is a long-running service, so a',
  'leaked thread, stuck promise, ANR, or crash is a production incident.',
].join(' ');

/** Thresholds are policy, evaluated in code, not delegated to the model. */
const POLICY = {
  threadScore: 1.6,
  runtimeScore: 1.6,
  needsAdjustmentNoul: 0.6,
  hazardConfidence: 0.5,
};

const FILES = [
  'src/config.ts',
  'src/geo.ts',
  'src/native/vpn.ts',
  'src/hooks/useVpn.ts',
  'src/screens/HomeScreen.tsx',
  'src/components/RocketScene.tsx',
  'src/components/RocketScene.styles.ts',
  'App.tsx',
  'android/app/src/main/java/com/wingsheep/vpnsky/vpn/VpnSkyVpnModule.kt',
  'android/app/src/main/java/com/wingsheep/vpnsky/vpn/WireguardManager.kt',
  'android/app/src/main/java/com/wingsheep/vpnsky/vpn/WireguardTunnel.kt',
  'android/app/src/main/java/com/wingsheep/vpnsky/vpn/WireguardKeys.kt',
  'android/app/src/main/java/com/wingsheep/vpnsky/MainApplication.kt',
  'android/app/src/main/AndroidManifest.xml',
  'android/app/build.gradle',
];

const QUESTIONS = {
  thread_safety_risk: {
    type: 'score',
    instructions:
      'Rate the thread-safety risk of this file in the described running service. Consider blocking calls on shared threads, unsynchronized shared mutable state, callbacks crossing threads, deadlock/lock contention, and executor or lifecycle races.',
    criteria: [
      'No shared mutable state and no realistic cross-thread interaction.',
      'Shared state or threading exists but is serialized, confined, or otherwise safe under realistic use.',
      'A plausible race, stale-state read, or unsafe cross-thread access can occur under realistic use.',
      'A concrete race, deadlock, unbounded block, or thread leak is likely to freeze or corrupt the service.',
    ],
  },
  runtime_safety_risk: {
    type: 'score',
    instructions:
      'Rate the runtime-safety risk of this file. Consider unhandled exceptions, stuck or never-settled promises, resource and lifecycle leaks, unbounded waits, invalid input reaching a parser, and crash/ANR paths during normal use (rotation, backgrounding, process death, flaky network).',
    criteria: [
      'No realistic crash, hang, leak, or stuck-state path.',
      'Edge cases are handled; only minor gaps with low impact.',
      'A realistic input or lifecycle path can throw, leak, hang, or leave the app in a stuck state.',
      'A crash, ANR, permanent stuck state, or leak is likely during normal operation.',
    ],
  },
  needs_adjustment: {
    type: 'noul',
    instructions:
      'Does this file require a code change to be acceptable for thread safety or runtime safety in this long-running VPN service? Cosmetic, stylistic, or purely theoretical concerns do not count.',
    criteria: {
      true: 'A concrete thread-safety or runtime-safety defect warrants a code change.',
      false: 'No concrete thread-safety or runtime-safety defect warrants a code change.',
    },
  },
  main_hazard: {
    type: 'choice',
    instructions:
      'What is the single most important thread-safety or runtime-safety hazard in this file? Choose none when there is no concrete hazard.',
    criteria: {
      none: 'No concrete thread-safety or runtime-safety hazard.',
      'main-thread-blocking': 'Blocking work on a UI, JS, or bridge thread, or an unbounded synchronous wait.',
      'race-condition': 'Shared state read/written without adequate ordering or synchronization.',
      'lifecycle-leak': 'Listener, executor, timer, promise, or object outliving its owner or never cleaned up.',
      'stuck-promise': 'A promise can remain unresolved, or resolve the wrong outcome, leaving callers waiting.',
      'unhandled-exception': 'An exception path can escape and crash or leave inconsistent state.',
      'resource-unsafe': 'File, key, socket, or other resource used unsafely (partial write, leak, bad cleanup).',
    },
  },
};

function apiKey() {
  return process.env.TYPESAFE_API_KEY?.trim() || null;
}

async function apiKeyFromDisk() {
  try {
    return (await readFile(`${homedir()}/.config/typesafe/api_key`, 'utf8')).trim();
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callJev(key, state, questions) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state, model: MODEL, questions }),
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(400 * attempt);
    }
  }
  throw lastError;
}

function verdict(file, answers) {
  const thread = answers.thread_safety_risk?.score ?? 0;
  const runtime = answers.runtime_safety_risk?.score ?? 0;
  const needs = answers.needs_adjustment?.noul ?? 0;
  const hazard = answers.main_hazard ?? { choice: 'none', confidence: 0 };
  const reasons = [];
  if (thread >= POLICY.threadScore) reasons.push(`thread ${thread.toFixed(2)}`);
  if (runtime >= POLICY.runtimeScore) reasons.push(`runtime ${runtime.toFixed(2)}`);
  if (needs >= POLICY.needsAdjustmentNoul) reasons.push(`needs ${needs.toFixed(2)}`);
  const adjust =
    (thread >= POLICY.threadScore || runtime >= POLICY.runtimeScore || needs >= POLICY.needsAdjustmentNoul) &&
    hazard.choice !== 'none' &&
    hazard.confidence >= POLICY.hazardConfidence
      ? 'yes'
      : 'review';
  return {
    file,
    thread: Number(thread.toFixed(2)),
    runtime: Number(runtime.toFixed(2)),
    needs: Number(needs.toFixed(2)),
    hazard: hazard.choice,
    hazardConfidence: Number((hazard.confidence ?? 0).toFixed(2)),
    verdict: adjust,
    reasons: reasons.join(', ') || 'below thresholds',
  };
}

async function main() {
  const outIndex = process.argv.indexOf('--out');
  const outPath = resolve(
    ROOT,
    outIndex > -1 ? process.argv[outIndex + 1] : 'artifacts/jev-safety-report.json',
  );

  const key = apiKey() || (await apiKeyFromDisk());
  if (!key) {
    console.error(
      'No TypeSafe API key. Set TYPESAFE_API_KEY or write ~/.config/typesafe/api_key.',
    );
    process.exit(2);
  }

  const sources = await Promise.all(
    FILES.map(async (file) => ({
      path: file,
      content: await readFile(resolve(ROOT, file), 'utf8'),
    })),
  );

  const results = [];
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= sources.length) return;
      const source = sources[index];
      const state = {
        system_context: SYSTEM_CONTEXT,
        file: source.path,
        code: source.content,
      };
      process.stderr.write(`jeving ${source.path}\n`);
      try {
        const response = await callJev(key, state, QUESTIONS);
        results[index] = {
          ...verdict(source.path, response.answers ?? {}),
          raw: response.answers ?? {},
          usage: response.usage ?? {},
        };
      } catch (error) {
        // One flaky request must not discard the files that already succeeded.
        results[index] = {
          file: source.path,
          thread: null,
          runtime: null,
          needs: null,
          hazard: 'unavailable',
          hazardConfidence: 0,
          verdict: 'error',
          reasons: error.message ?? String(error),
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sources.length) }, worker));

  const sorted = results.filter(Boolean).sort((a, b) => {
    const rank = (r) => (r.verdict === 'error' ? 2 : r.verdict === 'yes' ? 0 : 1);
    return rank(a) - rank(b) || (b.thread ?? 0) + (b.runtime ?? 0) - ((a.thread ?? 0) + (a.runtime ?? 0));
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    policy: POLICY,
    files: sorted,
    summary: {
      assessed: sorted.length,
      needsAdjustment: sorted.filter((r) => r.verdict === 'yes').length,
      review: sorted.filter((r) => r.verdict === 'review').length,
      errors: sorted.filter((r) => r.verdict === 'error').length,
    },
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`);

  const md = [
    '# Jev thread & runtime safety audit',
    '',
    `Generated ${payload.generatedAt} · model \`${MODEL}\` · policy: thread ≥ ${POLICY.threadScore}, runtime ≥ ${POLICY.runtimeScore}, needs ≥ ${POLICY.needsAdjustmentNoul}, hazard confidence ≥ ${POLICY.hazardConfidence}`,
    '',
    '| File | Thread | Runtime | Needs fix | Main hazard (conf) | Verdict |',
    '| --- | ---: | ---: | ---: | --- | --- |',
    ...sorted.map((r) =>
      r.verdict === 'error'
        ? `| \`${r.file}\` | — | — | — | unavailable | error: ${String(r.reasons).replace(/\|/g, '\\|').slice(0, 120)} |`
        : `| \`${r.file}\` | ${r.thread.toFixed(2)} | ${r.runtime.toFixed(2)} | ${r.needs.toFixed(2)} | ${r.hazard} (${r.hazardConfidence.toFixed(2)}) | ${r.verdict} |`,
    ),
    '',
    `**${payload.summary.needsAdjustment}/${payload.summary.assessed}** files need adjustment; **${payload.summary.review}** need review; **${payload.summary.errors}** could not be assessed.`,
    '',
  ].join('\n');

  await writeFile(outPath.replace(/\.json$/, '.md'), md);
  process.stdout.write(md);
  process.stdout.write(`\nJSON: ${outPath}\n`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
