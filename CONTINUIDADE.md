# SE-Mapper — definições, regras e estado

Documento de passagem. Reúne o que foi decidido, o que foi medido e onde o
trabalho parou, para que o desenvolvimento continue sem depender de recuperar
histórico de conversa.

Atualizado em 11/08/2026 · ambiente `unitherpharma-dev` (SoftExpert 3.1).

---

## 1. O que a ferramenta é

Percorre o SoftExpert Suite de um ambiente, registra a configuração tela a tela
e registro a registro **com evidência em imagem**, e compara dois ambientes para
qualificação de migração.

Login é **manual**: a ferramenta se conecta por CDP a um Chromium já autenticado
na porta 9222. Não há automação de credencial. Se a sessão cair, a coleta para em
vez de gravar telas de login como resultado vazio.

### O princípio que governa todo o desenho

> O modo de falha nunca foi "não consegue ler". É **afirmar leitura que não
> aconteceu**. Todo defeito encontrado produziu dado plausível e errado.

Daí a regra prática que se provou várias vezes: **medir, não interpretar**. Duas
vezes concluí o dialeto de uma tela olhando um print e errei; o que resolveu foi
contar páginas do navegador, contar quantos elementos casam com cada seletor,
instrumentar o filtro. Print serve de evidência, não de diagnóstico.

### Quatro estados que o relatório nunca mistura

| Estado | Significado | Quem resolve |
|---|---|---|
| **verificado** | leitura confirmada | — |
| **acesso negado** | o perfil não enxerga o registro | cliente: liberar perfil ou conferir por conta própria |
| **sem detalhe** | escopo dispensado por decisão do cliente | ninguém — é decisão registrada |
| **inconclusivo** (`tipo=nada`) | a ferramenta não conseguiu ler | quem mantém a ferramenta |

Só o último é problema da ferramenta. Confundi-los é o erro que o resto do
trabalho existe para evitar.

---

## 2. Fluxo acordado — um módulo por vez

1. `map` — percorre componentes e menus, sem abrir registro
2. **Douglas sequencia**: quais componentes, e a profundidade de cada tela
3. `andar` nas telas indicadas
4. **ler as imagens** e escrever a interpretação em `transcricoes.json`
5. `relatorio-modulo`
6. **aceite** do Douglas → `aceitar`
7. `expurgar --nivel pos-aceite` para liberar espaço
8. próximo componente

Nada de começar o módulo seguinte antes do relatório do atual sair.

---

## 3. Sistema de regras de profundidade

Duas listas em `dados/`, que se combinam:

| Arquivo | Efeito |
|---|---|
| `ignorar.json` | tela é aberta, contada e fotografada; **registros não são abertos** |
| `navegar.json` | declara que a tela **tem** painel interno; se não for percorrido, vira **pendência** |

A combinação das duas dá três níveis:

- **completo** — só em `navegar.json`: percorre painel, abre registros, navega dentro deles
- **só navegar** — nas duas: percorre e fotografa o painel, não abre registro
- **só evidenciar** — só em `ignorar.json`: foto principal e total

Campos de `navegar.json`:
- `soNoRegistro: true` — o painel vive **dentro** da janela do registro, não na tela.
  Sem isso, a tela gera pendência falsa (aconteceu em CM011, CM007, CM009, CM010).

Toda entrada guarda `motivo`, `definidoPor` e `em`. O relatório imprime o motivo,
para que a lacuna apareça como decisão e não como omissão.

> **A pendência de painel tem dois significados** e sempre exige conferir qual:
> painel realmente não percorrido, **ou declaração errada minha**. Em CM018,
> CM025 e CM026 eu declarei painel onde não existia — medido depois, não havia
> coluna de navegação nenhuma.

### Estado atual das regras — módulo Configuração (26 de 26 classificadas)

**Completo (8)** — `CM006` Sistema · `CM007` Home · `CM008` Autenticação ·
`CM009` Licença de acesso · `CM010` Servidor de e-mail · `CM011` Grupo de acesso ·
`CM022` Notificação por e-mail · (`DC035` do módulo Documento)

