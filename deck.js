// SPDX-License-Identifier: GPL-3.0-or-later
//
// Deck — cmux 커스텀 사이드바. 프로젝트별 AI 코딩 세션 상황판.
//
//   세션 칸   : 확인이 필요한 세션과 돌아가는 세션을 급한 순서로 (칸 높이 고정)
//               입력 대기(주황) → 완료(초록) → 작업 중(파랑) → 확인함(회색)
//   나중에 확인      : 확인하고 미뤄둔 세션. 그 세션이 다시 작업을 시작하면 빠진다
//   프로젝트  : 기본 사이드바와 같은 그룹 목록 + 이름 검색 + 상태 아이콘
//               그룹 보기에서는 끌어서 그룹 사이로 옮기고, 우클릭으로 색상·그룹을 바꾼다
// 줄을 누르면 그 프로젝트의 그 탭으로 바로 이동한다.
//
// 설치: ./install.sh  (또는 이 파일을 ~/.config/cmux/sidebars/deck.js 로 복사)
// 열기: 사이드바 버튼 우클릭 → deck
//
// 나중에 확인 목록과 본 세션 표시는 프로젝트 설명 칸에 적어둬서 cmux를 재시작해도 유지된다.
//
// 그룹 목록·접기 로직은 cmux 공식 예제(Examples/CustomSidebars/workspaces.js,
// GPL-3.0-or-later, Copyright (c) Manaflow, Inc.)를 바탕으로 했다.

// 버전. 기능이 바뀌면 CHANGELOG.md 와 함께 올린다 (맨 위 "Deck" 옆에 작게 보인다)
const VERSION = "0.2.0";

const TONE = {
  waiting: "#FF8A5B",
  done: "#5AD1A0",
  work: "#5AA8FF",
  later: "#8B94A3",
};
// 끝난 세션을 "완료"로 보여주는 시간 (초). cmux 재시작 때 활동 시각이 한꺼번에 찍혀서 길게 잡으면 전부 올라온다
const FRESH = 3 * 60;
// 세션 칸 줄 수. 세션이 적어도 이만큼 자리를 잡아서 아래 프로젝트 목록이 위아래로 흔들리지 않게 한다
const SLOTS = 8;

const now = () => data.clock()?.epoch ?? 0;

// ── 나중에 확인 / 본 것 ──
// 사이드바에는 저장 공간이 없어서, 세션 표시를 프로젝트 "설명" 칸 끝에 적어둔다.
// 설명 칸은 cmux가 재시작해도 기억하므로 목록이 유지된다.
//   예) "내가 쓴 설명\n⟦deck later=claude-abc seen=claude-def⟧"
// 사용자가 직접 쓴 설명은 건드리지 않고 표시 부분만 붙였다 뗀다. 표시할 게 없으면 표시도 지운다.
//
//   later : 다시 보겠다고 나중에 확인으로 보낸 세션. 열어봐도 그대로 나중에 확인 칸에 남는다
//   seen  : 확인 필요였는데 한 번 열어봤다가 떠난 세션. 없애지 않고 "확인함"으로 목록 맨 아래에 둔다
// 둘 다 그 세션이 다시 작업을 시작하거나 끝나면 풀린다. 다음에 멈추면 다시 확인 필요로 올라온다.
const MARK_RE = /\n?⟦deck(?::later ([^⟧]*)| ([^⟧]*))⟧\s*$/;
const LOADED_AT = Math.floor(Date.now() / 1000);

function parseDesc(desc) {
  const text = desc || "";
  const m = text.match(MARK_RE);
  const marks = { user: text.replace(MARK_RE, ""), later: [], seen: [] };
  if (!m) return marks;
  if (m[1] !== undefined) {
    marks.later = m[1].split(",").filter(Boolean); // 예전 형식 호환
    return marks;
  }
  for (const part of m[2].split(" ")) {
    const [k, v] = part.split("=");
    if ((k === "later" || k === "seen") && v) marks[k] = v.split(",").filter(Boolean);
  }
  return marks;
}

// 설명 칸 변경은 1초쯤 뒤에 데이터로 돌아온다. 그 사이엔 방금 쓴 값을 기준으로 보여준다
const pendingMarks = new Map(); // workspaceId -> { later, seen }
const [markTick, setMarkTick] = signal(0);
const [laterOpen, setLaterOpen] = signal(false);

function sameIds(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}
function sameMarks(a, b) {
  return sameIds(a.later, b.later) && sameIds(a.seen, b.seen);
}

function marksOf(w) {
  markTick();
  const saved = parseDesc(w.description);
  if (pendingMarks.has(w.id)) {
    const want = pendingMarks.get(w.id);
    if (sameMarks(want, saved)) pendingMarks.delete(w.id); // cmux가 따라왔으면 해제
    else return { user: saved.user, later: want.later, seen: want.seen };
  }
  return saved;
}

function writeMarks(w, later, seen) {
  const cur = marksOf(w);
  if (sameMarks({ later, seen }, cur)) return;
  pendingMarks.set(w.id, { later, seen });
  setMarkTick(markTick() + 1);
  const parts = [];
  if (later.length) parts.push("later=" + later.join(","));
  if (seen.length) parts.push("seen=" + seen.join(","));
  const mark = parts.length ? "⟦deck " + parts.join(" ") + "⟧" : "";
  const text = mark ? (cur.user ? cur.user + "\n" : "") + mark : cur.user;
  if (text) cmux("workspace.action", { workspace_id: w.id, action: "set_description", description: text });
  else cmux("workspace.action", { workspace_id: w.id, action: "clear_description" });
}

