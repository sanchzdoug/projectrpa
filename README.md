# SE Mapper

Mapeia a configuração do **SoftExpert Suite** em vários ambientes e compara um contra o
outro — o caso de uso é qualificar uma migração: o que está em homologação confere com
produção? Validado no 2.2.3, Patch 403.

O sistema também se auto-mede. Toda tela que falha ou abre sem conteúdo é registrada, e a
**taxa de falha** aparece no painel: uma coleta que falha muito não é confiável, e isso
precisa estar visível em vez de escondido atrás de um número bonito.

## Como rodar

Duplo clique em **`iniciar.cmd`** — ele sobe o painel e abre `http://localhost:7300` no navegador.
Ou, pelo terminal:

```bash
cd se-mapper
node se.js painel
```

A janela do terminal precisa continuar aberta: é ela que segura a aplicação. Fechar ou dar
Ctrl+C encerra o painel.

Daí em diante é tudo pela tela: cadastrar ambiente, abrir o navegador para login, disparar o
mapeamento, escolher o que aprofundar, comparar e gerar relatório. A linha de comando abaixo
continua valendo para quem preferir, e os dois caminhos usam os mesmos dados.

**Dois processos ficam de pé enquanto você trabalha:** o painel (porta 7300) e o navegador da
coleta (porta 9222), aberto pela etapa 2. Os dois precisam continuar vivos até a coleta terminar.

## Fluxo pela linha de comando

```bash
# 1. cadastrar o ambiente de origem
node se.js env add --nome "Homologação" --url https://<amb>.softexpert.app --papel origem
node se.js login          # você loga na mão; deixe o processo rodando
node se.js map            # componentes, menus, tarefas e contagem por tela
node se.js dash           # painel: progresso, erros e seleção de telas
#    marque as telas a aprofundar, clique em "Baixar seleção",
#    salve o arquivo como dados/selecao.json
node se.js deep           # abre registro a registro do que você marcou

# 2. quando o outro ambiente estiver disponível
node se.js env add --nome "Produção" --url https://<amb>.softexpert.app --papel destino
node se.js login
node se.js map
node se.js deep           # usa a MESMA seleção, sem você remarcar nada

# 3. comparar
node se.js compare --origem homologacao --destino producao
node se.js dash           # painel de comparação
```

Durante uma coleta longa, `node se.js dash --acompanhar` gera uma página que se atualiza
a cada 15s — dá para deixar aberta num monitor.

## O que a comparação confronta

| Nível | O que é comparado | Como aparece |
|---|---|---|
| Componentes | módulos instalados/visíveis | só na origem · só no destino |
| Telas | por **código** (DC043, WF019…) — o `pageId` muda entre ambientes | conforme · divergente · só de um lado |
| Registros | quantidade em cada tela | divergente quando os números não batem |
| Parâmetros | campo a campo dos registros aprofundados | origem → destino, valor a valor |

O **traço de divergência** no topo do painel é a leitura rápida: cada tela é um tique,
a altura é o tamanho da diferença, e os tiques ficam agrupados por módulo. Linha plana
significa ambientes alinhados; um bloco de picos mostra onde o problema se concentra.

## Indicadores de confiabilidade

O painel separa dois tipos de problema, porque eles pedem tratamentos diferentes:

- **exceção** — a automação quebrou naquela tela (erro de rede, timeout, seletor)
- **sem conteúdo** — a tela abriu e nada legível foi extraído: precisa de conferência manual

`taxa de falha = (exceções + sem conteúdo) / telas`. Os dois números aparecem separados no
painel e a lista completa fica na seção "Erros e telas para tratamento manual", com módulo,
código e motivo.

## Somente leitura, com uma ressalva

`login`, `map`, `dash` e `compare` não alteram nada: navegam e clicam apenas em **PESQUISAR**.

`deep` é diferente. O SoftExpert **não oferece** modo de visualização para os registros de
configuração — o único caminho até os parâmetros é o botão de edição. Então `deep` abre cada
registro em modo de edição, lê os campos e sai sem salvar. Isso **fica registrado na trilha
de auditoria**, o que é desejável: se algo for alterado por acidente, a trilha mostra.

## Comportamentos do SoftExpert embutidos no código

Descobertos por inspeção do DOM, concentrados em `lib/core.js` (`SEL`). Não mude sem reinspecionar.

| Comportamento | Como lidar |
|---|---|
| Telas de cadastro abrem com painel de filtros; a grade fica vazia | Acionar **PESQUISAR** antes de ler |
| A página tem 4 frames (`iframe`, `isoright`, `mainFrame`, `dataFrame`) | Escolher o frame **pelo conteúdo**, nunca pelo nome |
| Árvores hierárquicas | Cada nó é `table.nodeElm`; o nível vem do `margin-left` (16px por nível) |
| Os `div#lineID-*` parecem nós, mas não são | São blocos de renderização — devolvem ~10 em vez de 261 |
| Grades | `#t_content_gridframe`, página de **50 linhas** — acima disso há mais registros |
| Rodapé "Exibir total de registros **1 - 13**" | O "1" é o início do intervalo, **não** a contagem |
| `dblclick` num registro | Só **seleciona** a linha; não abre nada |
| Para abrir o registro | Selecionar e clicar em `#btnedit` (barra ExtJS no frame `iframe`) |
| Sessão de navegador com prazo fixo | Não use: derruba a coleta no meio. `login` roda sem prazo |

## Estrutura

```
se.js                        CLI
lib/core.js                  Playwright, sessão, ambientes, erros, seletores
lib/env.js                   cadastro e troca de ambiente
lib/map.js                   componentes, menus, tarefas, contagem por tela
lib/deep.js                  registro a registro (seleção compartilhada)
lib/compare.js               motor de comparação entre ambientes
lib/dash.js                  painel HTML (mapeamento e comparação)
ferramentas/importar-crawl.js   importa varredura anterior para um ambiente

dados/
  atual.json                 ambiente ativo
  selecao.json               telas a aprofundar — COMPARTILHADA entre ambientes
  comparacao.json            resultado do compare
  painel.html                painel gerado
  ambientes/<slug>/
    ambiente.json  mapa.json  contagem.json  profundo.json  erros.json  prints/
```

## Dependência

Usa o Playwright do plugin `playwright-skill` se estiver instalado. Caso contrário:

```bash
npm i playwright
```