**Só navegar (2)** — `CM032` Busca geral · `CM056` Gerenciar conta

**Só evidenciar (16)** — `CM001` · `CM002` · `CM003` · `CM004` · `CM012` ·
`CM018` · `CM019` · `CM020` · `CM023` · `CM025` · `CM026` · `CM027` · `CM030` ·
`CM031` · `CM034` · `CM055` · `CM058`

Critério que emergiu: **volume alto costuma indicar log, não parametrização** —
`CM020` tem 52.697 registros, `CM002` 6.705, `CM004` 2.404. Mas a regra é sempre
decisão explícita do cliente, nunca heurística por contagem.

Distinção que importa: `CM012` é a **configuração** da trilha (o que é auditado);
`CM002` e `CM003` são o **conteúdo** da trilha e entram só como total.

---

## 4. Dialetos do SoftExpert 3.1 — medidos, não supostos

### 4.1 Tela de detalhe (como o registro abre)

| Dialeto | Caminho | Como reconhecer |
|---|---|---|
| janela nova | duplo clique na linha | `page.waitForEvent('popup')` dispara |
| lápis da barra | `#btnedit` | grade e árvore clássicas |
| **modal em página** | duplo clique | `div.mask.modalAnimate` + `data-id="semodal_*"` |
| **sobreposição React** | «Ações» → «Editar» | `position:fixed` + z-index alto, **sem classe nem role** |

> Para distinguir: **conte as páginas do navegador antes e depois do clique**.
> Duas antes, duas depois, zero iframes ⇒ é sobreposição, por mais que pareça
> janela nova na tela.

### 4.2 Painel de navegação — cinco gramáticas, nenhuma casa com outra

| Seletor | Onde |
|---|---|
| `li.menu-item` | parâmetros clássicos (DC035) |
| `ul.tabs > li.tab > a.tabText` | parâmetros novos (CM006, CM008, CM022) |
| `a[class*=seribbon-toolbar]` | faixa «Dados do registro» |
| `div.sgNavHeader` | **título de seção, NÃO item** — ver armadilha abaixo |
| `[class*=newSimpleListItem_simpleList]` | lista React (CM056, CM032) |

O último traz **hash de build** no nome (`_aA7QD`, `_K6RgN`). Casar por prefixo;
amarrar no nome completo quebra na próxima versão — justamente o cenário de
comparar ambientes de versões diferentes.

---

## 5. Armadilhas já pagas — não repetir

**`div.sgNavHeader` no seletor de itens.** É o título («NAVEGAÇÃO», «GERAL»), não
um item. Incluído, ele desloca os índices e o `innerText` dele concatena os
filhos — foi assim que CM006 e CM008 reportaram «14 páginas» que **não existiam**.
Número inflado que passou por dado, e eu o repassei duas vezes como resultado.

**Clicar por índice.** A lista se redesenha a cada navegação e `nth(i)` passa a
apontar para outro elemento, ou para um já removido. Marcar no DOM
(`data-se-nav`) e clicar pela marca.

**Ordem: ler a listagem ANTES de percorrer o painel.** Percorrer navega a tela e
a grade desaparece. CM007 perdeu os 3 registros que tinha; CM006 e CM008 saíam
como `tipo=nada` pelo mesmo motivo.

**Casamento de texto largo.** `/a[çc][õo]es/` casa dentro de **"notificações"** —
a coleta clicava no sino em vez do menu da linha. Mesma família do ERR-012, em
que «Salvar e sair» passou por um filtro que comparava só «salvar».

**Expurgo por ocorrência.** O inventário lista uma entrada por *referência*, e o
mesmo arquivo é referenciado em vários lugares. Agrupar por ocorrência fez a
segunda referência virar «duplicata dele mesmo» e **268 evidências foram
apagadas**. Agrupar por arquivo único, e nunca remover sem que outro arquivo com
o mesmo md5 permaneça em disco.

---

## 6. Estado da coleta

| Módulo | Telas | Registros | Abertos | Negados | Páginas | Imagens | `nada` |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Documento** | 26 | 244 | 130 | 114 | 12 | 588 | 0 |
| **Administração** | 29 | 351 | 351 | 0 | 10 | 1.038 | 6 |
| **Configuração** | 26 | 19 | 19 | 0 | 41 | 60 | 4 |

