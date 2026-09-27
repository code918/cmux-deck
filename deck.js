// SPDX-License-Identifier: GPL-3.0-or-later
//
// Deck — cmux 커스텀 사이드바. 프로젝트와 그 안의 탭을 한 목록으로 본다.
//
//   검색     : 탭 제목으로 거르기. 결과는 탭 줄 (Enter = 맨 위 탭으로 이동)
//   그룹 보기 : 그룹 구역 → 프로젝트 → 그 프로젝트의 탭. 끌어서 그룹 사이로 옮기고,
//              우클릭으로 색상·그룹을 바꾼다. 프로젝트 줄을 누르면 탭 목록만 접힌다
//   최근순   : 묶음 없이 최근에 움직인 탭만 활동 순으로
//   탭 줄    : 왼쪽 점이 그 탭 세션의 상태 (주황=입력 대기, 파랑=작업 중, 초록=방금 끝남)
// 탭 줄을 누르면 그 탭으로 바로 이동한다.
//
// 설치: ./install.sh  (또는 이 파일을 ~/.config/cmux/sidebars/deck.js 로 복사)
// 열기: 사이드바 버튼 우클릭 → deck
//
// 그룹 목록·접기 로직은 cmux 공식 예제(Examples/CustomSidebars/workspaces.js,
// GPL-3.0-or-later, Copyright (c) Manaflow, Inc.)를 바탕으로 했다.

// 버전. 기능이 바뀌면 CHANGELOG.md 와 함께 올린다 (화면에는 안 보인다 — 파일과 CHANGELOG 로만 확인)
const VERSION = "0.4.0";

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
// 최근순에 올릴 탭의 나이 (초). 이보다 오래 조용한 탭은 최근순 목록에서 빠진다
const RECENT = 30 * 24 * 60 * 60;

// 새 탭 종류. [메뉴에 보일 이름, 터미널이 뜨자마자 칠 명령(없으면 빈 셸)]
// 쓰는 도구가 다르면 여기에 한 줄 더하면 된다 (예: ["새 탭 + 옆집 도구", "tool"])
const NEW_TABS = [
  ["새 탭", null],
  // 명령은 그냥 셸에 쳐 넣는 것이라, 별칭이든 함수든 그 셸이 아는 이름이면 된다
  ["새 탭 + Claude", "cl"],
];
// 머리글 "+" 를 눌렀을 때 만들 탭 (위 목록의 순번).
// 거의 언제나 에이전트를 띄우므로 그게 기본이고, 빈 셸은 option 을 누른 채로 누른다
const PLUS_TAB = 1;
const PLAIN_TAB = 0;

const now = () => data.clock()?.epoch ?? 0;

// ── 찾아보기 표 ──
// 줄 하나를 그릴 때마다 프로젝트를 배열 처음부터 훑으면, 줄 수 × 프로젝트 수만큼 비교가 매 초 돈다
// (프로젝트 47개 · 탭 73개면 초당 몇 만 번이다). 그래서 cmux 가 새 데이터를 줄 때 한 번만 표를 만들고
// 그 뒤로는 표에서 바로 꺼낸다. 데이터가 바뀌면 배열 자체가 새것이 되므로 그걸로 새로 만들 때를 안다.
// (표를 만드는 김에 탭↔세션, 제목 다듬기 결과까지 같이 담는다 — 셋 다 같은 주기로 낡는다)
let idx = { ws: null, agents: null, tabs: null, titles: null, src: null };

function index() {
  const all = data.workspaces() ?? [];
  if (idx.src === all) return idx;
  const ws = new Map();
  const agents = new Map();
  const tabs = new Map();
  for (const w of all) {
    ws.set(w.id, w);
    for (const a of w.agents ?? []) {
      // 세션은 탭의 id(panelId) 나 surfaceId 로 달려 있다. 둘 다 열쇠로 넣어둔다.
      // 한 탭에 세션이 여러 개 쌓여 있을 수 있는데 cmux 는 최신 것을 앞에 준다.
      // 그래서 먼저 온 것만 담는다 — 덮어쓰면 제일 오래된 세션이 남아서 "8일 전" 같은 시각이 뜬다
      const k1 = w.id + "|" + a.panelId;
      const k2 = w.id + "|s|" + a.surfaceId;
      if (a.panelId != null && !agents.has(k1)) agents.set(k1, a);
      if (a.surfaceId != null && !agents.has(k2)) agents.set(k2, a);
    }
    for (const t of w.tabs ?? []) {
      tabs.set(w.id + "|" + t.id, t);
      if (t.surfaceId != null) tabs.set(w.id + "|s|" + t.surfaceId, t);
    }
  }
  idx = { ws, agents, tabs, titles: new Map(), src: all };
  return idx;
}

// 탭 하나 꺼내기 (줄마다 매 초 부르므로 표에서 바로 찾는다)
const tabById = (wsId, tabId) => index().tabs.get(wsId + "|" + tabId) ?? null;

const groupById = (id) => (data.groups() ?? []).find((g) => g.id === id);
const wsById = (id) => index().ws.get(id);

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

