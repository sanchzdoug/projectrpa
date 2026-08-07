'use strict';
/**
 * Fila de módulos.
 *
 * A ordem não é alfabética nem por tamanho: é a ordem de aprendizado definida
 * com o cliente. Cada módulo só entra depois que o anterior fecha 100%, porque
 * cada um traz um jeito novo de navegar e o que se aprende num vale para o
 * seguinte.
 */
const { leJson, ambienteAtual } = require('./core');

const ORDEM = [
  'Documento', 'Administração', 'Configuração', 'Solicitação', 'Treinamento',
  'Questionário', 'Processo', 'Formulário', 'Workflow', 'Auditoria',
  'Risco', 'Requisito', 'Fornecedor',
];

/** Situação de cada módulo no ambiente ativo. */
function situacao() {
  const mapa = leJson('mapa.json', null);
  const passos = leJson('passos.json', { telas: {} });
  const previstas = {};
  if (mapa) {
    for (const c of mapa.componentes) previstas[c.nome] = c.menuConfiguracao.length;
  }
  const feitas = {};
  for (const t of Object.values(passos.telas || {})) {
    feitas[t.modulo] = feitas[t.modulo] || { total: 0, completas: 0, registros: 0, negados: 0, inconclusivos: 0 };
    const f = feitas[t.modulo];
    f.total++;
    if (t.limiteRegistros) f.completas++;
    const rs = t.registros || [];
    f.registros += rs.length;
    f.negados += rs.filter(r => r.negado).length;
    f.inconclusivos += rs.filter(r => r.inconclusivo).length;
  }

  // módulos existentes neste ambiente, na ordem combinada; extras vão ao fim
  const conhecidos = Object.keys(previstas);
  const ordenados = [
    ...ORDEM.filter(m => conhecidos.includes(m)),
    ...conhecidos.filter(m => !ORDEM.includes(m)).sort(),
  ];

  return ordenados.map(nome => {
    const f = feitas[nome] || { total: 0, completas: 0, registros: 0, negados: 0, inconclusivos: 0 };
    const prev = previstas[nome] || 0;
    return {
      nome, previstas: prev, ...f,
      naFila: ORDEM.includes(nome),
      pct: prev ? Math.round(f.completas * 100 / prev) : 0,
      concluido: prev > 0 && f.completas >= prev,
    };
  });
}

/** Próximo módulo pendente, respeitando a ordem. */
function proximo() {
  return situacao().find(m => m.naFila && m.previstas > 0 && !m.concluido) || null;
}

function executar(opts = {}) {
  const amb = ambienteAtual();
  if (!amb) { console.error('Nenhum ambiente ativo.'); process.exit(1); }
  const lista = situacao();

  console.log('\nFila de módulos — ' + amb.nome + '\n');
  console.log('  #  Módulo             telas  completas   registros  negados  incon.   %');
  lista.filter(m => m.naFila).forEach((m, i) => {
    const marca = m.concluido ? '✓' : (m.completas ? '·' : ' ');
    console.log('  ' + marca + ' ' + String(i + 1).padStart(2) + ' ' + m.nome.padEnd(16) +
      String(m.previstas).padStart(6) + String(m.completas).padStart(11) +
      String(m.registros).padStart(12) + String(m.negados).padStart(9) +
      String(m.inconclusivos).padStart(8) + String(m.pct + '%').padStart(6));
  });

  const fora = lista.filter(m => !m.naFila && m.previstas);
  if (fora.length) {
    console.log('\n  fora da ordem combinada: ' + fora.map(m => m.nome + ' (' + m.previstas + ')').join(', '));
  }

  const p = proximo();
  console.log('');
  if (!p) {
    console.log('  Todos os módulos da fila estão concluídos neste ambiente.');
  } else {
    console.log('  Próximo: ' + p.nome + ' — ' + p.completas + ' de ' + p.previstas + ' telas');
    console.log('  node se.js andar --modulo "' + p.nome + '" --bloco 3 --registros 9999');
  }
  console.log('');
  return lista;
}

module.exports = { executar, situacao, proximo, ORDEM };
