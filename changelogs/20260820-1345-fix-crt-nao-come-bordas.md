- O tubo CRT comia o contorno das superfícies (issue #33): a curvatura puxava
  também a borda de quem estava curvando, então a bolha aparecia ~2px menor
  que a janela, com o círculo mastigado, e os cantos arredondados do toast
  perdiam o traço. Agora a curvatura não mexe mais na borda — a bolha volta
  redonda e inteira, o toast recupera os cantos, e scanline, brilho e granulado
  continuam iguais.
