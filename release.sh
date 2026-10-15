#!/usr/bin/env bash
# Publish a release: tag the current commit and push it; CI builds and tests
# every platform and attaches the packages to the GitHub release.
#   ./release.sh v0.1.0
. "$(dirname "$0")/scripts/lib.sh"
tag="${1:-}"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: ./release.sh v<major>.<minor>.<patch> (e.g. v0.1.0)" >&2; exit 2; }
cd "$ROOT"
[ -z "$(git status --porcelain)" ] || { echo "commit your changes first (git status shows uncommitted work)" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && { echo "$tag already exists" >&2; exit 1; }
git tag "$tag"
git push origin HEAD "$tag"
echo "pushed $tag: the release appears on GitHub when CI finishes (the repository's Actions tab)"
