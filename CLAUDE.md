# CLAUDE.md — Claude Manager

Bolha flutuante (Electron) que gerencia sessões do Claude Code: avisa quando
um chat termina a tarefa ou fica esperando resposta, mostra tooltip e painel
com o recado do "gerente" (gerado por IA em pt-BR descontraído), permite
resposta rápida direto no terminal e conversa com o gerente.

## Regras

- Código, comentários e commits em inglês; strings visíveis ao usuário em pt-BR.
- Commits seguem Conventional Commits.
- Testes com vitest (`npm test`) — TDD nos módulos puros (registry, parsers,
  voice, warp, budget).
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
  ├── warp.js              → foco de janela/aba do terminal (wmctrl + xdotool)
  └── renderer (app.*)     → bolha, tooltip, painel, chat, configurações
```

Pontos críticos:
- **Wayland vs X11**: o app detecta a sessão; no X11 usa modo completo (drag
  manual, flip nas bordas, posição salva), no Wayland degrada (drag via
  app-region, janela única que cresce/encolhe).
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

## Releases (automatizadas)

- Versão mora nas **tags** (`vMAJOR.MINOR.PATCH`), não no package.json.
- Merge/push na `main` a partir de branch `release/*` = major, `feat/*` =
  minor, `fix/*` = patch (fallback: prefixo do commit). Outros prefixos não
  lançam. O CI tagueia, builda Linux+macOS e publica a release sozinho.
- **Toda PR de feat/fix/release DEVE atualizar o `CHANGELOG.md`** na seção
  "Não lançado" (check `changelog` obrigatório) — o texto adicionado desde a
  última tag vira o corpo da release publicada.
- Auto-update: AppImage se atualiza via electron-updater (`latest-linux.yml`);
  deb/rpm/dmg mostram banner apontando pra release.
