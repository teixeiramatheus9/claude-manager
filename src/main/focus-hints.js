// Linux has no permission dialog to raise: what breaks focus there is a
// missing tool or a terminal config, and both fail silently. This maps a
// failed focus to the one hint worth showing — null when there is nothing
// actionable to say.
export function linuxFocusHint(result, term) {
  if (result?.cause === 'no-x-windows' || result?.cause === 'xdotool-failed') {
    return {
      key: 'xdotool',
      title: 'O gerente precisa do xdotool',
      body:
        'Pra achar a janela do chat eu uso o xdotool e ele não respondeu. ' +
        'Instala com "sudo apt install xdotool" (ou dnf/pacman) e clica de novo.',
    };
  }
  // kitty only exports KITTY_LISTEN_ON when remote control is on — its
  // presence-without-listener is the fingerprint of the config being off.
  if (!result?.tabFound && term?.KITTY_WINDOW_ID && !term?.KITTY_LISTEN_ON) {
    return {
      key: 'kitty-remote',
      title: 'O kitty está de portas fechadas',
      body:
        'Pra ir direto pra aba certa do kitty, adiciona "allow_remote_control yes" ' +
        'no kitty.conf e reabre o terminal.',
    };
  }
  return null;
}
