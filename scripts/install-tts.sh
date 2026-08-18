#!/usr/bin/env bash
# Downloads Piper TTS (neural, offline) with the Brazilian Portuguese
# "faber" voice into ~/.config/claude-manager/piper/.
set -euo pipefail

PIPER_DIR="$HOME/.config/claude-manager/piper"
PIPER_RELEASE="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz"
VOICE_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/pt/pt_BR/faber/medium"

mkdir -p "$PIPER_DIR"
cd "$PIPER_DIR"

if [ ! -x "$PIPER_DIR/piper/piper" ]; then
  echo "Baixando o Piper..."
  curl -fL --progress-bar "$PIPER_RELEASE" -o piper.tar.gz
  tar -xzf piper.tar.gz
  rm piper.tar.gz
fi

if [ ! -f "$PIPER_DIR/pt_BR-faber-medium.onnx" ]; then
  echo "Baixando a voz pt-BR (faber, ~60MB)..."
  curl -fL --progress-bar "$VOICE_BASE/pt_BR-faber-medium.onnx" -o pt_BR-faber-medium.onnx
  curl -fL --progress-bar "$VOICE_BASE/pt_BR-faber-medium.onnx.json" -o pt_BR-faber-medium.onnx.json
fi

echo "Piper instalado em $PIPER_DIR ✓"
