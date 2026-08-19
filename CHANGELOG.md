# Release Notes

Toda PR de `feat/*`, `fix/*` ou `release/*` DEVE adicionar sua descrição aqui,
na seção **Não lançado** (o CI reprova a PR sem isso). A primeira feat da
rodada cria a seção `### Feats`; o primeiro fix cria a `### Fixes`. PRs de
`release/*` escrevem a nota completa da versão. No corte da release, tudo que
foi adicionado aqui desde a última tag vira o corpo da release no GitHub.

Formato dos marcadores: `- descrição curta e clara do que mudou (#PR)`.

## Não lançado

<!-- adicione as seções ### Feats / ### Fixes conforme necessário -->

### Feats
- Bolha roda sob XWayland: sobreposição real, arrastar e posição persistida voltam a funcionar no GNOME/Wayland (#2)
- Resposta rápida vai direto pelo socket da sessão do Claude Code, sem depender de terminal nem de servidor gráfico, e sem risco de cair no chat errado (#2)
- Política de mensagens entre sessões configurável no painel (#2)
- Ptyxis reconhecido no fallback de terminal; `wmctrl` deixa de ser necessário e `xdotool` passa a ser declarado como dependência dos pacotes (#2)

### Fixes
- Sessão cujo terminal foi fechado some da lista em vez de ficar congelada por horas dizendo que ainda está trabalhando (#2)
- Nada de injetar teclas no Wayland, onde isso abria pedido de acesso remoto e falhava (#2)
- Bolha se relança sob XWayland quando o AppImage perde a flag de plataforma (#2)
- Manager não afirma mais que entregou uma resposta que o canal não conseguiu confirmar (#2)

## v0.2.1 — 2026-08-19

### Feats
- Suporte a macOS: dmg, LaunchAgent, WaveTerm, TTS Kokoro e Centro de Notificações (#1)
- Atualização automática: AppImage se auto-atualiza; deb/rpm/dmg recebem banner com link da release
- Pipeline de release por tag: mergear release/feat/fix versiona, builda Linux+macOS e publica sozinho

## v0.1.1 — 2026-08-19

### Feats
- Hooks do Claude Code se auto-registram na primeira execução (sem repo, sem Node do sistema)
- Voz neural pt-BR (Piper) com download automático no primeiro uso do TTS

## v0.1.0 — 2026-08-18

- Primeira versão pública: bolha flutuante com notificações das sessões do
  Claude Code, voz de gerente por IA, painel de chats com resposta rápida,
  integração com terminal, chat com o gerente, modo economia de tokens, sons
  configuráveis e TTS.