// 나중에 확인: 다시 보겠다는 뜻이므로 본 것 표시는 지운다
function defer(r) {
  const w = wsById(r.workspaceId);
  if (!w) return;
  const m = marksOf(w);
  writeMarks(w, m.later.includes(r.agentId) ? m.later : m.later.concat([r.agentId]), m.seen.filter((id) => id !== r.agentId));
}
// 다시: 확인 필요로 되돌린다
function undefer(r) {
  const w = wsById(r.workspaceId);
  if (!w) return;
  const m = marksOf(w);
  writeMarks(w, m.later.filter((id) => id !== r.agentId), m.seen.filter((id) => id !== r.agentId));
}

// 지금 보고 있는 확인 필요 세션. 여기서 다른 데로 넘어가는 순간 "본 것"으로 표시한다
// (여는 순간 내리면 보고 있는 줄이 눈앞에서 사라져서, 떠날 때 내린다)
let lastFocus = null; // { workspaceId, agentId }

// ── 프로젝트 검색 / 정렬 ──
const [query, setQuery] = signal("");
// "recent": 그룹 무시하고 최근 작업 순, "group": 기본 사이드바와 같은 그룹 목록
const [sortMode, setSortMode] = signal("recent");

// 세션 상태 → 섹션
// unread 는 프로젝트 단위 숫자라서, 그 프로젝트에서 가장 최근에 끝난 세션 하나에만 붙인다
function bucket(w, a, t, latestIdleId) {
  if (a.status === "needs_input") return "check";
  if (a.status === "working") return "work";
  if (a.status === "idle") {
    const age = t - (a.lastActivityAt ?? 0);
    if (age < FRESH) return "check";
    if ((w.unread ?? 0) > 0 && a.id === latestIdleId) return "check";
  }
  return null;
}

function latestIdle(w) {
  let best = null;
  for (const a of w.agents ?? []) {
    if (a.status !== "idle") continue;
    if (!best || (a.lastActivityAt ?? 0) > (best.lastActivityAt ?? 0)) best = a;
  }
  return best ? best.id : null;
}

// 탭 제목이 이름뿐인 경우(프로젝트명, "Claude Code", 경로 등)는 제목으로 안 쓴다
function meaningful(title, w) {
  const t = cleanTitle(title);
  if (!t) return null;
  if (t === w.title || t === "Claude Code" || t === "Claude" || t === "md") return null;
  if (t.startsWith("~/") || t.startsWith("/") || t.includes("@")) return null;
  return t;
}

function isFocusedSession(w, a) {
  if (!w.selected) return false;
  const tab = (w.tabs ?? []).find((x) => x.id === a.panelId || x.surfaceId === a.surfaceId);
  return Boolean(tab?.focused);
}

// 세션이 하는 일: 탭 제목 → 세션 제목 → (세션이 하나뿐이면) 마지막 프롬프트 → 이름
function sessionLabel(w, a) {
  const tab = (w.tabs ?? []).find((x) => x.id === a.panelId || x.surfaceId === a.surfaceId);
  return (
    meaningful(tab?.title, w) ||
    meaningful(a.title, w) ||
    ((w.agents ?? []).length === 1 ? meaningful(w.latestPrompt, w) : null) ||
    (tab ? cleanTitle(tab.title) : null) ||
    a.name ||
    "세션"
  );
}

