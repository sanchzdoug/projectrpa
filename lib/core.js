'use strict';
/**
 * Núcleo: Playwright, sessão, ambientes, registro de erros e o conhecimento
 * de seletores do SoftExpert Suite 2.2.3 descoberto por inspeção do DOM.
 *
 * Os dados são sempre gravados dentro do ambiente ativo:
 *   dados/ambientes/<slug>/{mapa,contagem,profundo,erros}.json
 * A seleção de telas para aprofundamento é COMPARTILHADA entre ambientes,
 * porque o objetivo é verificar os mesmos itens dos dois lados.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------- Playwright
const CAMINHOS_PW = [
  path.join(os.homedir(), '.claude/plugins/cache/playwright-skill/playwright-skill/4.1.0/skills/playwright-skill/node_modules/playwright'),
  path.join(__dirname, '../node_modules/playwright'),
  'playwright',
];

function carregaPlaywright() {
  for (const p of CAMINHOS_PW) {
    try { return require(p); } catch (e) { /* tenta o próximo */ }
  }
  throw new Error('Playwright não encontrado. Rode "npm i playwright" dentro de se-mapper/.');
}

// ------------------------------------------------------------------ Caminhos
const RAIZ = path.join(__dirname, '..');
const DADOS = path.join(RAIZ, 'dados');
const AMBIENTES = path.join(DADOS, 'ambientes');
const PORTA_CDP = 9222;

const mkdir = d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); };

function slugify(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

// ----------------------------------------------------------------- Ambientes
function listaAmbientes() {
  mkdir(AMBIENTES);
  return fs.readdirSync(AMBIENTES)
    .filter(d => fs.existsSync(path.join(AMBIENTES, d, 'ambiente.json')))
    .map(d => JSON.parse(fs.readFileSync(path.join(AMBIENTES, d, 'ambiente.json'), 'utf8')));
}

function ambienteAtual() {
  const p = path.join(DADOS, 'atual.json');
  if (!fs.existsSync(p)) return null;
  try {
    const { slug } = JSON.parse(fs.readFileSync(p, 'utf8'));
    const a = path.join(AMBIENTES, slug, 'ambiente.json');
    return fs.existsSync(a) ? JSON.parse(fs.readFileSync(a, 'utf8')) : null;
  } catch (e) { return null; }
}

function defineAtual(slug) {
  mkdir(DADOS);
  fs.writeFileSync(path.join(DADOS, 'atual.json'), JSON.stringify({ slug }, null, 2), 'utf8');
}

/**
 * Guarda só a origem do endereço. É comum colar a URL da tela em que se está
 * (".../softexpert/workspace?page=home"); as demais URLs são montadas a partir
 * desta base, e qualquer caminho a mais produziria endereços inválidos.
 */
function normalizaUrl(url) {
  const bruta = String(url || '').trim();
  try { return new URL(bruta).origin; } catch (e) { return bruta.replace(/\/+$/, ''); }
}

function criaAmbiente({ nome, url, papel }) {
  const slug = slugify(nome);
  const dir = path.join(AMBIENTES, slug);
  mkdir(path.join(dir, 'prints'));
  const amb = {
    slug, nome,
    url: normalizaUrl(url),
    papel: papel || 'origem',            // origem | destino
    criadoEm: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, 'ambiente.json'), JSON.stringify(amb, null, 2), 'utf8');
  return amb;
}

/**
 * Remove um ambiente e TODOS os dados coletados nele. Sem volta.
 * Devolve o resumo do que foi apagado para quem chamou poder informar.
 */
