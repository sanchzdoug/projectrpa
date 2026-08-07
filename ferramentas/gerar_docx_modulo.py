# -*- coding: utf-8 -*-
"""Relatorio Word do percurso de um modulo, com evidencias e tabelas.

Uso: python gerar_docx_modulo.py <payload.json> <saida.docx>

O payload vem de lib/relatorio-modulo.js. Cada tela recebe sua tabela montada
a partir do que foi lido, e o print correspondente como evidencia.
"""
import json, os, sys
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

payload_path, saida = sys.argv[1], sys.argv[2]
with open(payload_path, encoding="utf-8") as f:
    D = json.load(f)

doc = Document()
doc.styles["Normal"].font.name = "Calibri"
doc.styles["Normal"].font.size = Pt(10)
sec = doc.sections[0]
sec.left_margin = sec.right_margin = Cm(1.8)
sec.top_margin = sec.bottom_margin = Cm(1.8)
LARG = Cm(17.4)

# Paleta do modelo de formatacao (skill cs-generator). O conteudo regulatorio
# dela nao se aplica aqui: este documento e o registro do que foi verificado,
# nao uma especificacao. So o layout foi aproveitado.
COR_CABECALHO = RGBColor(0x1F, 0x49, 0x7D)   # azul escuro institucional
COR_SUB       = RGBColor(0x2E, 0x75, 0xB6)   # azul medio
COR_DESTAQUE  = RGBColor(0xBD, 0xD7, 0xEE)   # azul claro do cabecalho de tabela
COR_CINZA     = RGBColor(0xF2, 0xF2, 0xF2)   # zebra
COR_BRANCO    = RGBColor(0xFF, 0xFF, 0xFF)
VERMELHO = RGBColor(0xA3, 0x22, 0x35)
AMBAR = RGBColor(0x9A, 0x5A, 0x16)
VERDE = RGBColor(0x1B, 0x6B, 0x55)


def _fundo(cel, rgb):
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    sh = OxmlElement('w:shd')
    sh.set(qn('w:val'), 'clear')
    sh.set(qn('w:color'), 'auto')
    sh.set(qn('w:fill'), '%02X%02X%02X' % (rgb[0], rgb[1], rgb[2]))
    cel._tc.get_or_add_tcPr().append(sh)


def titulo(txt, nivel=1):
    par = doc.add_paragraph(style='Heading %d' % nivel)
    r = par.add_run(txt)
    r.bold = True
    r.font.size = Pt(14 - (nivel - 1) * 2)
    r.font.color.rgb = COR_CABECALHO if nivel == 1 else COR_SUB
    par.paragraph_format.space_before = Pt(10)
    par.paragraph_format.space_after = Pt(6)
    return par


def p(txt="", size=10, bold=False, italic=False, align=None, after=6, cor=None):
    par = doc.add_paragraph()
    r = par.add_run(txt)
    r.font.size = Pt(size); r.bold = bold; r.italic = italic
    if cor: r.font.color.rgb = cor
    if align: par.alignment = align
    par.paragraph_format.space_after = Pt(after)
    return par


def tabela(cab, linhas, larguras=None, fonte=8.5):
    if not linhas:
        return None
    t = doc.add_table(rows=1, cols=len(cab))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, c in enumerate(cab):
        cel = t.rows[0].cells[i]; cel.text = ""
        _fundo(cel, COR_CABECALHO)
        r = cel.paragraphs[0].add_run(str(c))
        r.bold = True; r.font.size = Pt(fonte); r.font.color.rgb = COR_BRANCO
    for n_ln, ln in enumerate(linhas):
        cells = t.add_row().cells
        for cel in cells:
            _fundo(cel, COR_CINZA if n_ln % 2 == 0 else COR_BRANCO)
        for i, v in enumerate(ln):
            cells[i].text = ""
            par = cells[i].paragraphs[0]
            s = "" if v is None else str(v)
            neg = s.startswith("**") and s.endswith("**")
            if neg: s = s[2:-2]
            r = par.add_run(s); r.font.size = Pt(fonte); r.bold = neg
            par.paragraph_format.space_after = Pt(1)
    if larguras:
        for row in t.rows:
            for i, w in enumerate(larguras):
                row.cells[i].width = w
    doc.add_paragraph().paragraph_format.space_after = Pt(3)
    return t


