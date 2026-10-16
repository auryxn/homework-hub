#!/usr/bin/env bash
# mark_done.sh <assignment_id> <repo_url>
# Mark an assignment as done and attach its repo URL in Homework Hub.
set -u
ID="${1:?usage: mark_done.sh <id> <repo_url>}"
REPO_URL="${2:-}"
API="http://127.0.0.1:8787"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DATA="$ROOT/data/assignments.json"

echo "marking $ID done (repo=$REPO_URL)"

if curl -s --max-time 5 "$API/api/health" >/dev/null 2>&1; then
  curl -s --max-time 10 -X POST "$API/api/assignments/$ID/done" \
    -H 'Content-Type: application/json' \
    -d "{\"repo_url\":\"$REPO_URL\"}" && echo
else
  echo "server down; patching data file directly"
  python3 - "$DATA" "$ID" "$REPO_URL" <<'PY'
import json,sys,datetime
p,i,url=sys.argv[1],sys.argv[2],sys.argv[3]
d=json.load(open(p))
for a in d['assignments']:
    if a['id']==i:
        a['status']='done'; a['repo_url']=url; a['updated_at']=datetime.datetime.now().isoformat()
t=p+'.tmp'; json.dump(d,open(t,'w'),ensure_ascii=False,indent=2); import os; os.replace(t,p)
print('patched',i)
PY
fi
