#!/usr/bin/env bash
# e2e bench for the Vizor Bridge: nested GNOME Wayland session with a
# throwaway HOME (so enabling the extension never touches the real session),
# a titled two-tab gnome-terminal inside it, and the driver hunting through
# the bridge. Run from any session with gnome-shell >= 45.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"

UUID="vizor-bridge@vizor.app"
SANDBOX_HOME="$(mktemp -d /tmp/vizor-bridge-e2e.XXXXXX)"
trap 'rm -rf "$SANDBOX_HOME"' EXIT

echo "== instala a extensão no HOME descartável ($SANDBOX_HOME)"
EXT_TARGET="$SANDBOX_HOME/.local/share/gnome-shell/extensions/$UUID"
mkdir -p "$EXT_TARGET" "$SANDBOX_HOME/.config"
cp -r "resources/gnome-extension/$UUID/." "$EXT_TARGET/"

echo "== sobe a sessão aninhada e roda a caçada"
env HOME="$SANDBOX_HOME" \
    XDG_DATA_HOME="$SANDBOX_HOME/.local/share" \
    XDG_CONFIG_HOME="$SANDBOX_HOME/.config" \
    XDG_CACHE_HOME="$SANDBOX_HOME/.cache" \
    dbus-run-session -- bash -s <<INNER
set -e
gsettings set org.gnome.shell enabled-extensions "['$UUID']"
gsettings set org.gnome.shell disable-user-extensions false
gnome-shell --nested --wayland --wayland-display=wayland-vizor-e2e 2>/dev/null &
SHELL_PID=\$!
sleep 8
export WAYLAND_DISPLAY=wayland-vizor-e2e
dbus-update-activation-environment WAYLAND_DISPLAY=wayland-vizor-e2e HOME="$SANDBOX_HOME"
gnome-terminal --window -- bash -c 'printf "\033]0;E2E-ALFA\007"; gnome-terminal --tab -- bash -c "printf \"\\033]0;E2E-BETA\\007\"; sleep 120"; sleep 120' || true
sleep 4
cd "$REPO"
node --input-type=module -e "
  import { bridgeDriver, bridgeResponding } from './src/main/window-driver.js';
  import { focusChatTab } from './src/main/warp.js';
  const ok = await bridgeResponding({});
  console.log('bridge responding:', ok);
  if (!ok) process.exit(1);
  const driver = bridgeDriver({});
  console.log('windows:', JSON.stringify(await driver.listWindows()));
  const result = await focusChatTab(['E2E-ALFA'], { terminal: 'gnome-terminal', driver });
  console.log('focusChatTab:', JSON.stringify(result));
  process.exit(result.tabFound ? 0 : 1);
"
STATUS=\$?
kill \$SHELL_PID 2>/dev/null || true
exit \$STATUS
INNER
