#!/usr/bin/env bash
# Installs the orchestra kit for your user: `ask` CLI + Claude Code subagents + routing policy.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/.local/bin" "$HOME/.claude/agents" "$HOME/.orchestra"
ln -sf "$here/bin/ask.mjs" "$HOME/.local/bin/ask"
cp "$here"/claude/agents/*.md "$HOME/.claude/agents/"
if [ ! -f "$HOME/.orchestra/.env" ]; then
  cp "$here/env.example" "$HOME/.orchestra/.env"; chmod 600 "$HOME/.orchestra/.env"
  echo "Created ~/.orchestra/.env — fill in your keys."
fi
if ! grep -q "Orchestra routing policy" "$HOME/.claude/CLAUDE.md" 2>/dev/null; then
  { echo; cat "$here/CLAUDE.orchestra.md"; } >> "$HOME/.claude/CLAUDE.md"
  echo "Appended routing policy to ~/.claude/CLAUDE.md"
fi
command -v gemini >/dev/null || echo "Tip: npm i -g @google/gemini-cli   then run 'gemini' once to log in."
command -v agy >/dev/null    || echo "Tip: install Antigravity and its 'agy' CLI, then log in once interactively."
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "Add ~/.local/bin to PATH.";; esac
echo "Done. Test: ask list-free  |  echo hi | ask cheap 'reply OK'"