// 워크스페이스 → 세션 칸 + 나중에 확인 + 프로젝트 머리글을 한 줄로 펼친 평면 배열
// (프로젝트 줄은 끌어 옮길 수 있어야 해서 projectList 로 따로 뺀다)
function topEntries() {
  const t = now();
  const groups = { check: [], work: [], seen: [], later: [] };
  let focus = null;

  for (const w of data.workspaces() ?? []) {
    const li = latestIdle(w);
    const marks = marksOf(w);
    const keepLater = [];
    const keepSeen = [];
    for (const a of w.agents ?? []) {
      // /clear 직후처럼 아직 아무것도 묻지 않은 빈 세션은 확인할 게 없어서 목록에 올리지 않는다
      // (/clear 하면 세션 id가 새로 바뀌고, 첫 프롬프트가 없으니 title 이 비어 있다)
      if (a.status === "idle" && !a.title) continue;
      let b = bucket(w, a, t, li);
      // 다시 작업을 시작했거나 끝난 세션은 표시를 푼다
      // (활동 시각은 cmux 재시작 때 한꺼번에 새로 찍혀서 기준으로 쓰지 않는다)
      const restarted = a.status === "working" || a.status === "ended";
      if (marks.later.includes(a.id) && !restarted) {
        keepLater.push(a.id);
        b = "later";
      } else if (marks.seen.includes(a.id) && !restarted) {
        keepSeen.push(a.id);
        b = "seen"; // 이미 본 세션은 "확인함"으로 맨 아래에 남긴다 (다시 일을 시작할 때까지)
      }
      if (b === "check" && isFocusedSession(w, a)) focus = { workspaceId: w.id, agentId: a.id };
      if (!b) continue;
      groups[b].push({
        id: (b === "later" ? "l:" : "s:") + a.id,
        kind: b === "later" ? "later" : "row",
        agentId: a.id,
        bucket: b,
        waiting: a.status === "needs_input",
        label: sessionLabel(w, a),
        project: w.title,
        color: colorOf(w),
        surfaceId: a.surfaceId,
        panelId: a.panelId,
        // 지금 보고 있는 탭인지: 선택된 프로젝트 + 그 프로젝트에서 포커스된 탭
        focused: isFocusedSession(w, a),
        workspaceId: w.id,
        since: a.sinceEpoch ?? a.lastActivityAt ?? t,
        at: a.lastActivityAt ?? 0,
      });
    }
    // 닫힌 탭의 세션 id는 정리한다. 단 cmux가 막 켜졌을 땐 세션 목록이 늦게 채워지므로 2분 기다린다
    const agentIds = (w.agents ?? []).map((a) => a.id);
    const settled = t - LOADED_AT > 120 && agentIds.length > 0;
    for (const id of marks.later) if (!agentIds.includes(id) && !settled) keepLater.push(id);
    for (const id of marks.seen) if (!agentIds.includes(id) && !settled) keepSeen.push(id);
    writeMarks(w, keepLater, keepSeen);
  }

  // 확인 필요 세션을 보다가 다른 데로 넘어갔으면 그 세션을 "본 것"으로
  if (lastFocus && (!focus || focus.agentId !== lastFocus.agentId)) {
    const w = wsById(lastFocus.workspaceId);
    if (w) {
      const m = marksOf(w);
      if (!m.later.includes(lastFocus.agentId) && !m.seen.includes(lastFocus.agentId)) {
        writeMarks(w, m.later, m.seen.concat([lastFocus.agentId]));
      }
    }
  }
  lastFocus = focus;

  const out = [];
  // 섹션 제목 없이 한 목록에 급한 순서로: 멈춰 기다림 → 끝남 → 작업 중 → 확인함
  const order = (r) => (r.bucket === "check" ? (r.waiting ? 0 : 1) : r.bucket === "work" ? 2 : 3);
  const list = groups.check.concat(groups.work, groups.seen).sort((x, y) => order(x) - order(y) || y.at - x.at);
  const overflow = list.length > SLOTS;
  // 넘치면 마지막 칸을 "+N개 더" 줄이 쓰지 않도록, 더보기 줄은 칸 밖에 항상 따로 둔다
  for (let i = 0; i < SLOTS; i++) {
    if (i < list.length) out.push(list[i]);
    else out.push({ id: "p:" + i, kind: "slot" });
  }
  out.push({
    id: "m:sessions",
    kind: "more",
    text: list.length === 0 ? "모두 조용해요" : overflow ? "+" + (list.length - SLOTS) + "개 더" : "",
  });
  // 나중에 확인: 접어두는 게 기본. 머리글만 보이고 누르면 펼친다
  const later = groups.later.sort((x, y) => y.at - x.at);
  // 0개여도 머리글은 남겨서 높이가 안 바뀌게 한다 (펼치기는 내가 누를 때만 높이가 바뀐다)
  out.push({ id: "h:later", kind: "laterHeader", bucket: "later", count: later.length });
  if (laterOpen()) for (const r of later) out.push(r);

  out.push({ id: "h:projects", kind: "projects" });
  return out;
}

// 왼쪽 사이드바를 대체하므로 프로젝트 목록도 여기서 보여준다.
// 기본 사이드바와 같은 규칙: 그룹은 대표 프로젝트 자리에 머리글로, 접힌 그룹은 머리글만, 고정한 건 맨 위
// 끌어 옮기기는 그룹 보기에서만 된다. 검색·최근순 줄은 키를 달리해서("r:") 못 잡는 줄로 만든다
function projectList() {
  const all = data.workspaces() ?? [];
  // 그룹의 대표 프로젝트(그룹 터미널)는 검색·최근순 목록에도 안 내놓는다. 닫으면 그룹이 사라져서 고를 일이 없게 한다
  const anchors = new Set((data.groups() ?? []).map((g) => g.anchorId));
  const pickable = all.filter((w) => !anchors.has(w.id));
  const still = (w) => ({ id: "r:" + w.id, kind: "ws", wsId: w.id, inGroup: false, groupId: null, drag: false });
  const q = query().trim().toLowerCase();
  if (q) {
    const hits = pickable.filter((w) => (w.title || "").toLowerCase().includes(q));
    return hits.length ? hits.map(still) : [{ id: "f:nohit", kind: "nohit" }];
  }
  return sortMode() === "recent" ? recentEntries(pickable).map(still) : projectEntries(orderedWs(all));
}

