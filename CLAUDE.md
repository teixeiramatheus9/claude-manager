# CLAUDE.md — Claude Manager

Bolha flutuante (Electron) que gerencia sessões do Claude Code: avisa quando
um chat termina a tarefa ou fica esperando resposta, mostra tooltip e painel
com o recado do "gerente" (gerado por IA em pt-BR descontraído), permite
resposta rápida direto no terminal e conversa com o gerente.

## Regras

- Código, comentários e commits em inglês; strings visíveis ao usuário em pt-BR.
- Commits seguem Conventional Commits.
- Testes com vitest (`npm test`) — TDD nos módulos puros (registry, parsers,
  voice, warp, budget, display-mode, cc-sessions, cc-peer).
- `src/hook/hook-emit.js` é standalone de propósito (roda em todo evento de
  toda sessão do Claude Code): rápido, sem deps, **SEMPRE exit 0**, hard-timeout.
- Anti-recursão: todo `claude -p` interno seta `CLAUDE_MANAGER_INTERNAL=1`;
  o hook-emit sai imediatamente ao ver essa env.

## Arquitetura

```
Claude Code (hooks globais em ~/.claude/settings.json)
  UserPromptSubmit / Stop / Notification
        ↓ (JSON no stdin)
src/hook/hook-emit.js  →  unix socket ~/.config/claude-manager/manager.sock
        ↓                  (sem socket: fallback notify-send)
App Electron (src/main/index.js)
  ├── session-registry.js  → estado puro das sessões (testável)
  ├── transcript.js        → última msg/pergunta pendente no transcript .jsonl
  ├── manager-voice.js     → claude -p (Haiku) gera {title, message}; fallback frases
  ├── manager-chat.js      → chat com o gerente (digest local, econômico)
  ├── claude-cli.js        → runner compartilhado com contagem real de tokens
  ├── token-budget.js      → teto diário de tokens / modo economia
  ├── display-mode.js      → decide modo managed (XWayland) vs Wayland (puro)
  ├── cc-sessions.js       → resolve sessionId → socket/token do Claude Code
  ├── cc-peer.js           → cliente NDJSON do socket da sessão
  ├── warp.js              → FALLBACK: foco de janela/aba do terminal (xdotool)
  └── renderer (app.*)     → bolha, tooltip, painel, chat, configurações
```

Pontos críticos:
- **Wayland vs X11**: o app é lançado com `--ozone-platform=x11` e roda sob
  XWayland, onde o mutter honra `_NET_WM_STATE_ABOVE`/`STICKY` — é a única forma
  de ter sobreposição real no GNOME, porque o Wayland não tem API de
  posicionamento para apps comuns. A flag **precisa** vir da linha de comando
  (`appendSwitch` no código roda tarde demais). A decisão de modo sai de
  `display-mode.js`, não de `XDG_SESSION_TYPE` (que continua dizendo "wayland"
  sob XWayland). Sem `DISPLAY` ou sem a flag, degrada (drag via app-region,
  janela única que cresce/encolhe).
- **Canal com o Claude Code**: a resposta rápida escreve NDJSON no
  `messagingSocketPath` de `~/.claude/sessions/<pid>.json` — independe de
  terminal e de display server, e não pode cair no chat errado porque endereça
  por `sessionId`. O canal está atrás de feature gate remoto, então o fallback
  via `xdotool` continua obrigatório.
- **Sessão morta**: fechar o terminal mata o `claude` sem disparar hook nenhum,
  então a lista só descobre isso comparando com `~/.claude/sessions/`. Ausência
  ali não é prova de morte: builds sem o registro não listam nada. Só se reapa
  sessão já vista viva, ou quando o registro lista alguma outra (prova de que
  funciona nessa máquina), e nunca as fixtures `sim-*` do simulate-event.sh.
- **Sandbox do Electron no Ubuntu 24+**: `npm start` usa `--no-sandbox`
  (só HTML local). Alternativa com sandbox: ver README.

## Comandos

```bash
npm start                 # sobe a bolha
npm test                  # vitest
npm run hooks:install     # registra hooks globais (com backup do settings.json)
npm run hooks:remove      # desinstala os hooks
npm run autostart:install # sobe junto com o login
npm run dist              # AppImage + deb + rpm em dist/
./scripts/simulate-event.sh [UserPromptSubmit|Stop|Notification] [nome]
```

Runtime: `~/.config/claude-manager/` (`manager.sock`, `state.json`,
`sessions.json`, `config.json`, `usage.json`, `log`).
