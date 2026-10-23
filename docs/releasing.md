# Releasing VPNSky

The release workflow (`.github/workflows/build-release.yml`) owns versioning and the Play upload.
Do not hand-edit the version before a release; let it compute the bump.

## One-time setup

1. **Secrets** (Settings → Secrets and variables → Actions):

   | Secret | Purpose |
   |---|---|
   | `KEYSTORE_FILE` | `base64 -w0 android/keystore/vpnsky.jks`, one line |
   | `KEYSTORE_PASSWORD` | JKS store password |
   | `KEY_ALIAS` | `vpnsky` |
   | `KEY_PASSWORD` | key password for that alias |
   | `PLAY_SERVICE_ACCOUNT_JSON` | Play Console service-account JSON |

   The service account needs **Release to testing tracks** and, for production releases,
   **Manage production releases** in Play Console → Users and permissions.

2. **Optional variables** (Settings → Secrets and variables → Actions → Variables) for
   tag-triggered releases:
   - `PLAY_TRACK`: `internal` (default), `alpha`, `beta`, or `production`.
   - `PLAY_RELEASE_STATUS`: `completed` (default) or `draft`.

   Manual dispatch has its own track/status selectors and ignores these variables.

3. **Allow the bot to push the version bump.** Repository settings → Actions → General →
   Workflow permissions: *Read and write permissions*. If `master` is protected, either allow
   GitHub Actions to bypass the rule or the release will stop before building with a clear error.

4. **Declare the foreground-service type in Play Console** (App content → Foreground service
   types → `specialUse`) before the first build that contains `VpnForegroundService`.

## Release a new version

1. Open **Actions → Release (Play Store) → Run workflow**.
2. Choose the branch: `master` (anything else is rejected).
3. Choose:
   - **bump**: `patch`, `minor`, or `major` (default `patch`); or
   - **version**: an exact `MAJOR.MINOR.PATCH` (overrides `bump`).
   - **track**: `internal` by default.
   - **release_status**: `completed` publishes to the track immediately; `draft` leaves it
     unpublished in Play Console.
4. Run it.

The job:

1. Runs `tsc`, ESLint, and Jest.
2. Computes the next version from the highest of the latest `v*` tag and
   `android/version.properties`, then writes `android/version.properties`, `package.json` and
   `package-lock.json`.
3. Computes `versionCode = max(seconds since 2025-01-01, previous code + 1)` and fails if the
   version is not newer than the latest tag.
4. Commits `chore(release): vX.Y.Z [skip ci]` and pushes it to `master`.
5. Builds the R8-minified, upload-key-signed AAB + APK.
6. Uploads the AAB to the selected Play track.
7. Reads the track back through the Android Publisher API and fails unless the new `versionCode`
   is present (`scripts/play_verify.mjs`).
8. Creates and pushes the annotated `vX.Y.Z` tag, then the GitHub release with the APK attached.

`GITHUB_TOKEN`-created tags do not re-trigger workflows, so the tag cannot upload the same release
a second time.

## Tag path (recovery / manual)

Pushing `vX.Y.Z` also runs the same job, but skips the bump and commit and builds the tag exactly
as named. Use it to rebuild a release whose upload failed:

```bash
git tag -a v1.0.1 -m "VPNSky 1.0.1"
git push origin v1.0.1
```

The tag must be `vMAJOR.MINOR.PATCH` and must not be older than the latest release tag. The
workflow writes the computed `versionCode` into the checkout but does not commit it on this path;
the next dispatch uses the tag as the version base.

## Version rules

- **versionName** is the semver tag/input, e.g. `1.0.1`.
- **versionCode** is a timestamp in seconds since `2025-01-01T00:00:00Z`, floored one above the
  last committed code. Current releases are already in the ~57,000,000 range, so switching to a
  small sequential scheme would be a Play downgrade. The timestamp stays under Play's
  2,100,000,000 ceiling for decades.
- The committed `android/version.properties` is what local builds, IDE runs, and
  `npm run build:apk:signed` use. Check it with `npm run version:show`
  (`npm run version:check` verifies `version.properties`, `package.json` and `package-lock.json`
  agree) or `cd android && ./gradlew :app:printVersion`.
- CI builds from `master` are **not** Play releases: they are named
  `<committed version>-ci.<run number>` and never upload.

## If something fails

| Symptom | Cause / fix |
|---|---|
| `Could not push the version bump` | Branch protection blocks `GITHUB_TOKEN`; allow Actions to bypass it. |
| `Tag vX.Y.Z already exists` | That release was already started. If its upload failed, re-run the tag workflow; if it succeeded, dispatch a higher bump instead. |
| Play rejects `versionCode ... has already been used` | The same artifact/code was uploaded twice (manual upload or a same-second retry). Build a new patch release; do not re-upload the old AAB. |
| `play-verify: ... is NOT on the track` | Upload was left as a draft, went to a different track, or the service account lacks track access. Check Play Console → Release dashboard. |
| Upload succeeded, later step failed | Play has the build; fix the remaining step and let the next patch release move on. Do not re-upload the same `versionCode`. |

## Local signed build

```bash
npm run build:apk:signed
```

It reads `android/version.properties` for `versionName` and allocates a fresh timestamp
`versionCode`. The output prints both values and verifies the APK is not debug-signed. A local
build is for smoke-testing; the CI release is what goes to Play.
