#!/bin/bash
# Run the seeded demo on the live app from a terminal: create bills, then one runCrew request per bill (staggered).
# Usage: ./demo_remote.sh [key ...]    e.g. ./demo_remote.sh hero_lookalike clean_office
URL=https://logical-smart-bill-guard.base44.app/functions
only=$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1:]))' "$@")
ids=$(curl -s -m 90 -X POST $URL/runDemo -H 'Content-Type: application/json' -d "{\"only\":$only}" | python3 -c 'import json,sys;print(" ".join(b["id"] for b in sorted(json.load(sys.stdin)["bills"],key=lambda b:b["seq"])))')
for id in $ids; do
  ( t=$(date +%s); r=$(curl -s -m 300 -X POST $URL/runCrew -H 'Content-Type: application/json' -d "{\"invoice_id\":\"$id\",\"pace\":true}"); echo "$id $(( $(date +%s)-t ))s $r" ) &
  sleep 3
done
wait
