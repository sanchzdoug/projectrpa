'use strict';
/**
 * Painel de controle local: cadastra ambientes, dispara as etapas e acompanha
 * a execução pelo navegador — sem precisar de linha de comando.
 *
 *   node se.js painel
 *
 * O servidor só escuta em 127.0.0.1. Ele executa os próprios comandos do
 * SE Mapper como processos filhos e transmite a saída para a tela.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { listaAmbientes, ambienteAtual, defineAtual, criaAmbiente, excluiAmbiente, leJson, leSelecao,
        gravaSelecao, qualidade, conecta, RAIZ, DADOS } = require('./core');
const { CSS, esc, dataHora } = require('./dash');

const PORTA = 7300;

// ------------------------------------------------------- execução de etapas
let tarefa = null;   // etapa finita: map, deep, compare, relatorio
let sessao = null;   // processo do login — vive enquanto durar a coleta, não é etapa

/**
 * O login não é uma etapa: ele fica de pé segurando a sessão do navegador
 * enquanto as etapas rodam. Tratá-lo como tarefa travaria todo o resto.
 */
function iniciaSessao(forcar) {
  if (sessao && !sessao.fim) {
    // processo vivo: só recusa se ele realmente estiver de pé e o pedido não for de reabertura
    if (!forcar) return { erro: 'Já existe um processo de sessão. Use "Reabrir navegador" para recomeçar.' };
    try { sessao.proc.kill(); } catch (e) { /* já morreu */ }
    sessao.fim = Date.now();
  }
  const proc = spawn(process.execPath, [path.join(RAIZ, 'se.js'), 'login'], {
    cwd: RAIZ, env: process.env, windowsHide: true,
  });
  sessao = { proc, linhas: [], inicio: Date.now(), fim: null };
  const acumula = buf => {
    for (const l of String(buf).split(/\r?\n/)) {
      if (!l.trim()) continue;
      sessao.linhas.push(l);
      if (sessao.linhas.length > 60) sessao.linhas.shift();
    }
  };
  proc.stdout.on('data', acumula);
  proc.stderr.on('data', acumula);
  proc.on('close', () => { sessao.fim = Date.now(); });
  return { ok: true };
}

function encerraSessao() {
  if (!sessao || sessao.fim) return { erro: 'Nenhuma sessão aberta por aqui.' };
  try { sessao.proc.kill(); } catch (e) { /* já morreu */ }
  sessao.fim = Date.now();
  return { ok: true };
}

function iniciaTarefa(tipo, args, slug) {
  if (tarefa && !tarefa.fim) return { erro: 'Já existe uma etapa em execução: ' + tarefa.tipo };
  const proc = spawn(process.execPath, [path.join(RAIZ, 'se.js'), ...args], {
    cwd: RAIZ, env: process.env, windowsHide: true,
  });
  tarefa = { tipo, slug, proc, linhas: [], inicio: Date.now(), fim: null, codigo: null };
  const acumula = buf => {
    for (const l of String(buf).split(/\r?\n/)) {
      if (!l.trim()) continue;
      tarefa.linhas.push(l);
      if (tarefa.linhas.length > 400) tarefa.linhas.shift();
    }
  };
  proc.stdout.on('data', acumula);
  proc.stderr.on('data', acumula);
  proc.on('close', c => { tarefa.fim = Date.now(); tarefa.codigo = c; });
  return { ok: true };
}

function paraTarefa() {
  if (!tarefa || tarefa.fim) return { erro: 'Nenhuma etapa em execução' };
  try { tarefa.proc.kill(); } catch (e) { /* já morreu */ }
  tarefa.fim = Date.now();
  return { ok: true };
}

// ------------------------------------------------------------------- estado
let cdpDesde = null;   // instante em que a sessão do navegador foi vista pela primeira vez

async function estado() {
  const ambientes = listaAmbientes();
  const atual = ambienteAtual();
  // NÃO chame esta variável de "sessao": o processo de login já tem esse nome
  // no módulo, e a sombra faria a leitura de estado quebrar assim que o
  // navegador ficasse ativo.
  let cdpAtivo = false;
  try { const { browser } = await conecta(); await browser.close(); cdpAtivo = true; } catch (e) { /* sem sessão */ }
  if (cdpAtivo && !cdpDesde) cdpDesde = Date.now();
  if (!cdpAtivo) cdpDesde = null;

  const detalhe = ambientes.map(a => {
    const mapa = leJson('mapa.json', null, a.slug);
    const q = qualidade(a.slug);
    const prof = leJson('profundo.json', { telas: {} }, a.slug);
    const previstas = mapa ? mapa.componentes.reduce((s, c) => s + c.menuConfiguracao.length, 0) : 0;
    return {
      ...a,
      mapeado: !!mapa,
      componentes: mapa ? mapa.componentes.length : 0,
      previstas, varridas: q.total, lidas: q.lidas,
      semLeitura: q.semConteudo, excecoes: q.comExcecao, taxaFalha: q.taxaFalha,
      pct: previstas ? Math.round(q.total * 100 / previstas) : 0,
      telasProfundas: Object.keys(prof.telas).length,
      registrosProfundos: Object.values(prof.telas).reduce((s, t) => s + Object.keys(t.registros || {}).length, 0),
    };
  });

  const comparacao = fs.existsSync(path.join(DADOS, 'comparacao.json'))
    ? JSON.parse(fs.readFileSync(path.join(DADOS, 'comparacao.json'), 'utf8')).resumo : null;

  return {
    ambientes: detalhe,
    atual: atual ? atual.slug : null,
    sessao: cdpAtivo,            // o navegador respondeu na porta de depuração
    selecao: (leSelecao().telas || []).length,
    comparacao,
    cdpDesde,                    // desde quando o navegador responde
    verificadoEm: Date.now(),    // instante desta checagem
    sessaoProc: sessao ? {
      viva: !sessao.fim,
      desde: sessao.inicio,
      duracao: Math.round(((sessao.fim || Date.now()) - sessao.inicio) / 1000),
      linhas: sessao.linhas.slice(-8),
    } : null,
    tarefa: tarefa ? {
      tipo: tarefa.tipo, slug: tarefa.slug, emAndamento: !tarefa.fim,
      codigo: tarefa.codigo, linhas: tarefa.linhas.slice(-120),
      duracao: Math.round(((tarefa.fim || Date.now()) - tarefa.inicio) / 1000),
    } : null,
    relatorios: fs.existsSync(path.join(DADOS, 'relatorios'))
      ? fs.readdirSync(path.join(DADOS, 'relatorios')).sort().reverse().slice(0, 20) : [],
  };
}