function excluiAmbiente(slug) {
  const dir = path.join(AMBIENTES, slug);
  if (!fs.existsSync(dir)) return { erro: 'Ambiente não encontrado: ' + slug };
  const cont = leJson('contagem.json', { telas: {} }, slug);
  const prof = leJson('profundo.json', { telas: {} }, slug);
  const resumo = {
    slug,
    telas: Object.keys(cont.telas || {}).length,
    telasProfundas: Object.keys(prof.telas || {}).length,
  };
  fs.rmSync(dir, { recursive: true, force: true });
  const atual = path.join(DADOS, 'atual.json');
  if (fs.existsSync(atual)) {
    try {
      if (JSON.parse(fs.readFileSync(atual, 'utf8')).slug === slug) {
        const resto = listaAmbientes();
        if (resto.length) defineAtual(resto[0].slug);
        else fs.unlinkSync(atual);
      }
    } catch (e) { /* arquivo ilegível: ignora */ }
  }
  // a comparação passa a apontar para um ambiente que não existe mais
  const cmp = path.join(DADOS, 'comparacao.json');
  if (fs.existsSync(cmp)) {
    try {
      const c = JSON.parse(fs.readFileSync(cmp, 'utf8'));
      if (c.origem.slug === slug || c.destino.slug === slug) { fs.unlinkSync(cmp); resumo.comparacaoRemovida = true; }
    } catch (e) { /* ignora */ }
  }
  return resumo;
}

function dirAmbiente(slug) {
  const s = slug || (ambienteAtual() || {}).slug;
  if (!s) throw new Error('Nenhum ambiente ativo. Rode "node se.js env add --nome <nome> --url <url>".');
  const d = path.join(AMBIENTES, s);
  mkdir(path.join(d, 'prints'));
  return d;
}

const dirPrints = slug => path.join(dirAmbiente(slug), 'prints');

// --------------------------------------------------------------- Persistência
function leJson(nome, padrao = null, slug) {
  const p = path.join(dirAmbiente(slug), nome);
  if (!fs.existsSync(p)) return padrao;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return padrao; }
}

function gravaJson(nome, dados, slug) {
  fs.writeFileSync(path.join(dirAmbiente(slug), nome), JSON.stringify(dados, null, 2), 'utf8');
}

/** A seleção de aprofundamento é compartilhada — mesmos itens nos dois ambientes. */
function leSelecao() {
  const p = path.join(DADOS, 'selecao.json');
  if (!fs.existsSync(p)) return { telas: [] };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { telas: [] }; }
}

function gravaSelecao(sel) {
  mkdir(DADOS);
  fs.writeFileSync(path.join(DADOS, 'selecao.json'), JSON.stringify(sel, null, 2), 'utf8');
}

// -------------------------------------------------------- Registro de erros
/**
 * Toda falha é registrada com contexto. A taxa de erro é indicador de
 * confiabilidade da coleta: uma varredura que falha muito não é operacional.
 */
function registraErro(erro, slug) {
  const atual = leJson('erros.json', { itens: [] }, slug);
  atual.itens.push({ quando: new Date().toISOString(), ...erro });
  gravaJson('erros.json', atual, slug);
}

/** Consolida os indicadores de qualidade da coleta do ambiente. */
function qualidade(slug) {
  const cont = leJson('contagem.json', { telas: {} }, slug);
  const erros = leJson('erros.json', { itens: [] }, slug);
  const telas = Object.values(cont.telas);
  const total = telas.length;
  const comExcecao = telas.filter(t => t.erro).length;
  const semConteudo = telas.filter(t => !t.erro && (!t.tipo || t.tipo === 'outro')).length;
  const lidas = total - comExcecao - semConteudo;
  const pct = n => (total ? +(n * 100 / total).toFixed(1) : 0);
  return {
    total, lidas, comExcecao, semConteudo,
    pctLidas: pct(lidas), pctExcecao: pct(comExcecao), pctSemConteudo: pct(semConteudo),
    taxaFalha: pct(comExcecao + semConteudo),
    erros: erros.itens,
  };
}

