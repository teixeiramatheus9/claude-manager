# Release Notes

Toda PR de `feat/*`, `fix/*` ou `release/*` DEVE adicionar sua descrição aqui,
na seção **Não lançado** (o CI reprova a PR sem isso). A primeira feat da
rodada cria a seção `### Feats`; o primeiro fix cria a `### Fixes`. PRs de
`release/*` escrevem a nota completa da versão. No corte da release, tudo que
foi adicionado aqui desde a última tag vira o corpo da release no GitHub.

Formato dos marcadores: `- descrição curta e clara do que mudou (#PR)`.

## Não lançado

### Feats
- Notificação por voz da pergunta agora diz quantas opções tem pra escolher ("tem uma pergunta no X com 3 opções")
- Sete temas de cor (azul-aço, âmbar crt, magenta synth, ciano gelo, monocromo, magma reator, matrix code), com o logo acompanhando a cor de cada um
- Tamanho do painel ajustável de 80% a 160% — a fonte e os controles crescem junto, não só a janela
- Volume próprio para a voz do gerente, multiplicado pelo volume geral
- O gerente avisa por voz quando termina de se atualizar

### Fixes
- Opções da pergunta aparecem no card mesmo quando o aviso chega antes do transcript ser gravado — o app agora relê o arquivo algumas vezes antes de desistir
- Ajustes de som (volume, timbre, mudo, TTS) voltam a valer na hora: eles moravam em cada janela, e quem toca o som é a bolinha enquanto quem configura é o painel
- Prévia de som toca com o volume recém-escolhido, em vez do valor anterior
- Barra dos sliders para de mostrar um valor diferente do botão em controles que não começam no zero
- Atualização mostra que está instalando (e avisa da senha) em vez de continuar oferecendo o download; no Linux o app sai da frente pro diálogo de autenticação do sistema, que antes ficava atrás do overlay e impedia digitar a senha
- Instalação das vozes neurais não depende mais do bzip2 do sistema — a descompressão agora é feita pelo próprio app (corrige voz robótica em máquinas sem bzip2)

### Feats
- Ícone do app refeito na identidade nova: tile grafite com o prompt pixel, no lugar do círculo laranja
- Redesign completo da interface na direção "terminal": grafite e azul-aço, tudo monoespaçado, status por glifos e ações em [colchetes] — bolinha, painel de sessões, chats, configurações e notificação
- Cada chat na lista ganhou um ✕ pra fechar: some da lista na hora e não volta no restart — se o terminal voltar a ser usado, o chat reaparece como sessão nova
- Bolinha em janela própria e painel em janela separada: a bolinha nunca mais é redimensionada, o que elimina o fantasma que aparecia ao abrir e fechar o painel nas bordas da tela
- Seletor de voz do gerente: Santa ou Faber, nas configurações e nos dois sistemas — as duas vozes agora rodam no mesmo motor neural (sherpa-onnx), aposentando o Piper
- Botão "Buscar versão mais recente" nas configurações; a atualização agora instala direto pelo app e relança na versão nova — deb/rpm via autenticação nativa do sistema, macOS trocando o app no /Applications automaticamente
- Pipeline de release com um job por pacote (AppImage, deb, rpm, macOS), espelho apt confiável com retry/timeout, e publicação só quando TODOS os pacotes estão prontos

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