// -------------------------------------------------------------------- tela
const ESTILO_EXTRA = `
.passo{border:1px solid var(--vinco);background:var(--papel-2);margin-bottom:12px}
.passo__c{display:flex;align-items:center;gap:14px;padding:13px 16px;border-bottom:1px solid var(--vinco-2)}
.passo__n{font-family:var(--display);font-size:12px;font-weight:600;letter-spacing:.1em;
  width:26px;height:26px;display:grid;place-items:center;border:1.5px solid var(--tinta);flex:none}
.passo--feito .passo__n{background:var(--ok-p);border-color:var(--ok-p);color:#fff}
.passo--ativo .passo__n{background:var(--tinta);color:#fff}
.passo--espera{opacity:.55}
.passo__t{font-family:var(--display);font-size:16px;font-weight:600}
.passo__s{font-size:12.5px;color:var(--grafite);margin-left:auto;text-align:right;font-family:var(--dado)}
.passo__b{padding:14px 16px}
.arv{margin-top:10px;border:1px solid var(--vinco-2);max-height:420px;overflow:auto;background:#fff}
.arv__c{border-bottom:1px solid var(--vinco-2)}
.arv__ch{display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;
  font-family:var(--display);font-size:13.5px;font-weight:600;background:var(--papel-2)}
.arv__ch:hover{background:#eef1f4}
.arv__n{margin-left:auto;font-family:var(--dado);font-size:11.5px;font-weight:400;color:var(--grafite)}
.arv__t{display:none;padding:2px 0 8px 0}
.arv__c--ab .arv__t{display:block}
.arv__l{display:flex;align-items:center;gap:9px;padding:4px 12px 4px 30px;font-family:var(--dado);font-size:12px}
.arv__l:hover{background:#f6f8fa}
.arv__l input{width:auto;margin:0}
.arv__cod{font-weight:600;min-width:56px}
.arv__f{flex:1}
.arv__s{font-size:11px;color:var(--grafite)}
.arv__s--ok{color:var(--ok-p,#1b6b55)}
.arv__s--neg{color:#a32235}
.arv__teste{opacity:.55}
.arv__acoes{display:flex;gap:8px;padding:6px 12px;background:#fafbfc}
.arv__acoes button{font:inherit;font-size:11px;font-family:var(--dado);padding:2px 8px;cursor:pointer;
  border:1px solid var(--vinco);background:#fff}
.campos{display:grid;grid-template-columns:1fr 2fr auto;gap:10px;align-items:end}
label{display:block;font-family:var(--display);font-size:10.5px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--tenue);margin-bottom:4px}
input[type=text],input[type=url],select{width:100%;font:inherit;font-family:var(--dado);font-size:12.5px;
  padding:8px 10px;border:1px solid var(--vinco);background:var(--papel-2);color:var(--tinta)}
.bt{font:inherit;font-family:var(--display);font-size:12px;letter-spacing:.1em;text-transform:uppercase;
  font-weight:600;padding:9px 17px;border:1.5px solid var(--tinta);background:var(--tinta);color:#fff;
  cursor:pointer;white-space:nowrap}
.bt--sec{background:transparent;color:var(--tinta)}
.bt--perigo{background:transparent;color:var(--falha-p);border-color:var(--falha-p)}
.bt:disabled{background:transparent;color:var(--tenue);border-color:var(--vinco);cursor:not-allowed}
.linha-bt{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.amb-l{display:grid;grid-template-columns:1fr auto;gap:12px;padding:11px 0;border-top:1px solid var(--vinco-2)}
.amb-l:first-child{border-top:0}
.amb-l__n{font-family:var(--display);font-size:16px;font-weight:600}
.amb-l__u{font-family:var(--dado);font-size:11.5px;color:var(--tenue)}
.amb-l__m{font-family:var(--dado);font-size:11.5px;color:var(--grafite);margin-top:3px}
.pap{font-family:var(--display);font-size:10px;letter-spacing:.14em;text-transform:uppercase;
  padding:1px 7px;border:1px solid currentColor;margin-left:8px}
.pap--origem{color:var(--org-p)} .pap--destino{color:var(--dst-p)}
.med{height:5px;background:var(--vinco);margin-top:7px}
.med i{display:block;height:100%;background:var(--ok-p)}
.log{background:var(--noite);color:#C6D3DE;font-family:var(--dado);font-size:11.5px;line-height:1.65;
  padding:12px 14px;max-height:290px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.log b{color:var(--dif)}
.pulso{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--dif);margin-right:7px;
  animation:p 1.1s ease-in-out infinite}
@keyframes p{0%,100%{opacity:1}50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.pulso{animation:none}}
.rels{display:flex;flex-wrap:wrap;gap:8px}
.rel{font-family:var(--dado);font-size:12px;padding:6px 11px;border:1px solid var(--vinco);
  background:var(--papel-2);text-decoration:none;color:var(--tinta)}
.rel:hover{border-color:var(--tinta)}
@media (max-width:760px){ .campos{grid-template-columns:1fr} }
`;

