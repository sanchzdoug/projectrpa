'use strict';
/** Gestão de ambientes: cadastrar, alternar e listar. */
const { listaAmbientes, ambienteAtual, defineAtual, criaAmbiente, qualidade, leJson, slugify } = require('./core');

function add(o) {
  if (!o.nome || !o.url) {
    console.error('Uso: node se.js env add --nome <nome> --url <url> [--papel origem|destino]');
    process.exit(1);
  }
  const papel = o.papel || (listaAmbientes().some(a => a.papel === 'origem') ? 'destino' : 'origem');
  const amb = criaAmbiente({ nome: o.nome, url: o.url, papel });
  defineAtual(amb.slug);
  console.log('Ambiente criado e ativado: ' + amb.nome + ' [' + amb.slug + '] papel=' + amb.papel);
  console.log('  ' + amb.url);
  console.log('\nPróximo passo: node se.js login');
}

function use(o) {
  const alvo = o._[2] || o.slug;
  if (!alvo) { console.error('Uso: node se.js env use <slug>'); process.exit(1); }
  const amb = listaAmbientes().find(a => a.slug === slugify(alvo) || a.slug === alvo);
  if (!amb) { console.error('Ambiente não encontrado: ' + alvo); process.exit(1); }
  defineAtual(amb.slug);
  console.log('Ambiente ativo: ' + amb.nome + ' (' + amb.url + ')');
}

function list() {
  const ambientes = listaAmbientes();
  const atual = ambienteAtual();
  if (!ambientes.length) {
    console.log('\nNenhum ambiente cadastrado.');
    console.log('  node se.js env add --nome teste --url https://<ambiente>.softexpert.app\n');
    return;
  }
  console.log('');
  for (const a of ambientes) {
    const marca = atual && atual.slug === a.slug ? '►' : ' ';
    const mapa = leJson('mapa.json', null, a.slug);
    const q = qualidade(a.slug);
    console.log(' ' + marca + ' ' + a.nome.padEnd(18) + '[' + a.papel.padEnd(7) + '] ' + a.url);
    console.log('     ' + (mapa ? mapa.componentes.length + ' componentes' : 'não mapeado') +
      (q.total ? ' · ' + q.total + ' telas · ' + q.lidas + ' lidas · falha ' + q.taxaFalha + '%' : ''));
  }
  console.log('');
}

module.exports = { add, use, list };
