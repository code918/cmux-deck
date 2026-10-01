# Changelog

Versions follow [Semantic Versioning](https://semver.org/). While Deck is 0.x, a minor bump (0.2 → 0.3) may change behavior or labels.

## 0.5.0 — 2026-10-01

### Added
- **_세션_: every tab with Claude running right now.** A third view next to *그룹* and *최근순* lists only the tabs whose Claude session is still open, most recently active first — the same rows as *최근순*, but nothing that has exited and no age cutoff. Rows you put down with **X** still show here: this view answers "what is open", not "what is new". A session counts as open when cmux hasn't marked it ended and it carries a process id; cmux sometimes revives old sessions after a restart as empty records with no process, and those are left out.
- **New group from a project.** Right-click a project → *새 그룹으로 묶기* makes a group named after that project with the project inside it. Drag other projects in as usual. cmux creates the group's own terminal alongside, which Deck keeps hidden as before.
- **Rename a group.** Right-click a group header → *그룹 이름 바꾸기*: the search box turns into a name field holding the current name. Enter saves, Esc cancels. Clicking elsewhere also saves — the field treats losing focus as Enter.
- **`scripts/end-dead-sessions.py`.** When Claude dies without saying goodbye (a crash, a kill), cmux keeps the session as running and it lingers in *세션*. The script finds sessions whose process is gone and tells cmux they ended. Run it by hand, or put it on a timer. `--dry-run` lists without changing anything.

### Fixed
- Sort-row labels (*최근순*, *탭 접기*) no longer wrap onto two lines when the row gets tight.

## 0.4.0 — 2026-09-23

### Added
- **Add a tab from the sidebar, to any project.** The **+** in the sort row turns the whole list into a project picker with the cursor already in the search box: type a few letters, press Enter (or click a row), and a Claude terminal opens at the **end** of that project's tabs, focused. Right-click the **+** to place a plain shell instead. Enter on an empty box takes the top row — the project you were last in — so the common case is two keystrokes. **+** again or Esc backs out.
- **A + on each project row too.** Hover a project and its collapse chevron turns into a **+**, which opens a tab in that project straight away — for when the project is already on screen and you don't want to search for it.
- **Open the tab straight into an agent.** Right-click the sort-row **+**, a project row, a picker row, or any tab row: *새 탭*, *새 탭 + Claude*. The command is typed into the new terminal as it spawns, so the shell stays yours after the agent exits. Edit `NEW_TABS` at the top of `deck.js` to add your own, and `PLUS_TAB` to choose what a plain click on **+** opens.

- **An X to put a row down.** Hover a row in *최근순* (or a tab search result) and its state/elapsed column turns into an **X**: it doesn't close the tab, it marks the row as seen. The row leaves *최근순* and its dot goes quiet — until that tab moves again, at which point it comes back on its own. This is the way out of the case no heuristic catches: a session you `/clear`ed keeps its old title and its "just finished" timestamp, so it sits at the top of the list looking like news. Right-click gives the same thing as *목록에서 내리기*, plus *탭 닫기* for when you did mean to close it. Custom sidebars have no storage, so a cmux restart forgets what you put down.
- **An X to clear the search.** It shows up in the search box once there is something to clear; Esc does the same.

### Removed
- **Guessing which sessions are empty.** 0.2 and 0.3 tried to spot a `/clear`ed session by its title (no first prompt, tab still named after the folder) and hide it from *최근순* and from the state dots. A session you clear and then keep working in looks exactly the same from the outside, so the guess hid tabs that were very much alive — including, reliably, the one you were typing in. The guess is gone; put rows down with the **X** instead.

### Changed
- **One search covers projects and tabs.** Typing matches project names and tab titles together and returns a single list — each matching project with its tabs under it, then tabs that matched by title, each naming its project — the same in either view. You don't have to remember whether what you are looking for was a project name or something you typed into a tab. The group sections are dropped while you type: with three hits left, the section rules were longer than the list. Enter takes the top row, opening a project or jumping to a tab.
- **Search survives the wrong keyboard layout.** Type `gopte` with the IME still in Korean and you get `해ㅔㅅㄷ`; type `운며들다` with it still in English and you get `dnsauemfek`. Both now find what you meant: the query and every name are compared as the keys you actually pressed (2-set Hangul layout), so either mistake matches.
- **Faster list.** Every row used to scan the whole project array once per binding per second — with 47 projects and 73 tabs that is tens of thousands of comparisons a second, and the state icon computed the same answer three times per project. Lookups now go through an index rebuilt once per data update, title cleanup is cached, and a project's state is computed once per tick.
- A tab whose title is still the shell's own (`user@host:~/workspace/kilog`, which is what a tab shows until an agent renames it) is listed by its folder name, like a path title already was.

## 0.3.0 — 2026-09-22

A different sidebar: instead of ranking sessions across projects, Deck now shows the tab tree — search on top, projects grouped below, and every tab of a project listed right under it. If you keep many tabs open, this is the list you were looking for.

### Added
- **Tabs under each project.** Every open tab is a row under its project, in tab order. The dot on the left is that tab's session state (orange: waiting for input, blue: working, green: just finished), and the time on the right is how long it has been in that state. Click a row to jump to that tab.
- Collapse a project's tabs with the ▸ chevron on its row (or right-click → *탭 목록 접기*). Collapsed projects show their tab count instead. *탭 접기* / *탭 펼치기* on the right of the sort row does all projects at once.

### Fixed
- **Tabs you left yesterday no longer claim to be waiting for you.** Claude Code keeps its "needs input" signal on after a session is done, and cmux doesn't count `/clear` as activity, so every tab left open overnight came back orange with its stale timestamp ("입력 대기 · 1일") even though nothing was actually waiting. A needs-input signal now only counts as urgent while it is fresh; past `STALE` (default one hour) the tab goes quiet. Neither `agent.title` nor `lastActivityAt` could tell the two apart — `title` is empty even for a session that is actively working.

### Removed
- The session panel at the top — the urgency-ordered list, *나중에 확인*, *확인함*, the *+N개 더* line, the fixed 8-row height, and the *확인 n · 작업 n* counters. Tab state now lives on the tab rows themselves.
- The title and version line at the top. The running version is in `deck.js` and this file.
- The marks Deck used to write into project descriptions (`⟦deck …⟧`) are cleaned up automatically the first time 0.3 loads. Descriptions you wrote yourself are left alone.

### Changed
- The project list opens in *그룹* order by default (it was *최근순*).
- **Search matches tab titles, not project names.** Results come back as tab rows — the tab title, the project it belongs to, and its state — most recently active first, and Enter jumps to the top one. Unlike *최근순*, search doesn't filter by age: if you are looking for a tab, how long it has been quiet shouldn't hide it.
- **_최근순_ drops the project grouping entirely and lists tabs.** Grouping by project meant one busy project dragged all of its quiet tabs to the top with it — a project with 17 tabs buried everything else under tabs that hadn't moved in days. Now only tabs touched within `RECENT` (default 24 hours) are listed, newest first, each row naming its project. *탭 접기* is hidden in this view since there is nothing to fold.
- **A group now reads as a section, not a row.** A thin rule and some air above it, the name small and bold, and the collapse chevron moved to the far right. Collapsed groups show their project count, the most urgent state inside, and the unread total; expanded ones stay quiet, because every row below says it already.
- **Only the tab row is highlighted.** Opening a tab used to light up its project row too, so two rows were selected at once and neither told you where you actually were.
- **Clicking a project no longer opens it** — it folds its tabs, the same as a group header. Jumping is what the tab rows are for; *이 프로젝트 열기* in the right-click menu still opens a project directly (the only way in for a project with no tabs).
- Indentation is kept to a minimum. Group → project → tab is three levels deep, and on a narrow sidebar the indents ate the tab names, so the section rule replaces the group indent entirely and the levels are told apart by text size and color.
- A tab whose title is a path (`~/workspace/kilog`) shows just the folder name. The part that tells tabs apart is at the end, and that was exactly the part being truncated.
- The elapsed time on a tab row only takes space when there is something to show.

## 0.2.0 — 2026-09-19

### Added
- Drag a project into, out of, or between groups in the *그룹* view. Drag a group header to move the whole group.
- Right-click a project to change its color or send it to a group. Changes show up instantly instead of a second later.
- A project that joins a group takes that group's color (the color most of its members use). Right-click a group header to paint the whole group at once.
- Version label next to the title.

### Changed
- Sessions you opened and left no longer disappear. They stay at the bottom of the list as *확인함* (seen) until they start working again.
- A session with nothing asked yet (for example right after `/clear`) stays out of the list. There is nothing to check in it.
- *대기* is now called *나중에 확인*.
- The session area reserves 8 rows instead of 5.
- Clicking a group header only collapses or expands it. Group terminals are also left out of the recent and search lists, because closing one deletes the whole group in cmux.

### Fixed
- A session cleared with `/clear` really does leave the list now. cmux reports that empty prompt as *needs_input*, not *idle*, so it kept coming back as a waiting session — and the project's state icon kept showing the same warning.
- Spinner characters cmux puts in front of a working tab's title no longer show up in session names.

## 0.1.0 — 2026-09-18

First public release.

- Session list across all projects, most urgent first: waiting for input → just finished → working. Click a row to jump to that tab.
- Fixed-height session area so the project list below doesn't jump around.
- Park a session for later. Parked and seen sessions are stored in the project description, so they survive cmux restarts.
- Project list with recent-activity order or the built-in grouping, state icons, unread badges, and name search.
