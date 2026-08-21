---
name: prod-update
description: Cut a production release of Token Circles — pre-flight checks (tests, guided-tour walk, migration dress rehearsal), then tag vX.Y.Z and push, then monitor the two prod deploys and verify the result live. Use whenever the user wants to release, ship, tag a version, or push to prod (e.g. "/prod-update", "release 5.9.1", "tag and deploy", "ship it").
---

# /prod-update — tag a release and watch it land

Prod deploys **only** from a `v*` tag. `push main` deploys to dev. Never deploy prod through
`workflow_dispatch`: a non-tag build stamps its version from `git describe --tags`, so it ships
as `5.9.0-3-gabc1234` instead of the release version. `docs/deploy-update-pipeline.md` records a
real incident from exactly that ("label says 5.6.0 but the 5.6.1 fix works").

## 1. Pre-flight

Run these before tagging. Everything here is cheap next to a bad prod deploy.

```sh
git checkout main && git pull --ff-only origin main
git status --porcelain            # must be empty
gh run list --branch main --limit 5   # the head commit must be green
```

- [ ] **Unit + worker tests green in CI** on the exact commit you are about to tag.
- [ ] **Guided tours walk clean.** Run the `tour-check` skill (`pnpm run test:tours`, and
      `MOBILE=1` too). Tours break silently when page layout changes, and nothing in CI
      catches it — this is the one manual gate that has to happen before a tag.
- [ ] **Changelogs updated.** `CHANGELOG.md` gets the user-facing entry under the new version
      heading with today's date; `dev-changelog.md` carries the detail. Written for a user, not
      a commit log.
- [ ] **Version bumped** if the repo tracks it in `package.json` (the built app takes its
      version from the tag, so this is for tidiness, not correctness).
- [ ] **Migrations rehearsed**, if `worker/migrations/` gained files since the last release:

      ```sh
      git diff --name-only $(git describe --tags --abbrev=0)..HEAD -- worker/migrations/
      ```

      For anything non-trivial, build a local D1 at prod's current state, apply the new
      migrations, and diff `sqlite_master` against a fresh full build — they must match. The
      deploy takes a `d1 export` backup before migrating, but a rehearsal is what stops you
      needing it.

## 2. Tag and push

```sh
git tag -a v5.9.1 -m "v5.9.1

<short summary of what is in it>"
git push origin refs/tags/v5.9.1
```

Annotated (`-a`), never lightweight. The tag push is what triggers prod.

## 3. Monitor

```sh
gh run list --limit 6            # two runs appear on headBranch v5.9.1
gh run watch <worker-run-id> --exit-status
gh run watch <frontend-run-id> --exit-status
```

**Deploy API Worker** must show these steps in this order:

1. `Typecheck`
2. `Back up remote D1 before migrations (prod)` — a full `d1 export`
3. `Upload D1 backup artifact` — artifact `d1-backup-prod-<sha>`, 30-day retention
4. `Apply D1 migrations (prod)` — every migration must report ✅
5. `Deploy worker (prod)`

If the backup step did not run before the migration step, stop and investigate before doing
anything else.

## 4. Verify live

```sh
curl -s https://tokencircles.com/version.json          # {"version":"5.9.1","gitSha":"<sha>"}
curl -s https://api.tokencircles.com/api/health        # {"ok":true,"env":"production"}
```

The `version` must equal the tag without its `v`, and `gitSha` must be the commit you tagged.
Anything of the shape `5.9.0-3-g…` means a non-tag build reached prod — see the warning at the
top.

## Rollback

The worker and the frontend deploy independently, so roll back whichever broke:

- **Data**: download the `d1-backup-prod-<sha>` artifact from the deploy run. It is the full
  pre-migration SQL dump.
- **Code**: tag the previous good commit as a new patch version and let the pipeline run
  forward. Re-pointing an existing tag is worse — it makes the version stamp lie about which
  code is live.

## Notes

- Tag pushes are not test-gated in `ci.yml` (no `tags: ['v*']` trigger). The pre-flight list
  above is the gate; do not skip it on the assumption CI will catch something.
- Force-pushing an existing tag does **not** reliably re-trigger the deploy workflows. If a tag
  has to move, expect to trigger the deploy another way, and re-check `version.json`.
- A GitHub Release is optional and separate from the tag. The tag alone deploys.
