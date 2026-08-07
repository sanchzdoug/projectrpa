#!/usr/bin/env node
'use strict';
/**
 * SE Mapper — mapeia a configuração do SoftExpert Suite em vários ambientes
 * e compara um contra o outro (ex.: homologação × produção).
 *
 * Fluxo:
 *   env add -> login -> map -> dash (marcar telas) -> deep
 *   ...repete no outro ambiente...
 *   compare -> dash
 */
const { abreNavegador, conecta, ambienteAtual, listaAmbientes, leJson, leSelecao,
        qualidade, PORTA_CDP, DADOS, espera } = require('./lib/core');

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const chave = a.slice(2);
      const prox = argv[i + 1];
      if (prox && !prox.startsWith('--')) { o[chave] = prox; i++; } else o[chave] = true;
    } else o._.push(a);
  }
  return o;
}

const AJUDA = `
SE Mapper — configuração do SoftExpert Suite, com comparação entre ambientes

  Ambientes
    node se.js env add --nome <nome> --url <url> [--papel origem|destino]
    node se.js env use <slug>
    node se.js env list

  Coleta (sempre no ambiente ativo)
    node se.js login                abre o navegador e aguarda seu login manual
    node se.js map                  componentes, menus, tarefas e contagem por tela
         --remapear                 refaz a descoberta de componentes e menus
         --recontar                 refaz a contagem de todas as telas
    node se.js dash                 painel: progresso, erros e seleção de telas
         --acompanhar               a página se atualiza sozinha durante a coleta
         --ambiente                 força o modo de ambiente único
    node se.js deep                 abre registro a registro das telas selecionadas
         --limite N                 no máximo N registros por tela

  Comparação
    node se.js compare --origem <slug> --destino <slug>
    node se.js dash --comparar      painel de comparação

  Relatório e controle
    node se.js relatorio            gera o Word (comparação, se houver; senão o mapeamento)
         --mapeamento               força o relatório do ambiente ativo
    node se.js painel               painel de controle no navegador (configurar e disparar tudo)

  node se.js status                 o que já foi coletado

A seleção de telas é compartilhada entre ambientes: o que você marcar é o que
será aberto em profundidade dos dois lados.
`;

async function cmdLogin() {
  const amb = ambienteAtual();
  if (!amb) {
    console.error('Nenhum ambiente ativo. Rode:');
    console.error('  node se.js env add --nome <nome> --url <url>');
    process.exit(1);
  }
  console.log('Abrindo ' + amb.nome + ' — ' + amb.url);
  const { page } = await abreNavegador(amb.url);
  console.log('\n  Faça o LOGIN manualmente na janela que abriu.');
  console.log('  A sessão fica disponível na porta ' + PORTA_CDP + ' para os demais comandos.');
  console.log('  Deixe este processo rodando; encerre com Ctrl+C ao terminar.\n');
  let ultimo = '';
  for (;;) {
    await espera(30000);
    try {
      const u = page.url();
      if (u !== ultimo) { ultimo = u; console.log('  [sessão ativa] ' + u.slice(0, 100)); }
    } catch (e) {
      console.log('  Navegador fechado. Encerrando.');
      process.exit(0);
    }
  }
}

async function cmdStatus() {
  const ambientes = listaAmbientes();
  const atual = ambienteAtual();
  console.log('\nDados em ' + DADOS);
  if (!ambientes.length) { console.log('\n  Nenhum ambiente cadastrado.\n'); return; }
  for (const a of ambientes) {
    const mapa = leJson('mapa.json', null, a.slug);
    const prof = leJson('profundo.json', { telas: {} }, a.slug);
    const q = qualidade(a.slug);
    const det = Object.values(prof.telas).reduce((s, t) => s + Object.keys(t.registros || {}).length, 0);
    console.log('\n ' + (atual && atual.slug === a.slug ? '►' : ' ') + ' ' + a.nome + ' [' + a.papel + ']');
    console.log('     ' + a.url);
    console.log('     mapa ......... ' + (mapa ? mapa.componentes.length + ' componentes, ' +
      mapa.componentes.reduce((s, c) => s + c.menuConfiguracao.length, 0) + ' telas' : 'não mapeado'));
    console.log('     contagem ..... ' + q.total + ' telas · ' + q.lidas + ' lidas (' + q.pctLidas + '%)');
    console.log('     qualidade .... ' + q.comExcecao + ' exceções, ' + q.semConteudo +
      ' sem conteúdo · taxa de falha ' + q.taxaFalha + '%');
    console.log('     profundo ..... ' + Object.keys(prof.telas).length + ' telas, ' + det + ' registros');
  }
  const sel = leSelecao();
  console.log('\n  seleção compartilhada: ' + (sel.telas || []).length + ' tela(s)');
  try {
    const { browser } = await conecta();
    console.log('  sessão do navegador: ATIVA (porta ' + PORTA_CDP + ')');
    await browser.close();
  } catch (e) {
    console.log('  sessão do navegador: inativa — rode "node se.js login"');
  }
  console.log('');
}

(async () => {
  const o = parseArgs(process.argv.slice(2));
  const cmd = o._[0];
  try {
    switch (cmd) {
      case 'env': {
        const sub = o._[1] || 'list';
        const env = require('./lib/env');
        if (sub === 'add') env.add(o);
        else if (sub === 'use') env.use(o);
        else env.list();
        break;
      }
      case 'login': await cmdLogin(); break;
      case 'map': await require('./lib/map').executar(o); break;
      case 'dash': require('./lib/dash').executar(o); break;
      case 'deep': await require('./lib/deep').executar(o); break;
      case 'compare': require('./lib/compare').executar(o); break;
      case 'relatorio': require('./lib/relatorio').executar(o); break;
      case 'painel': require('./lib/servidor').executar(o); break;
      case 'andar': await require('./lib/andar').executar(o); break;
      case 'relatorio-modulo': require('./lib/relatorio-modulo').executar(o); break;
      case 'fila': require('./lib/fila').executar(o); break;
      case 'aceitar': require('./lib/aceite').aceitar(o); break;
      case 'expurgar': require('./lib/aceite').expurgar(o); break;
      case 'status': await cmdStatus(); break;
      default: console.log(AJUDA);
    }
  } catch (e) {
    console.error('\nFalhou: ' + e.message);
    process.exit(1);
  }
})();
