#!/usr/bin/env bash
# Injects a fake hook event through the real hook path.
# Usage: ./scripts/simulate-event.sh [UserPromptSubmit|Stop|Notification] [project-name]
set -u
EVENT="${1:-Stop}"
NAME="${2:-projeto-teste}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
printf '{"hook_event_name":"%s","session_id":"sim-%s","cwd":"/tmp/%s","transcript_path":"","message":"Claude precisa da sua permissão pra rodar um comando"}\n' \
  "$EVENT" "$NAME" "$NAME" | node "$PROJECT_DIR/src/hook/hook-emit.js"
