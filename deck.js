// SPDX-License-Identifier: GPL-3.0-or-later
//
// Deck — cmux 커스텀 사이드바. 프로젝트와 그 안의 탭을 한 목록으로 본다.
//
//   검색     : 프로젝트 이름으로 거르기 (Enter = 첫 결과로 이동)
//   프로젝트 : 기본은 그룹 목록. 끌어서 그룹 사이로 옮기고, 우클릭으로 색상·그룹을 바꾼다
//   탭       : 프로젝트 줄 바로 아래에 그 프로젝트의 탭을 순서대로 펼친다
//              탭 이름 왼쪽 점은 그 탭 세션의 상태 (주황=입력 대기, 파랑=작업 중, 초록=방금 끝남)
//              프로젝트 줄 왼쪽 ▸ 를 누르면 그 프로젝트의 탭 목록만 접는다
// 줄을 누르면 그 프로젝트(또는 그 탭)로 바로 이동한다.
//
// 설치: ./install.sh  (또는 이 파일을 ~/.config/cmux/sidebars/deck.js 로 복사)
// 열기: 사이드바 버튼 우클릭 → deck
//
// 그룹 목록·접기 로직은 cmux 공식 예제(Examples/CustomSidebars/workspaces.js,
// GPL-3.0-or-later, Copyright (c) Manaflow, Inc.)를 바탕으로 했다.

// 버전. 기능이 바뀌면 CHANGELOG.md 와 함께 올린다 (화면에는 안 보인다 — 파일과 CHANGELOG 로만 확인)
const VERSION = "0.3.0";

const TONE = {
  waiting: "#FF8A5B",
  done: "#5AD1A0",
  work: "#5AA8FF",
};
// 끝난 세션을 "완료"로 보여주는 시간 (초). cmux 재시작 때 활동 시각이 한꺼번에 찍혀서 길게 잡으면 전부 올라온다
const FRESH = 3 * 60;
// 입력 대기 신호를 "지금 내 차례"로 볼 시간 (초).
// Claude Code 는 일이 끝난 뒤에도 입력 대기 신호를 남겨 두고, cmux 는 /clear 를 활동으로 치지 않는다.
// 그래서 어제 쓰고 놔둔 탭까지 전부 "입력 대기 · 1일"로 올라온다 — 정작 지금 급한 건 하나도 없는데.
// 이 시간이 지난 입력 대기는 상태 없음(회색)으로 내린다. 급하면 짧게, 자리를 오래 비우면 길게 잡는다
const STALE = 60 * 60;

const now = () => data.clock()?.epoch ?? 0;

const groupById = (id) => (data.groups() ?? []).find((g) => g.id === id);
const wsById = (id) => (data.workspaces() ?? []).find((w) => w.id === id);

// ── 0.2 잔재 정리 ──
// 예전 버전은 "나중에 확인 / 확인함" 표시를 프로젝트 설명 칸 끝에 적어뒀다.
// 그 기능이 없어졌으므로 처음 한 번 돌면서 표시만 떼어낸다 (사용자가 쓴 설명은 그대로 둔다).
const MARK_RE = /\n?⟦deck(?::later [^⟧]*| [^⟧]*)⟧\s*$/;
let marksCleaned = false;
function cleanupOldMarks() {
  if (marksCleaned) return;
  const all = data.workspaces() ?? [];
  if (!all.length) return; // 아직 데이터가 안 왔으면 다음 그리기 때 다시 본다
  marksCleaned = true;
  for (const w of all) {
    const text = w.description || "";
    if (!MARK_RE.test(text)) continue;
    const user = text.replace(MARK_RE, "");
    if (user) cmux("workspace.action", { workspace_id: w.id, action: "set_description", description: user });
    else cmux("workspace.action", { workspace_id: w.id, action: "clear_description" });
  }
}

// ── 프로젝트 검색 / 정렬 ──
const [query, setQuery] = signal("");
// "group": 기본 사이드바와 같은 그룹 목록(기본), "recent": 그룹 무시하고 최근 작업 순
const [sortMode, setSortMode] = signal("group");

// ── 프로젝트별 탭 목록 접기 ──
// 기본은 펼침. 접은 프로젝트만 기억한다
const tabsClosed = new Set();
const [tabsTick, setTabsTick] = signal(0);