EMBUTIDAS = set()
SUBSTITUTAS = D.get("substitutas") or {}


def evidencia(caminho, legenda):
    if caminho:
        EMBUTIDAS.add(os.path.normcase(os.path.abspath(caminho)))
    # Arquivo expurgado como DUPLICATA e substituido pelo representante de
    # mesmo conteudo (md5 identico): a evidencia e a mesma imagem.
    if caminho and not os.path.exists(caminho) and caminho in SUBSTITUTAS:
        alt = SUBSTITUTAS[caminho]
        if os.path.exists(alt):
            caminho = alt
            legenda += "  [imagem identica reaproveitada apos expurgo de duplicata]"
    if not caminho or not os.path.exists(caminho):
        p("[evidência indisponível: %s]" % legenda, size=8, italic=True)
        return
    try:
        doc.add_picture(caminho, width=LARG)
    except Exception:
        p("[evidência ilegível: %s]" % legenda, size=8, italic=True)
        return
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap = doc.add_paragraph(); cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = cap.add_run("Evidência — " + legenda); r.font.size = Pt(8); r.italic = True
    cap.paragraph_format.space_after = Pt(12)


# ============================================================ capa
p("PERCURSO DE CONFIGURAÇÃO — MÓDULO %s" % D["modulo"].upper(),
  size=18, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, after=4)
p("SoftExpert Suite", size=12, align=WD_ALIGN_PARAGRAPH.CENTER, after=20)

a = D["ambiente"]; r = D["resumo"]
tabela(["Item", "Valor"], [
    ["Ambiente", "%s — %s" % (a["nome"], a["url"])],
    ["Papel", a["papel"]],
    ["Gerado em", D["geradoEm"]],
    ["Telas percorridas", r["telas"]],
    ["Registros abertos", r["abertos"]],
    ["Registros com acesso negado", "**%d**" % r["negados"]],
    ["Registros inconclusivos", r["inconclusivos"]],
    ["Método", "Automação Playwright sobre sessão autenticada manualmente"],
], larguras=[Cm(5), Cm(12.4)], fonte=9)

p()
p("COMO LER ESTE RELATÓRIO", size=10, bold=True)
p("Cada tela traz a tabela do que foi lido e o print da tela como evidência. Três "
  "situações são distintas e não devem ser confundidas: ACESSO NEGADO significa que o dado "
  "existe mas o perfil da coleta não o alcança — cabe ao cliente liberar ou verificar; VAZIO "
  "significa que a tela respondeu e não há registros; INCONCLUSIVO significa que a automação "
  "não conseguiu confirmar a leitura — é limitação da ferramenta e está listada ao final.",
  size=9, italic=True)
doc.add_page_break()

# ============================================================ acesso negado
if r["negados"]:
    titulo("1. Acesso negado — ação necessária do cliente", 1)
    p("Os registros abaixo existem, mas o perfil usado na coleta não pode visualizá-los. "
      "Para concluir a verificação, o cliente precisa liberar o acesso a este perfil ou "
      "executar a conferência destes itens por conta própria.", size=9.5, after=8)
    if D.get("mensagensNegado"):
        p("Mensagem devolvida pelo sistema:", size=9, bold=True, after=3)
        for m in D["mensagensNegado"]:
            p("« %s »" % m, size=9.5, italic=True, cor=VERMELHO, after=6)
    tabela(["Código", "Tela", "Negados", "de"],
           [[t["codigo"], t["funcao"], "**%d**" % t["negados"], t["registros"]]
            for t in D["telas"] if t["negados"]],
           larguras=[Cm(2.2), Cm(9.2), Cm(3), Cm(3)], fonte=9)
    doc.add_page_break()

