#!/usr/bin/env bash
# One self-evolution cycle (PLAN.md → "The loop"). Run by launchd at 08:00,
# or by hand: `pnpm evolve` / `scripts/evolve.sh [--sim-only]`.
#
# Works in a SEPARATE git worktree ($EVOLVE_WORKTREE) with its own dev
# server on $SIM_PORT, so your :3000 dev server keeps running. Never pushes.
#
# Autonomous by design (the user's call): each cycle first MERGES the previous
# cycles' evolve/* branches into $BASE, if their report says `Checks: PASSED`,
# then builds today's change on a fresh branch from $BASE. A branch whose checks
# failed stays unmerged for a human, and later cycles don't build on it.
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"   # launchd's PATH is bare

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SIM_HOME="${SIM_HOME:-$HOME/beobeo-sim}"
WT="${EVOLVE_WORKTREE:-$(dirname "$REPO")/beobeo-evolve}"
BASE="${EVOLVE_BASE:-salarabb/phase_1}"
SIM_PORT="${SIM_PORT:-3100}"
DATE="$(date +%F)"
SIM_ONLY=0; [[ "${1:-}" == "--sim-only" ]] && SIM_ONLY=1

mkdir -p "$SIM_HOME/logs" "$SIM_HOME/reports" "$SIM_HOME/digests"
LOG="$SIM_HOME/logs/evolve-$DATE.log"
exec > >(tee -a "$LOG") 2>&1
echo "=== evolve $DATE $(date +%T) ==="

if ! mkdir "$SIM_HOME/evolve.lock" 2>/dev/null; then
  echo "Another cycle is running (remove $SIM_HOME/evolve.lock if stale)."; exit 0
fi
DEV_PID=""
# macOS banner (Notification Center). Works from launchd too: the LaunchAgent runs in your GUI session.
notify() {
  local title="$1" msg="$2"
  osascript -e "display notification \"${msg//\"/\'}\" with title \"${title//\"/\'}\" sound name \"Glass\"" 2>/dev/null || true
}
cleanup() {
  local code=$?
  [[ -n "$DEV_PID" ]] && kill "$DEV_PID" 2>/dev/null && wait "$DEV_PID" 2>/dev/null
  rmdir "$SIM_HOME/evolve.lock" 2>/dev/null
  if [[ "${FINISHED:-0}" == 1 ]]; then
    local report="$SIM_HOME/reports/$DATE.md" checks="no report written" headline=""
    if [[ -f "$report" ]]; then
      checks="$(grep -m1 '^Checks:' "$report" || echo 'Checks: ?')"
      headline="$(grep -m1 -v '^#\|^$\|^Checks:' "$report" | cut -c1-120)"
    fi
    notify "Beobeo evolve $DATE · $MODE" "$checks. ${headline}"
  elif [[ "${LOCKED:-0}" == 1 ]]; then
    notify "Beobeo evolve $DATE stopped early" "Exit $code. See $LOG"
  fi
}
trap cleanup EXIT
LOCKED=1

# ---------------------------------------------------------------- 1. sync the worktree
if [[ ! -d "$WT/.git" && ! -f "$WT/.git" ]]; then
  echo "Creating evolve worktree at $WT"
  git -C "$REPO" worktree add --detach "$WT" "$BASE" || exit 1
fi
ln -sf "$REPO/.env" "$WT/.env"
ln -sf ../../.env "$WT/apps/web/.env"

if [[ -n "$(git -C "$WT" status --porcelain)" ]]; then
  echo "Worktree has uncommitted changes (a previous cycle died mid-way?) — stashing them."
  git -C "$WT" stash push -u -m "evolve-autostash-$DATE" >/dev/null
fi

# Merge yesterday's work into $BASE before starting today's (oldest first; stop at the first that can't land).
merge_into_base() {
  local br="$1" old new cur
  grep -q '^Checks: PASSED' "$SIM_HOME/reports/${br#evolve/}.md" 2>/dev/null || { echo "Not merging $br: its report is missing or its checks failed."; return 1; }
  old="$(git -C "$REPO" rev-parse "$BASE")"
  cur="$(git -C "$REPO" symbolic-ref --short -q HEAD || true)"
  if [[ "$cur" == "$BASE" ]]; then
    # $BASE is checked out in your checkout: merge there (git refuses, touching nothing, if your uncommitted edits overlap).
    git -C "$REPO" merge --no-edit "$br" || { git -C "$REPO" merge --abort 2>/dev/null; echo "Merging $br into your checkout failed (uncommitted edits in the way, or a conflict)."; return 1; }
  else
    # Not checked out anywhere: merge in the evolve worktree, then move the branch ref.
    git -C "$WT" checkout -q --detach "$old" && git -C "$WT" merge --no-edit -m "Merge $br into $BASE" "$br" \
      || { git -C "$WT" merge --abort 2>/dev/null; echo "Merging $br conflicted."; return 1; }
    new="$(git -C "$WT" rev-parse HEAD)"
    git -C "$REPO" update-ref "refs/heads/$BASE" "$new" "$old" || return 1
  fi
  echo "Merged $br into $BASE ($(git -C "$REPO" rev-parse --short "$BASE"))."
  MERGED+=("$br")
}
MERGED=()
for br in $(git -C "$REPO" for-each-ref --sort=refname --format='%(refname:short)' --no-merged "$BASE" 'refs/heads/evolve/*'); do
  [[ "$br" == "evolve/$DATE" ]] && continue   # a same-day re-run keeps building on today's branch
  merge_into_base "$br" || break
