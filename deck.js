// SPDX-License-Identifier: GPL-3.0-or-later
//
// Deck — cmux 커스텀 사이드바. 프로젝트별 AI 코딩 세션 상황판.
//
//   세션 칸   : 확인이 필요한 세션과 돌아가는 세션을 급한 순서로 (칸 높이 고정)
//               입력 대기(주황) → 완료(초록) → 작업 중(파랑)
//   나중에    : 확인하고 미뤄둔 세션. 그 세션이 다시 움직이면 알아서 빠진다
//   프로젝트  : 기본 사이드바와 같은 그룹 목록 + 이름 검색 + 상태 아이콘
// 줄을 누르면 그 프로젝트의 그 탭으로 바로 이동한다.
//
// 설치: ./install.sh  (또는 이 파일을 ~/.config/cmux/sidebars/deck.js 로 복사)
// 열기: 사이드바 버튼 우클릭 → deck
//
// 주의: 사이드바에는 저장 공간이 없어서 "나중에" 목록은 cmux를 재시작하면 비워진다.
//
// 그룹 목록·접기 로직은 cmux 공식 예제(Examples/CustomSidebars/workspaces.js,
// GPL-3.0-or-later, Copyright (c) Manaflow, Inc.)를 바탕으로 했다.

const TONE = {
  waiting: "#FF8A5B",
  done: "#5AD1A0",
  work: "#5AA8FF",
  later: "#8B94A3",
};
// 끝난 세션을 "완료"로 보여주는 시간 (초). cmux 재시작 때 활동 시각이 한꺼번에 찍혀서 길게 잡으면 전부 올라온다
const FRESH = 3 * 60;
// 세션 칸 줄 수. 세션이 적어도 이만큼 자리를 잡아서 아래 프로젝트 목록이 위아래로 흔들리지 않게 한다
const SLOTS = 5;

const now = () => data.clock()?.epoch ?? 0;

// ── 나중에 ──
// 미룬 세션 id → 미룰 당시의 마지막 활동 시각. 그 뒤로 활동이 생기면 목록에서 뺀다
const deferred = new Map();
const [deferTick, setDeferTick] = signal(0);
const [laterOpen, setLaterOpen] = signal(false);

function defer(r) {
  deferred.set(r.agentId, r.at);
  setDeferTick(deferTick() + 1);
}
function undefer(r) {
  deferred.delete(r.agentId);
  setDeferTick(deferTick() + 1);
}

// ── 프로젝트 검색 ──
const [query, setQuery] = signal("");

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