function pagina() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SE Mapper — controle</title><style>${CSS}${ESTILO_EXTRA}</style></head><body>
<header class="cmd"><div class="env">
  <div class="cmd__id">
    <span class="marca">SE Mapper<span>controle</span></span>
    <span class="carimbo" id="carimbo">—</span>
  </div>
  <h1 class="tese" id="tese">Carregando…</h1>
  <p class="tese__ap" id="tese-ap"></p>
</div></header>

<main class="env corpo" id="app"></main>

<script>
const $ = s => document.querySelector(s);
let E = null;

async function api(rota, corpo){
  const r = await fetch(rota, corpo ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(corpo)} : {});
  return r.json();
}

function tese(){
  const n = E.ambientes.length;
  const mapeados = E.ambientes.filter(a => a.mapeado && a.varridas >= a.previstas && a.previstas).length;
  const t = $('#tese'), ap = $('#tese-ap');
  if (E.tarefa && E.tarefa.emAndamento){
    t.innerHTML = '<em>' + E.tarefa.tipo + '</em> em execução.';
    ap.textContent = 'Ambiente ' + (E.tarefa.slug || '') + ' · ' + E.tarefa.duracao + 's decorridos. Acompanhe a saída abaixo.';
  } else if (!n){
    t.innerHTML = 'Nenhum ambiente configurado.';
    ap.textContent = 'Comece cadastrando o ambiente de origem — normalmente o de homologação ou o que vai migrar.';
  } else if (E.comparacao){
    const c = E.comparacao;
    const d = c.divergente + c.soOrigem + c.soDestino;
    t.innerHTML = d ? '<em>' + d + ' de ' + c.telas + ' telas</em> não conferem.' : 'As <em class="ok">' + c.telas + ' telas</em> conferem.';
    ap.textContent = 'Comparação concluída. Abra o painel ou gere o relatório.';
  } else if (mapeados >= 2){
    t.innerHTML = 'Dois ambientes mapeados. <em>Pronto para comparar.</em>';
    ap.textContent = 'Rode a comparação para confrontar menus, telas e contagens.';
  } else if (n === 1){
    t.innerHTML = 'Um ambiente cadastrado.';
    ap.textContent = 'Conclua o mapeamento e cadastre o segundo ambiente quando ele estiver disponível.';
  } else {
    t.innerHTML = 'Ambientes cadastrados.';
    ap.textContent = 'Siga as etapas abaixo em cada ambiente.';
  }
  $('#carimbo').textContent = new Date().toLocaleString('pt-BR');
}

function passo(n, titulo, situacao, estado, corpo){
  return '<section class="passo passo--' + estado + '">' +
    '<div class="passo__c"><div class="passo__n">' + n + '</div>' +
    '<div class="passo__t">' + titulo + '</div>' +
    '<div class="passo__s">' + situacao + '</div></div>' +
    '<div class="passo__b">' + corpo + '</div></section>';
}

/* A tela se redesenha a cada poll. Sem preservar o formulário, o que você
   estiver digitando some no meio da frase — junto com o foco e o cursor. */
const CAMPOS = ['n','u','p'];
function guardaForm(){
  const s = {vals:{}, foco:null, ini:0, fim:0};
  CAMPOS.forEach(id => { const el = document.getElementById(id); if (el) s.vals[id] = el.value; });
  const a = document.activeElement;
  if (a && CAMPOS.includes(a.id)) { s.foco = a.id; s.ini = a.selectionStart; s.fim = a.selectionEnd; }
  return s;
}
function devolveForm(s){
  Object.entries(s.vals).forEach(([id,v]) => {
    const el = document.getElementById(id);
    if (el && v !== undefined && v !== '') el.value = v;
  });
  if (s.foco){
    const el = document.getElementById(s.foco);
    if (el){ el.focus(); try { el.setSelectionRange(s.ini, s.fim); } catch(e){} }
  }
}

