# SE-Mapper

Ferramenta que levanta a configuração do SoftExpert Suite com evidência em
imagem e compara ambientes para qualificação de migração (GxP/CSV).

## Antes de qualquer coisa

**Leia `CONTINUIDADE.md`** — é o documento de passagem: definições, regras,
dialetos da interface, armadilhas já pagas, estado da coleta e por onde seguir.
Sem ele, você vai repetir erros que já custaram caro neste projeto.

Depois rode `node ferramentas/verificar-ambiente.js` para saber se há sessão viva.

## O que nunca esquecer

> O modo de falha desta ferramenta não é "não conseguir ler". É **afirmar
> leitura que não aconteceu**. Todo defeito já encontrado produziu dado
> plausível e errado.

**Medir, não interpretar.** Print é evidência, não diagnóstico. Para saber o que
uma tela faz: conte páginas do navegador antes e depois do clique, conte quantos
elementos casam com cada seletor, instrumente o filtro. Concluir pelo visual já
levou a correções erradas mais de uma vez.

**Quatro estados que o relatório nunca mistura:** verificado · acesso negado
(ação do cliente) · sem detalhe (escopo definido pelo Douglas) · inconclusivo
(`tipo=nada`, limitação da ferramenta). Só o último é problema nosso.

**Nunca clicar em controle que grava.** A janela de detalhe abre em modo de
edição. Ver `ERR-012` no Obsidian: a coleta clicou «Salvar e sair» em 10
registros GxP porque o filtro comparava só «salvar». A proteção do sistema que
salvou aquele caso não existe mais.

## Fluxo — um módulo por vez

`map` → Douglas sequencia e define a profundidade de cada tela → `andar` →
**ler as imagens e escrever a interpretação** → `relatorio-modulo` → aceite do
Douglas → `expurgar`. Não começar o módulo seguinte antes do relatório sair.

As regras de profundidade ficam em `dados/ignorar.json` e `dados/navegar.json`.
São decisão do cliente, com motivo escrito — o relatório imprime o motivo para
que a lacuna apareça como decisão, não como omissão.

## Ambiente

- Windows, PowerShell. Login no SoftExpert é **manual** (CDP na porta 9222).
- Node ≥ 18 + Playwright; Python com `python-docx` para o Word.
- `dados/` contém configuração GxP de cliente e **não vai para o GitHub**.