# ============================================================ visão geral
titulo("2. Visão geral das telas", 1)
tabela(["Código", "Tela", "Tipo", "Registros", "Total", "Abertos", "Negados", "Inconcl."],
       [[t["codigo"], t["funcao"], t["tipo"], t["registros"], t.get("total") or "—",
         t["abertos"] or "—", ("**%d**" % t["negados"]) if t["negados"] else "—",
         t["inconclusivos"] or "—"] for t in D["telas"]],
       larguras=[Cm(1.9), Cm(5.6), Cm(2.1), Cm(1.9), Cm(1.6), Cm(1.6), Cm(1.6), Cm(1.6)], fonte=8)

# ---- cobertura da verificacao: o que foi olhado, e ate onde ----
p()
p("2.1  Cobertura da verificação", size=11, bold=True, after=4)
p("Quanto de cada tela foi efetivamente percorrido. «Páginas» são as combinações "
  "Faixa × Painel abertas dentro das janelas de registro; «Imagens» é quantas telas foram "
  "fotografadas; «Interpretadas» é em quantas dessas imagens a leitura visual foi escrita "
  "neste relatório. A diferença entre Imagens e Interpretadas é declarada de propósito: "
  "a imagem existe e pode ser conferida, mas a análise escrita ainda não foi feita.",
  size=9, italic=True, after=6)
tabela(["Código", "Tela", "Acionador", "Páginas", "Não config.", "Campos", "Imagens", "Interpret."],
       [[t["codigo"], t["funcao"], t.get("acionador") or "—",
         t.get("covPaginas") or "—", t.get("covNaoConfig") or "—", t.get("covCampos") or "—",
         t.get("covImagens") or "—", t.get("covInterpretadas") or "—"] for t in D["telas"]],
       larguras=[Cm(1.9), Cm(4.9), Cm(2.0), Cm(1.7), Cm(1.9), Cm(1.7), Cm(1.7), Cm(2.0)], fonte=8)

# ---- prova de que a coleta nao escreveu ----
recusados = {}
for t in D["telas"]:
    for reg in (t.get("registrosCompletos") or []):
        for b in (reg.get("botoesRecusados") or []):
            recusados[b] = recusados.get(b, 0) + 1
p()
p("2.2  Integridade da coleta — nenhuma gravação executada", size=11, bold=True, after=4)
if recusados:
    p("A janela de detalhe do SoftExpert abre em modo de EDIÇÃO. A coleta recusou "
      "deliberadamente todo controle capaz de gravar ou excluir, e registra abaixo quantas "
      "vezes cada um foi encontrado e recusado. Nenhum registro foi alterado por esta coleta.",
      size=9, after=6)
    tabela(["Controle recusado", "Vezes encontrado"],
           [[k, v] for k, v in sorted(recusados.items(), key=lambda x: -x[1])],
           larguras=[Cm(11.4), Cm(6)], fonte=9)
else:
    p("Nenhum controle de gravação foi encontrado nas telas percorridas.", size=9)
doc.add_page_break()

# ============================================================ telas sem conteudo
# Separadas do detalhamento: nao ha o que detalhar, e mistura-las com as telas
# configuradas faria o leitor procurar tabela onde nao existe.
vazias = [t for t in D["telas"] if t["tipo"] == "vazio"]
if vazias:
    titulo("2.3  Telas sem configuração", 1)
    p("As telas abaixo foram percorridas e não possuem configurações, parametrizações "
      "ou dados disponíveis neste ambiente.", size=9.5, after=8)
    tabela(["Código", "Tela", "Situação"],
           [[t["codigo"], t["funcao"],
             "Sem configurações/parametrizações ou dados disponíveis"] for t in vazias],
           larguras=[Cm(2.2), Cm(6.4), Cm(8.8)], fonte=9)
    doc.add_page_break()