function render(){
  const form = guardaForm();
  tese();
  const A = E.ambientes;
  const emExec = E.tarefa && E.tarefa.emAndamento;
  let h = '';

  // 1 — ambientes
  const listaAmb = A.map(a =>
    '<div class="amb-l"><div><span class="amb-l__n">' + a.nome + '</span>' +
    '<span class="pap pap--' + a.papel + '">' + a.papel + '</span>' +
    '<div class="amb-l__u">' + a.url + '</div>' +
    '<div class="amb-l__m">' + (a.mapeado
        ? a.varridas + ' de ' + a.previstas + ' telas · ' + a.lidas + ' lidas · falha ' + a.taxaFalha + '%'
        : 'ainda não mapeado') + '</div>' +
    (a.previstas ? '<div class="med"><i style="width:' + a.pct + '%"></i></div>' : '') +
    '</div><div class="linha-bt">' +
    '<button class="bt bt--sec" onclick="ativar(\\'' + a.slug + '\\')"' + (E.atual === a.slug ? ' disabled' : '') + '>' +
      (E.atual === a.slug ? 'ativo' : 'ativar') + '</button>' +
    '<button class="bt bt--perigo" onclick="excluir(\\'' + a.slug + '\\',\\'' + a.nome.replace(/'/g, "\\\\'") + '\\',' +
      a.varridas + ',' + a.telasProfundas + ')"' + (emExec ? ' disabled' : '') + '>excluir</button>' +
    '</div></div>').join('');

  h += passo(1, 'Ambientes', A.length + ' cadastrado(s)', A.length ? 'feito' : 'ativo',
    (listaAmb || '<p class="nota">Nenhum ambiente ainda.</p>') +
    '<div style="margin-top:14px"><div class="campos">' +
    '<div><label for="n">Nome</label><input id="n" type="text" placeholder="Homologação"></div>' +
    '<div><label for="u">Endereço</label><input id="u" type="url" placeholder="https://ambiente.softexpert.app"></div>' +
    '<div><label for="p">Papel</label><select id="p"><option value="origem">origem</option><option value="destino">destino</option></select></div>' +
    '</div><div class="linha-bt" style="margin-top:11px"><button class="bt" onclick="addAmb()">Adicionar ambiente</button></div></div>');

  const atual = A.find(a => a.slug === E.atual);
  const nomeAtual = atual ? atual.nome : '—';

  // 2 — sessão (processo próprio: fica de pé enquanto as etapas rodam)
  const sp = E.sessaoProc;
  const abrindo = sp && sp.viva && !E.sessao;
  const relogio = E.sessao && E.cdpDesde
    ? '<span class="pulso"></span>ativa há <b id="relSessao" data-desde="' + E.cdpDesde + '">—</b>'
    : (abrindo ? '<span class="pulso"></span>aguardando login há <b id="relSessao" data-desde="' + sp.desde + '">—</b>' : 'inativa');
  h += passo(2, 'Sessão do navegador', relogio,
    !atual ? 'espera' : (E.sessao ? 'feito' : 'ativo'),
    '<p class="nota">Abre o navegador em <b>' + nomeAtual + '</b> e espera você fazer o login. ' +
    'A janela precisa continuar aberta enquanto durar a coleta.</p>' +
    '<div class="linha-bt" style="margin-top:10px">' +
    (sp && sp.viva
      ? '<button class="bt" onclick="reabrirSessao()">Reabrir navegador</button>' +
        '<button class="bt bt--perigo" onclick="encerrarSessao()">Encerrar sessão</button>'
      : (E.sessao
        // sessão de pé, mas aberta fora daqui: abrir outra tentaria a mesma porta e falharia
        ? '<span class="nota">Sessão iniciada fora deste painel — reaproveitada como está. ' +
          'Para trocar de ambiente, feche aquela janela e abra por aqui.</span>'
        : '<button class="bt" onclick="acao(\\'login\\')"' + (!atual ? ' disabled' : '') + '>Abrir navegador e aguardar login</button>')) +
    (E.sessao ? '<span class="nota">Navegador respondendo na porta 9222 · última verificação <b id="relVerif" data-desde="' + E.verificadoEm + '">agora</b></span>'
      : (abrindo ? '<span class="nota">Navegador aberto — faça o login na janela. Se ela não apareceu, use <b>Reabrir navegador</b>.</span>' : '')) +
    '</div>' +
    (sp && sp.linhas.length ? '<div class="log" style="margin-top:11px;max-height:110px">' +
      sp.linhas.map(l => l.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))).join('\\n') + '</div>' : ''));

  // 3 — mapeamento
  h += passo(3, 'Mapeamento', atual && atual.mapeado ? atual.varridas + '/' + atual.previstas + ' telas' : 'não iniciado',
    !E.sessao ? 'espera' : (atual && atual.previstas && atual.varridas >= atual.previstas ? 'feito' : 'ativo'),
    '<p class="nota">Percorre componentes, menus e telas de configuração de <b>' + nomeAtual + '</b>, ' +
    'contando os registros de cada uma. Grava checkpoint a cada tela — pode ser retomado.</p>' +
    '<div class="linha-bt" style="margin-top:10px">' +
    '<button class="bt" onclick="acao(\\'map\\')"' + (!E.sessao || emExec ? ' disabled' : '') + '>Iniciar mapeamento</button>' +
    '<button class="bt bt--sec" onclick="abrirPainel()"' + (!atual || !atual.mapeado ? ' disabled' : '') + '>Abrir painel do ambiente</button>' +
    '</div>');

  // 4 — escolha do que analisar, por componente
  h += passo(4, 'Componentes e telas',
    (atual && atual.mapeado) ? E.selecao + ' tela(s) marcada(s)' : 'depende do mapeamento',
    !(atual && atual.mapeado) ? 'espera' : (E.selecao ? 'feito' : 'ativo'),
    '<p class="nota">Escolha o componente e marque as telas de Configuração a analisar. ' +
    'A marca vale para todos os ambientes — é o que garante que a comparação olhe as mesmas telas ' +
    'dos dois lados. <b>Produto não contratado</b> aparece separado e fora do escopo.</p>' +
    '<div id="arv" class="arv">carregando…</div>' +
    '<div class="linha-bt" style="margin-top:12px">' +
    '<button class="bt" onclick="percorrer()" id="btPerc" disabled>Percorrer telas marcadas</button>' +
    '<button class="bt bt--sec" onclick="gerarRel()" id="btRel" disabled>Gerar relatório do componente</button>' +
    '<span class="nota" id="selInfo"></span>' +
    '</div>');

  // 5 — aprofundamento
  h += passo(5, 'Verificação em profundidade', E.selecao + ' tela(s) selecionada(s)',
    !(atual && atual.mapeado) ? 'espera' : (E.selecao ? 'ativo' : 'espera'),
    '<p class="nota">Abre registro a registro das telas que você marcou no painel. A seleção vale para todos os ' +
    'ambientes. <b>A tela de detalhe abre em modo de edição</b> — o SoftExpert não oferece outro caminho — e é ' +
    'fechada sem salvar; o acesso fica na trilha de auditoria.</p>' +
    '<div class="linha-bt" style="margin-top:10px">' +
    '<button class="bt" onclick="acao(\\'deep\\')"' + (!E.sessao || !E.selecao || emExec ? ' disabled' : '') + '>Iniciar aprofundamento</button>' +
    (atual && atual.telasProfundas ? '<span class="nota">' + atual.telasProfundas + ' tela(s), ' + atual.registrosProfundos + ' registro(s) já abertos.</span>' : '') +
    '</div>');

  // 5 — comparação
  const prontos = A.filter(a => a.mapeado);
  h += passo(6, 'Comparação', E.comparacao ? 'gerada' : (prontos.length >= 2 ? 'pronta para rodar' : 'faltam ambientes'),
    prontos.length < 2 ? 'espera' : (E.comparacao ? 'feito' : 'ativo'),
    '<p class="nota">Confronta componentes, telas, contagens e — nas telas aprofundadas — os parâmetros ' +
    'registro a registro.</p>' +
    (prontos.length >= 2
      ? '<div class="campos" style="margin-top:10px"><div><label for="o">Origem</label><select id="o">' +
        prontos.map(a => '<option value="' + a.slug + '"' + (a.papel === 'origem' ? ' selected' : '') + '>' + a.nome + '</option>').join('') +
        '</select></div><div><label for="d">Destino</label><select id="d">' +
        prontos.map(a => '<option value="' + a.slug + '"' + (a.papel === 'destino' ? ' selected' : '') + '>' + a.nome + '</option>').join('') +
        '</select></div><div><button class="bt" onclick="comparar()"' + (emExec ? ' disabled' : '') + '>Comparar</button></div></div>'
      : '<p class="nota" style="margin-top:8px">Mapeie os dois ambientes para habilitar.</p>') +
    (E.comparacao ? '<div class="linha-bt" style="margin-top:11px"><button class="bt bt--sec" onclick="abrirComparacao()">Abrir painel de comparação</button></div>' : ''));

  // 6 — relatórios
  h += passo(7, 'Relatórios', E.relatorios.length + ' gerado(s)',
    !(atual && atual.mapeado) ? 'espera' : 'ativo',
    '<p class="nota">Gera o documento Word com identificação do ambiente, indicadores, telas, pendências e — ' +
    'quando houver comparação — o confronto entre origem e destino.</p>' +
    '<div class="linha-bt" style="margin-top:10px">' +
    '<button class="bt" onclick="acao(\\'relatorio\\')"' + (!(atual && atual.mapeado) || emExec ? ' disabled' : '') + '>Gerar relatório</button>' +
    '</div>' +
    (E.relatorios.length ? '<div class="rels" style="margin-top:12px">' +
      E.relatorios.map(r => '<a class="rel" href="/relatorios/' + encodeURIComponent(r) + '" download>' + r + '</a>').join('') +
      '</div>' : ''));

  // execução
  if (E.tarefa){
    h += '<section class="sec"><div class="sec__c"><h2 class="sec__t">' +
      (E.tarefa.emAndamento ? '<span class="pulso"></span>' : '') + 'Execução — ' + E.tarefa.tipo + '</h2>' +
      '<span class="sec__n">' + E.tarefa.duracao + 's' +
      (E.tarefa.emAndamento ? '' : ' · encerrado com código ' + E.tarefa.codigo) + '</span></div>' +
      '<div class="log" id="log">' + E.tarefa.linhas.map(l => l.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))).join('\\n') + '</div>' +
      (E.tarefa.emAndamento ? '<div class="linha-bt" style="margin-top:10px"><button class="bt bt--perigo" onclick="parar()">Interromper</button></div>' : '') +
      '</section>';
  }

  $('#app').innerHTML = h;
  devolveForm(form);
  const log = $('#log'); if (log) log.scrollTop = log.scrollHeight;
}

