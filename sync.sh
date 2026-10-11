#!/bin/bash
# Sync local source into the Base44 sandbox (base44/* → base44/*, app/* → app root). Usage: ./sync.sh [files...]
APP=6acac653bce3f69086b7ffca
cd "$(dirname "$0")"
files=("$@")
if [ ${#files[@]} -eq 0 ]; then
  files=($(find base44/entities base44/functions base44/shared base44/agents -type f \( -name '*.ts' -o -name '*.json' -o -name '*.jsonc' \)) $(find app -type f \( -name '*.jsx' -o -name '*.js' -o -name '*.css' -o -name '*.html' \)))
fi
fail=0
for f in "${files[@]}"; do sleep 0.7
  dest="$f"; [[ "$f" == app/* ]] && dest="${f#app/}"
  out=$(npx base44 --app-id $APP sandbox write --overwrite "$dest" < "$f" 2>&1)
  if echo "$out" | grep -q '"path"\|created\|overwritten'; then echo "ok  $dest"; else echo "ERR $dest: $(echo "$out" | tail -2)"; fail=1; fi
done
exit $fail
