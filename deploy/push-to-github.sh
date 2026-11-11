#!/usr/bin/env bash
#
# Push this repository to GitHub using a personal access token.
#
#   GITHUB_TOKEN=ghp_xxxxxxxx bash deploy/push-to-github.sh
#
# Create the token at GitHub -> Settings -> Developer settings ->
# Personal access tokens -> Fine-grained tokens, with "Contents: Read and write"
# on the frins repository. Classic tokens need the "repo" scope.
#
# The token is used in the remote URL for this one push and is not written to
# .git/config, so it does not linger on the machine.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/jagthapsaurabh/frins.git}"
BRANCH="${BRANCH:-main}"

[ -n "${GITHUB_TOKEN:-}" ] || {
  echo "Set GITHUB_TOKEN first:"
  echo "  GITHUB_TOKEN=ghp_xxxxxxxx bash deploy/push-to-github.sh"
  exit 1
}

# Pull the owner/repo out of the https URL
SLUG="${REPO_URL#https://github.com/}"
SLUG="${SLUG%.git}"
AUTH_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${SLUG}.git"

git rev-parse --git-dir > /dev/null 2>&1 || {
  echo "Not a git repository. Run this from the project root."
  exit 1
}

echo "==> Pushing ${BRANCH} to ${SLUG}"
git push "$AUTH_URL" "HEAD:${BRANCH}"

echo "==> Setting origin to the clean URL"
git remote remove origin > /dev/null 2>&1 || true
git remote add origin "$REPO_URL"

echo
echo "Done. https://github.com/${SLUG}"