async function addAmb(){
  const cn = $('#n'), cu = $('#u');
  const nome = cn.value.trim(), url = cu.value.trim(), papel = $('#p').value;
  if (!nome || !url){
    alert('Informe o nome e o endereço do ambiente.');
    (nome ? cu : cn).focus();
    return;
  }
  if (!/^https?:\\/\\//i.test(url)){
    alert('O endereço precisa começar com https:// — por exemplo https://ambiente.softexpert.app');
    cu.focus();
    return;
  }
  const r = await api('/api/ambiente', {nome, url, papel});
  if (r.erro){ alert(r.erro); return; }
  cn.value = ''; cu.value = '';     // limpa só depois de gravar
  atualizar(true);
}
async function ativar(slug){ await api('/api/ativar', {slug}); atualizar(true); }
let ARV = null, MARCADAS = new Set();
// O painel se redesenha a cada 3s. Sem guardar o que esta aberto e onde a
// lista estava rolada, a arvore fecha sozinha no meio da escolha.
let ABERTOS = new Set(), ROLAGEM = 0;

async function carregarArvore(){
  const alvo = document.getElementById('arv');
  if (!alvo) return;
  const r = await fetch('/api/componentes').then(x => x.json()).catch(() => null);
  if (!r || !r.componentes) { alvo.textContent = 'mapeamento ainda não disponível'; return; }
  ARV = r.componentes;
  MARCADAS = new Set();
  ARV.forEach(c => c.telas.forEach(t => { if (t.marcada) MARCADAS.add(t.pageId); }));
  desenharArvore();
}

function desenharArvore(){
  const alvo = document.getElementById('arv');
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  let h = '';
  for (const c of ARV) {
    const nMarc = c.telas.filter(t => MARCADAS.has(t.pageId)).length;
    const nLidas = c.telas.filter(t => t.lida).length;
    if (!c.contratado) {
      h += '<div class="arv__c arv__teste"><div class="arv__ch">' + esc(c.nome) +
        '<span class="arv__n">' + esc(c.observacao || 'não contratado') + '</span></div></div>';
      continue;
    }
    h += '<div class="arv__c' + (ABERTOS.has(c.nome) ? ' arv__c--ab' : '') +
      '" data-nome="' + esc(c.nome) + '">' +
      '<div class="arv__ch" onclick="abrir(this)">' + esc(c.nome) +
      '<span class="arv__n">' + c.telas.length + ' telas · ' + nLidas + ' lidas' +
      (nMarc ? ' · <b>' + nMarc + ' marcadas</b>' : '') + '</span></div>' +
      '<div class="arv__t"><div class="arv__acoes" data-comp="' + esc(c.nome) + '">' +
      '<button data-modo="1">marcar todas</button>' +
      '<button data-modo="0">limpar</button>' +
      '<button data-modo="2">só as não lidas</button>' +
      '</div>';
    for (const t of c.telas) {
      const sit = t.lida
        ? '<span class="arv__s arv__s--ok">lida · ' + t.registros + ' reg' +
          (t.negados ? ' · <span class="arv__s--neg">' + t.negados + ' negados</span>' : '') + '</span>'
        : '<span class="arv__s">' + (t.total ? t.total + ' registros' : '—') + '</span>';
      h += '<label class="arv__l"><input type="checkbox" value="' + esc(t.pageId) + '"' +
        (MARCADAS.has(t.pageId) ? ' checked' : '') + ' onchange="marcar(this)">' +
        '<span class="arv__cod">' + esc(t.codigo) + '</span>' +
        '<span class="arv__f">' + esc(t.funcao) + '</span>' + sit + '</label>';
    }
    h += '</div></div>';
  }
  const rolagem = alvo.scrollTop || ROLAGEM;
  alvo.innerHTML = h;
  alvo.scrollTop = rolagem;
  alvo.onscroll = () => { ROLAGEM = alvo.scrollTop; };
  atualizaBotoes();
}

