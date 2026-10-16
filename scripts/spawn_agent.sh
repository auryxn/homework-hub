#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# spawn_agent.sh <assignment_id> <subject> <title>
#
# Launched detached by the Homework Hub server when the user clicks
# "Начать выполнять". Runs a real OpenClaw subject agent that:
#   1. reads + solves the assignment,
#   2. commits the result to sdc-homework-3/<subject-folder>/<slug>/,
#   3. marks the assignment done in Homework Hub (+ repo link),
#   4. notifies the user on Telegram.
#
# Progress is streamed to data/logs/agent-<id>.log (the UI tails it), and the
# job file data/jobs/<id>.json is updated with pid/session/finish info.
# ---------------------------------------------------------------------------
set -u

ID="${1:?usage: spawn_agent.sh <id> <subject> <title>}"
SUBJECT="${2:-unknown}"
DESC="${3:-}"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
LOGS="$ROOT/data/logs"
JOBS="$ROOT/data/jobs"
mkdir -p "$LOGS" "$JOBS"

LOG="$LOGS/agent-${ID}.log"
JOB="$JOBS/${ID}.json"
QUEUE="$ROOT/data/agent-queue.txt"
API="${HOMEWORK_HUB_API:-http://127.0.0.1:8787}"
TS="$(date '+%Y-%m-%dT%H:%M:%S%z')"

log() { printf '[%s] %s\n' "$TS" "$*"; echo; }

log "=== agent start id=${ID} subject=${SUBJECT} ==="
log "title: ${DESC}"

# Subject -> repo folder (keep in sync with server.js SUBJECTS + README).
case "$SUBJECT" in
  "Basics of IP Law")      FOLDER="basics-of-ip-law" ;;
  "OS And Syst Software")  FOLDER="os-and-syst-software" ;;
  "Machine Learning")      FOLDER="machine-learning" ;;
  "Soft Engineering")      FOLDER="soft-engineering" ;;
  "Multithread Java")      FOLDER="multithread-java" ;;
  *)                       FOLDER="$(printf '%s' "$SUBJECT" | tr 'A-Z ' 'a-z-' | tr -cd 'a-z0-9-')" ;;
esac
REPO_PATH="${FOLDER}/${ID}"
REPO_URL="https://github.com/auryxn/sdc-homework-3/tree/main/${REPO_PATH}"
log "repo_path: ${REPO_PATH}"

printf '%s\t%s\t%s\t%s\n' "$TS" "$ID" "$SUBJECT" "$REPO_PATH" >> "$QUEUE"

# --- Real OpenClaw agent invocation ----------------------------------------
SESSION_KEY="agent:main:subject-${FOLDER}"
HERE_ROOT="$(cd "$ROOT/.." && pwd)"

read -r -d '' PROMPT <<PROMPT_EOF
Ты — предметный агент по "${SUBJECT}" в системе Homework Hub. Выполни задание полностью и самостоятельно, от начала до конца.

ЗАДАНИЕ (id=${ID})
${DESC}

СТИЛЬ (ОБЯЗАТЕЛЬНО): прочитай сначала ${HERE_ROOT}/homework-hub/agents-subjects/STYLE.md и строго следуй ему. Кратко: масштаб решения = вес задания. Это студенческая работа, она должна выглядеть так, будто её сделал прилежный студент. НЕ переусложняй.

ТРЕБОВАНИЯ:
1) Изучи задание и подготовь решение, адекватное его объёму. Для простого концептуального задания (5-10 баллов) — ~1 страница текста и максимум 1-2 небольшие диаграммы. Код добавляй ТОЛЬКО если задание прямо требует написать код. Не делай папки diagrams/assets с рендером, mindmap, sequence+deployment+value и т.п. для простых заданий.
2) Соблюдай единый стиль всех решений. Создай папку в репозитории sdc-homework-3 по пути "${REPO_PATH}/" и положи туда README.md (задание + ответ по пунктам). Лишние файлы — только если их требует задание. Решение согласовано с другими заданиями: не дублируй, следи за консистентностью.
3) Закоммить и запушь в репо sdc-homework-3 https://github.com/auryxn/sdc-homework-3.git (gh уже авторизован под auryxn, рабочая папка тебе известна). Целевая папка: ${REPO_PATH}/.
4) Обнови статус задания в Homework Hub. Вызови: bash ${HERE}/mark_done.sh "${ID}" "${REPO_URL}" (или POST ${API}/api/assignments/${ID}/done с {"repo_url":"${REPO_URL}"}). Это переведёт карточку в статус "Выполнено" и привяжет ссылку.
5) Верни короткий итог (5-8 строк) и ссылку на папку задания в репозитории.
PROMPT_EOF

log "launching openclaw agent (session=${SESSION_KEY})"
START_MS=$(date +%s)

# Run the real agent detached-friendly; capture its JSON result in the log.
cd "$HERE_ROOT" && openclaw agent \
  --session-key "$SESSION_KEY" \
  --message "$PROMPT" \
  --channel telegram --deliver --reply-to "${HOMEWORK_HUB_TG_TARGET:-1139547914}" \
  --json > "$LOG.agent.json" 2>&1
RC=$?
END_MS=$(date +%s)
DUR=$((END_MS - START_MS))

# Merge the agent's own JSON result into the log for a readable terminal view.
if [ -f "$LOG.agent.json" ]; then
  log "--- agent result (exit=${RC}, ${DUR}s) ---"
  cat "$LOG.agent.json" >> "$LOG"
  rm -f "$LOG.agent.json"
fi

log "=== agent finished id=${ID} exit=${RC} dur=${DUR}s ==="

# --- Write finish info back into the job file ------------------------------
if [ -f "$JOB" ]; then
  python3 - "$JOB" "$RC" "$DUR" <<'PY' 2>/dev/null || true
import json,sys,datetime
p,rc,dur=sys.argv[1],int(sys.argv[2]),int(sys.argv[3])
try: d=json.load(open(p))
except Exception: d={}
d['status']='finished' if rc==0 else 'failed'
d['exit_code']=rc
d['duration_s']=dur
d['finished_at']=datetime.datetime.now().isoformat()
json.dump(d,open(p,'w'),ensure_ascii=False,indent=2)
PY
fi

# --- Safety net: if agent didn't mark done, still surface the repo link -----
if [ "$RC" -eq 0 ]; then
  STATUS="$(curl -s --max-time 5 "$API/api/assignments/${ID}" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("status",""))' 2>/dev/null || true)"
  if [ "$STATUS" != "done" ]; then
    log "agent did not mark done (status=${STATUS}); marking done with repo link"
    bash "$HERE/mark_done.sh" "$ID" "$REPO_URL" >> "$LOG" 2>&1 || true
  fi
fi

exit 0