// 워크스페이스 → 세션 칸 + 나중에 + 프로젝트 목록을 한 줄로 펼친 평면 배열
function entries() {
  const t = now();
  deferTick();
  const groups = { check: [], work: [], later: [] };
  const alive = new Set();

  for (const w of data.workspaces() ?? []) {
    const li = latestIdle(w);
    for (const a of w.agents ?? []) {
      alive.add(a.id);
      let b = bucket(w, a, t, li);
      if (deferred.has(a.id)) {
        // 미룬 뒤에 세션이 다시 움직였으면(새 활동·작업 시작·종료) 나중에 목록에서 뺀다
        const movedOn = (a.lastActivityAt ?? 0) > deferred.get(a.id) || a.status === "working" || a.status === "ended";
        if (movedOn) deferred.delete(a.id);
        else b = "later";
      }
      if (!b) continue;
      groups[b].push({
        id: (b === "later" ? "l:" : "s:") + a.id,
        kind: b === "later" ? "later" : "row",
        agentId: a.id,
        bucket: b,
        waiting: a.status === "needs_input",
        label: sessionLabel(w, a),
        project: w.title,
        color: w.color || "#7f7f7f",
        surfaceId: a.surfaceId,
        workspaceId: w.id,
        since: a.sinceEpoch ?? a.lastActivityAt ?? t,
        at: a.lastActivityAt ?? 0,
      });
    }
  }
  // 사라진 세션은 미룬 목록에서도 정리
  for (const id of Array.from(deferred.keys())) if (!alive.has(id)) deferred.delete(id);

  const out = [];
  // 섹션 제목 없이 한 목록에 급한 순서로: 멈춰 기다림 → 끝남 → 작업 중
  const order = (r) => (r.bucket === "check" ? (r.waiting ? 0 : 1) : 2);
  const list = groups.check.concat(groups.work).sort((x, y) => order(x) - order(y) || y.at - x.at);
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
  // 나중에: 접어두는 게 기본. 머리글만 보이고 누르면 펼친다
  const later = groups.later.sort((x, y) => y.at - x.at);
  // 0개여도 머리글은 남겨서 높이가 안 바뀌게 한다 (펼치기는 내가 누를 때만 높이가 바뀐다)
  out.push({ id: "h:later", kind: "laterHeader", bucket: "later", count: later.length });
  if (laterOpen()) for (const r of later) out.push(r);

  // 왼쪽 사이드바를 대체하므로 프로젝트 목록도 여기서 보여준다.
  // 기본 사이드바와 같은 규칙: 그룹은 대표 프로젝트 자리에 머리글로, 접힌 그룹은 머리글만, 고정한 건 맨 위
  const all = data.workspaces() ?? [];
  out.push({ id: "h:projects", kind: "projects" });
  const q = query().trim().toLowerCase();
  if (q) {
    const hits = all.filter((w) => (w.title || "").toLowerCase().includes(q));
    for (const w of hits) out.push({ id: "w:" + w.id, kind: "ws", wsId: w.id, inGroup: false });
    if (hits.length === 0) out.push({ id: "f:nohit", kind: "nohit" });
  } else {
    for (const p of projectEntries(all)) out.push(p);
  }
  return out;
}

// 첫 프롬프트가 제목일 때가 많아서 한 줄로 정리한다
function cleanTitle(s) {
  return String(s || "").replace(/^[✳✽✻·*\s]+/, "").replace(/\s+/g, " ").trim();
}

function ago(sec) {
  if (sec < 60) return "방금";
  if (sec < 3600) return Math.floor(sec / 60) + "분";
  if (sec < 86400) return Math.floor(sec / 3600) + "시간";
  return Math.floor(sec / 86400) + "일";
}

function counts() {
  const c = { check: 0, work: 0, later: 0 };
  for (const e of entries()) {
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
  if (r.bucket === "later") return "나중에";
  if (r.bucket === "work") return "작업 중";
  return r.waiting ? "입력 대기" : "완료";
}

function rowTone(r) {
  if (r.bucket === "later") return TONE.later;
  if (r.bucket === "work") return TONE.work;
  return r.waiting ? TONE.waiting : TONE.done;
}

function jump(r) {
  cmux("workspace.select", { workspace_id: r.workspaceId });
  if (r.surfaceId) cmux("surface.focus", { surface_id: r.surfaceId });
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
          .color(() => (e().kind === "later" ? "secondary" : "primary")),
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
    // 작업 중인 세션은 미룰 이유가 없어서 확인 필요에만 버튼을 단다
    hoverButton("나중에", () => defer(e())).opacity(() => (e().bucket === "check" ? 1 : 0)),
  ])
    .paddingHorizontal(10)
    .paddingVertical(6)
    .cornerRadius(8)
    // 멈춰서 기다리는 줄만 은은하게 칠해서 눈에 먼저 들어오게
    .background(() => (e().waiting ? "#FF8A5B1F" : null))
    .hoverBackground(() => (e().waiting ? "#FF8A5B33" : "#7f7f7f24"))
    .frame({ maxWidth: "infinity" })
    .onTap(() => jump(e()))
    .contextMenu([
      Button("나중에 보기", () => defer(e())),
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
      Text("나중에").font(11).weight("semibold").color(TONE.later),
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
          const hit = (data.workspaces() ?? []).find((w) => (w.title || "").toLowerCase().includes(q));
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
    Rectangle().fill("#00000000").frame({ height: 4 }),
  ]);
}