// ------------------------------------------------------- Sessão de navegador
async function abreNavegador(url, slug) {
  const perfil = path.join(dirAmbiente(slug), 'perfil-navegador');
  mkdir(perfil);
  const { chromium } = carregaPlaywright();
  const ctx = await chromium.launchPersistentContext(perfil, {
    headless: false,
    viewport: null,
    args: ['--remote-debugging-port=' + PORTA_CDP, '--start-maximized'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  if (url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  return { ctx, page };
}

async function conecta() {
  const { chromium } = carregaPlaywright();
  let browser;
  try {
    browser = await chromium.connectOverCDP('http://localhost:' + PORTA_CDP);
  } catch (e) {
    throw new Error('Nenhuma sessão ativa na porta ' + PORTA_CDP + '. Rode "node se.js login" primeiro.');
  }
  return { browser, ctx: browser.contexts()[0] };
}

async function abaDeTrabalho(ctx, novaAba = false) {
  if (novaAba) return ctx.newPage();
  return ctx.pages().find(p => /workspace|\/se\//i.test(p.url())) || ctx.pages()[0] || ctx.newPage();
}

// ------------------------------------------------- Conhecimento do SoftExpert
/**
 * Aprendizados obtidos por inspeção do DOM — não altere sem reinspecionar:
 *  - Telas de cadastro abrem com painel de filtros; a grade só popula após PESQUISAR.
 *  - Árvores: cada nó é table.nodeElm; o nível vem do margin-left (16px por nível).
 *    Os div#lineID-* parecem nós mas são blocos de renderização (devolvem ~10 de 261).
 *  - Grades: #t_content_gridframe, página de 50 linhas.
 *  - O rodapé "Exibir total de registros 1 - 13" traz um INTERVALO, não a contagem.
 *  - A página tem 4 frames; escolha pelo conteúdo, nunca pelo nome.
 *  - dblclick apenas SELECIONA a linha. Para abrir o registro: #btnedit (barra ExtJS).
 */
const SEL = {
  botaoPesquisar: ['PESQUISAR', 'BUSCAR'],
  gradeConteudo: '#t_content_gridframe',
  totalRegistros: '#gridframe_reacord_all',
  noArvore: 'table.nodeElm',
  textoNo: 'td.txtContainer',
  pxPorNivel: 16,
  paginaGrade: 50,
  btnNovo: '#btnnew',
  btnEditar: '#btnedit',
  btnExcluir: '#btndel',
  lancadorComponentes: 'li#components',
  // Nem todo componente tem o `.item` interno: "Administração" e um
  // `.productItem` direto. Procurar so por `.productItem .item` fazia o
  // componente inteiro desaparecer do mapa.
  cardComponente: '.productItem .item, .productItem',
  itemMenu: 'a[href*="workspace?page="]',
  abaMenu: 'Configuração',
};

const espera = ms => new Promise(r => setTimeout(r, ms));

async function pesquisar(page) {
  for (const f of page.frames()) {
    try {
      const ok = await f.evaluate((rotulos) => {
        const lp = s => (s || '').replace(/\s+/g, ' ').trim().toUpperCase();
        const cands = [...document.querySelectorAll('button,a,div,span,input[type=button]')]
          .filter(e => rotulos.includes(lp(e.innerText || e.value)) && e.children.length <= 2);
        if (!cands.length) return false;
        let alvo = cands[0], area = 0;
        cands.forEach(e => {
          const r = e.getBoundingClientRect();
          if (r.width * r.height > area) { area = r.width * r.height; alvo = e; }
        });
        ['mousedown', 'mouseup', 'click'].forEach(t =>
          alvo.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
        return true;
      }, SEL.botaoPesquisar);
      if (ok) return f.name() || '(principal)';
    } catch (e) { /* frame inacessível */ }
  }
  return null;
}

async function melhorFrame(page, avaliador) {
  let escolhido = null, melhor = -1;
  for (const f of page.frames()) {
    let nota;
    try { nota = await f.evaluate(avaliador); } catch (e) { continue; }
    if (nota > melhor) { melhor = nota; escolhido = f; }
  }
  return { frame: escolhido, nota: melhor };
}

module.exports = {
  carregaPlaywright, abreNavegador, conecta, abaDeTrabalho,
  RAIZ, DADOS, AMBIENTES, PORTA_CDP, slugify,
  listaAmbientes, ambienteAtual, defineAtual, criaAmbiente, excluiAmbiente, normalizaUrl,
  dirAmbiente, dirPrints,
  leJson, gravaJson, leSelecao, gravaSelecao, registraErro, qualidade,
  SEL, espera, pesquisar, melhorFrame,
};
