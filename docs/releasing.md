# Releasing Shadowline

Shadowline's first public release is `0.1.0-alpha.0`. Both public packages are
in Changesets prerelease mode and use npm's `alpha` dist-tag. Do not publish an
alpha under npm's `latest` channel.

Shadowline uses Changesets to version and publish its two public packages. They
form a fixed Changesets group and are released at the same version. The core is
published before the adapter because the adapter pins that exact core version.

1. Add and review changesets during development with `npm run changeset`.
2. Run `npm ci`, `just validate`, and
   `npm run release:check-packed-consumers` before merging package changes.
3. Confirm that `.changeset/pre.json` is in prerelease mode with the `alpha`
   tag. If prerelease mode has not been entered yet, run
   `npm run changeset -- pre enter alpha`.
4. Merge the package changes and their changesets to `main`.
5. Let `.github/workflows/release-packages.yml` create or update the Changesets
   version pull request.
6. Review and merge that version pull request. The next workflow run publishes
   the committed versions to npm.

The release workflow uses GitHub Actions OIDC with `id-token: write`; it does
not use an `NPM_TOKEN`. It runs the complete type, test, validation, build,
browser, and packed-consumer checks before `changesets/action`. The action
publishes any prepared, unpublished versions already committed on `main`, so a
failed publish can be retried with `workflow_dispatch` after its cause is fixed.

When the packages are ready for a stable release, exit prerelease mode with
`npm run changeset -- pre exit`, apply and review the resulting versions, and
only then publish to `latest`.

The package-level repository metadata must continue to match this GitHub
repository for OIDC provenance validation. Never store an npm token in this
repository.