# ============================================================ tela a tela
titulo("3. Detalhamento por tela", 1)
for t in D["telas"]:
    if t["tipo"] == "vazio":
        continue          # ja listadas na secao 2.3
    titulo("%s — %s" % (t["codigo"], t["funcao"]), 2)
    p("Tipo: %s · Registros listados: %s · Total informado pelo sistema: %s"
      % (t["tipo"], t["registros"], t.get("total") or "—"), size=9, italic=True, after=8)

    # tabela da listagem
    if t.get("colunas") and t.get("amostraGrade"):
        p("Listagem", size=10, bold=True, after=3)
        tabela(t["colunas"][:6], [l[:6] for l in t["amostraGrade"]], fonte=8)
    elif t.get("amostraArvore"):
        p("Estrutura (níveis)", size=10, bold=True, after=3)
        tabela(["Nível", "Item"], [[n["nivel"], n["nome"]] for n in t["amostraArvore"]],
               larguras=[Cm(2), Cm(15.4)], fonte=8)

    # páginas do painel de navegação da própria tela
    if t.get("paginas"):
        p("Páginas do painel de navegação", size=10, bold=True, after=3)
        tabela(["Página", "Campos", "Ativos"],
               [[k, v["campos"], v["ativos"]] for k, v in t["paginas"].items()],
               larguras=[Cm(9.4), Cm(4), Cm(4)], fonte=8.5)

        # Cada página com evidência propria: a imagem, a leitura da imagem e a
        # tabela extraida. Uma tela como a DC035 tem doze paginas de parametros
        # e resumi-las em "quantos campos" perde justamente a configuracao.
        for nome, v in t["paginas"].items():
            if not (v.get("print") or v.get("leitura") or v.get("detalhe")):
                continue
            doc.add_page_break()
            p("%s › %s" % (t["codigo"], nome), size=11, bold=True, after=4)
            evidencia(v.get("print"), "%s — pagina %s" % (t["codigo"], nome))
            if v.get("leitura"):
                p("Leitura da imagem", size=9.5, bold=True, after=2)
                for linha in v["leitura"]:
                    p(linha, size=8.5, after=1)
            if v.get("detalhe"):
                p("Campos extraidos", size=9.5, bold=True, after=2)
                tabela(["Campo", "Valor", "Editavel"],
                       [[c["rotulo"], c.get("valor") or "—",
                         "nao" if c.get("bloqueado") else "sim"] for c in v["detalhe"]],
                       larguras=[Cm(9.4), Cm(5.4), Cm(2.6)], fonte=8)

    # registros abertos
    if t.get("registrosDetalhe"):
        p("Registros verificados", size=10, bold=True, after=3)
        tabela(["Registro", "Identificador", "Campos", "Páginas internas", "Situação"],
               [[x["nome"], x.get("identificador") or "—", x["campos"],
                 ", ".join(x.get("paginas") or []) or "—", x["situacao"]]
                for x in t["registrosDetalhe"][:40]],
               larguras=[Cm(4.6), Cm(3.2), Cm(1.8), Cm(5.4), Cm(2.4)], fonte=8)
        if len(t["registrosDetalhe"]) > 40:
            p("(%d registros adicionais omitidos da tabela; todos constam nos dados brutos)"
              % (len(t["registrosDetalhe"]) - 40), size=8, italic=True)

    evidencia(t.get("print"), "%s — %s" % (t["codigo"], t["funcao"]))

    # ---- evidencia dos registros com ACESSO NEGADO ----
    # A tela de negativa e o que o cliente precisa ver para decidir entre
    # liberar o perfil ou fazer a verificacao por conta propria.
    negados_img = [x for x in (t.get("registrosNegadosPrints") or []) if x.get("arquivo")]
    if negados_img:
        doc.add_page_break()
        titulo("%s — evidência das negativas de acesso (%d)" % (t["codigo"], len(negados_img)), 2)
        p("Cada imagem abaixo é a janela devolvida pelo sistema ao tentar abrir o registro.",
          size=9, italic=True, after=6)
        for n_x, x in enumerate(negados_img):
            evidencia(x["arquivo"], "%s — %s · ACESSO NEGADO" % (t["codigo"], x["nome"]))
            # A leitura da imagem sai UMA vez por tela: as 114 negativas sao o
            # mesmo arquivo, e repetir o texto 114 vezes seria ruido.
            if n_x == 0 and x.get("leitura"):
                p("Leitura da imagem", size=9, bold=True, after=2)
                for linha in x["leitura"]:
                    p(linha, size=8.5, after=1)
                p("A leitura acima vale para as %d imagens desta seção: são o mesmo arquivo, "
                  "byte a byte." % len(negados_img), size=8, italic=True, after=8)

    # ---- configuração de CADA registro aberto ----
    completos = t.get("registrosCompletos") or []
    if completos:
        doc.add_page_break()
        p("Configuração registro a registro — %s (%d registros)" % (t["codigo"], len(completos)),
          size=11, bold=True, after=8)
        for reg in completos:
            # nome local separado: `titulo` e a funcao de cabecalho do modulo
            rotulo_reg = reg["nome"]
            if reg.get("identificador") and reg["identificador"] not in rotulo_reg:
                rotulo_reg += "  ·  %s" % reg["identificador"]
            p(rotulo_reg, size=10, bold=True, after=3)

            if reg["campos"]:
                tabela(["Campo", "Valor", "Aba"],
                       [[c["rotulo"], c["valor"], c.get("aba") or "—"] for c in reg["campos"]],
                       larguras=[Cm(6.6), Cm(7), Cm(3.8)], fonte=7.5)
            else:
                p("(sem campos legíveis)", size=8, italic=True, after=4)

            # grades internas (ex.: aba Responsável = lista de pessoas)
            for g in reg.get("abasGrade") or []:
                p("Aba %s — %d linha(s)" % (g["nome"], len(g["linhas"])), size=9, bold=True, after=2)
                tabela(g["colunas"][:6], [l[:6] for l in g["linhas"]], fonte=7.5)

            # Paginas internas do registro. A chave e "Faixa > Painel": o
            # conteudo esta no cruzamento dos dois eixos de navegacao.
            paginas = reg.get("paginas") or []
            nao_conf = [x for x in paginas if x.get("naoConfigurado")]
            com_dado = [x for x in paginas if not x.get("naoConfigurado")
                        and (x.get("campos") or x.get("grade"))]
            sem_nada = [x for x in paginas if not x.get("naoConfigurado")
                        and not x.get("campos") and not x.get("grade")]

            # Recursos NAO CONFIGURADOS: resultado, nao falha. Ficam em tabela
            # propria porque e justamente o tipo de diferenca que aparece ao
            # comparar dois ambientes.
            if nao_conf:
                p("Recursos nao configurados nesta categoria (%d)" % len(nao_conf),
                  size=9, bold=True, after=2)
                tabela(["Pagina", "Como o sistema indica"],
                       [[x["nome"], x.get("motivo") or "—"] for x in nao_conf],
                       larguras=[Cm(9.4), Cm(8)], fonte=7.5)

            for pg in com_dado:
                p("Pagina %s" % pg["nome"], size=9, bold=True, after=2)
                if pg.get("grade"):
                    tabela(pg["grade"]["colunas"][:6], [l[:6] for l in pg["grade"]["linhas"]], fonte=7.5)
                else:
                    tabela(["Campo", "Valor", "Editavel"],
                           [[c["rotulo"], c.get("valor") or "—",
                             "nao" if c.get("bloqueado") else "sim"] for c in pg["campos"]],
                           larguras=[Cm(7.6), Cm(7.2), Cm(2.6)], fonte=7.5)
                evidencia(pg.get("print"), "%s — %s · %s" % (t["codigo"], reg["nome"], pg["nome"]))
                if pg.get("leitura"):
                    p("Leitura da imagem", size=9, bold=True, after=2)
                    for linha in pg["leitura"]:
                        p(linha, size=8.5, after=1)

            if sem_nada:
                p("Paginas sem conteudo proprio: %s"
                  % ", ".join(x["nome"] for x in sem_nada), size=8, italic=True, after=6)

            # Botao de acao recusado: prova de que a coleta nao gravou nada.
            if reg.get("botoesRecusados"):
                p("Botoes de acao recusados pela coleta: %s"
                  % ", ".join(sorted(set(reg["botoesRecusados"]))), size=8, italic=True, after=6)

            # Evidencia da janela do registro: uma imagem por aba, com a leitura
            # da imagem quando ela foi feita. A tabela acima vem do DOM; a
            # imagem e o que o avaliador consegue conferir sem refazer o acesso.
            for pr in reg.get("prints") or []:
                legenda = "%s — %s" % (t["codigo"], reg["nome"])
                if pr.get("aba"):
                    legenda += " · aba %s" % pr["aba"]
                evidencia(pr.get("arquivo"), legenda)
                if pr.get("leitura"):
                    p("Leitura da imagem", size=9, bold=True, after=2)
                    for linha in pr["leitura"]:
                        p(linha, size=8.5, after=1)
            doc.add_paragraph().paragraph_format.space_after = Pt(6)

    doc.add_page_break()