function abrir(el){
  const c = el.parentElement;
  c.classList.toggle('arv__c--ab');
  const nome = c.dataset.nome;
  if (c.classList.contains('arv__c--ab')) ABERTOS.add(nome); else ABERTOS.delete(nome);
}

// Delegacao de evento: onclick inline exigiria aspas aninhadas dentro do
// template da pagina, e foi exatamente isso que quebrou o script.
document.addEventListener('click', ev => {
  const b = ev.target.closest('.arv__acoes button');
  if (!b) return;
  ev.stopPropagation();
  marcarTodas(b.parentElement.dataset.comp, Number(b.dataset.modo));
});
function marcar(cb){ cb.checked ? MARCADAS.add(cb.value) : MARCADAS.delete(cb.value); salvarSelecao(); }
function marcarTodas(nome, modo){
  const c = ARV.find(x => x.nome === nome); if (!c) return;
  c.telas.forEach(t => {
    if (modo === 0) MARCADAS.delete(t.pageId);
    else if (modo === 1) MARCADAS.add(t.pageId);
    else if (!t.lida) MARCADAS.add(t.pageId);
  });
  // Mexe SO nas caixas deste componente. Redesenhar a arvore inteira a cada
  // clique descarta a posicao da rolagem e invalida os elementos que o usuario
  // (ou um laco) ainda esta percorrendo.
  const bloco = [...document.querySelectorAll('.arv__c')].find(x => x.dataset.nome === nome);
  if (bloco) {
    bloco.querySelectorAll('.arv__l input').forEach(cx => { cx.checked = MARCADAS.has(cx.value); });
    const cab = bloco.querySelector('.arv__n');
    const nM = c.telas.filter(t => MARCADAS.has(t.pageId)).length;
    const nL = c.telas.filter(t => t.lida).length;
    if (cab) cab.innerHTML = c.telas.length + ' telas · ' + nL + ' lidas' +
      (nM ? ' · <b>' + nM + ' marcadas</b>' : '');
  }
  salvarSelecao();
}
function componenteDasMarcadas(){
  const nomes = new Set();
  ARV.forEach(c => c.telas.forEach(t => { if (MARCADAS.has(t.pageId)) nomes.add(c.nome); }));
  return [...nomes];
}
function atualizaBotoes(){
  const n = MARCADAS.size, comps = componenteDasMarcadas();
  // o cabecalho do passo acompanha a selecao sem depender do poll
  const arv = document.getElementById('arv');
  const cab = arv && arv.closest('.passo') ? arv.closest('.passo').querySelector('.passo__s') : null;
  if (cab) cab.textContent = n + ' tela(s) marcada(s)';
  const bp = document.getElementById('btPerc'), br = document.getElementById('btRel');
  const info = document.getElementById('selInfo');
  if (bp) bp.disabled = !n;
  if (br) br.disabled = comps.length !== 1;
  if (info) info.textContent = n
    ? n + ' tela(s) em ' + comps.length + ' componente(s)' +
      (comps.length === 1 ? ' — relatório de ' + comps[0] : ' — marque um componente por vez para gerar relatório')
    : '';
}
async function salvarSelecao(){
  const telas = [];
  ARV.forEach(c => c.telas.forEach(t => {
    if (MARCADAS.has(t.pageId)) telas.push({ pageId: t.pageId, codigo: t.codigo, componente: c.nome });
  }));
  await api('/api/selecao', { telas });
  atualizaBotoes();
}
async function percorrer(){
  const telas = [];
  ARV.forEach(c => c.telas.forEach(t => { if (MARCADAS.has(t.pageId)) telas.push(t.codigo); }));
  if (!telas.length) return;
  const r = await api('/api/acao', { comando: 'andar', telas, registros: 9999 });
  if (r.erro) alert(r.erro); else atualizar(true);
}
async function gerarRel(){
  const comps = componenteDasMarcadas();
  if (comps.length !== 1) return alert('Marque telas de um único componente para gerar o relatório dele.');
  const r = await api('/api/acao', { comando: 'relatorio-modulo', modulo: comps[0] });
  if (r.erro) alert(r.erro); else atualizar(true);
}

