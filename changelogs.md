# Changelogs

Cada mudança que vale nota de release mora no **seu próprio arquivo** dentro de
`changelogs/`. Nada de editar um arquivo compartilhado: duas PRs nunca mais
conflitam por causa de release note.

## Como escrever a sua

Crie um arquivo em `changelogs/` com este nome:

```
AAAAMMDD-HHMM-<tipo>-<slug>.md
```

- **AAAAMMDD-HHMM** — quando você escreveu. Serve pra ordenar a nota final.
- **tipo** — `feat` ou `fix`. É por ele que a release agrupa as seções.
- **slug** — minúsculas, sem acento, separado por hífen.

Exemplo: `changelogs/20260819-1815-feat-bandeja-do-sistema.md`

O conteúdo é só o(s) bullet(s), em pt-BR, do ponto de vista de quem usa o app —
o que mudou pra ele, não como foi implementado:

```markdown
- Ícone na bandeja do sistema: fechar pelo painel estaciona o app na bandeja, e
  o encerrar de vez fica no menu dela
```

## Regras

- **PR de `feat/*`, `fix/*` ou `release/*` DEVE adicionar pelo menos um arquivo
  aqui** — o check `changelog` reprova a PR sem isso, e também reprova nome fora
  do padrão acima.
- PR de `chore/*`, `docs/*` e afins não precisa (e não corta versão).
- Uma mudança por arquivo. Se a sua PR faz uma feat e um fix, são dois arquivos.
- Não edite arquivos de outra pessoa, nem apague os já existentes: no corte da
  release, a nota publicada é a junção dos arquivos **adicionados desde a tag
  anterior**, ordenados pelo nome e agrupados por tipo.

## E o CHANGELOG.md?

Fica como arquivo histórico do que já foi lançado até a v0.8.1. Ele não é mais
editado por PR nenhuma.
