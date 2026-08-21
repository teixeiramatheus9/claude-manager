- Corrigida a onda de notificação que podia ficar "fantasma" na tela (visível
  mesmo depois de abrir o painel) por uma corrida interna — agora todo aviso
  atrasado é descartado em vez de ressuscitar o anel.
- O clique na bolha ficou mais direto: ele não disputa mais com o redesenho da
  onda, e o app passou a registrar cada clique/abertura de painel no log pra
  facilitar diagnóstico.
- Arrastar a bolha com uma onda ativa deixava os anéis piscando no lugar
  ANTIGO — uma isca que parecia a bolha mas não clicava. Agora as ondas se
  mudam junto com ela.