async function acao(comando){ const r = await api('/api/acao', {comando}); if (r.erro) alert(r.erro); atualizar(true); }
async function comparar(){
  const r = await api('/api/acao', {comando:'compare', origem:$('#o').value, destino:$('#d').value});
  if (r.erro) alert(r.erro);
  atualizar(true);
}
async function parar(){ await api('/api/parar'); atualizar(true); }
async function encerrarSessao(){
  if (!confirm('Encerrar a sessão do navegador? As etapas em execução vão falhar.')) return;
  await api('/api/encerrar-sessao'); atualizar(true);
}
async function reabrirSessao(){
  if (!confirm('Fechar o navegador atual e abrir outro? Use isto se a janela sumiu ou travou.')) return;
  const r = await api('/api/acao', {comando:'login', forcar:true});
  if (r.erro) alert(r.erro);
  atualizar(true);
}
async function excluir(slug, nome, telas, profundas){
  const perdas = [];
  if (telas) perdas.push(telas + ' telas mapeadas');
  if (profundas) perdas.push(profundas + ' telas aprofundadas');
  const aviso = 'Excluir o ambiente "' + nome + '"?\\n\\n' +
    (perdas.length ? 'Serão apagados: ' + perdas.join(', ') + ', prints e registro de erros.\\n'
                   : 'Ainda não há dados coletados nele.\\n') +
    '\\nNão tem volta. A seleção de telas e os relatórios já gerados permanecem.';
  if (!confirm(aviso)) return;
  const r = await api('/api/excluir', {slug});
  if (r.erro){ alert(r.erro); return; }
  if (r.comparacaoRemovida) alert('A comparação existente foi descartada, porque usava este ambiente.');
  atualizar(true);
}
function abrirPainel(){ window.open('/painel?ambiente=1', '_blank'); }
function abrirComparacao(){ window.open('/painel?comparar=1', '_blank'); }

/* Só redesenha quando algo mudou de verdade. A duração dos processos muda a
   cada segundo e sozinha não justifica reconstruir a tela. */
let assinatura = null;
function assina(e){
  const c = JSON.parse(JSON.stringify(e));
  delete c.verificadoEm;
  // A contagem da selecao NAO entra na assinatura: cada caixa marcada mudava
  // o estado, o poll de 3s redesenhava o painel e a arvore era reconstruida
  // embaixo do usuario — os cliques pareciam nao pegar.
  delete c.selecao;
  if (c.tarefa) delete c.tarefa.duracao;
  if (c.sessaoProc) delete c.sessaoProc.duracao;
  return JSON.stringify(c);
}

/* Os relógios andam por conta própria, sem redesenhar a tela: o painel só se
   reconstrói quando o estado muda, e um contador parado não prova nada. */
