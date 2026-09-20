# Changelog

Versions follow [Semantic Versioning](https://semver.org/). While Deck is 0.x, a minor bump (0.2 → 0.3) may change behavior or labels.

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
