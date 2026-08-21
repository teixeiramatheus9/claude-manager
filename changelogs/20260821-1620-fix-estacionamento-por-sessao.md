- Corrigida a regressão da 0.21.1 no Wayland: a modal de config voltava presa
  no canto ao reabrir. O "estacionamento" de janelas voltou pro Wayland (e
  macOS/Windows), como na 0.21.0 — só o X11 usa o esconder normal, que é o
  único jeito que funciona lá.
