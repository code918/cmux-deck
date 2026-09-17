#!/usr/bin/env bash
# Deck 설치: cmux 커스텀 사이드바 폴더에 deck.js 를 연결한다.
# 심볼릭 링크라서 이 저장소에서 git pull 하면 cmux에도 바로 반영된다.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/deck.js"
DEST_DIR="$HOME/.config/cmux/sidebars"
DEST="$DEST_DIR/deck.js"

mkdir -p "$DEST_DIR"

# 이미 다른 deck.js 가 있으면 지우지 않고 백업해둔다
if [ -e "$DEST" ] && [ "$(readlink "$DEST" 2>/dev/null || true)" != "$SRC" ]; then
  BACKUP="$DEST.bak-$(date +%Y%m%d%H%M%S)"
  mv "$DEST" "$BACKUP"
  echo "기존 파일 백업: $BACKUP"
fi

ln -sfn "$SRC" "$DEST"
echo "연결 완료: $DEST -> $SRC"

# cmux 가 있으면 바로 검증·반영
CMUX="$(command -v cmux || true)"
[ -z "$CMUX" ] && [ -x /Applications/cmux.app/Contents/Resources/bin/cmux ] && CMUX=/Applications/cmux.app/Contents/Resources/bin/cmux
if [ -n "$CMUX" ]; then
  "$CMUX" sidebar reload deck || true
  echo "사이드바 버튼을 우클릭해서 deck 을 고르세요. (또는: cmux sidebar select deck)"
fi