# ============================================================ pendências
titulo("4. Pendências da automação", 1)
pend = [t for t in D["telas"] if t["tipo"] == "nada" or t["inconclusivos"]]
if pend:
    p("Diferente de acesso negado, aqui a limitação é da ferramenta e precisa de ajuste ou "
      "conferência manual.", size=9, italic=True, after=8)
    tabela(["Código", "Tela", "Situação", "Acionador usado"],
           [[t["codigo"], t["funcao"],
             ("%d inconclusivo(s)" % t["inconclusivos"]) if t["inconclusivos"] else "sem leitura",
             t.get("acionador") or "—"] for t in pend],
           larguras=[Cm(2.2), Cm(7.2), Cm(4), Cm(4)], fonte=9)
else:
    p("Nenhuma: todas as telas responderam e todos os registros foram classificados.", italic=True)

p()
titulo("5. Receita de navegação aplicada", 1)
p("Verificada contra a interface e aplicável aos demais módulos. Cada operação tenta os "
  "caminhos em ordem até um responder — por isso atende versões antigas e novas sem "
  "ramificação por versão.", size=9, italic=True, after=8)
tabela(["Operação", "Caminhos tentados, em ordem"], [
    ["Pesquisar", "botão .sgDFFilterSearchBtn → botão PESQUISAR → botão Filtros"],
    ["Expandir árvore", "ícone img.arrowplus (classe CSS, não imagem)"],
    ["Total de registros", "clique em “Exibir total de registros” (segundo clique obrigatório)"],
    ["Selecionar registro", "linha marcada no DOM → texto exato"],
    ["Abrir registro", "duplo clique na linha → lápis #btnedit — sempre abre JANELA NOVA"],
    ["Navegar dentro", "li.menu-item · a.page-has-content · span.x-tree-node-text · faixa seribbon-toolbar"],
    ["Conferência", "identificador da janela tem de bater com o registro pedido"],
], larguras=[Cm(4.4), Cm(13)], fonte=8.5)