// 첫 프롬프트가 제목일 때가 많아서 한 줄로 정리한다
function cleanTitle(s) {
  // 작업 중일 때 제목 앞에 붙는 회전 표시(✳ ◐ ◓ 점자 스피너 등)를 떼어낸다
  return String(s || "")
    .replace(/^[\u2731-\u273F\u25CB-\u25D3\u2802-\u28FF\u00B7*\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ago(sec) {
  if (sec < 60) return "방금";
  if (sec < 3600) return Math.floor(sec / 60) + "분";
  if (sec < 86400) return Math.floor(sec / 3600) + "시간";
  return Math.floor(sec / 86400) + "일";
}

function counts() {
  const c = { check: 0, work: 0, seen: 0, later: 0 };
  for (const e of topEntries()) {
    if (e.kind === "row") c[e.bucket] += 1;
    if (e.kind === "laterHeader") c.later = e.count;
  }
  return c;
}

// ── 뷰 조각 ────────────────────────────────────────────────────────────

// 맨 위 요약: "내 차례 2 · 작업 중 3"
function summary() {
  return HStack({ spacing: 6 }, [
    Text("Deck").font(15).weight("semibold"),
    Text("v" + VERSION).font(10).color("tertiary"),
    Spacer({ minLength: 0 }),
    Text(() => {
      const n = counts().check;
      return n > 0 ? "확인 " + n : "";
    })
      .font(11)
      .color(TONE.waiting),
    Text(() => {
      const n = counts().work;
      return n > 0 ? "작업 " + n : "";
    })
      .font(11)
      .color(TONE.work),
  ])
    .paddingHorizontal(12)
    .paddingVertical(8)
    .frame({ maxWidth: "infinity" });
}

function stateLabel(r) {
  if (r.bucket === "later") return "나중에 확인";
  if (r.bucket === "seen") return "확인함";
  if (r.bucket === "work") return "작업 중";
  return r.waiting ? "입력 대기" : "완료";
}

function rowTone(r) {
  if (r.bucket === "later" || r.bucket === "seen") return TONE.later;
  if (r.bucket === "work") return TONE.work;
  return r.waiting ? TONE.waiting : TONE.done;
}

// 탭 이동. surface.focus 가 실제로 알아듣는 건 탭의 패널 id(agents[j].panelId = tabs[k].id)다.
// agents[j].surfaceId 로 보내면 "탭을 못 찾음"으로 조용히 실패해서 프로젝트만 바뀌거나 아무 반응이 없다.
// 프로젝트 id도 같이 넘겨서 지금 보고 있는 프로젝트가 아닌 곳의 탭도 찾게 한다.
function jump(r) {
  const tabId = r.panelId || r.surfaceId;
  cmux("workspace.select", { workspace_id: r.workspaceId });
  if (tabId) cmux("surface.focus", { workspace_id: r.workspaceId, surface_id: tabId });
}

// 호버하면 오른쪽 위에 뜨는 작은 버튼
function hoverButton(label, onTap) {
  return Text(label)
    .font(10)
    .weight("semibold")
    .color("secondary")
    .paddingHorizontal(6)
    .paddingVertical(2)
    .background("#7f7f7f33")
    .cornerRadius(6)
    .hoverBackground("#7f7f7f55")
    .showOnHover()
    .onTap(onTap);
}

function rowBody(e) {
  // 왼쪽: 제목 / 프로젝트 / 미리보기, 오른쪽: 경과 시간 (카드 전체 기준 세로 가운데)
  return HStack({ spacing: 8 }, [
    VStack({ spacing: 0 }, [
      HStack({ spacing: 0 }, [
        Text(() => e().label)
          .font(13)
          .lineLimit(1)
          .truncation("tail")
          .marquee()
          .color(() => (e().kind === "later" || e().bucket === "seen" ? "secondary" : "primary")),
        Spacer({ minLength: 0 }),
      ]).frame({ maxWidth: "infinity" }),
      HStack({ spacing: 5 }, [
        Circle({ size: 6 }).fill(() => e().color),
        Text(() => e().project).font(11).lineLimit(1).truncation("tail").color("secondary"),
        Spacer({ minLength: 0 }),
      ])
        .paddingTop(3)
        .frame({ maxWidth: "infinity" }),
    ]).frame({ maxWidth: "infinity" }),
    // 오른쪽: 상태 / 경과 시간
    VStack({ spacing: 1, alignment: "trailing" }, [
      Text(() => stateLabel(e())).font(10).weight("semibold").color(() => rowTone(e())),
      Text(() => ago(now() - e().since)).font(11).color(() => rowTone(e())).opacity(0.85),
    ])
      // 호버하면 같은 자리에 버튼이 뜨므로 잠깐 숨긴다
      .hideOnHover(),
  ]).frame({ maxWidth: "infinity" });
}

// 빈 칸. 세션 줄과 같은 글자 크기·여백으로 만들어 높이를 정확히 맞춘다
function slot() {
  return VStack({ spacing: 0 }, [
    Text(" ").font(13),
    HStack({ spacing: 5 }, [Circle({ size: 6 }).fill("#00000000"), Text(" ").font(11)]).paddingTop(3),
  ])
    .paddingHorizontal(10)
    .paddingVertical(6)
    .frame({ maxWidth: "infinity" })
    .opacity(0);
}

function row(e) {
  return ZStack({ alignment: "trailing" }, [
    rowBody(e),
    // 작업 중인 세션은 미룰 이유가 없어서 확인 필요·확인함에만 버튼을 단다
    hoverButton("나중에", () => defer(e())).opacity(() => (e().bucket === "work" ? 0 : 1)),
  ])
    .paddingHorizontal(10)
    .paddingVertical(6)
    .cornerRadius(8)
    // 지금 보고 있는 세션은 프로젝트 목록의 선택 표시와 같은 배경
    .background(() => (e().focused ? "#7f7f7f3d" : null))
    .hoverBackground(() => (e().focused ? "#7f7f7f3d" : "#7f7f7f24"))
    .frame({ maxWidth: "infinity" })
    .onTap(() => jump(e()))
    .contextMenu([
      Button("나중에 확인으로 보내기", () => defer(e())),
    ]);
}

// 미룬 세션 줄: 흐리게. 호버하면 "다시" 버튼으로 확인 필요에 되돌린다
function laterRow(e) {
  return ZStack({ alignment: "trailing" }, [
    rowBody(e),
    hoverButton("다시", () => undefer(e())),
  ])
    .paddingHorizontal(10)
    .paddingVertical(6)
    .opacity(0.8)
    .cornerRadius(8)
    .hoverBackground("#7f7f7f24")
    .frame({ maxWidth: "infinity" })
    .onTap(() => jump(e()))
    .contextMenu([
      Button("확인 필요로 되돌리기", () => undefer(e())),
    ]);
}

function laterHeader(e) {
  return VStack({ spacing: 0 }, [
    Rectangle().fill("#00000000").frame({ height: 14 }),
    HStack({ spacing: 6 }, [
      Image("chevron.right")
        .font(9)
        .weight("semibold")
        .color("tertiary")
        .rotation(() => (laterOpen() ? 90 : 0))
        .frame({ width: 10, height: 14 }),
      Text("나중에 확인").font(11).weight("semibold").color(TONE.later),
      Text(() => String(e().count)).font(11).color("tertiary"),
      Spacer({ minLength: 0 }),
    ])
      .paddingHorizontal(12)
      .paddingVertical(4)
      .cornerRadius(6)
      .hoverBackground("#7f7f7f1c")
      .frame({ maxWidth: "infinity" })
      .opacity(() => (e().count > 0 ? 1 : 0.45))
      .onTap(() => {
        if (e().count > 0) setLaterOpen(!laterOpen());
      }),
  ]);
}

function more(e) {
  return Text(() => e().text || " ")
    .font(11)
    .color("tertiary")
    .paddingHorizontal(12)
    .paddingVertical(2);
}

function projectsHeader(e) {
  return VStack({ spacing: 0 }, [
    Rectangle().fill("#00000000").frame({ height: 14 }),
    // 검색 박스
    HStack({ spacing: 6, alignment: "center" }, [
      Image("magnifyingglass").font(11).color("tertiary"),
      TextField("", {
        placeholder: "프로젝트 검색",
        autofocus: false,
        onEdit: (t) => setQuery(t ?? ""),
        // Enter 누르면 첫 번째 결과로 이동
        onSubmit: (t) => {
          const q = (t ?? "").trim().toLowerCase();
          if (!q) return;
          const anchors = new Set((data.groups() ?? []).map((g) => g.anchorId));
          const hit = (data.workspaces() ?? []).find((w) => !anchors.has(w.id) && (w.title || "").toLowerCase().includes(q));
          if (hit) cmux("workspace.select", { workspace_id: hit.id });
        },
      }).font(12),
    ])
      .paddingHorizontal(10)
      // 고정 높이는 적용이 안 돼서 위아래 패딩으로 박스를 키운다
      .paddingVertical(7)
      .frame({ maxWidth: "infinity", alignment: "leading" })
      .background("#7f7f7f1f")
      .cornerRadius(7)
      .paddingHorizontal(8),
    // 정렬 전환: 최근순 / 그룹
    HStack({ spacing: 10 }, [
      sortTab("최근순", "recent"),
      sortTab("그룹", "group"),
      Spacer({ minLength: 0 }),
    ])
      .paddingHorizontal(14)
      .paddingTop(8)
      .paddingBottom(2)
      .frame({ maxWidth: "infinity" }),
  ]);
}

function sortTab(label, mode) {
  return Text(label)
    .font(11)
    .weight(() => (sortMode() === mode ? "semibold" : "regular"))
    .color(() => (sortMode() === mode ? "primary" : "tertiary"))
    .onTap(() => setSortMode(mode));
}

function noHit() {
  return Text("맞는 프로젝트가 없어요").font(12).color("tertiary").paddingHorizontal(14).paddingVertical(6).fixed();
}

// ── 그룹 접기 (누르는 즉시 반영하고 cmux 쪽은 뒤따라 맞춘다) ──
const collapseOverride = new Map();
const [collapseTick, setCollapseTick] = signal(0);

function isCollapsed(g) {
  collapseTick();
  if (!g) return false;
  if (collapseOverride.has(g.id)) {
    const v = collapseOverride.get(g.id);
    if (v === g.collapsed) collapseOverride.delete(g.id); // cmux가 따라왔으면 해제
    else return v;
  }
  return !!g.collapsed;
}

function toggleCollapse(g) {
  const next = !isCollapsed(g);
  collapseOverride.set(g.id, next);
  setCollapseTick(collapseTick() + 1);
  cmux(next ? "workspace.group.collapse" : "workspace.group.expand", { group_id: g.id });
}

const groupById = (id) => (data.groups() ?? []).find((g) => g.id === id);
const wsById = (id) => (data.workspaces() ?? []).find((w) => w.id === id);

// 프로젝트의 마지막 작업 시각: 세션 활동과 마지막 메시지 중 가장 최근
function activityAt(w) {
  let at = w.latestAt ?? 0;
  for (const a of w.agents ?? []) at = Math.max(at, a.lastActivityAt ?? 0);
  return at;
}

// 그룹 무시하고 최근 작업 순. 고정한 프로젝트는 맨 위, 시각이 같으면 cmux 순서
function recentEntries(ws) {
  return ws
    .slice()
    .sort((x, y) => (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0) || activityAt(y) - activityAt(x) || x.index - y.index);
}

// 워크스페이스 배열 → 그룹 머리글 + 멤버 줄
function projectEntries(ws) {
  collapseTick();
  const groups = new Map((data.groups() ?? []).map((g) => [g.id, g]));
  const section = (g) => {
    const rows = [{ id: "g:" + g.id, kind: "group", groupId: g.id }];
    if (!isCollapsed(g)) {
      for (const m of ws) {
        // 대표 프로젝트는 머리글이 대신하므로 줄로 다시 안 그린다
        if (groupOf(m) === g.id && m.id !== g.anchorId) rows.push({ id: "w:" + m.id, kind: "ws", wsId: m.id, inGroup: true, groupId: g.id, drag: true });
      }
    }
    return rows;
  };

  const pinned = [];
  const rest = [];
  const seen = new Set();
  for (const w of ws) {
    const gid = groupOf(w);
    if (gid && groups.has(gid)) {
      const g = groups.get(gid);
      const isAnchor = w.id === g.anchorId || !ws.some((x) => x.id === g.anchorId);
      if (seen.has(g.id) || !isAnchor) continue;
      seen.add(g.id);
      (g.pinned ? pinned : rest).push(...section(g));
    } else if (!gid) {
      (w.pinned ? pinned : rest).push({ id: "w:" + w.id, kind: "ws", wsId: w.id, inGroup: false, groupId: null, drag: true });
    }
  }
  for (const g of groups.values()) {
    if (!seen.has(g.id) && ws.some((x) => groupOf(x) === g.id)) (g.pinned ? pinned : rest).push(...section(g));
  }
  return [...pinned, ...rest];
}

// ── 누르는 즉시 반영 (색상 · 그룹 · 순서) ──
// cmux 데이터는 1초쯤 뒤에 따라오므로 그 사이엔 방금 한 동작을 기준으로 그린다.
// cmux가 따라오면 풀고, 안 따라와도(cmux가 순서를 다르게 정리한 경우 등) 몇 초 뒤엔 풀어서 실제 값을 보여준다.
const HOLD = 4;
const colorOverride = new Map(); // workspaceId -> { color: "#hex" | null, until }
const groupOverride = new Map(); // workspaceId -> { group: groupId | null, until }
let orderOverride = null; // { ids, until }
const [liveTick, setLiveTick] = signal(0);
const bump = () => setLiveTick(liveTick() + 1);
const sameColor = (a, b) => String(a || "").toUpperCase() === String(b || "").toUpperCase();

function colorOf(w) {
  liveTick();
  const o = w && colorOverride.get(w.id);
  if (o) {
    if (sameColor(o.color, w.color) || now() > o.until) colorOverride.delete(w.id);
    else return o.color || "#7f7f7f";
  }
  return w?.color || "#7f7f7f";
}

function groupOf(w) {
  liveTick();
  const o = groupOverride.get(w.id);
  if (o) {
    if ((w.group ?? null) === o.group || now() > o.until) groupOverride.delete(w.id);
    else return o.group;
  }
  return w.group ?? null;
}

// 방금 옮긴 순서대로 줄 세운 프로젝트 배열
function orderedWs(ws) {
  liveTick();
  if (!orderOverride) return ws;
  const wanted = orderOverride.ids.filter((id) => ws.some((w) => w.id === id));
  if (now() > orderOverride.until || ws.map((w) => w.id).join(",") === wanted.join(",")) {
    orderOverride = null;
    return ws;
  }
  const rank = new Map(orderOverride.ids.map((id, i) => [id, i]));
  return ws.slice().sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
}

function setColor(w, hex) {
  if (!w) return;
  colorOverride.set(w.id, { color: hex, until: now() + HOLD });
  bump();
  if (hex) cmux("workspace.action", { action: "set_color", workspace_id: w.id, color: hex });
  else cmux("workspace.action", { action: "clear_color", workspace_id: w.id });
}

// 그룹의 색: 그룹 자체엔 색을 안 주고 멤버들을 같은 색으로 칠해 쓰므로, 멤버들이 가장 많이 쓰는 색을 그룹 색으로 본다
function groupColor(groupId, exceptId) {
  const tally = new Map();
  let best = null;
  for (const x of data.workspaces() ?? []) {
    if (x.id === exceptId || groupOf(x) !== groupId || !x.color) continue;
    const c = String(x.color).toUpperCase();
    tally.set(c, (tally.get(c) ?? 0) + 1);
    if (!best || tally.get(c) > tally.get(best)) best = c;
  }
  return best;
}

function setGroup(w, groupId) {
  if (!w || (w.group ?? null) === (groupId ?? null)) return;
  // 그룹에 들어가면 그 그룹 색으로 맞춘다. 빼낼 때는 색을 그대로 둔다
  const tone = groupId ? groupColor(groupId, w.id) : null;
  if (tone && !sameColor(tone, w.color)) setColor(w, tone);
  groupOverride.set(w.id, { group: groupId ?? null, until: now() + HOLD });
  bump();
  if (groupId) cmux("workspace.group.add", { group_id: groupId, workspace_id: w.id });
  else cmux("workspace.group.remove", { workspace_id: w.id });
}

// ── 끌어 옮기기 (그룹 보기 전용) ──
// index 는 끌던 줄이 놓인 자리(머리글 포함 평면 목록 기준)다. 위·아래 줄을 보고 어느 그룹에 넣을지 정한다.
// 경계가 애매한 자리는 extra.side 로 가른다: "below"면 아래 줄과 한 묶음, 아니면 위 줄과 한 묶음.
// 그룹 머리글을 끌면 그룹이 통째로 움직인다 (extra.block). 공식 예제 workspaces.js 의 규칙을 그대로 따랐다.
function handleMove(key, index, extra) {
  if (sortMode() !== "group" || query().trim()) return;
  const ws = orderedWs(data.workspaces() ?? []);
  const list = projectEntries(ws);

  if (extra && extra.block && key.startsWith("g:")) {
    // 그룹 통째 이동: 그룹 줄들을 뽑아 놓은 자리 앞에 (대표 프로젝트부터) 다시 끼운 전체 순서를 보낸다
    const gid = key.slice(2);
    const memberIds = new Set(ws.filter((w) => groupOf(w) === gid).map((w) => w.id));
    const others = list.filter((e) => e.id !== key && e.groupId !== gid);
    const nextEntry = others.slice(index).find((e) => e.kind === "ws" || e.kind === "group");
    const nextId = nextEntry ? (nextEntry.kind === "group" ? groupById(nextEntry.groupId)?.anchorId : nextEntry.wsId) : null;
    const anchorId = groupById(gid)?.anchorId;
    const blockIds = ws.map((w) => w.id).filter((id) => memberIds.has(id));
    if (anchorId && blockIds.includes(anchorId)) {
      blockIds.splice(blockIds.indexOf(anchorId), 1);
      blockIds.unshift(anchorId);
    }
    const rest = ws.map((w) => w.id).filter((id) => !memberIds.has(id));
    let insertAt = nextId ? rest.indexOf(nextId) : rest.length;
    if (insertAt < 0) insertAt = rest.length;
    const full = [...rest.slice(0, insertAt), ...blockIds, ...rest.slice(insertAt)];
    orderOverride = { ids: full, until: now() + HOLD };
    bump();
    cmux("workspace.reorder_many", { workspace_ids: JSON.stringify(full) });
    return;
  }

  const id = key.slice(2);
  const dragged = ws.find((w) => w.id === id);
  if (!dragged) return;
  const others = list.filter((e) => e.id !== key);
  const prev = index > 0 ? others[index - 1] ?? null : null;
  const nextAny = others[index] ?? null;
  // 순서 기준은 아래쪽 줄. 머리글이면 그 그룹의 대표 프로젝트 앞 = 그룹 전체의 앞
  const nextId = nextAny ? (nextAny.kind === "group" ? groupById(nextAny.groupId)?.anchorId : nextAny.wsId) : null;
  const nextWs = nextId ? ws.find((w) => w.id === nextId) : null;

  let container;
  if (extra && extra.side === "below") {
    container = nextAny && nextAny.kind === "ws" ? nextAny.groupId : null;
  } else {
    container = prev ? prev.groupId : null;
    // 접힌 그룹 머리글 바로 아래는 "그룹 안"이 아니라 "그룹 다음"이다 (원래 그 그룹이면 그대로)
    if (prev && prev.kind === "group") {
      const g = groupById(prev.groupId);
      if (g && isCollapsed(g) && groupOf(dragged) !== g.id) container = null;
    }
  }
  // 놓은 자리를 바로 그려둔다: 아래쪽 줄 앞에 끼운 순서 + 새 그룹
  const restIds = ws.map((w) => w.id).filter((x) => x !== id);
  let at = nextId ? restIds.indexOf(nextId) : restIds.length;
  if (at < 0) at = restIds.length;
  orderOverride = { ids: [...restIds.slice(0, at), id, ...restIds.slice(at)], until: now() + HOLD };
  bump();
  setGroup(dragged, container ?? null);
  if (nextWs) {
    const before = nextWs.index;
    cmux("workspace.reorder", { workspace_id: id, index: dragged.index < before ? before - 1 : before });
  } else {
    cmux("workspace.reorder", { workspace_id: id, index: ws.length - 1 });
  }
}

// cmux 기본 팔레트 중 9개 (지금 그룹들이 쓰는 색 포함)
// 우클릭 메뉴는 macOS 기본 메뉴라 도형에 색을 못 입힌다. 그래서 색이 보이도록 동그라미 이모지가 있는 색만 골랐다.
// 색상값은 누르자마자 점을 칠하려고 같이 적어둔다 (cmux 기본 팔레트)
const COLORS = [
  ["🔴 빨강", "Red", "#C0392B"], ["🟠 주황", "Orange", "#A04000"], ["🟡 호박", "Amber", "#7D6608"], ["🟢 초록", "Green", "#196F3D"],
  ["🩵 아쿠아", "Aqua", "#0E6B8C"], ["🔵 파랑", "Blue", "#1565C0"], ["🟣 보라", "Purple", "#6A1B9A"], ["🟤 갈색", "Brown", "#7B3F00"], ["⚫ 숯색", "Charcoal", "#3E4B5E"],
];

// 프로젝트 우클릭 메뉴: 그룹 옮기기 / 색상 바꾸기. w 는 대상 프로젝트를 돌려주는 함수
// 지금 cmux는 우클릭 메뉴 안의 하위 메뉴(Menu)를 그리지 않아서 한 단계로 펼쳐 놓는다
function projectMenu(w) {
  return [
    ...(data.groups() ?? []).map((g) =>
      Button(() => "그룹 이동 → " + (groupById(g.id)?.name ?? ""), () => setGroup(w(), g.id)),
    ),
    Button("그룹에서 빼기", () => setGroup(w(), null)),
    Divider(),
    ...COLORS.map(([label, name, hex]) => Button(label, () => setColor(w(), hex))),
    Button("⚪ 색상 지우기", () => setColor(w(), null)),
  ];
}

// 그룹 머리글 우클릭 메뉴: 그룹 색 지정 = 그 그룹 프로젝트를 전부 같은 색으로 칠한다
// (대표 프로젝트는 머리글 역할이라 원래 색을 안 칠해 쓰므로 건드리지 않는다)
function groupMenu(groupId) {
  const paint = (hex) => () => {
    const anchorId = groupById(groupId)?.anchorId;
    for (const x of data.workspaces() ?? []) {
      if (groupOf(x) === groupId && x.id !== anchorId && !sameColor(hex, x.color)) setColor(x, hex);
    }
  };
  return [
    ...COLORS.map(([label, name, hex]) => Button("그룹 전체 → " + label, paint(hex))),
    Button("그룹 전체 → ⚪ 색상 지우기", paint(null)),
  ];
}

// 프로젝트 전체 상태: 세션 중 가장 급한 것 하나 (기다림 > 작업 중 > 완료)
function projectState(w) {
  if (!w) return null;
  const t = now();
  const li = latestIdle(w);
  let st = null;
  for (const a of w.agents ?? []) {
    const b = bucket(w, a, t, li);
    if (b === "check" && a.status === "needs_input") return "waiting";
    if (b === "work") st = "work";
    else if (b === "check" && st !== "work") st = "done";
  }
  return st;
}

// 이름 오른쪽 작은 상태 아이콘. 원래 사이드바의 번개 표시 자리
// 아이콘을 바꿔 끼우는 대신 세 개를 겹쳐 두고 해당 상태만 보이게 한다 (고정 아이콘이 확실히 동작한다)
function stateIcon(w) {
  const one = (name, state, tone) =>
    Image(name).font(10).color(tone).opacity(() => (projectState(w()) === state ? 1 : 0));
  return ZStack({}, [
    one("exclamationmark.circle.fill", "waiting", TONE.waiting),
    one("bolt.fill", "work", TONE.work),
    one("checkmark.circle.fill", "done", TONE.done),
  ]);
}

function unreadBadge(w) {
  return Text(() => (w()?.unread > 0 ? String(w().unread) : ""))
    .font(10)
    .bold()
    .color("white")
    .paddingHorizontal(() => (w()?.unread > 0 ? 5 : 0))
    .paddingVertical(() => (w()?.unread > 0 ? 1 : 0))
    .background(() => (w()?.unread > 0 ? "#E4573D" : null))
    .cornerRadius(7);
}

// 그룹 머리글: 어디를 눌러도 접기/펴기만 한다.
// 대표 프로젝트(그룹 터미널)로는 이동하지 않는다. 거기서 터미널을 닫으면 그룹이 통째로 사라지기 때문
function groupRow(e) {
  const g = () => groupById(e().groupId) ?? { id: e().groupId, name: "", collapsed: false };
  const anchor = () => wsById(g().anchorId);
  return HStack({ spacing: 6 }, [
    Image("chevron.right")
      .font(10)
      .weight("semibold")
      .color("tertiary")
      .rotation(() => (isCollapsed(g()) ? 0 : 90))
      .frame({ width: 14, height: 16 }),
    Text(() => g().name)
      .font(12)
      .weight("semibold")
      .lineLimit(1)
      .truncation("tail")
      .color(() => (anchor()?.selected ? "primary" : "secondary")),
    Spacer({ minLength: 0 }),
    stateIcon(anchor),
    unreadBadge(anchor),
  ])
    .paddingLeading(8)
    .paddingTrailing(10)
    .paddingVertical(5)
    .cornerRadius(8)
    .background(() => (anchor()?.selected ? "#7f7f7f3d" : null))
    .hoverBackground(() => (anchor()?.selected ? "#7f7f7f3d" : "#7f7f7f1c"))
    .frame({ maxWidth: "infinity" })
    // 머리글은 줄처럼 잡히진 않지만, 끌면 그룹이 통째로 움직인다
    .fixed()
    .block("g:" + e().groupId)
    .onTap(() => toggleCollapse(g()))
    .contextMenu(groupMenu(e().groupId));
}

// 프로젝트 한 줄: 색 점 · 이름 · 안 읽은 알림 수. 그룹 안이면 들여쓴다
function projectRow(e) {
  const w = () => wsById(e().wsId);
  const view = HStack({ spacing: 8 }, [
    Circle({ size: 7 }).fill(() => colorOf(w())),
    Text(() => w()?.title ?? "")
      .font(13)
      .lineLimit(1)
      .truncation("tail")
      .marquee()
      .color(() => (w()?.selected ? "primary" : "secondary")),
    Spacer({ minLength: 0 }),
    stateIcon(w),
    unreadBadge(w),
  ])
    .paddingHorizontal(10)
    .paddingVertical(5)
    .marginLeading(() => (e().inGroup ? 14 : 0))
    .cornerRadius(8)
    .background(() => (w()?.selected ? "#7f7f7f3d" : null))
    .hoverBackground(() => (w()?.selected ? "#7f7f7f3d" : "#7f7f7f24"))
    .frame({ maxWidth: "infinity" });
  // 줄 종류는 키로 고정되므로 끌 수 있는지도 여기서 한 번만 정한다
  return (e().drag ? view : view.fixed())
    .onTap(() => cmux("workspace.select", { workspace_id: e().wsId }))
    .contextMenu(projectMenu(w));
}

// ── 루트 ───────────────────────────────────────────────────────────────
sidebar(
  () =>
    VStack({ spacing: 2 }, [
      summary(),
      Divider(),
      Rectangle().fill("#00000000").frame({ height: 4 }),
      ForEach(
        { items: topEntries, key: (e) => e.id },
        (e) => {
          // key 접두사로 줄 종류가 고정되므로 템플릿을 한 번만 고르면 된다
          const kind = e().kind;
          if (kind === "more") return more(e);
          if (kind === "slot") return slot();
          if (kind === "projects") return projectsHeader(e);
          if (kind === "later") return laterRow(e);
          if (kind === "laterHeader") return laterHeader(e);
          return row(e);
        },
      ),
      // 프로젝트 목록은 끌어 옮길 수 있는 목록으로 따로 둔다 (간격은 위 목록과 같게)
      Reorderable(
        { items: projectList, key: (e) => e.id, spacing: 2, onMove: handleMove },
        (e) => {
          const kind = e().kind;
          if (kind === "group") return groupRow(e);
          if (kind === "nohit") return noHit();
          return projectRow(e);
        },
      ),
    ]),
  { surface: "glass" },
);