// ── 검색 / 정렬 ──
// 검색은 하나다. 프로젝트 이름과 탭 제목을 같이 보고 결과도 한 목록으로 준다 —
// 찾는 사람은 "그게 프로젝트 이름이었는지 탭 제목이었는지"를 기억하고 있지 않다.
// 그래서 보기(그룹/최근순)와도 상관없이 검색 중에는 같은 목록이 나온다
// "group": 기본 사이드바와 같은 그룹 목록(기본), "recent": 그룹 무시하고 최근 작업 순
const [sortMode, setSortMode] = signal("group");
// ── 탭 추가 (어느 프로젝트에 넣을지 고르는 중) ──
const [picking, setPicking] = signal(false);
// 프로젝트 줄의 "+" 로 "무슨 탭을 열지" 고르는 중인 프로젝트. 그 줄 바로 아래에 고를 줄들이 펼쳐진다.
// 왼쪽 클릭으로 뜨는 메뉴는 이 런타임에 없어서(우클릭 메뉴뿐이다) 목록 안에 펼치는 쪽으로 한다
const [addingTo, setAddingTo] = signal(null);
// Enter 로 하는 일은 한 박자 미뤄 둔다.
// 줄을 누르면 검색칸이 먼저 "확정"되면서 Enter 가 같이 터지는데, 그게 즉시 실행되면
// 누른 줄이 아니라 맨 윗줄이 열린다. 예약만 해두면 뒤따라 오는 줄 클릭이 이걸 물리고
// 자기가 고른 줄로 간다. 아무도 안 물리면 다음 그리기 때 예약대로 실행된다
let pending = null; // () => void
const cancelPending = () => (pending = null);
function runPending() {
  const p = pending;
  pending = null;
  if (p) p();
}

// 검색어는 두 벌만 둔다: 평소 검색과, 탭 넣을 곳 고르기.
// 보기를 바꿔도 검색은 같은 것을 찾으므로 치던 말이 그대로 남는다
const queries = { search: "", pick: "" };
const [queryTick, setQueryTick] = signal(0);
const queryKey = () => (picking() ? "pick" : "search");

function query() {
  queryTick();
  return queries[queryKey()] ?? "";
}
function setQuery(t) {
  queries[queryKey()] = t ?? "";
  setQueryTick(queryTick() + 1);
}

// 입력칸은 한 방향이라 떠 있는 칸의 글자를 우리가 바꿀 수 없다. 대신 뜰 때의 초기값은 줄 수 있어서,
// 지우기도 되돌리기도 "칸을 새로 띄우기"로 한다 — 이 숫자가 바뀌면 같은 자리라도 새 칸이 된다
const [fieldTick, setFieldTick] = signal(0);
function remountField() {
  setFieldTick(fieldTick() + 1);
}
function clearQuery() {
  setQuery("");
  remountField();
}

// 고르기를 시작한 "+" 가 무슨 탭을 만들 것인지 (NEW_TABS 순번).
// 종류를 먼저 고르고 프로젝트를 고르는 순서다 — 머리글엔 종류마다 버튼이 하나씩 있다
const [pickKind, setPickKind] = signal(0);
const pickItem = () => NEW_TABS[pickKind()] ?? NEW_TABS[0];

// 고르기를 연 순간의 "최근에 만진 순서"를 붙잡아 둔다.
// 이 순서는 1초마다 바뀌는 값으로 매기는데, 그대로 두면 읽는 동안 줄이 계속 자리를 바꾼다 —
// 누르려던 줄이 손가락 아래에서 다른 프로젝트로 바뀌어 있는 셈이다
let pickOrder = new Map();

function startPick(idx) {
  cancelPending();
  setAddingTo(null);
  setPickKind(idx);
  pickOrder = new Map(
    pickableWs()
      .slice()
      .sort((a, b) => lastTouched(b) - lastTouched(a))
      .map((w, i) => [w.id, i]),
  );
  setPicking(true); // 먼저 고르기로 넘긴 다음 지워야 원래 보기의 검색어가 안 날아간다
  clearQuery();
}
function endPick() {
  cancelPending();
  clearQuery();
  setPicking(false);
}

// ── 프로젝트별 탭 목록 접기 ──
// 기본은 펼침. 접은 프로젝트만 기억한다
const tabsClosed = new Set();
const [tabsTick, setTabsTick] = signal(0);

function tabsOpen(wsId) {
  tabsTick();
  return !tabsClosed.has(wsId);
}
function toggleTabs(wsId) {
  cancelPending();
  if (tabsClosed.has(wsId)) tabsClosed.delete(wsId);
  else tabsClosed.add(wsId);
  setTabsTick(tabsTick() + 1);
}

// ── 봤다고 치우기 ──
// cmux 신호만으로는 안 내려가는 줄이 있다. 대표적으로 /clear 한 세션 — cmux 는 이걸 활동으로 치지 않아서
// 제목도 상태도 하던 일 그대로 남고, 방금 끝난 것처럼 "완료 · 방금"으로 올라온다.
// 제목으로 가려내는 건 한계가 있어서(blankSession), 손으로 내리는 길을 둔다.
// 내린 시각의 활동 시각을 적어두고, 그 탭이 다시 움직이면 알아서 돌아온다.
// 사이드바엔 저장소가 없어서 cmux 를 껐다 켜면 풀린다
const dismissed = new Map(); // 탭 id -> 내릴 때의 lastActivityAt
const [dismissTick, setDismissTick] = signal(0);

function isDismissed(a) {
  dismissTick();
  if (!a) return false;
  const at = dismissed.get(a.panelId ?? a.id);
  return at !== undefined && (a.lastActivityAt ?? 0) <= at;
}

