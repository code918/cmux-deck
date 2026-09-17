# Deck

A custom sidebar for [cmux](https://github.com/manaflow-ai/cmux) that shows every AI coding session across all your projects, and which one needs you next.

![Deck screenshot](docs/screenshot.png)

If you run several Claude Code / Codex sessions per project in cmux tabs, it gets hard to tell which session is waiting on you, which one just finished, and which one is still working. Deck puts that at the top of the left sidebar, and keeps your normal project list right below it.

> The UI labels are in Korean for now. See [한국어](#한국어) below.

## Features

- **Session list, most urgent first.** Waiting for input (orange) → just finished (green) → working (blue). Each row shows what the session is doing (from the tab title), the project, its state, and how long it has been in that state. Click a row to jump straight to that tab.
- **Fixed height.** The session area always takes the same number of rows (default 5), so the project list below doesn't jump around as sessions change state. Overflow collapses into "+N more".
- **Park for later.** Hover a row and hit *대기* to move it into a collapsed section. It stays there even after you open it, survives cmux restarts, and comes back once that session starts working again.
- **Seen sessions step aside.** Open a session that needs you, move on, and it drops off the list until it needs you again.
- **Project list with groups.** Same grouping, collapse, and pin order as the built-in cmux sidebar, plus a state icon per project (⚡ working, ! waiting, ✓ done) and the unread badge.
- **Search.** Filter projects by name as you type. Press Enter to jump to the first match.

## Install

Requires a cmux build with custom sidebars (the `.js` runtime).

```sh
git clone https://github.com/code918/cmux-deck.git
cd cmux-deck
./install.sh
```

Then right-click the sidebar toggle button in cmux and pick **deck**, or run:

```sh
cmux sidebar select deck
```

`install.sh` symlinks `deck.js` into `~/.config/cmux/sidebars/`, so `git pull` updates the sidebar in place. If you'd rather not use a symlink, copy `deck.js` there yourself.

To go back to the built-in sidebar, right-click the sidebar toggle button and pick the default.

## Configuration

Edit the constants at the top of `deck.js`. cmux hot-reloads the file on save.

| Constant | Default | Meaning |
| --- | --- | --- |
| `SLOTS` | `5` | Number of rows reserved for sessions |
| `FRESH` | `180` | Seconds a finished session stays in the list as "done" |
| `TONE` | | Colors for each state |

## Limitations

- **Uses the project description field for storage.** Custom sidebars have no storage, so parked and seen sessions are saved as a small `⟦deck …⟧` tag at the end of each project's description. Deck hides it, but the built-in sidebar may show it.
- **No approve / deny buttons.** The sidebar data doesn't expose permission request IDs. Use cmux's Feed panel (`Ctrl-4`) or the notification buttons for that.
- **"Waiting for input" is broad.** Claude Code also sends that signal about a minute after it finishes, so a finished session shows as green only briefly and then as waiting.
- No drag-to-reorder or rename in the project list. Switch to the built-in sidebar for those.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

The group list and collapse logic is based on the official cmux example `Examples/CustomSidebars/workspaces.js` (GPL-3.0-or-later, Copyright (c) Manaflow, Inc.).

---

## 한국어

cmux 왼쪽 사이드바를 **프로젝트별 AI 세션 상황판**으로 바꿔주는 커스텀 사이드바예요. 어떤 세션이 나를 기다리는지, 방금 끝났는지, 아직 돌아가는지를 맨 위에서 보고, 그 아래에서 평소처럼 프로젝트를 고를 수 있어요.

- **세션 칸**: 입력 대기(주황) → 완료(초록) → 작업 중(파랑) 순서. 누르면 그 탭으로 이동.
- **칸 높이 고정**: 세션이 바뀌어도 아래 프로젝트 목록이 흔들리지 않아요.
- **대기**: 줄에 마우스를 올리고 [대기]. 열어봐도 그대로 남고, 그 세션이 다시 일을 시작하면 빠져요.
- **본 세션은 내려감**: 확인 필요 세션을 열어봤다가 넘어가면 목록에서 내려가요.
- **프로젝트 목록**: 기본 사이드바와 같은 그룹, 접기, 고정 순서. 상태 아이콘과 안 읽은 알림 수.
- **검색**: 이름으로 바로 거르기. Enter로 첫 결과 이동.

설치는 `./install.sh` 후 사이드바 버튼 우클릭 → **deck**.
