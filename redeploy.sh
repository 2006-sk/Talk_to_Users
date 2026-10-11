#!/bin/bash
# Shared code changed → Base44 only redeploys a function when its entry file changes, so re-send each entry.ts with a build stamp.
APP=6acac653bce3f69086b7ffca
cd "$(dirname "$0")"
stamp="// build $(date -u +%Y%m%dT%H%M%SZ)"
for f in base44/functions/*/entry.ts; do
  sleep 0.8
  out=$( { grep -v '^// build ' "$f"; echo "$stamp"; } | npx base44 --app-id $APP sandbox write --overwrite "$f" 2>&1)
  echo "$out" | grep -q 'created\|overwritten' && echo "ok  $f" || echo "ERR $f $(echo "$out" | tail -1)"
done
