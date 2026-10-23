#!/usr/bin/env node
/**
 * Single source of truth for the Android version.
 *
 * `android/version.properties` is read by Gradle (so local builds and IDE runs show the same
 * version as CI), while `package.json` is kept in sync for tooling. The release workflow calls
 * this script to compute the next semver and a strictly increasing versionCode before it builds.
 *
 * Usage:
 *   node scripts/version.mjs show                 # 1.0.0 (57036467), latest tag: v1.0.0
 *   node scripts/version.mjs name                 # 1.0.0
 *   node scripts/version.mjs code                 # next versionCode
 *   node scripts/version.mjs bump patch|minor|major
 *   node scripts/version.mjs write 1.0.1 57050000
 *   node scripts/version.mjs assert-newer 1.0.1   # fails when <= latest v* tag
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const propsPath = join(root, 'android', 'version.properties');
const packagePath = join(root, 'package.json');
const packageLockPath = join(root, 'package-lock.json');

/** 2025-01-01T00:00:00Z. versionCode = seconds since this epoch, floored above the previous one. */
const VERSION_CODE_EPOCH = 1735689600;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) {
  console.error(`version: ${message}`);
  process.exit(1);
}

function readProperties() {
  let text;
  try {
    text = readFileSync(propsPath, 'utf8');
  } catch {
    fail(`missing ${propsPath}`);
  }
  const name = text.match(/^VERSION_NAME=(.+)$/m)?.[1]?.trim();
  const code = text.match(/^VERSION_CODE=(\d+)$/m)?.[1];
  if (!name || !code) {
    fail(`${propsPath} must contain VERSION_NAME and VERSION_CODE`);
  }
  if (!SEMVER.test(name)) {
    fail(`VERSION_NAME "${name}" is not MAJOR.MINOR.PATCH`);
  }
  return { name, code: Number(code) };
}

function parse(version) {
  const match = SEMVER.exec(version);
  if (!match) fail(`"${version}" is not MAJOR.MINOR.PATCH`);
  return match.slice(1).map(Number);
}

function compare(left, right) {
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function increment(version, part) {
  const [major, minor, patch] = parse(version);
  if (part === 'major') return `${major + 1}.0.0`;
  if (part === 'minor') return `${major}.${minor + 1}.0`;
  if (part === 'patch') return `${major}.${minor}.${patch + 1}`;
  fail(`unknown bump "${part}" (expected patch, minor or major)`);
}

function releaseTags() {
  try {
    return execFileSync('git', ['tag', '--list', 'v*'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map(tag => tag.trim())
      .filter(Boolean)
      .map(tag => tag.replace(/^v/, ''))
      .filter(version => SEMVER.test(version));
  } catch {
    return [];
  }
}

function latestTag() {
  const tags = releaseTags();
  if (tags.length === 0) return null;
  return tags.reduce((latest, version) =>
    compare(version, latest) > 0 ? version : latest,
  );
}

function highest(...versions) {
  return versions.filter(Boolean).reduce((latest, version) => {
    if (!latest) return version;
    return compare(version, latest) > 0 ? version : latest;
  }, null);
}

function nextCode(previousCode) {
  const fromClock = Math.floor(Date.now() / 1000) - VERSION_CODE_EPOCH;
  return Math.max(fromClock, Number(previousCode) + 1, 1);
}

function writeVersion(name, code) {
  if (!SEMVER.test(name)) fail(`"${name}" is not MAJOR.MINOR.PATCH`);
  if (!Number.isSafeInteger(code) || code < 1)
    fail(`invalid versionCode "${code}"`);

  const properties = [
    '# Android versionName / versionCode read by android/app/build.gradle.',
    '# The release workflow bumps this file, then builds the tag from the resulting commit.',
    '# Do not edit by hand: use `node scripts/version.mjs write <name> <code>`.',
    `VERSION_NAME=${name}`,
    `VERSION_CODE=${code}`,
    '',
  ].join('\n');
  writeFileSync(propsPath, properties);

  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  pkg.version = name;
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

  const lock = JSON.parse(readFileSync(packageLockPath, 'utf8'));
  lock.version = name;
  if (lock.packages?.['']) lock.packages[''].version = name;
  writeFileSync(packageLockPath, `${JSON.stringify(lock, null, 2)}\n`);

  console.log(`version: wrote ${name} (${code})`);
}

const [command, ...args] = process.argv.slice(2);
const current = readProperties();

switch (command) {
  case 'show': {
    const tag = latestTag();
    console.log(
      `${current.name} (${current.code})${tag ? `, latest tag: v${tag}` : ''}`,
    );
    break;
  }
  case 'name':
    console.log(current.name);
    break;
  case 'check': {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
    const lock = JSON.parse(readFileSync(packageLockPath, 'utf8'));
    const lockRoot = lock.packages?.['']?.version;
    const problems = [];
    if (pkg.version !== current.name) {
      problems.push(`package.json is ${pkg.version}`);
    }
    if (lock.version !== current.name) {
      problems.push(`package-lock.json is ${lock.version}`);
    }
    if (lockRoot !== current.name) {
      problems.push(`package-lock.json packages[""] is ${lockRoot}`);
    }
    if (problems.length > 0) {
      fail(
        `${problems.join(', ')}; android/version.properties is ${
          current.name
        } (${current.code})`,
      );
    }
    console.log(`version: ok ${current.name} (${current.code})`);
    break;
  }
  case 'code':
    console.log(nextCode(current.code));
    break;
  case 'bump': {
    const base = highest(current.name, latestTag());
    console.log(increment(base, args[0] ?? 'patch'));
    break;
  }
  case 'latest-tag':
    console.log(latestTag() ?? '');
    break;
  case 'assert-newer': {
    const candidate = args[0];
    if (!candidate) fail('assert-newer needs a version');
    parse(candidate);
    const tag = latestTag();
    if (tag && compare(candidate, tag) <= 0) {
      fail(`v${candidate} is not newer than the latest release tag v${tag}`);
    }
    if (compare(candidate, current.name) < 0) {
      fail(
        `v${candidate} is older than the committed version v${current.name}`,
      );
    }
    break;
  }
  case 'assert-latest': {
    // Tag-triggered builds skip the bump, but must not publish an older tag after a newer one.
    const candidate = args[0];
    if (!candidate) fail('assert-latest needs a version');
    parse(candidate);
    const tag = latestTag();
    if (tag && compare(candidate, tag) < 0) {
      fail(`v${candidate} is older than the latest release tag v${tag}`);
    }
    break;
  }
  case 'write': {
    const name = args[0];
    const code = Number(args[1]);
    if (!name || !args[1]) fail('write needs <version> <versionCode>');
    writeVersion(name, code);
    break;
  }
  default:
    fail(
      'usage: version.mjs show|name|check|code|latest-tag|bump <part>|assert-newer <version>|assert-latest <version>|write <version> <code>',
    );
}