function dismissTab(wsId, tabId) {
  const w = wsById(wsId);
  const a = agentOfTab(w, tabById(wsId, tabId));
  if (!a) return;
  dismissed.set(a.panelId ?? a.id, a.lastActivityAt ?? now());
  setDismissTick(dismissTick() + 1);
}

// ── 탭 ──

// 첫 프롬프트가 제목일 때가 많아서 한 줄로 정리한다
function cleanTitle(s) {
  const raw = String(s || "");
  if (!raw) return "";
  // 제목은 잘 안 바뀌는데 이 정규식은 줄마다 매 초 돈다. 같은 데이터 동안은 한 번만 계산한다
  const memo = index().titles;
  const hit = memo.get(raw);
  if (hit !== undefined) return hit;
  // 작업 중일 때 제목 앞에 붙는 회전 표시(✳ ◐ ◓ 점자 스피너 등)를 떼어낸다
  const out = raw
    .replace(/^[✱-✿○-◓⠂-⣿·*\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  memo.set(raw, out);
  return out;
}

// 탭에 물려 있는 세션. cmux 는 탭의 id 를 세션의 panelId 로 들고 있다 (위 찾아보기 표 참고)
function agentOfTab(w, tab) {
  if (!w || !tab) return null;
  const m = index().agents;
  return m.get(w.id + "|" + tab.id) ?? (tab.surfaceId != null ? m.get(w.id + "|s|" + tab.surfaceId) : null) ?? null;
}

// 세션이 올라타 있는 탭
function tabOfAgent(w, a) {
  if (!w || !a) return null;
  const m = index().tabs;
  return (a.panelId != null ? m.get(w.id + "|" + a.panelId) : null) ?? (a.surfaceId != null ? m.get(w.id + "|s|" + a.surfaceId) : null) ?? null;
}

// /clear 로 비워진 세션인지. cmux 는 이 상태도 "입력 대기"로 넘기기 때문에 제목으로 가른다
// (첫 프롬프트가 없고, 탭 제목도 에이전트가 붙인 제목이 아니라 프로젝트·폴더 이름으로 돌아와 있다)
function blankSession(w, a) {
  if (a.title) return false;
  // 단, /clear 한 뒤에도 계속 쓰고 있는 탭이 여기 걸린다 — 제목은 안 붙었는데 멀쩡히 일하는 중이다.
  // 그래서 "제목이 없다"만으로는 안 보고, 조용해진 뒤에야 빈 세션으로 친다
  if (a.status === "working") return false;
  if (now() - (a.lastActivityAt ?? 0) < FRESH) return false;
  const t = cleanTitle(tabOfAgent(w, a)?.title);
  if (!t) return true;
  const dir = String(w.directory || "").split("/").filter(Boolean).pop();
  return t === w.title || t === dir || t === "Claude Code" || t === "Claude";
}

// 세션 하나의 상태: 입력 대기 / 작업 중 / 방금 끝남 / (없음)
function agentState(w, a) {
  if (!w || !a) return null;
  // 손으로 내린 줄은 다시 움직이기 전까지 상태 없음. 점도 프로젝트 아이콘도 같이 가라앉는다
  if (isDismissed(a)) return null;
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
  // 아이콘 셋이 각자 부르므로 같은 계산이 세 번 돈다. 데이터·시각·내려놓기가 그대로면 한 번만 한다
  const ix = index();
  if (!ix.states) ix.states = new Map();
  const key = w.id + "|" + now() + "|" + dismissTick();
  const memo = ix.states.get(key);
  if (memo !== undefined) return memo;
  let st = null;
  for (const a of w.agents ?? []) {
    const s = agentState(w, a);
    if (s === "waiting") {
      st = "waiting";
      break; // 가장 급한 상태라 더 볼 것 없다
    }
    if (s === "work") st = "work";
    else if (s === "done" && st !== "work") st = "done";
  }
  ix.states.set(key, st);
  return st;
}

// 탭 이름. 경로가 제목인 탭("~/workspace/kilog")은 폴더 이름만 남긴다.
// 사이드바가 좁아서 경로를 그대로 두면 앞부분만 보이고 정작 구분되는 뒷부분이 잘린다
function tabLabel(w, tab) {
  const t = cleanTitle(tab?.title);
  if (!t) return "터미널";
  if (t.includes(" ")) return t; // 띄어쓰기가 있으면 첫 프롬프트다. 그대로 둔다
  // 갓 연 터미널은 셸이 찍는 "사용자@호스트:~/경로" 가 제목이라 앞부분이 다 똑같다. 뒤 경로만 본다
  const path = t.split(":").pop();
  if (path.startsWith("~/") || path.startsWith("/")) return path.split("/").filter(Boolean).pop() || t;
  return t;
}

// 탭 이동. surface.focus 가 실제로 알아듣는 건 탭의 id 다.
// 프로젝트 id도 같이 넘겨서 지금 보고 있는 프로젝트가 아닌 곳의 탭도 찾게 한다.
function jumpTab(wsId, tabId) {
  cancelPending(); // 이 클릭 때문에 검색칸이 먼저 확정되며 잡아둔 예약을 물린다
  cmux("workspace.select", { workspace_id: wsId });
  if (tabId) cmux("surface.focus", { workspace_id: wsId, surface_id: tabId });
}

// 프로젝트 맨 뒤에 탭 하나 더.
// cmux 는 새 탭을 "지금 보고 있는 탭 바로 오른쪽"에 끼워 넣는다. 그래서 맨 뒤에 붙이려면
// 그 프로젝트의 마지막 탭을 먼저 띄워두고 만들어야 한다. 프로젝트 → 탭 순서를 지켜야
// 탭 선택이 먹는다 (jumpTab 과 같은 순서. 프로젝트를 먼저 고르지 않으면 surface.focus 가 무시된다).
// initial_input 은 새 셸에 그대로 입력되는 값이라, 실행까지 하려면 줄바꿈을 붙여야 한다
function addTab(wsId, input) {
  if (!wsId) return;
  cancelPending();
  const tabs = wsById(wsId)?.tabs ?? [];
  const last = tabs[tabs.length - 1];
  cmux("workspace.select", { workspace_id: wsId });
  // 두 번 부르는 건 실수가 아니다. 프로젝트를 막 고른 직후엔 cmux 가 "그 프로젝트에서 마지막에 보던 탭"을
  // 되살리면서 첫 번째 지정을 덮어쓴다. 한 번 더 불러야 우리가 고른 마지막 탭이 남는다
  if (last) {
    cmux("surface.focus", { workspace_id: wsId, surface_id: last.id });
    cmux("surface.focus", { workspace_id: wsId, surface_id: last.id });
  }
  const params = { workspace_id: wsId, type: "terminal", focus: true };
  if (input) params.initial_input = input + "\r";
  cmux("surface.create", params);
  // 접어둔 프로젝트에 넣었으면 방금 만든 탭이 보이도록 펴준다
  if (tabsClosed.delete(wsId)) setTabsTick(tabsTick() + 1);
  if (addingTo()) setAddingTo(null);
  if (picking()) endPick();
}

// 새 탭 메뉴. ws 는 대상 프로젝트 id 를 돌려주는 함수
function newTabMenu(ws) {
  return NEW_TABS.map(([label, input]) => Button(label, () => addTab(ws(), input)));
}

// 프로젝트를 마지막으로 만진 때. 고르기 목록에서 최근에 쓴 프로젝트를 위로 올리는 데 쓴다
function lastTouched(w) {
  let at = w?.latestAt ?? 0;
  for (const a of w?.agents ?? []) at = Math.max(at, a.lastActivityAt ?? 0);
  return at;
}

// 이름으로 프로젝트 거르기. 검색과 탭 넣을 곳 고르기가 같이 쓴다
function matchWs(ws, q) {
  if (!q) return ws;
  return ws.filter((w) => String(w.title ?? "").toLowerCase().includes(q));
}

// ── 목록 만들기 ────────────────────────────────────────────────────────

// 최근순: 프로젝트 묶음을 아예 버리고, 최근에 움직인 탭만 활동 순으로 쭉 세운다.
// 프로젝트로 묶으면 조용한 탭까지 프로젝트를 따라 딸려 올라와서 "최근"이라는 말이 무색해진다.
// 프로젝트 이름은 각 줄에 같이 적어서 어디 탭인지 알 수 있게 한다
function recentTabs(ws) {
  const t = now();
  const out = [];
  for (const w of ws) {
    for (const tab of w.tabs ?? []) {
      const a = agentOfTab(w, tab);
      const at = a?.lastActivityAt ?? 0;
      if (!at || t - at > RECENT) continue;
      // /clear 로 비워진 세션은 최근에 움직였어도 볼 게 없다 (상태 아이콘과 같은 기준)
      if (blankSession(w, a)) continue;
      // 손으로 내린 줄도 뺀다. 검색에는 그대로 나온다 — 찾아서 왔으면 보여주는 게 맞다
      if (isDismissed(a)) continue;
      out.push(tabEntry(w, tab, at));
    }
  }
  return out.sort((x, y) => y.at - x.at);
}

// 검색: 프로젝트가 아니라 탭 제목으로 찾는다. 결과도 최근순과 같은 모양의 탭 줄이다.
// (조용한 탭도 나와야 하므로 최근순과 달리 나이는 안 따진다)
function searchTabs(ws, q) {
  const out = [];
  for (const w of ws) {
    for (const tab of w.tabs ?? []) {
      if (!tabLabel(w, tab).toLowerCase().includes(q)) continue;
      out.push(tabEntry(w, tab, agentOfTab(w, tab)?.lastActivityAt ?? 0));
    }
  }
  return out.sort((x, y) => y.at - x.at);
}

function tabEntry(w, tab, at) {
  return { id: "rt:" + w.id + ":" + tab.id, kind: "recent", wsId: w.id, tabId: tab.id, at };
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

// 그룹의 대표 프로젝트(그룹 터미널)는 어느 목록에도 안 내놓는다.
// 닫으면 그룹이 통째로 사라져서 고를 일이 없게 한다
function pickableWs() {
  const anchors = new Set((data.groups() ?? []).map((g) => g.anchorId));
  return (data.workspaces() ?? []).filter((w) => !anchors.has(w.id));
}

// 탭을 넣을 프로젝트 고르기. 이름으로 거르고, 고르기를 연 순간의 순서(pickOrder)를 그대로 지킨다.
// 맨 위는 그때 막 일하던 프로젝트라 Enter 한 번이면 끝나고, 아래 줄들은 고르는 동안 움직이지 않는다
function pickTargets(ws, q) {
  return matchWs(ws, q)
    .map((w) => ({ id: "p:" + w.id, kind: "pick", wsId: w.id, rank: pickOrder.get(w.id) ?? 1e9 }))
    .sort((a, b) => a.rank - b.rank);
}

// 검색 결과 한 목록. 이름이 맞은 프로젝트는 줄 + 그 프로젝트의 탭을 통째로,
// 제목이 맞은 탭은 어느 프로젝트인지 적은 탭 줄로 뒤에 붙인다.
// 프로젝트가 이미 걸린 곳의 탭은 위에 다 나와 있으므로 다시 세우지 않는다
function searchRows(ws, q) {
  const hitWs = matchWs(ws, q);
  const hit = new Set(hitWs.map((w) => w.id));
  // 키를 "w:" 가 아니라 "s:" 로 두는 건, 줄을 끌 수 있는지가 키마다 한 번만 정해지기 때문이다.
  // 같은 키를 쓰면 그룹 보기에서 만들어진 "끌 수 있는 줄" 이 검색 결과에도 그대로 나온다
  const rows = hitWs.map((w) => ({ id: "s:" + w.id, kind: "ws", wsId: w.id, inGroup: false, groupId: null, drag: false }));
  return rows.concat(searchTabs(ws, q).filter((r) => !hit.has(r.wsId)));
}

// 프로젝트 줄 목록 + 각 프로젝트 바로 아래에 그 프로젝트의 탭 줄.
// 최근순과 검색 결과의 탭 줄은 프로젝트 줄 없이 홀로 선다
function projectList() {
  cleanupOldMarks();
  runPending();
  const all = data.workspaces() ?? [];
  const pickable = pickableWs();
  const q = query().trim().toLowerCase();

  // 탭 추가 중: 목록이 통째로 "어디에 넣을까" 고르는 화면이 된다
  if (picking()) {
    const rows = pickTargets(pickable, q);
    return rows.length ? rows : [{ id: "f:nopick", kind: "noproj" }];
  }
  // 검색 중에는 보기(그룹/최근순)와 상관없이 같은 결과를 준다
  let base;
  if (q) {
    base = searchRows(pickable, q);
    if (!base.length) return [{ id: "f:nohit", kind: "nohit" }];
  } else if (sortMode() === "recent") {
    const rows = recentTabs(pickable);
    return rows.length ? rows : [{ id: "f:quiet", kind: "quiet" }];
  } else {
    base = projectEntries(orderedWs(all));
  }

  // 프로젝트 줄 뒤에 탭을 끼워 넣는다. 탭 줄은 끌 수 없고, 소속 그룹은 프로젝트 줄을 따른다
  const out = [];
  for (const e of base) {
    out.push(e);
    // "+" 를 누른 프로젝트면 무슨 탭을 열지 고를 줄을 먼저 세운다. 탭을 접어놨어도 이건 보여준다
    if (e.kind === "ws" && addingTo() === e.wsId) {
      for (let i = 0; i < NEW_TABS.length; i++) {
        out.push({ id: "n:" + e.wsId + ":" + i, kind: "newtab", wsId: e.wsId, idx: i, inGroup: e.inGroup, groupId: e.groupId });
      }
    }
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
  cancelPending();
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
  if (sortMode() !== "group" || query().trim() || picking()) return;
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
    ...newTabMenu(() => w()?.id),
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

// 조건부 뷰가 없어서 ForEach 로 대신한다. 목록이 비면 안 그리고, 채워지면 새로 mount 된다.
// 새로 mount 된다는 게 핵심이다 — 입력칸에 커서를 보내는 방법이 따로 없어서,
// autofocus 를 단 칸은 "이때 뜬다"로만 커서를 받을 수 있다
// key 는 함수다. 돌려주는 값이 바뀌면 같은 자리라도 "다른 줄"이 되어 새로 mount 된다 (검색어 지우기가 이걸 쓴다)
function mountIf(on, key, build) {
  return ForEach({ items: () => (on() ? [key()] : []), key: (k) => k }, () => build());
}

// 맨 위: 검색 + 정렬 전환 (제목·버전 줄은 자리만 먹어서 뺐다. 버전은 CHANGELOG.md 로 확인한다)
// 검색칸은 평소 것과 "탭 넣을 곳 고르기" 것 둘 중 하나만 떠 있다.
// 하나를 두고 글자만 바꾸지 않는 건 커서 때문이다 — 뜰 때만 커서를 넣을 수 있다
function header() {
  return VStack({ spacing: 0 }, [
    Rectangle().fill("#00000000").frame({ height: 8 }),
    // 고를 탭 종류가 바뀌면 칸도 새로 뜬다 — 무엇을 만들 참인지는 여기 적히는 게 전부다
    mountIf(() => picking(), () => "pick:" + pickKind() + ":" + fieldTick(), () =>
      searchBox("어느 프로젝트에 " + pickItem()[0] + "?", true, (q) => {
        const hit = pickTargets(pickableWs(), q)[0];
        // 바로 열지 않고 예약만 한다 (위 pending 설명 참고)
        if (hit) pending = () => addTab(hit.wsId, pickItem()[1]);
      }),
    ),
    // 검색은 하나. Enter 는 맨 윗줄로 간다 — 프로젝트면 열고, 탭이면 그 탭으로.
    // (여기서도 바로 실행하지 않고 예약한다. 줄을 누르면 이 확정이 먼저 터지기 때문)
    mountIf(() => !picking(), () => "search:" + fieldTick(), () =>
      searchBox("프로젝트·탭 검색", false, (q) => {
        const hit = searchRows(pickableWs(), q)[0];
        if (!hit) return;
        pending = hit.kind === "ws"
          ? () => cmux("workspace.select", { workspace_id: hit.wsId })
          : () => jumpTab(hit.wsId, hit.tabId);
      }),
    ),
    // 정렬 전환: 그룹 / 최근순
    HStack({ spacing: 10 }, [
      sortTab("그룹", "group"),
      sortTab("최근순", "recent"),
      Spacer({ minLength: 0 }),
      newTabButton(),
      allTabsToggle(),
    ])
      .paddingHorizontal(14)
      .paddingTop(8)
      .paddingBottom(4)
      .frame({ maxWidth: "infinity" }),
  ]);
}

// submit 에는 다듬은 검색어가 들어온다 (빈 문자열이면 아무것도 안 한다).
// 첫 값으로 그 화면이 기억하고 있던 검색어를 넣는다 — 칸이 뜰 때 한 번만 읽히므로,
// 다른 보기에 갔다 돌아오면 치던 말이 그대로 다시 보인다
function searchBox(placeholder, autofocus, submit) {
  return HStack({ spacing: 6, alignment: "center" }, [
    Image("magnifyingglass").font(11).color("tertiary"),
    TextField(query(), {
      placeholder: placeholder,
      autofocus: autofocus,
      onEdit: (t) => setQuery(t ?? ""),
      // 이 "확정"은 Enter 만이 아니라 칸이 포커스를 잃을 때도 (= 목록의 줄을 누를 때도) 터진다.
      // 그래서 넘어오는 글자를 믿지 않고 우리가 들고 있는 검색어를 쓰고,
      // 빈 칸이면 아무것도 안 한다 — 안 그러면 줄 한 번 누른 게 "맨 윗줄 Enter"로 둔갑한다
      onSubmit: () => {
        const q = query().trim().toLowerCase();
        if (q) submit(q);
      },
      // Esc: 고르는 중이면 그만두고, 검색 중이면 검색어를 지운다
      onCancel: () => (picking() ? endPick() : clearQuery()),
    }).font(12),
    // 검색어 지우기. 친 게 없으면 자리만 지킨다 (나타났다 사라지면 글자 칸이 그만큼 흔들린다)
    Image("xmark.circle.fill")
      .font(11)
      .color("tertiary")
      .opacity(() => (query() ? 0.75 : 0))
      .onTap(() => {
        if (query()) clearQuery();
      }),
  ])
    .paddingLeading(10)
    // 오른쪽은 좁게. X 는 동그란 기호라 여백을 왼쪽과 똑같이 주면 저 혼자 안쪽으로 밀려 보인다
    .paddingTrailing(6)
    // 고정 높이는 적용이 안 돼서 위아래 패딩으로 박스를 키운다
    .paddingVertical(7)
    .frame({ maxWidth: "infinity", alignment: "leading" })
    .background("#7f7f7f1f")
    .cornerRadius(7)
    .paddingHorizontal(8);
}

// 보기를 바꾸면 고르기는 그만둔다. 검색어는 그대로 둔다 —
// 검색 중에는 두 보기가 같은 결과를 주므로 치던 말을 지울 이유가 없다
function sortTab(label, mode) {
  return Text(label)
    .font(11)
    .weight(() => (sortMode() === mode ? "semibold" : "regular"))
    .color(() => (!picking() && sortMode() === mode ? "primary" : "tertiary"))
    .onTap(() => {
      cancelPending();
      if (picking()) endPick();
      setAddingTo(null);
      setSortMode(mode);
    });
}

// 새 탭. 누르면 목록이 "어느 프로젝트에 넣을까" 고르는 화면으로 바뀌고, 검색칸에 커서가 간다.
// 한 번 더 누르면 그만둔다.
// 그냥 누르면 PLUS_TAB (기본 Claude 터미널), option 을 누른 채로는 빈 터미널.
// 버튼을 둘로 늘리지 않은 건 머리글 폭 때문이다 — 옆의 "탭 접기"가 두 줄로 접힌다.
// 우클릭은 고르기를 건너뛰고 지금 프로젝트에 바로 넣는 길
function newTabButton() {
  // 누름 정보에 수식키가 어떤 이름으로 실려오는지는 문서에 없다 (공식 예제는 cmd·shift 만 쓴다).
  // 그래서 있을 법한 이름을 다 본다 — 못 알아보면 그냥 기본(Claude)으로 열릴 뿐이다
  const plain = (p) => {
    if (!p) return false;
    if (p.option || p.alt || p.opt) return true;
    const mods = p.modifiers;
    if (Array.isArray(mods)) return mods.some((m) => /^(opt|alt)/i.test(String(m)));
    if (typeof mods === "string") return /opt|alt/i.test(mods);
    return false;
  };
  return Image("plus")
    .font(10)
    .weight("semibold")
    .color(() => (picking() ? "primary" : "tertiary"))
    .frame({ width: 15, height: 15 })
    .cornerRadius(8)
    .background(() => (picking() ? "#7f7f7f4a" : null))
    .hoverBackground("#7f7f7f4a")
    .onTap((p) => (picking() ? endPick() : startPick(plain(p) ? PLAIN_TAB : PLUS_TAB)))
    .contextMenu(newTabMenu(() => currentWs()?.id));
}

// 지금 보고 있는 프로젝트. "+" 우클릭 메뉴가 쓴다
const currentWs = () => (data.workspaces() ?? []).find((w) => w.selected) ?? null;

// 탭 목록 전체 접기/펼치기. 하나라도 펼쳐져 있으면 전부 접고, 다 접혀 있으면 전부 편다
function allTabsToggle() {
  const anyOpen = () => {
    tabsTick();
    return (data.workspaces() ?? []).some((w) => (w.tabs ?? []).length > 0 && !tabsClosed.has(w.id));
  };
  // 최근순과 고르는 중에는 프로젝트 줄 자체가 없어서 접을 것도 없다
  return Text(() => (sortMode() !== "group" || picking() ? "" : anyOpen() ? "탭 접기" : "탭 펼치기"))
    .font(11)
    .color("tertiary")
    .onTap(() => {
      if (sortMode() !== "group") return;
      if (anyOpen()) for (const w of data.workspaces() ?? []) tabsClosed.add(w.id);
      else tabsClosed.clear();
      setTabsTick(tabsTick() + 1);
    });
}

function noHit() {
  return Text("맞는 프로젝트·탭이 없어요").font(12).color("tertiary").paddingHorizontal(14).paddingVertical(6).fixed();
}

function quiet() {
  return Text("최근에 움직인 탭이 없어요").font(12).color("tertiary").paddingHorizontal(14).paddingVertical(6).fixed();
}

function noProject() {
  return Text("맞는 프로젝트가 없어요").font(12).color("tertiary").paddingHorizontal(14).paddingVertical(6).fixed();
}

// 탭을 넣을 프로젝트 한 줄: 색 점 · 이름 · 지금 탭 수.
// 누르면 그 프로젝트 맨 뒤에, 아까 "+" 에서 고른 종류로 탭이 생긴다 (우클릭하면 다른 종류로도)
function pickRow(e) {
  // 이 템플릿은 이 줄 전용으로 한 번만 만들어지므로, 대상 프로젝트는 지금 붙잡아 둔다.
  // 누를 때 목록에서 다시 꺼내면 그 사이 목록이 바뀌었을 때 엉뚱한 줄을 집는다
  const target = e().wsId;
  const w = () => wsById(e().wsId);
  const n = () => (w()?.tabs ?? []).length;
  return HStack({ spacing: 6 }, [
    Circle({ size: 7 }).fill(() => colorOf(w())),
    Text(() => w()?.title ?? "")
      .font(13)
      .lineLimit(1)
      .truncation("tail")
      .marquee()
      .color("primary"),
    Spacer({ minLength: 0 }),
    Text(() => (n() > 0 ? "탭 " + n() : "탭 없음")).font(10).color("tertiary"),
  ])
    .paddingHorizontal(10)
    .paddingVertical(5)
    .cornerRadius(8)
    .hoverBackground("#7f7f7f24")
    .frame({ maxWidth: "infinity" })
    .fixed()
    .onTap(() => {
      cancelPending(); // 이 클릭 때문에 검색칸이 먼저 확정되며 잡아둔 예약을 물린다
      addTab(target, pickItem()[1]);
    })
    .contextMenu(newTabMenu(() => target));
}

function stateLabel(s) {
  return s === "waiting" ? "입력 대기" : s === "work" ? "작업 중" : s === "done" ? "완료" : "";
}

// 최근순 한 줄: 탭 이름 + 그 아래 어느 프로젝트인지 + 오른쪽에 상태·경과 시간.
// 위에 프로젝트 줄이 없으므로 소속을 줄 안에서 밝힌다
function recentRow(e) {
  const w = () => wsById(e().wsId);
  const tab = () => tabById(e().wsId, e().tabId);
  const state = () => agentState(w(), agentOfTab(w(), tab()));
  const active = () => Boolean(w()?.selected && tab()?.focused);
  const tone = () => (state() ? TONE[state()] : null);

  return HStack({ spacing: 8 }, [
    VStack({ spacing: 0 }, [
      HStack({ spacing: 0 }, [
        Text(() => tabLabel(w(), tab()))
          .font(13)
          .lineLimit(1)
          .truncation("tail")
          .marquee()
          .color(() => (active() ? "primary" : "secondary")),
        Spacer({ minLength: 0 }),
      ]).frame({ maxWidth: "infinity" }),
      HStack({ spacing: 5 }, [
        Circle({ size: 6 }).fill(() => colorOf(w())),
        Text(() => w()?.title ?? "").font(11).lineLimit(1).truncation("tail").color("tertiary"),
        Spacer({ minLength: 0 }),
      ])
        .paddingTop(2)
        .frame({ maxWidth: "infinity" }),
    ]).frame({ maxWidth: "infinity" }),
    // 상태·시간 자리를 X 와 나눠 쓴다. 마우스를 올리면 X 로 바뀌므로 줄 폭은 그대로다.
    // 오른쪽 정렬로 두는 건, 이 자리의 폭은 "입력 대기" 같은 긴 글자가 정하기 때문이다 —
    // 가운데 두면 X 혼자 글자 한복판까지 밀려 들어온다
    ZStack({ alignment: "trailing" }, [
      VStack({ spacing: 1, alignment: "trailing" }, [
        Text(() => stateLabel(state())).font(9).weight("semibold").color(() => tone() ?? "tertiary"),
        // 검색 결과에는 한 번도 안 돌아본 탭도 섞여 있다. 활동 기록이 없으면 시간은 비워둔다
        Text(() => (e().at ? ago(now() - e().at) : "")).font(10).color(() => tone() ?? "tertiary").opacity(0.85),
      ]).hideOnHover(),
      // 목록에서 내리기. 탭을 닫는 게 아니라 "봤다" 표시다 — 다시 움직이면 알아서 돌아온다
      Image("xmark")
        .font(9)
        .weight("semibold")
        .color("secondary")
        .padding(3)
        .cornerRadius(9)
        .hoverBackground("#7f7f7f4a")
        .showOnHover()
        .onTap(() => dismissTab(e().wsId, e().tabId)),
    ]).fixed(),
  ])
    .paddingHorizontal(10)
    .paddingVertical(5)
    .cornerRadius(8)
    .background(() => (active() ? "#7f7f7f3d" : null))
    .hoverBackground(() => (active() ? "#7f7f7f3d" : "#7f7f7f24"))
    .frame({ maxWidth: "infinity" })
    .fixed()
    .onTap(() => jumpTab(e().wsId, e().tabId))
    .contextMenu([
      Button("목록에서 내리기", () => dismissTab(e().wsId, e().tabId)),
      Button("탭 닫기", () => cmux("surface.close", { workspace_id: e().wsId, surface_id: e().tabId })).destructive(),
      Divider(),
      // 검색·최근순에는 프로젝트 줄이 없으니, 같은 프로젝트에 탭을 더할 길을 탭 줄에 둔다
      ...newTabMenu(() => e().wsId),
    ]);
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
    // 오른쪽 끝 한 자리를 둘이 나눠 쓴다: 평소엔 접힘 화살표, 줄에 마우스를 올리면 "+".
    // 한 자리에 겹쳐 두는 건 폭 때문이다 — 둘을 나란히 두면 그만큼 프로젝트·탭 이름이 잘린다.
    // 화살표를 왼쪽으로 옮기지 않는 이유도 같다
    ZStack({}, [
      Image("chevron.right")
        .font(8)
        .weight("semibold")
        .color("tertiary")
        .rotation(() => (tabsOpen(e().wsId) ? 90 : 0))
        .frame({ width: 10, height: 12 })
        .opacity(() => (tabCount() > 0 ? 0.6 : 0))
        .hideOnHover(),
      // 누르면 이 줄 아래에 "그냥 터미널 / Claude" 고를 줄이 펼쳐진다. 한 번 더 누르면 접힌다.
      // 우클릭하면 같은 항목이 메뉴로 나온다 (줄 자체의 우클릭 메뉴에도 있다)
      Image("plus")
        .font(10)
        .weight("semibold")
        .color(() => (addingTo() === e().wsId ? "primary" : "secondary"))
        .frame({ width: 15, height: 15 })
        .cornerRadius(8)
        .background(() => (addingTo() === e().wsId ? "#7f7f7f4a" : null))
        .hoverBackground("#7f7f7f4a")
        .showOnHover()
        .onTap(() => setAddingTo(addingTo() === e().wsId ? null : e().wsId))
        .contextMenu(newTabMenu(() => e().wsId)),
    ]),
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
      // 고르는 중이었으면 먼저 그것부터 접는다. 접기와 한꺼번에 일어나면 뭘 누른 건지 알기 어렵다
      if (addingTo()) setAddingTo(null);
      else if (tabCount() > 0) toggleTabs(e().wsId);
    })
    .contextMenu(projectMenu(w));
}

// "+" 를 누르면 프로젝트 줄 아래에 잠깐 서는 줄: 무슨 탭을 열지 고른다.
// 탭 줄과 같은 들여쓰기·크기로 두어서 "이 프로젝트에 붙는 것"으로 읽히게 한다
function newTabRow(e) {
  const item = () => NEW_TABS[e().idx] ?? ["", null];
  return HStack({ spacing: 6 }, [
    Image("plus").font(9).weight("semibold").color("tertiary").frame({ width: 5, height: 12 }),
    Text(() => item()[0]).font(12).lineLimit(1).truncation("tail").color("secondary"),
    Spacer({ minLength: 0 }),
  ])
    .paddingLeading(6)
    .paddingTrailing(8)
    .paddingVertical(3)
    .marginLeading(() => (e().inGroup ? 20 : 12))
    .cornerRadius(7)
    .background("#7f7f7f14")
    .hoverBackground("#7f7f7f33")
    .frame({ maxWidth: "infinity" })
    .fixed()
    .onTap(() => {
      cancelPending();
      setAddingTo(null);
      addTab(e().wsId, item()[1]);
    });
}

// 탭 한 줄: 상태 점 · 탭 이름 · (일하는 중이면) 경과 시간
// 프로젝트 줄보다 한 단 더 들여쓰고 글자도 작게 해서 소속이 눈에 들어오게 한다
function tabRow(e) {
  const w = () => wsById(e().wsId);
  const tab = () => tabById(e().wsId, e().tabId);
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
    .onTap(() => jumpTab(e().wsId, e().tabId))
    // 이 탭이 속한 프로젝트에 탭 하나 더 (프로젝트 줄까지 올라가지 않아도 되게)
    .contextMenu(newTabMenu(() => e().wsId));
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
          if (kind === "newtab") return newTabRow(e);
          if (kind === "recent") return recentRow(e);
          if (kind === "pick") return pickRow(e);
          if (kind === "nohit") return noHit();
          if (kind === "noproj") return noProject();
          if (kind === "quiet") return quiet();
          return projectRow(e);
        },
      ),
    ]),
  { surface: "glass" },
);