function decorrido(ms){
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return m + 'min ' + String(r).padStart(2, '0') + 's';
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
}
setInterval(() => {
  const a = document.getElementById('relSessao');
  if (a) a.textContent = decorrido(Number(a.dataset.desde));
  const b = document.getElementById('relVerif');
  if (b) { const s = Math.round((Date.now() - Number(b.dataset.desde)) / 1000); b.textContent = s < 2 ? 'agora' : 'há ' + s + 's'; }
}, 1000);
async function atualizar(forcar){
  try {
    E = await api('/api/estado');
  } catch (err) {
    document.getElementById('tese').textContent = 'Painel fora do ar.';
    document.getElementById('tese-ap').textContent =
      'O processo que serve esta página foi encerrado. Rode "node se.js painel" (ou iniciar.cmd) de novo.';
    return;
  }
  // o carimbo da checagem anda a cada poll, mesmo quando a tela não é redesenhada
  const rv = document.getElementById('relVerif');
  if (rv && E.verificadoEm) rv.dataset.desde = E.verificadoEm;

  const a = assina(E);
  if (!forcar && a === assinatura) return;
  assinatura = a;
  render();
  // A arvore e recarregada depois de cada redesenho: o passo 4 e reescrito
  // pelo render e o conteudo dela se perderia. Recarrega so quando o passo
  // existe na tela, para nao bater na API a cada poll.
  // Redesenha so quando o passo 4 acabou de aparecer ou apos uma acao: a
  // arvore e cara de montar e piscar a cada poll atrapalha a escolha.
  // Busca a arvore no servidor uma vez. Depois disso ela vive no cliente:
  // refazer o fetch a cada redesenho descartava a escolha em andamento.
  const arv = document.getElementById('arv');
  if (arv && !ARV) carregarArvore();
  else if (arv && ARV && !arv.dataset.pronta) { arv.dataset.pronta = '1'; desenharArvore(); }
}
atualizar(true);
setInterval(() => atualizar(false), 3000);
</script></body></html>`;
}

// ------------------------------------------------------------------ servidor
function executar(opts = {}) {
  const porta = Number(opts.porta) || PORTA;
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const json = (o, c = 200) => { res.writeHead(c, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
    const corpo = () => new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch (e) { r({}); } }); });

    try {
      if (u.pathname === '/') {
        // O painel vive em lib/painel.html. Manter a pagina num template
        // literal dentro do JS ja custou dois erros de escape de aspas —
        // arquivo separado nao tem esse problema e permite editar o desenho
        // sem tocar no servidor.
        const html = path.join(__dirname, 'painel.html');
        if (fs.existsSync(html)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(fs.readFileSync(html, 'utf8'));
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(pagina());
      }
      if (u.pathname === '/api/estado') return json(await estado());

      if (u.pathname === '/api/ambiente' && req.method === 'POST') {
        const b = await corpo();
        if (!b.nome || !b.url) return json({ erro: 'Informe nome e endereço.' }, 400);
        const amb = criaAmbiente({ nome: b.nome, url: b.url, papel: b.papel || 'origem' });
        defineAtual(amb.slug);
        return json({ ok: true, amb });
      }
      if (u.pathname === '/api/ativar' && req.method === 'POST') {
        const b = await corpo(); defineAtual(b.slug); return json({ ok: true });
      }
      if (u.pathname === '/api/excluir' && req.method === 'POST') {
        const b = await corpo();
        if (tarefa && !tarefa.fim) return json({ erro: 'Há uma etapa em execução. Interrompa antes de excluir.' }, 409);
        return json(excluiAmbiente(b.slug));
      }
      if (u.pathname === '/api/componentes') {
        // Arvore para a escolha no front: componente -> telas de Configuracao,
        // com a situacao de cada uma (ja percorrida, quantos registros, negados).
        // Regras de profundidade definidas pelo cliente, por tela.
        const leRegra = (arq) => {
          try {
            const q = path.join(DADOS, arq);
            if (!fs.existsSync(q)) return {};
            const r = JSON.parse(fs.readFileSync(q, 'utf8'));
            delete r._nota;
            return r;
          } catch (e) { return {}; }
        };
        const semDetalhe = leRegra('ignorar.json');
        const comPainel = leRegra('navegar.json');
        const profundidade = (cod) => {
          const sd = !!semDetalhe[cod], cp = !!comPainel[cod];
          if (cp && !sd) return 'completo';
          if (cp && sd) return 'navegar';
          if (sd) return 'evidenciar';
          return null;
        };
        const mapa = leJson('mapa.json', { componentes: [] });
        const passos = leJson('passos.json', { telas: {} });
        const contagem = leJson('contagem.json', { telas: {} });
        const porCodigo = {};
        Object.values(contagem.telas || {}).forEach(t => { porCodigo[t.codigo] = t; });
        const feito = {};
        Object.values(passos.telas || {}).forEach(t => { feito[t.codigo] = t; });
        // A chave da selecao e o pageId, nao o codigo: o mesmo codigo aparece
        // em componentes diferentes (e ate duas vezes no mesmo — AD074 e
        // "Motivo" e "Turno"). Marcar por codigo selecionava telas alheias.
        const sel = new Set((leSelecao().telas || []).map(x => x.pageId).filter(Boolean));
        const comps = (mapa.componentes || []).map(c => ({
          nome: c.nome,
          contratado: c.contratado !== false,
          observacao: c.observacao || c.erro || null,
          geral: (c.menuGeral || []).length,
          telas: (c.menuConfiguracao || []).map(m => {
            const f = feito[m.codigo];
            const ct = porCodigo[m.codigo] || {};
            return {
              codigo: m.codigo, pageId: m.pageId, funcao: m.funcao || '',
              profundidade: profundidade(m.codigo),
              motivo: (semDetalhe[m.codigo] || {}).motivo || null,
              total: ct.total || null,
              lida: !!f,
              registros: f ? (f.registros || []).length : 0,
              negados: f ? (f.registros || []).filter(r => r.negado).length : 0,
              tipo: f ? f.tipo : null,
              marcada: sel.has(m.pageId),
            };
          }),
        }));
        return json({ componentes: comps });
      }
      if (u.pathname === '/api/selecao' && req.method === 'POST') {
        const b = await corpo();
        gravaSelecao({
          geradoEm: new Date().toISOString(),
          amostragem: b.amostragem || { modo: 'todos', limite: 0, descricao: 'todos os registros de cada tela' },
          telas: b.telas || [],
        });
        return json({ ok: true, n: (b.telas || []).length });
      }
      if (u.pathname === '/api/acao' && req.method === 'POST') {
        const b = await corpo();
        const atual = ambienteAtual();
        if (b.comando === 'login') return json(iniciaSessao(b.forcar));
        if (b.comando === 'compare') {
          return json(iniciaTarefa('comparação', ['compare', '--origem', b.origem, '--destino', b.destino], null));
        }
        if (b.comando === 'andar') {
          const cods = (b.telas || []).join(',');
          if (!cods) return json({ erro: 'Nenhuma tela selecionada.' }, 400);
          const args = ['andar', '--tela', cods];
          if (b.registros !== 0) args.push('--registros', String(b.registros || 9999));
          return json(iniciaTarefa('percurso de ' + (b.telas || []).length + ' tela(s)',
                                   args, atual ? atual.slug : null));
        }
        if (b.comando === 'relatorio-modulo') {
          if (!b.modulo) return json({ erro: 'Informe o módulo.' }, 400);
          return json(iniciaTarefa('relatório de ' + b.modulo,
                                   ['relatorio-modulo', '--modulo', b.modulo], atual ? atual.slug : null));
        }
        const mapa = { map: ['map'], deep: ['deep'], relatorio: ['relatorio'] };
        if (!mapa[b.comando]) return json({ erro: 'Comando desconhecido.' }, 400);
        return json(iniciaTarefa(b.comando, mapa[b.comando], atual ? atual.slug : null));
      }
      if (u.pathname === '/api/parar' && req.method === 'POST') return json(paraTarefa());
      if (u.pathname === '/api/encerrar-sessao' && req.method === 'POST') return json(encerraSessao());

      if (u.pathname === '/painel') {
        require('./dash').executar({ ambiente: u.searchParams.get('ambiente'), comparar: u.searchParams.get('comparar') });
        const p = path.join(DADOS, 'painel.html');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(p, 'utf8'));
      }
      if (u.pathname.startsWith('/relatorios/')) {
        const nome = decodeURIComponent(u.pathname.replace('/relatorios/', ''));
        const p = path.join(DADOS, 'relatorios', nome);
        if (!p.startsWith(path.join(DADOS, 'relatorios')) || !fs.existsSync(p)) { res.writeHead(404); return res.end('não encontrado'); }
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + nome + '"' });
        return res.end(fs.readFileSync(p));
      }
      res.writeHead(404); res.end('não encontrado');
    } catch (e) {
      json({ erro: e.message }, 500);
    }
  });

  srv.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error('\n  A porta ' + porta + ' já está em uso — provavelmente há outro painel aberto.');
      console.error('  Feche a janela do painel anterior, ou suba este em outra porta:');
      console.error('      node se.js painel --porta ' + (porta + 1) + '\n');
    } else {
      console.error('\n  Não foi possível subir o painel: ' + e.message + '\n');
    }
    process.exit(1);
  });

  srv.listen(porta, '127.0.0.1', () => {
    console.log('\n  Painel de controle: http://localhost:' + porta);
    console.log('  Abra no navegador. Encerre com Ctrl+C.\n');
  });
}

module.exports = { executar };
