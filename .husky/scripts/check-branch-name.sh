#!/bin/sh
# Enforce the branch naming convention.
#
# Checked on push rather than on every commit: local scratch branches are
# nobody's business, but anything that reaches the remote is shared history
# and shows up in PR lists, release notes and `git branch -a` forever.

branch="$(git rev-parse --abbrev-ref HEAD)"

# Long-lived branches that are exempt by definition.
case "$branch" in
  main|develop|HEAD) exit 0 ;;
esac

# <type>/<kebab-case-description>, optionally prefixed with an issue number:
#   feat/offline-region-download
#   fix/142-corridor-directional-bias
#   release/1.2.0
pattern='^(feat|fix|chore|docs|refactor|perf|test|ci|build|revert|release|hotfix)/([0-9]+-)?[a-z0-9]+(-[a-z0-9]+)*$'

if ! printf '%s' "$branch" | grep -Eq "$pattern"; then
  cat >&2 <<MSG

  Branch name "$branch" does not match the convention.

    <type>/<short-kebab-description>
    <type>/<issue-number>-<short-kebab-description>

  type: feat fix chore docs refactor perf test ci build revert release hotfix

  Examples:
    feat/saved-terrain-filters
    fix/142-corridor-directional-bias
    release/1.2.0

  Rename with:
    git branch -m <new-name>

MSG
  exit 1
fi
