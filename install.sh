#!/usr/bin/env bash
# install.sh — one-command setup for the Pharos Limit Orders & DCA skill.
#
#   curl -fsSL https://raw.githubusercontent.com/Jennycruzy/pharos-limit-orders-dca/main/install.sh | bash
#   # or, from inside a clone:
#   ./install.sh
#
# Idempotent and non-destructive: it never overwrites an existing .env.
set -euo pipefail

REPO_URL="https://github.com/Jennycruzy/pharos-limit-orders-dca.git"
REPO_DIR="pharos-limit-orders-dca"

say()  { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$1"; }

# 1. Get into the repo (clone if we're not already in it).
if [ -f "scripts/orders.ts" ] && [ -f "SKILL.md" ]; then
  say "Using current directory ($(pwd))"
else
  if [ -d "$REPO_DIR" ]; then
    say "Found existing $REPO_DIR — updating"
    git -C "$REPO_DIR" pull --ff-only || warn "git pull skipped"
  else
    say "Cloning $REPO_URL"
    git clone "$REPO_URL"
  fi
  cd "$REPO_DIR"
fi

# 2. Dependencies.
say "Installing npm dependencies"
npm install

# 3. .env scaffold (never clobber an existing one).
if [ -f ".env" ]; then
  say ".env already exists — leaving it untouched"
else
  say "Creating .env from .env.example"
  cp .env.example .env
  warn "Edit .env and set PRIVATE_KEY (the wallet that signs fills)."
  warn "For a MAINNET demo also set: PHAROS_NETWORK=mainnet"
fi

# 4. Register the skill with Claude Code (optional, harmless if unused).
if command -v claude >/dev/null 2>&1 || [ -d "$HOME/.claude" ]; then
  mkdir -p "$HOME/.claude/skills"
  ln -sfn "$(pwd)" "$HOME/.claude/skills/$REPO_DIR"
  say "Linked into ~/.claude/skills/$REPO_DIR (Claude Code will auto-discover it)"
fi
# Codex / Cursor / Zed / Aider read AGENTS.md and .cursor/rules/ from the repo
# root automatically — just open this folder as the workspace.

# 5. Sanity check (read-only; no funds needed).
say "Verifying the CLI runs"
npx ts-node scripts/orders.ts status >/dev/null && echo "    CLI OK"

cat <<'NEXT'

Setup complete.

What this skill does:
  Creates unattended Pharos limit orders and recurring DCA swaps through
  FaroSwap. It stores the order, watches live price/time, and fills only when
  the trigger fires.

Before live fills:
  Put your funded wallet PRIVATE_KEY in .env.
  For a mainnet demo, also set PHAROS_NETWORK=mainnet.

Then ask your agent in plain English, for example:
  "Buy PHRS with 0.01 USDC when PHRS is below $1."
  "DCA 0.01 USDC into PHRS every 30 seconds."
NEXT