p()
titulo("6. Ressalvas", 1)
for txt in D.get("ressalvas", []):
    par = doc.add_paragraph(txt, style="List Bullet")
    par.runs[0].font.size = Pt(9.5)

p()
# ============================================================ anexo de imagens
doc.add_page_break()
titulo("A. Anexo — demais imagens capturadas", 1)
faltantes = []
for cam in (D.get("todasImagens") or []):
    if os.path.normcase(os.path.abspath(cam)) not in EMBUTIDAS:
        faltantes.append(cam)
if faltantes:
    p("As imagens a seguir foram capturadas durante a verificação e não apareceram "
      "nas seções anteriores. Estão aqui para que nenhuma evidência colhida fique de "
      "fora do documento, mesmo sem análise escrita.", size=9, italic=True, after=8)
    for cam in faltantes:
        nome = os.path.basename(cam)
        pasta = os.path.basename(os.path.dirname(cam))
        evidencia(cam, "%s / %s" % (pasta, nome))
else:
    p("Todas as imagens capturadas já aparecem nas seções anteriores.", size=9, italic=True)
doc.add_page_break()

titulo("7. Revisão", 1)
tabela(["Revisado por", "Área", "Data", "Parecer"], [["", "", "", ""], ["", "", "", ""]],
       larguras=[Cm(4), Cm(4), Cm(2.6), Cm(6.8)], fonte=9)

doc.save(saida)
print("gerado: " + saida)
