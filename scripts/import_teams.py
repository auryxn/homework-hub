#!/usr/bin/env python3
"""Import Teams scraped assignments into Homework Hub data store.

Reads: ~/.openclaw/workspace/teams-assignments/data/det_upcoming_final.json
       ~/.openclaw/workspace/teams-assignments/data/det_completed_final.json
Writes/merges: ~/.openclaw/workspace/homework-hub/data/assignments.json
Idempotent: matched by id (Teams GUID kept alongside slug id).
"""
import json, re, os, datetime, unicodedata

HOME = os.path.expanduser("~")
SRC = os.path.join(HOME, ".openclaw/workspace/teams-assignments/data")
DST = os.path.join(HOME, ".openclaw/workspace/homework-hub/data/assignments.json")

SUBJECT_BY_COURSE_KEY = {
    # map by distinctive substrings (lowercased)
    "soft engineering": "Soft Engineering",
    "basics of ip law": "Basics of IP Law",
    "os and syst software": "OS And Syst Software",
    "machine learning": "Machine Learning",
    "multithread java": "Multithread Java",
}
DEFAULT_SUBJECT = "Soft Engineering"  # was previously unclassified

def norm(s):
    return (s or "").strip()

def slugify(s, fallback="task"):
    s = norm(s).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:60] or fallback

def guess_subject(course, title):
    low = (course or "").lower()
    for k, v in SUBJECT_BY_COURSE_KEY.items():
        if k in low:
            return v
    lt = (title or "").lower()
    if "sse" in lt:
        return "Soft Engineering"
    return None  # unresolved -> park under course name later

def extract_detail_text(detail):
    """detail is {'card':..., 'detail': {...}}; return (instructions, fulltext)."""
    if detail is None:
        return "", ""
    d = detail.get("detail") if isinstance(detail, dict) and "detail" in detail else detail
    if isinstance(d, str):
        txt = d
    elif isinstance(d, dict):
        txt = d.get("fullText") or d.get("text") or ""
    else:
        txt = str(d)
    instr = ""
    m = re.search(r"Инструкции\s*\n(.*?)(?:\nМоя работа|\nБаллы|$)", txt, re.S)
    if m:
        instr = m.group(1).strip()
    if not instr:
        # fallback: strip chrome lines, take middle chunk
        instr = txt.strip()
    return instr, txt.strip()

def load_cards(path):
    if not os.path.exists(path):
        return {"cards": [], "details": []}
    with open(path) as f:
        return json.load(f)

def build(cards, details, completed_default):
    out = []
    details = details or []
    for i, c in enumerate(cards):
        det = details[i] if i < len(details) else None
        instr, fulltext = extract_detail_text(det)
        title = c.get("displayName") or c.get("cardText") or "Task"
        course = ""
        m = re.search(r"(2026 HR S\d [^0-9].*?)(?:\s*Количество баллов|\s*Срок|$)", c.get("cardText",""))
        if m: course = m.group(1).strip()
        elif c.get("course"): course = c["course"]
        subj = guess_subject(course, title)
        due = c.get("dueRaw")
        try:
            due_iso = datetime.datetime.fromisoformat(due.replace("Z","+00:00")).isoformat() if due else None
        except Exception:
            due_iso = None
        out.append({
            "id": slugify(title, fallback="task-%d" % i),
            "teams_id": c.get("id"),
            "class_id": c.get("classId"),
            "title": title,
            "subject": subj,
            "course": course or None,
            "due": due_iso,
            "points": c.get("maxPoints"),
            "status": "done" if (c.get("isCompleted") or completed_default) else "not_started",
            "description": instr or (fulltext[:1500] if fulltext else ""),
            "files": [],
            "repo_path": None,
            "repo_url": None,
            "teams_url": None,
            "created_at": None,
            "updated_at": None,
        })
    return out

def dedupe(items):
    seen = {}
    for it in items:
        key = (it.get("title","").strip().lower(), it.get("course") or "")
        if key in seen:
            # prefer richer description / keep done
            if len(it.get("description") or "") > len(seen[key].get("description") or ""):
                seen[key] = it
        else:
            seen[key] = it
    return list(seen.values())

def main():
    up = load_cards(os.path.join(SRC, "det_upcoming_final.json"))
    co = load_cards(os.path.join(SRC, "det_completed_final.json"))
    items = build(up.get("cards",[]), up.get("details",[]), False) \
          + build(co.get("cards",[]), co.get("details",[]), True)
    items = dedupe(items)

    # keep only our 5 subjects; others go to "Other" bucket but keep them
    for it in items:
        if not it["subject"]:
            it["subject"] = "Other"
        if not it["course"]:
            it["course"] = "Other"
        it["updated_at"] = datetime.datetime.now().isoformat()

    now = datetime.datetime.now().isoformat()
    data = {
        "assignments": items,
        "meta": {
            "imported_at": now,
            "source": "teams-scrape det_upcoming_final.json + det_completed_final.json",
            "count": len(items),
        },
    }
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    tmp = DST + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DST)
    print("wrote", DST, "items:", len(items))
    from collections import Counter
    print("by subject:", Counter(i["subject"] for i in items))
    print("by status:", Counter(i["status"] for i in items))

if __name__ == "__main__":
    main()
