# Claude Manager

Gerente flutuante das sessões do Claude Code. Uma bolha sempre-por-cima na tela
avisa quando um chat termina a tarefa ou fica esperando você, mostra um
balãozinho (tooltip) com o recado do gerente e lista o status de todas as
sessões num painel.

## Como funciona

Hooks globais do Claude Code (`UserPromptSubmit`, `Stop`, `Notification`)
mandam os eventos pra um unix socket; o app Electron mostra a bolha (com badge
de não-lidos), o tooltip de mensagem nova e o painel de sessões. As mensagens
do gerente são geradas por `claude -p` (Haiku) com fallback pra frases prontas.

## Uso

```bash
npm install
npm run hooks:install   # registra os hooks em ~/.claude/settings.json (com backup)
npm start               # sobe a bolha
```

- Arrasta a bolha pra qualquer lugar da tela (a posição fica salva).
- Mensagem nova → tooltip sai do lado da bolha e some em ~8s; clicar nele abre o painel.
- Clica na bolha pra abrir o painel (abrir zera o badge). Cada chat mostra UM
  balão de mensagem (com X pra dispensar) e resposta rápida.
- Clicar num chat foca a janela/aba do terminal dele (caça as abas do Warp
  lendo o título com Ctrl+Tab; requer `wmctrl` e `xdotool`).
- Pergunta de múltipla escolha → as opções viram chips; clicar num chip
  responde direto no chat (setas + Enter via xdotool).
- 💬 no cabeçalho abre o **chat com o gerente** (Haiku, contexto compacto
  gerado localmente — barato de token). Pergunta "resume o dia", "como tá o X?".
- 🎚️ configura volume/timbre dos sons, o **terminal usado** (Warp, GNOME
  Terminal, Kitty, Alacritty, Konsole, Tilix, WezTerm ou Auto) e o **teto
  diário de tokens** do gerente — estourou o teto (ou barrinha no zero), entra
  o **modo economia**: frases prontas, zero token, até você subir o limite.
  O gasto é medido de verdade (usage reportado pelo próprio `claude` CLI).
- As sessões sobrevivem a restart (salvas em `sessions.json`).
- Com o app fechado, os avisos caem em notificação nativa (`notify-send`).

```bash
./scripts/install-tts.sh   # voz neural pt-BR (Piper) pro TTS — sem ela, cai no spd-say robótico
npm run hooks:remove       # desinstala os hooks
npm run autostart:install  # sobe a bolha junto com o login (Xorg)
npm run autostart:remove   # remove o autostart
npm test                   # testes unitários
./scripts/simulate-event.sh Stop meu-projeto   # evento falso pra testar
```

## Empacotamento

```bash
npm run dist   # gera AppImage + .deb + .rpm em dist/
```

O AppImage roda em qualquer distro sem instalar nada. Pra gerar o .deb e o
.rpm o sistema precisa de `binutils` e `rpm` (`sudo apt install binutils rpm`).

**Instalou pelo pacote?** Os hooks do Claude Code se **auto-registram na
primeira execução** (com backup do settings.json) — sem precisar do repo nem
de Node no sistema. Só instala `wmctrl` e `xdotool` pra integração com o
terminal (Fedora: `sudo dnf install wmctrl xdotool`) e usa sessão **X11/Xorg**
pro modo completo.

## Sandbox do Electron no Ubuntu 24+

O Ubuntu restringe user namespaces sem privilégio, então o Electron aborta com
`The SUID sandbox helper binary was found, but is not configured correctly`.
O `npm start` usa `--no-sandbox` (ok aqui: o app só carrega HTML local, nada
remoto). Se preferir manter o sandbox do Chromium, rode uma vez após cada
`npm install`:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

e tire o `--no-sandbox` do script `start`.

## Arquivos de runtime

`~/.config/claude-manager/` → `manager.sock`, `state.json` (posição da bolha), `log`.