function tabsOpen(wsId) {
  tabsTick();
  return !tabsClosed.has(wsId);
}
function toggleTabs(wsId) {
  if (tabsClosed.has(wsId)) tabsClosed.delete(wsId);
  else tabsClosed.add(wsId);
  setTabsTick(tabsTick() + 1);
}

// ── 탭 ──

// 첫 프롬프트가 제목일 때가 많아서 한 줄로 정리한다
function cleanTitle(s) {
  // 작업 중일 때 제목 앞에 붙는 회전 표시(✳ ◐ ◓ 점자 스피너 등)를 떼어낸다
  return String(s || "")
    .replace(/^[✱-✿○-◓⠂-⣿·*\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 탭에 물려 있는 세션. cmux 는 탭의 id 를 세션의 panelId 로 들고 있다
function agentOfTab(w, tab) {
  if (!w || !tab) return null;
  return (w.agents ?? []).find((a) => a.panelId === tab.id || (a.surfaceId && a.surfaceId === tab.surfaceId)) ?? null;
}

// /clear 로 비워진 세션인지. cmux 는 이 상태도 "입력 대기"로 넘기기 때문에 제목으로 가른다
// (첫 프롬프트가 없고, 탭 제목도 에이전트가 붙인 제목이 아니라 프로젝트·폴더 이름으로 돌아와 있다)
function blankSession(w, a) {
  if (a.title) return false;
  const tab = (w.tabs ?? []).find((x) => x.id === a.panelId || x.surfaceId === a.surfaceId);
  const t = cleanTitle(tab?.title);
  if (!t) return true;
  const dir = String(w.directory || "").split("/").filter(Boolean).pop();
  return t === w.title || t === dir || t === "Claude Code" || t === "Claude";
}

// 세션 하나의 상태: 입력 대기 / 작업 중 / 방금 끝남 / (없음)
function agentState(w, a) {
  if (!w || !a) return null;
  if (a.status === "working") return "work";
  if (a.status === "needs_input") {
    if (blankSession(w, a)) return null;
    // 오래 묵은 입력 대기는 내린다 (위 STALE 설명 참고)
    const at = a.sinceEpoch ?? a.lastActivityAt ?? 0;
    return at && now() - at < STALE ? "waiting" : null;
  }
  if (a.status === "idle" && now() - (a.lastActivityAt ?? 0) < FRESH) return "done";
  return null;
}

// 프로젝트 전체 상태: 세션 중 가장 급한 것 하나 (입력 대기 > 작업 중 > 완료)
function projectState(w) {
  if (!w) return null;
  let st = null;
  for (const a of w.agents ?? []) {
    const s = agentState(w, a);
    if (s === "waiting") return "waiting";
    if (s === "work") st = "work";
    else if (s === "done" && st !== "work") st = "done";
  }
  return st;
}

// 탭 이름. 경로가 제목인 탭("~/workspace/kilog")은 폴더 이름만 남긴다.
// 사이드바가 좁아서 경로를 그대로 두면 앞부분만 보이고 정작 구분되는 뒷부분이 잘린다
function tabLabel(w, tab) {
  const t = cleanTitle(tab?.title);
  if (!t) return "터미널";
  if ((t.startsWith("~/") || t.startsWith("/")) && !t.includes(" ")) {
    return t.split("/").filter(Boolean).pop() || t;
  }
  return t;
}

// 탭 이동. surface.focus 가 실제로 알아듣는 건 탭의 id 다.
// 프로젝트 id도 같이 넘겨서 지금 보고 있는 프로젝트가 아닌 곳의 탭도 찾게 한다.
function jumpTab(wsId, tabId) {
  cmux("workspace.select", { workspace_id: wsId });
  if (tabId) cmux("surface.focus", { workspace_id: wsId, surface_id: tabId });
}

// ── 목록 만들기 ────────────────────────────────────────────────────────

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

// 프로젝트 줄 목록 + 각 프로젝트 바로 아래에 그 프로젝트의 탭 줄
// 검색·최근순 줄은 키를 달리해서("r:") 못 잡는 줄로 만든다 (끌어 옮기기는 그룹 보기에서만)
function projectList() {
  cleanupOldMarks();
  const all = data.workspaces() ?? [];
  // 그룹의 대표 프로젝트(그룹 터미널)는 검색·최근순 목록에도 안 내놓는다. 닫으면 그룹이 사라져서 고를 일이 없게 한다
  const anchors = new Set((data.groups() ?? []).map((g) => g.anchorId));
  const pickable = all.filter((w) => !anchors.has(w.id));
  const still = (w) => ({ id: "r:" + w.id, kind: "ws", wsId: w.id, inGroup: false, groupId: null, drag: false });

  let base;
  const q = query().trim().toLowerCase();
  if (q) {
    const hits = pickable.filter((w) => (w.title || "").toLowerCase().includes(q));
    if (!hits.length) return [{ id: "f:nohit", kind: "nohit" }];
    base = hits.map(still);
  } else if (sortMode() === "recent") {
    base = recentEntries(pickable).map(still);
  } else {
    base = projectEntries(orderedWs(all));
  }

  // 프로젝트 줄 뒤에 탭을 끼워 넣는다. 탭 줄은 끌 수 없고, 소속 그룹은 프로젝트 줄을 따른다
  const out = [];
  for (const e of base) {
    out.push(e);
    if (e.kind !== "ws" || !tabsOpen(e.wsId)) continue;
    const w = wsById(e.wsId);
    for (const tab of w?.tabs ?? []) {
      out.push({
        id: "t:" + e.wsId + ":" + tab.id,
        kind: "tab",
        wsId: e.wsId,
        tabId: tab.id,
        inGroup: e.inGroup,
        groupId: e.groupId,
      });
    }
  }
  return out;
}

function ago(sec) {
  if (sec < 60) return "방금";
  if (sec < 3600) return Math.floor(sec / 60) + "분";
  if (sec < 86400) return Math.floor(sec / 3600) + "시간";
  return Math.floor(sec / 86400) + "일";
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
// index 는 끌던 줄이 놓인 자리(머리글·탭 줄까지 포함한 평면 목록 기준)다.
// 탭 줄은 옮기는 대상이 아니므로, 위·아래로 훑어 가장 가까운 프로젝트·그룹 줄을 찾아 기준으로 삼는다.
// 경계가 애매한 자리는 extra.side 로 가른다: "below"면 아래 줄과 한 묶음, 아니면 위 줄과 한 묶음.
// 그룹 머리글을 끌면 그룹이 통째로 움직인다 (extra.block). 공식 예제 workspaces.js 의 규칙을 그대로 따랐다.
function handleMove(key, index, extra) {
  if (sortMode() !== "group" || query().trim()) return;
  const ws = orderedWs(data.workspaces() ?? []);
  const list = projectList();
  const movable = (e) => e.kind === "ws" || e.kind === "group";

  if (extra && extra.block && key.startsWith("g:")) {
    // 그룹 통째 이동: 그룹 줄들을 뽑아 놓은 자리 앞에 (대표 프로젝트부터) 다시 끼운 전체 순서를 보낸다
    const gid = key.slice(2);
    const memberIds = new Set(ws.filter((w) => groupOf(w) === gid).map((w) => w.id));
    const others = list.filter((e) => e.id !== key && e.groupId !== gid);
    const nextEntry = others.slice(index).find(movable);
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
  // 끌고 있는 프로젝트의 탭 줄은 그 프로젝트를 따라다니므로 기준에서 뺀다
  const others = list.filter((e) => e.id !== key && !(e.kind === "tab" && e.wsId === id));
  // 놓인 자리 위·아래에서 탭 줄을 건너뛰고 가장 가까운 프로젝트·그룹 줄을 찾는다
  let prev = null;
  for (let i = Math.min(index, others.length) - 1; i >= 0; i--) {
    if (movable(others[i])) { prev = others[i]; break; }
  }
  let nextAny = null;
  for (let i = Math.max(index, 0); i < others.length; i++) {
    if (movable(others[i])) { nextAny = others[i]; break; }
  }
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

// 프로젝트 우클릭 메뉴: 탭 접기 / 그룹 옮기기 / 색상 바꾸기. w 는 대상 프로젝트를 돌려주는 함수
// 지금 cmux는 우클릭 메뉴 안의 하위 메뉴(Menu)를 그리지 않아서 한 단계로 펼쳐 놓는다
function projectMenu(w) {
  return [
    // 줄을 눌러도 이동하지 않으므로, 탭이 없는 프로젝트로 가는 길은 여기에 남겨둔다
    Button("이 프로젝트 열기", () => {
      const x = w();
      if (x) cmux("workspace.select", { workspace_id: x.id });
    }),
    Button(() => (tabsOpen(w()?.id) ? "탭 목록 접기" : "탭 목록 펼치기"), () => toggleTabs(w()?.id)),
    Divider(),
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

// ── 뷰 조각 ────────────────────────────────────────────────────────────

// 맨 위: 검색 + 정렬 전환 (제목·버전 줄은 자리만 먹어서 뺐다. 버전은 CHANGELOG.md 로 확인한다)
function header() {
  return VStack({ spacing: 0 }, [
    Rectangle().fill("#00000000").frame({ height: 8 }),
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
    // 정렬 전환: 그룹 / 최근순
    HStack({ spacing: 10 }, [
      sortTab("그룹", "group"),
      sortTab("최근순", "recent"),
      Spacer({ minLength: 0 }),
      allTabsToggle(),
    ])
      .paddingHorizontal(14)
      .paddingTop(8)
      .paddingBottom(4)
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

// 탭 목록 전체 접기/펼치기. 하나라도 펼쳐져 있으면 전부 접고, 다 접혀 있으면 전부 편다
function allTabsToggle() {
  const anyOpen = () => {
    tabsTick();
    return (data.workspaces() ?? []).some((w) => (w.tabs ?? []).length > 0 && !tabsClosed.has(w.id));
  };
  return Text(() => (anyOpen() ? "탭 접기" : "탭 펼치기"))
    .font(11)
    .color("tertiary")
    .onTap(() => {
      if (anyOpen()) for (const w of data.workspaces() ?? []) tabsClosed.add(w.id);
      else tabsClosed.clear();
      setTabsTick(tabsTick() + 1);
    });
}

function noHit() {
  return Text("맞는 프로젝트가 없어요").font(12).color("tertiary").paddingHorizontal(14).paddingVertical(6).fixed();
}

// 상태 아이콘. 아이콘을 바꿔 끼우는 대신 세 개를 겹쳐 두고 해당 상태만 보이게 한다
// (고정 아이콘이 확실히 동작한다). state 는 "waiting" | "work" | "done" | null 을 돌려주는 함수
function stateIconOf(state) {
  const one = (name, want, tone) => Image(name).font(10).color(tone).opacity(() => (state() === want ? 1 : 0));
  return ZStack({}, [
    one("exclamationmark.circle.fill", "waiting", TONE.waiting),
    one("bolt.fill", "work", TONE.work),
    one("checkmark.circle.fill", "done", TONE.done),
  ]);
}

// 이름 오른쪽 작은 상태 아이콘. 원래 사이드바의 번개 표시 자리
function stateIcon(w) {
  return stateIconOf(() => projectState(w()));
}

// 안 읽은 알림 수. n 은 숫자를 돌려주는 함수
function badge(n) {
  return Text(() => (n() > 0 ? String(n()) : ""))
    .font(10)
    .bold()
    .color("white")
    .paddingHorizontal(() => (n() > 0 ? 5 : 0))
    .paddingVertical(() => (n() > 0 ? 1 : 0))
    .background(() => (n() > 0 ? "#E4573D" : null))
    .cornerRadius(7);
}

function unreadBadge(w) {
  return badge(() => w()?.unread ?? 0);
}

// 그룹 머리글: 줄이 아니라 "구역"으로 보이게 — 위에 얇은 선과 여백을 두고 이름은 작고 굵게.
// 들여쓰기를 안 쓰는 대신 이 선이 묶음을 말해주므로, 아래 프로젝트·탭 이름이 폭을 다 쓸 수 있다.
// 어디를 눌러도 접기/펴기만 한다. 대표 프로젝트(그룹 터미널)로는 이동하지 않는다 —
// 거기서 터미널을 닫으면 그룹이 통째로 사라지기 때문.
function groupRow(e) {
  const g = () => groupById(e().groupId) ?? { id: e().groupId, name: "", collapsed: false };
  const anchor = () => wsById(g().anchorId);
  // 머리글이 대신하는 대표 프로젝트는 빼고 센다
  const members = () => (data.workspaces() ?? []).filter((w) => groupOf(w) === e().groupId && w.id !== g().anchorId);
  // 접으면 안이 안 보이므로, 그룹에서 가장 급한 상태와 안 읽은 수를 머리글에 모아 보여준다
  const inside = () => (anchor() ? members().concat([anchor()]) : members());
  const rolled = () => {
    if (!isCollapsed(g())) return null;
    let st = null;
    for (const w of inside()) {
      const s = projectState(w);
      if (s === "waiting") return "waiting";
      if (s === "work") st = "work";
      else if (s === "done" && st !== "work") st = "done";
    }
    return st;
  };
  const rolledUnread = () => (isCollapsed(g()) ? inside().reduce((n, w) => n + (w.unread ?? 0), 0) : 0);

  return VStack({ spacing: 0 }, [
    Rectangle().fill("#00000000").frame({ height: 10 }),
    Rectangle().fill("#7f7f7f2e").frame({ height: 1 }).paddingHorizontal(10),
    HStack({ spacing: 5 }, [
      Text(() => g().name)
        .font(11)
        .weight("semibold")
        .lineLimit(1)
        .truncation("tail")
        .color(() => (anchor()?.selected ? "primary" : "secondary")),
      // 개수는 접었을 때만. 펼쳐 놓으면 아래에 다 보이니 숫자는 군더더기다
      Text(() => (isCollapsed(g()) && members().length > 0 ? "· " + members().length : ""))
        .font(10)
        .color("tertiary"),
      Spacer({ minLength: 0 }),
      stateIconOf(rolled),
      badge(rolledUnread),
      // 접힘 표시는 오른쪽 끝에 둔다. 왼쪽에 두면 아래 이름들까지 그만큼 밀린다
      Image("chevron.right")
        .font(8)
        .weight("semibold")
        .color("tertiary")
        .rotation(() => (isCollapsed(g()) ? 0 : 90))
        .frame({ width: 10, height: 12 })
        .opacity(0.6),
    ])
      .paddingHorizontal(10)
      .paddingTop(6)
      .paddingBottom(2)
      .frame({ maxWidth: "infinity" })
      .hoverBackground("#7f7f7f1c")
      .cornerRadius(6)
      .onTap(() => toggleCollapse(g()))
      .contextMenu(groupMenu(e().groupId)),
  ])
    // 머리글은 줄처럼 잡히진 않지만, 끌면 그룹이 통째로 움직인다
    .fixed()
    .block("g:" + e().groupId);
}

// 프로젝트 한 줄: 색 점 · 이름 · 탭 수 · 상태 · 안 읽은 알림 수 · 접기 화살표
// 누르면 그 프로젝트로 넘어가지 않고 탭 목록만 접었다 편다 (그룹 머리글과 같은 규칙).
// 이동은 탭 줄로만 한다 — 프로젝트를 고르면 cmux 가 알아서 마지막 탭을 띄우는데,
// 어느 탭인지 모르고 넘어가는 것보다 탭을 골라 들어가는 편이 낫다.
function projectRow(e) {
  const w = () => wsById(e().wsId);
  const tabCount = () => (w()?.tabs ?? []).length;
  const view = HStack({ spacing: 6 }, [
    Circle({ size: 7 }).fill(() => colorOf(w())),
    Text(() => w()?.title ?? "")
      .font(13)
      .lineLimit(1)
      .truncation("tail")
      .marquee()
      .color(() => (w()?.selected ? "primary" : "secondary")),
    Spacer({ minLength: 0 }),
    // 접었을 때만 탭 개수를 보여준다 (펼쳐 놓으면 아래에 다 보이니까)
    Text(() => (!tabsOpen(e().wsId) && tabCount() > 0 ? String(tabCount()) : ""))
      .font(10)
      .color("tertiary"),
    stateIcon(w),
    unreadBadge(w),
    // 화살표는 오른쪽 끝에. 왼쪽에 두면 이름과 그 아래 탭 이름이 그만큼 밀린다
    Image("chevron.right")
      .font(8)
      .weight("semibold")
      .color("tertiary")
      .rotation(() => (tabsOpen(e().wsId) ? 90 : 0))
      .frame({ width: 10, height: 12 })
      .opacity(() => (tabCount() > 0 ? 0.6 : 0)),
  ])
    .paddingLeading(8)
    .paddingTrailing(8)
    .paddingVertical(5)
    .cornerRadius(8)
    // 선택 배경은 탭 줄만 쓴다. 프로젝트까지 같이 칠하면 한 번에 두 줄이 강조돼서 어느 탭에 있는지가 흐려진다
    .hoverBackground("#7f7f7f24")
    .frame({ maxWidth: "infinity" });
  // 줄 종류는 키로 고정되므로 끌 수 있는지도 여기서 한 번만 정한다
  return (e().drag ? view : view.fixed())
    .onTap(() => {
      if (tabCount() > 0) toggleTabs(e().wsId);
    })
    .contextMenu(projectMenu(w));
}

// 탭 한 줄: 상태 점 · 탭 이름 · (일하는 중이면) 경과 시간
// 프로젝트 줄보다 한 단 더 들여쓰고 글자도 작게 해서 소속이 눈에 들어오게 한다
function tabRow(e) {
  const w = () => wsById(e().wsId);
  const tab = () => (w()?.tabs ?? []).find((t) => t.id === e().tabId) ?? null;
  const agent = () => agentOfTab(w(), tab());
  const state = () => agentState(w(), agent());
  const active = () => Boolean(w()?.selected && tab()?.focused);
  const tone = () => (state() ? TONE[state() === "waiting" ? "waiting" : state() === "work" ? "work" : "done"] : null);

  return HStack({ spacing: 6 }, [
    // 상태 점: 상태가 없으면 흐린 회색으로 자리만 지킨다
    Circle({ size: 5 })
      .fill(() => tone() ?? "#7f7f7f")
      .opacity(() => (tone() ? 1 : 0.35)),
    Text(() => tabLabel(w(), tab()))
      .font(12)
      .lineLimit(1)
      .truncation("tail")
      .marquee()
      .color(() => (active() ? "primary" : "secondary")),
    Spacer({ minLength: 0 }),
    // 경과 시간. 폭을 안 잡아주면 "17시간"이 한 글자씩 세로로 눌린다.
    // fixed() 로 글자 폭만 차지하게 해서, 상태가 없는(= 글자가 없는) 탭은 자리를 아예 안 먹는다
    Text(() => {
      const a = agent();
      return state() && a ? ago(now() - (a.lastActivityAt ?? now())) : "";
    })
      .font(10)
      .lineLimit(1)
      .color(() => tone() ?? "tertiary")
      .opacity(0.85)
      .fixed(),
  ])
    .paddingLeading(6)
    .paddingTrailing(8)
    .paddingVertical(3)
    // 그룹 안이면 프로젝트 줄이 이미 8 만큼 들어가 있으므로 그만큼만 더 민다.
    // 이름 길이가 아쉬워서 단 구분은 들여쓰기보다 글자 크기·색으로 준다
    .marginLeading(() => (e().inGroup ? 20 : 12))
    .cornerRadius(7)
    .background(() => (active() ? "#7f7f7f3d" : null))
    .hoverBackground(() => (active() ? "#7f7f7f3d" : "#7f7f7f1c"))
    .frame({ maxWidth: "infinity" })
    .fixed()
    .onTap(() => jumpTab(e().wsId, e().tabId));
}

// ── 루트 ───────────────────────────────────────────────────────────────
sidebar(
  () =>
    VStack({ spacing: 2 }, [
      header(),
      Reorderable(
        { items: projectList, key: (e) => e.id, spacing: 2, onMove: handleMove },
        (e) => {
          // key 접두사로 줄 종류가 고정되므로 템플릿을 한 번만 고르면 된다
          const kind = e().kind;
          if (kind === "group") return groupRow(e);
          if (kind === "tab") return tabRow(e);
          if (kind === "nohit") return noHit();
          return projectRow(e);
        },
      ),
    ]),
  { surface: "glass" },
);