done
UNMERGED="$(git -C "$REPO" for-each-ref --format='%(refname:short)' --no-merged "$BASE" 'refs/heads/evolve/*' | wc -l | tr -d ' ')"
# Today's branch if this is a re-run, else the freshly merged $BASE.
START="$BASE"; git -C "$REPO" rev-parse -q --verify "refs/heads/evolve/$DATE" >/dev/null && START="evolve/$DATE"
git -C "$WT" checkout --detach "$START" || exit 1
echo "Simulating against $START ($(git -C "$WT" rev-parse --short HEAD)); merged this morning: ${MERGED[*]:-none}; still unmerged: $UNMERGED"
if [[ ! -d "$WT/packages/sim" ]]; then
  echo "packages/sim is not on $START — commit the sim package to $BASE first."; exit 1
fi
(cd "$WT" && pnpm install --prefer-offline >/dev/null) || exit 1

# ---------------------------------------------------------------- 2. app under test
echo "Starting dev server on :$SIM_PORT"
(cd "$WT/apps/web" && BETTER_AUTH_URL="http://localhost:$SIM_PORT" exec pnpm exec next dev --port "$SIM_PORT") \
  > "$SIM_HOME/logs/dev-$DATE.log" 2>&1 &
DEV_PID=$!
for _ in $(seq 1 90); do curl -sf -o /dev/null "http://localhost:$SIM_PORT/signin" && break; sleep 2; done
curl -sf -o /dev/null "http://localhost:$SIM_PORT/signin" || { echo "Dev server never came up — see dev-$DATE.log"; exit 1; }

# ---------------------------------------------------------------- 3. simulate + digest
export SIM_APP_URL="http://localhost:$SIM_PORT"
(cd "$WT" && pnpm --silent sim:day) || echo "sim:day exited non-zero (see above) — continuing to digest"
DIGEST="$(cd "$WT" && pnpm --silent sim:digest | tail -1)"
echo "Digest: $DIGEST"
(cd "$WT" && pnpm --silent sim:report) || echo "sim:report failed"
# The dev server stays up through step 5 so /evolve can screenshot its own changes (HMR).

[[ $SIM_ONLY == 1 ]] && { echo "--sim-only: stopping before /evolve."; notify "Beobeo sim $DATE" "Sim day done. Digest: $(basename "$DIGEST")"; LOCKED=0; exit 0; }

# ---------------------------------------------------------------- 4. safety valve
MODE="implement"
FAILS="$(ls -1t "$SIM_HOME/reports/"*.md 2>/dev/null | head -2 | xargs grep -l '^Checks: FAILED' 2>/dev/null | wc -l | tr -d ' ')"
if (( UNMERGED >= 3 )); then MODE="propose"; echo "Safety valve: $UNMERGED evolve branches couldn't be merged → propose-only until a human looks."; fi
if (( FAILS >= 2 )); then MODE="propose"; echo "Safety valve: last two cycles failed checks → propose-only."; fi

# ---------------------------------------------------------------- 5. Claude improves the product
ALLOWED=(Read Edit Write Glob Grep
  "Bash(git status:*)" "Bash(git diff:*)" "Bash(git log:*)" "Bash(git checkout -b evolve/*)" "Bash(git add:*)"
  "Bash(git commit:*)" "Bash(git rev-parse:*)" "Bash(git branch:*)" "Bash(git show:*)"
  "Bash(pnpm typecheck:*)" "Bash(pnpm lint:*)" "Bash(pnpm test:*)" "Bash(pnpm build:*)" "Bash(pnpm install:*)"
  "Bash(pnpm --filter:*)" "Bash(pnpm exec:*)" "Bash(pnpm sim:theme:*)" "Bash(pnpm sim:insights:*)" "Bash(pnpm sim:bootstrap:*)"
  "Bash(pnpm sim:report:*)" Artifact
  "Bash(ls:*)" "Bash(cat:*)" "Bash(head:*)" "Bash(tail:*)" "Bash(wc:*)" "Bash(mkdir:*)" "Bash(sqlite3:*)" "Bash(curl -s:*)")
DENIED=("Bash(git push:*)" "Bash(git merge:*)" "Bash(git reset:*)" "Bash(git rebase:*)" "Bash(rm:*)" "Bash(git worktree:*)")
run_claude() {
  SIM_APP_URL="http://localhost:$SIM_PORT" claude -p "$1" --permission-mode acceptEdits \
    --allowedTools "${ALLOWED[@]}" --disallowedTools "${DENIED[@]}" --add-dir "$SIM_HOME" \
    || echo "claude exited non-zero for: $1"
}
cd "$WT"
run_claude "/evolve $DIGEST $MODE $START"
# Sundays: audit and evolve the persona population itself.
[[ "$(date +%u)" == "7" ]] && run_claude "/evolve-agents"

FINISHED=1
echo "=== evolve done $(date +%T) — report: $SIM_HOME/reports/$DATE.md ==="
