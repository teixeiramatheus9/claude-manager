- Clique no card leva pra aba EXATA da sessão, sem caça por título: o hook
  captura a identidade que cada terminal deixa no ambiente e o app foca por
  ela — kitty, WezTerm e tmux via CLI oficial (Linux, macOS e Windows).
- No macOS, Terminal.app e iTerm2 ganham foco exato pelo tty da sessão: o app
  descobre o tty do processo do claude e pede por AppleScript a aba que o
  possui — funciona mesmo sem nenhuma variável de ambiente capturada.
- A identidade capturada vale mais que o terminal configurado: se a sessão
  vive no kitty, é o kitty que vem pra frente, mesmo com outro app escolhido
  nas configurações.
- WaveTerm agora troca pra ABA certa de verdade (macOS e Windows): o
  `wsh focusblock` só alcança a aba ativa, então o app descobre o índice da
  aba do bloco no banco do Wave e manda o atalho nativo de trocar de aba
  antes de focar o bloco — era por isso que o clique só trazia o Wave pra
  frente na aba em que você já estava.
- Warp no macOS ganha a mesma caça de aba do Linux e do Windows: lê o título
  da janela (que segue a aba ativa) via Acessibilidade e vai passando as abas
  até achar a do chat — antes só trazia o Warp pra frente.
- Warp, Windows Terminal e afins seguem na caça por título de antes — esses
  não expõem API de aba; nada muda pra pior em nenhum caso.
