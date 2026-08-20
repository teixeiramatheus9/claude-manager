- Clicar no card agora cai direto na aba certa do Warp, em qualquer sistema:
  o Warp dá a cada sessão uma URL própria (`warp://session/<uuid>`) que abre a
  janela e seleciona a aba sozinha, e o hook passou a guardar esse endereço.
  Na prática o clique saiu de quase 4 segundos para ~15 milissegundos, sem
  varrer janela, sem apertar tecla nenhuma.
- Para quem não tem esse endereço (Windows Terminal, cmd, Git Bash, ou sessões
  abertas antes desta versão), a caça ficou bem melhor: o app procura a aba
  pelo nome que o próprio Claude Code dá ao chat, lido do transcript na hora
  do clique — antes ele só conhecia o nome do projeto e o começo do prompt.
- Fim do desfile de abas nos terminais que têm atalho de "ir pra aba N": o app
  percorre as abas uma única vez, aprende a posição de cada chat e daí em
  diante vai direto. Se o chat mudar de lugar, ele reaprende; se não achar,
  devolve você pra aba em que estava.
- No Windows, com várias janelas de terminal abertas, o app usa o processo da
  sessão para saber em qual janela ela vive, em vez de chutar pelo título.
- O app não digita mais às cegas: se o Windows recusar trazer o terminal pra
  frente, ele segura as teclas em vez de mandá-las pro app que estiver na
  frente — dava pra trocar as guias do navegador sem querer.
- Quando algo impede o foco, o gerente diz o que é: título de aba escondido
  (`suppressApplicationTitle`), foco negado pelo Windows ou PowerShell fora
  do ar — cada caso com sua explicação, em vez de falhar calado.
- "Encontrar a bolha" não arrasta mais a bolha para o meio da tela: agora ela
  só pulsa onde você deixou. O reposicionamento ficou só para quando não há
  para onde apontar — bolha nunca posicionada ou salva num monitor que sumiu.
- O pulso do "encontrar a bolha" não mostra mais o canto quadrado do brilho em
  telas escuras: as ondas param antes da borda e o brilho desaparece por igual.