function noHit() {
  return Text("맞는 프로젝트가 없어요").font(12).color("tertiary").paddingHorizontal(14).paddingVertical(6);
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

// 워크스페이스 배열 → 그룹 머리글 + 멤버 줄
function projectEntries(ws) {
  collapseTick();
  const groups = new Map((data.groups() ?? []).map((g) => [g.id, g]));
  const section = (g) => {
    const rows = [{ id: "g:" + g.id, kind: "group", groupId: g.id }];
    if (!isCollapsed(g)) {
      for (const m of ws) {
        // 대표 프로젝트는 머리글이 대신하므로 줄로 다시 안 그린다
        if (m.group === g.id && m.id !== g.anchorId) rows.push({ id: "w:" + m.id, kind: "ws", wsId: m.id, inGroup: true });
      }
    }
    return rows;
  };

  const pinned = [];
  const rest = [];
  const seen = new Set();
  for (const w of ws) {
    if (w.group && groups.has(w.group)) {
      const g = groups.get(w.group);
      const isAnchor = w.id === g.anchorId || !ws.some((x) => x.id === g.anchorId);
      if (seen.has(g.id) || !isAnchor) continue;
      seen.add(g.id);
      (g.pinned ? pinned : rest).push(...section(g));
    } else if (!w.group) {
      (w.pinned ? pinned : rest).push({ id: "w:" + w.id, kind: "ws", wsId: w.id, inGroup: false });
    }
  }
  for (const g of groups.values()) {
    if (!seen.has(g.id) && ws.some((x) => x.group === g.id)) (g.pinned ? pinned : rest).push(...section(g));
  }
  return [...pinned, ...rest];
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

// 그룹 머리글: 화살표는 접기/펴기, 나머지를 누르면 대표 프로젝트로 이동
function groupRow(e) {
  const g = () => groupById(e().groupId) ?? { id: e().groupId, name: "", collapsed: false };
  const anchor = () => wsById(g().anchorId);
  return HStack({ spacing: 6 }, [
    Image("chevron.right")
      .font(10)
      .weight("semibold")
      .color("tertiary")
      .rotation(() => (isCollapsed(g()) ? 0 : 90))
      .frame({ width: 14, height: 16 })
      .onTap(() => toggleCollapse(g())),
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
    .onTap(() => {
      const a = anchor();
      if (a) cmux("workspace.select", { workspace_id: a.id });
    });
}

// 프로젝트 한 줄: 색 점 · 이름 · 안 읽은 알림 수. 그룹 안이면 들여쓴다
function projectRow(e) {
  const w = () => wsById(e().wsId);
  return HStack({ spacing: 8 }, [
    Circle({ size: 7 }).fill(() => w()?.color || "#7f7f7f"),
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
    .frame({ maxWidth: "infinity" })
    .onTap(() => cmux("workspace.select", { workspace_id: e().wsId }));
}

// ── 루트 ───────────────────────────────────────────────────────────────
sidebar(
  () =>
    VStack({ spacing: 2 }, [
      summary(),
      Divider(),
      Rectangle().fill("#00000000").frame({ height: 4 }),
      ForEach(
        { items: entries, key: (e) => e.id },
        (e) => {
          // key 접두사로 줄 종류가 고정되므로 템플릿을 한 번만 고르면 된다
          const kind = e().kind;
          if (kind === "more") return more(e);
          if (kind === "slot") return slot();
          if (kind === "projects") return projectsHeader(e);
          if (kind === "group") return groupRow(e);
          if (kind === "ws") return projectRow(e);
          if (kind === "nohit") return noHit();
          if (kind === "later") return laterRow(e);
          if (kind === "laterHeader") return laterHeader(e);
          return row(e);
        },
      ),
    ]),
  { surface: "glass" },
);
