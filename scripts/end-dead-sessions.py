#!/usr/bin/env python3
# Claude 프로세스는 죽었는데 cmux 기록엔 아직 살아 있는 세션을 "끝남"으로 정리한다.
# Claude 가 종료 신호(SessionEnd) 없이 죽으면 cmux 는 그 세션을 계속 들고 있고,
# Deck 의 "세션" 보기에 안 열린 탭이 섞여 나온다. 사이드바에선 프로세스 생사를 볼 수 없어서 여기서 고친다.
#
# 사용: python3 end-dead-sessions.py [--dry-run]
import json
import os
import subprocess
import sys
import time

STORE = os.path.expanduser("~/.cmuxterm/claude-hook-sessions.json")
CMUX = "/Applications/cmux.app/Contents/Resources/bin/cmux"


def etime_seconds(text):
    # ps 의 etime 형식: [[dd-]hh:]mm:ss
    days = 0
    if "-" in text:
        d, text = text.split("-", 1)
        days = int(d)
    parts = [int(x) for x in text.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    h, m, s = parts
    return days * 86400 + h * 3600 + m * 60 + s


def alive(rec):
    pid = rec.get("pid")
    if not pid:
        return False
    out = subprocess.run(["ps", "-o", "etime=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    if not out:
        return False
    # pid 는 재사용된다. 시작 시각이 기록과 다르면 다른 프로세스다
    started = rec.get("pidStartSeconds")
    if started is None:
        return True
    return abs((time.time() - etime_seconds(out)) - started) < 5


# 탭(surface) id → 지금 그 탭이 있는 작업 공간 id.
# 기록 속 작업 공간은 cmux 재시작·탭 이동 뒤 낡아 있을 수 있고, 낡은 곳으로 보내면 종료 신호가 먹지 않는다
def surface_homes():
    out = subprocess.run([CMUX, "rpc", "system.tree", "{}"], capture_output=True, text=True).stdout
    homes = {}

    def walk(o, ws):
        if isinstance(o, dict):
            if o.get("type") == "terminal" and "id" in o:
                homes[o["id"]] = ws
            for v in o.values():
                walk(v, ws)
        elif isinstance(o, list):
            for v in o:
                walk(v, ws)

    try:
        for win in json.loads(out).get("windows", []):
            for w in win.get("workspaces", []):
                walk(w, w["id"])
    except ValueError:
        pass
    return homes


def main():
    dry = "--dry-run" in sys.argv
    with open(STORE) as f:
        sessions = json.load(f).get("sessions", {})
    homes = surface_homes()
    dead = [r for r in sessions.values() if not alive(r)]
    for r in dead:
        print(("[dry] " if dry else "") + "end", r["sessionId"][:8], r.get("cwd", ""))
        if dry:
            continue
        payload = {"session_id": r["sessionId"], "hook_event_name": "SessionEnd", "reason": "other", "cwd": r.get("cwd", "")}
        env = dict(os.environ, CMUX_WORKSPACE_ID=homes.get(r.get("surfaceId")) or r.get("workspaceId", ""), CMUX_SURFACE_ID=r.get("surfaceId", ""))
        # 대기열(enqueue)로 보내면 일부가 무시돼서 바로 처리하는 쪽으로 보낸다
        subprocess.run([CMUX, "hooks", "claude", "session-end"], input=json.dumps(payload), text=True, env=env, capture_output=True)
    print(f"{len(dead)}/{len(sessions)} 정리")


if __name__ == "__main__":
    main()