**69 transcrições** escritas (leitura de imagem virada em texto).
**23 componentes contratados**, 1 em teste (Kanban, fora do escopo), **233 telas
de configuração** no mapa.

- **Documento** — relatório gerado, **aceito**, expurgo de duplicatas aplicado.
- **Administração** — coletado, **sem relatório ainda**. É o maior volume.
- **Configuração** — coletado, **zero pendências**, relatório gerado; falta
  interpretar as imagens.

---

## 7. Pendências técnicas

**`tipo=nada` em 4 telas da Configuração** (`CM012`, `CM030`, `CM031` e outra).
Nas três primeiras deixou de importar: viraram «só evidenciar» por decisão. Mas a
causa não foi isolada — em CM012 os campos existem (`sgWidget6`, `sgWidget11`), o
filtro os **aceita** quando testado isolado, e a coleta não os captura. Há
diferença entre sondagem e execução que ainda não achei.

**Interpretação das imagens da Configuração** — 41 páginas de painel colhidas,
2 interpretadas (`CM008 › Segurança`, `CM012`).

**Relatório da Administração** — 1.038 imagens esperando.

**Comparação entre ambientes** — nunca executada com dois ambientes reais.

---

## 8. Achados que interessam ao cliente

**`CM008 › Segurança`** — quatro pontos de controle de acesso:
contrassenha em operações críticas **desligada**; senha **sem validade**;
**controle de repetição = 0** (senha reutilizável); tamanho mínimo 6. Bloqueio
após 5 tentativas por 2 minutos, mas **sem notificação a ninguém**.

**`CM012`** — trilha «Habilitar por completo», as quatro ações auditadas
(marcadas e acinzentadas, impostas pelo produto), retenção **3.997 dias**.
O número não é redondo — vale confirmar se foi deliberado.

**Versão mudou durante o trabalho**: mapeamento inicial em **Patch 61**, CM008
mostra **Patch 63**. Parte da coleta é de uma versão, parte de outra.

**ERR-012** (Obsidian) — a coleta clicou «Salvar e sair» em 10 registros GxP.
Nada foi gravado: o sistema exigiu contrassenha e a conta não tinha. A rede que
salvou o caso **não existe mais** (contrassenha habilitada depois), então o filtro
da ferramenta passou a ser a única proteção.

---

## 9. Comandos

```bash
node ferramentas/verificar-ambiente.js     # Node, Playwright, Chromium, Python, sessão
node se.js login                           # abre o navegador para login manual
node se.js map --remapear                  # componentes e menus
node se.js andar --modulo X --registros 9999
node se.js andar --tela CM006,CM008 --registros 9999
node se.js relatorio-modulo --modulo X
node se.js aceitar --modulo X              # congela o md5 do .docx
node se.js expurgar --modulo X --nivel pos-aceite --aplicar
node se.js painel --porta 7310             # painel de controle
empacotar.cmd                              # zip só com código
```

Painel em `lib/painel.html`, servido por `se.js painel`. Fica fora do template
literal do servidor de propósito: escape de aspas aninhadas já quebrou a página
duas vezes.

---

## 10. Onde continuar

Ordem sugerida:

1. **Interpretar as 41 páginas da Configuração** — o dado está colhido e a
   interpretação é o que falta para o relatório valer.
2. **Gerar o relatório da Administração** — 1.038 imagens paradas.
3. **Isolar o `tipo=nada`** comparando lado a lado o que a sondagem faz e o que
   o `andar` faz na mesma tela. É diferença de ambiente de execução.
4. **Exercitar a comparação** com dois ambientes mapeados — é o propósito final
   da ferramenta e nunca foi testado de verdade.

Há **6 arquivos modificados não commitados** (`andar.js`, `core.js`,
`extracao.js`, `map.js`, `servidor.js`, `painel.html`) sobre `9aa9090`.

Ver também, no Obsidian: `SoftExpert_Navegacao_Automatizada`,
`SE-Mapper_Ferramenta`, `ERR-012`.
