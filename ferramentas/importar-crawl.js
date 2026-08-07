'use strict';
/**
 * Importa a varredura exploratória (feita antes do sistema existir) para dentro
 * de um ambiente do SE Mapper — evita refazer ~2h de mapeamento.
 *
 *   node ferramentas/importar-crawl.js <pasta> --nome teste --url https://...
 */
const fs = require('fs');
const path = require('path');
const { criaAmbiente, defineAtual, gravaJson, listaAmbientes, slugify } = require('../lib/core');

const args = process.argv.slice(2);
const origem = args.find(a => !a.startsWith('--'));
const opt = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[i + 1];
}

if (!origem || !fs.existsSync(origem)) {
  console.error('Uso: node ferramentas/importar-crawl.js <pasta> --nome <nome> --url <url>');
  process.exit(1);
}
if (!opt.nome || !opt.url) {
  console.error('Informe --nome e --url do ambiente de onde os dados vieram.');
  process.exit(1);
}

const ler = n => {
  const p = path.join(origem, n);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
};

const abas = ler('se-abas-config.json');
const geral = ler('se-menus-componentes.json');
const crawl = ler('se-crawl-v2.json');
const topnav = ler('se-topnav.json');
if (!abas) { console.error('se-abas-config.json não encontrado em ' + origem); process.exit(1); }

const slug = slugify(opt.nome);
const amb = listaAmbientes().find(a => a.slug === slug) ||
            criaAmbiente({ nome: opt.nome, url: opt.url, papel: opt.papel || 'origem' });
defineAtual(amb.slug);
console.log('Ambiente: ' + amb.nome + ' [' + amb.slug + '] papel=' + amb.papel);

// ---------------------------------------------------------------- mapa.json
const geralPorNome = {};
if (geral) for (const c of geral.componentes || []) geralPorNome[c.nome] = c.itens || [];

const mapa = {
  ambiente: amb.slug,
  base: amb.url,
  capturadoEm: abas.capturadoEm || new Date().toISOString(),
  importadoDe: origem,
  tarefas: topnav ? { menu: (topnav.menus || []).find(m => m.nome === 'Minhas tarefas') || null } : null,
  componentes: (abas.componentes || []).map(c => ({
    nome: c.nome,
    menuGeral: (geralPorNome[c.nome] || []).map(i => ({ funcao: i.funcao, codigo: i.codigo, pageId: i.pageId })),
    menuConfiguracao: (c.itens || []).map(i => ({ funcao: i.funcao, codigo: i.codigo, pageId: i.pageId })),
  })),
};
gravaJson('mapa.json', mapa, amb.slug);
console.log('mapa.json ....... ' + mapa.componentes.length + ' componentes, ' +
  mapa.componentes.reduce((a, c) => a + c.menuConfiguracao.length, 0) + ' telas de configuração');

// ------------------------------------------- contagem.json + erros.json
const contagem = { telas: {} };
const erros = { itens: [] };
if (crawl) {
  for (const t of crawl.telas || []) {
    const chave = t.modulo + '|' + t.pageId;
    const semConteudo = !t.erro && (!t.tipo || t.tipo === 'outro');
    contagem.telas[chave] = {
      modulo: t.modulo, codigo: t.codigo, funcao: t.funcao, pageId: t.pageId,
      url: t.url, titulo: t.titulo, frame: t.frame, tipo: t.tipo,
      qtd: t.qtd || 0,
      paginado: !!(t.grade && (t.grade.linhas || []).length >= 50),
      colunas: t.grade ? t.grade.cab : undefined,
      amostra: t.arvore ? t.arvore.slice(0, 10) : (t.grade ? (t.grade.linhas || []).slice(0, 10) : []),
      vazio: t.vazio, erro: t.erro, print: t.screenshot,
    };
    if (t.erro) erros.itens.push({ quando: crawl.atualizadoEm, fase: 'contagem', modulo: t.modulo,
      codigo: t.codigo, tela: t.funcao, severidade: 'excecao', mensagem: t.erro });
    else if (semConteudo) erros.itens.push({ quando: crawl.atualizadoEm, fase: 'contagem', modulo: t.modulo,
      codigo: t.codigo, tela: t.funcao, severidade: 'sem-conteudo', mensagem: 'tela abriu sem conteúdo legível' });
  }
}
gravaJson('contagem.json', contagem, amb.slug);
gravaJson('erros.json', erros, amb.slug);

const n = Object.keys(contagem.telas).length;
const soma = Object.values(contagem.telas).reduce((a, t) => a + (t.qtd || 0), 0);
console.log('contagem.json ... ' + n + ' telas, ' + soma + ' registros');
console.log('erros.json ...... ' + erros.itens.length + ' ocorrências');
console.log('\nPronto. "node se.js dash" para o painel.');
