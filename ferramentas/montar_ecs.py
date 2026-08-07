# -*- coding: utf-8 -*-
"""Monta a entrada da ECS/CS a partir do que foi EFETIVAMENTE coletado.

Cada parametro da especificacao nasce de uma leitura registrada em
passos.json (extracao do DOM) e, quando existe, da transcricao da imagem.
Nada e digitado a mao: se o dado nao foi lido, ele nao entra -- e a lacuna
aparece como [PLACEHOLDER] em vez de virar texto plausivel.

A rastreabilidade ERU/EFS fica como [PLACEHOLDER]: esses documentos nao
existem neste levantamento e inventar identificador de requisito seria
fabricar rastreabilidade regulatoria.
"""
import json, io, os, sys

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..',
                    'dados', 'ambientes', 'desenvolvimento')
PASSOS = json.load(io.open(os.path.join(BASE, 'passos.json'), encoding='utf-8'))
try:
    TRANSC = json.load(io.open(os.path.join(BASE, 'transcricoes.json'), encoding='utf-8'))
except Exception:
    TRANSC = {}

PH = "[PLACEHOLDER]"

def telas():
    return {t.get('codigo'): t for t in PASSOS.get('telas', {}).values()
            if t.get('modulo') == 'Documento'}

T = telas()

def chave(png):
    if not png: return None
    return '/'.join(str(png).replace('\\', '/').split('/')[-2:])

def evid(png):
    k = chave(png)
    if not k: return "sem imagem"
    return ("imagem %s%s" % (k, " (interpretada)" if k in TRANSC else " (nao interpretada)"))

CODIGO = ('{', '}', ';', '=>', 'function(', 'function (', 'var ', 'window.')

def rotulo_valido(rot):
    """Um rotulo com cara de codigo nao e rotulo.

    A busca do rotulo caminha pelos irmaos a direita do controle e chegava a
    varrer o corpo de um <script>, entregando JavaScript como nome de
    parametro de configuracao.
    """
    r = (rot or '').strip()
    if r in ('', '(sem rotulo)', '(sem rótulo)'): return False
    if len(r) > 90: return False
    return not any(t in r for t in CODIGO)

def par(nome, valor, justificativa, verificacao):
    return {"parametro": nome, "valor": valor, "referencia_efs_eru": PH,
            "justificativa": justificativa, "verificacao": verificacao}

# ------------------------------------------------- 10.x montados dos dados
def do_paginas(codigo, filtro=None):
    """Parametros vindos das paginas do painel de navegacao de uma tela."""
    t = T.get(codigo) or {}
    out = []
    for nome, v in (t.get('paginas') or {}).items():
        if nome == '__ignorados' or not v: continue
        if filtro and nome not in filtro: continue
        for c in (v.get('campos') or []):
            rot = c.get('rotulo') or ''
            if not rotulo_valido(rot): continue
            val = c.get('valor')
            val = '(vazio)' if val in (None, '') else val
            if c.get('bloqueado'):
                val += "  [campo nao editavel pelo cliente]"
            out.append(par("%s > %s" % (nome, rot), val,
                           "Parametro lido em %s (%s), pagina %s." % (codigo, t.get('funcao'), nome),
                           "%s; %s" % (PH, evid(v.get('print')))))
    return out

def do_registros(codigo, campos_chave=None, limite=None):
    """Parametros vindos dos registros de uma tela (um bloco por registro)."""
    t = T.get(codigo) or {}
    out = []
    regs = [r for r in (t.get('registros') or [])
            if r.get('abriu') and not r.get('negado') and not r.get('inconclusivo')]
    if limite: regs = regs[:limite]
    for r in regs:
        img = (r.get('prints') or [{}])[0].get('arquivo')
        campos = [c for c in (r.get('campos') or []) if rotulo_valido(c.get('rotulo'))]
        if campos_chave:
            campos = [c for c in campos if c.get('rotulo') in campos_chave]
        resumo = " · ".join("%s=%s" % (c['rotulo'], c.get('valor') or '(vazio)')
                            for c in campos[:8]) or "(sem campos legiveis)"
        marcados = [c['rotulo'] for c in (r.get('campos') or []) if c.get('valor') == 'ATIVO']
        if marcados:
            resumo += "  |  ATIVOS: " + ", ".join(marcados)
        out.append(par(r.get('nome'), resumo,
                       "Registro configurado em %s (%s)." % (codigo, t.get('funcao')),
                       "%s; %s" % (PH, evid(img))))
    return out

def bloco(modulo, secao, parametros):
    return {"modulo": modulo, "secao": secao, "parametros": parametros}

CFG = []

# 10.1 Workflow / roteiro de revisao
p = do_registros('DC037') + do_registros('DC055')
if p: CFG.append(bloco("Fluxo de revisao de documentos (roteiros e regras)", "10.1", p))

# 10.2 Seguranca e controle de acesso
p = do_registros('DC063')
if p: CFG.append(bloco("Perfis de permissao (RBAC) - modulo Documento", "10.2", p))

# 10.3 Assinaturas eletronicas
p = do_paginas('DC035', filtro={'Assinatura digital'})
if p: CFG.append(bloco("Assinatura eletronica e digital", "10.3", p))

# 10.4 Trilha de auditoria e parametros gerais
p = do_paginas('DC035', filtro={'Geral', 'Documento', 'Revisão'})
if p: CFG.append(bloco("Parametros gerais, controle de revisao e auditoria", "10.4", p))

# 10.5 Formularios, mascaras e navegacao
p = do_registros('DC033', limite=60) + do_registros('DC034')
if p: CFG.append(bloco("Mascaras de identificacao e navegadores dinamicos", "10.5", p))

# 10.6 Integracoes e servicos
p = do_paginas('DC035', filtro={'Serviços', 'Google Drive', 'Microsoft 365', 'Aplicativo'})
if p: CFG.append(bloco("Integracoes, servicos e visualizadores", "10.6", p))

# 10.7 Saidas: conversao, marca d'agua, copia impressa, exportacao
p = (do_paginas('DC035', filtro={'Conversão para PDF', 'Cópia impressa'})
     + do_registros('DC045') + do_registros('DC052'))
if p: CFG.append(bloco("Conversao para PDF, marca d'agua e copia controlada", "10.7", p))

# 10.8 Estrutura de categorias, validade e temporalidade
p = (do_registros('DC043', limite=40) + do_registros('DC044')
     + do_registros('DC042') + do_registros('DC047') + do_registros('DC046'))
if p: CFG.append(bloco("Categorias, validade, temporalidade e distribuicao", "10.8", p))

total = sum(len(b['parametros']) for b in CFG)
sys.stderr.write("blocos=%d parametros=%d\n" % (len(CFG), total))
io.open(sys.argv[1], 'w', encoding='utf-8').write(json.dumps(CFG, ensure_ascii=False))
