#!/usr/bin/env bash
# Syntax-check every frontend ES module. Node only accepts --check on .mjs for
# ESM, so each file is copied to a temp .mjs first.
set -u
tmp="${TMPDIR:-/tmp}/mi-syntax"
rm -rf "$tmp"; mkdir -p "$tmp"
fail=0
while IFS= read -r f; do
  cp "$f" "$tmp/probe.mjs"
  if ! out=$(node --check "$tmp/probe.mjs" 2>&1); then
    echo "FAIL $f"
    echo "$out" | head -6
    fail=1
  fi
done < <(find frontend/js -name '*.js' | sort)
[ "$fail" -eq 0 ] && echo "All frontend modules parse cleanly."
exit $fail
