'use strict';
/**
 * Comparação entre dois ambientes.
 *
 * Confronta, nesta ordem:
 *   1. componentes instalados
 *   2. telas de configuração de cada componente (por código: DC043, WF019...)
 *   3. quantidade de registros de cada tela
 *   4. registros e parâmetros das telas marcadas para aprofundamento
 *
 * O código da tela é a chave de comparação — o pageId muda entre ambientes.
 */
const path = require('path');
const fs = require('fs');
const { leJson, listaAmbientes, DADOS, qualidade } = require('./core');

const chaveTela = t => (t.codigo || t.funcao || '').trim();

function indexaTelas(contagem) {
  const idx = {};
  for (const t of Object.values(contagem.telas || {})) {
    const k = t.modulo + '::' + chaveTela(t);
    idx[k] = t;
  }
  return idx;
}

function statusTela(a, b) {
  if (a && !b) return 'so-origem';
  if (!a && b) return 'so-destino';
  const naoAvaliado = t => t.erro || !t.tipo || t.tipo === 'outro';
  if (naoAvaliado(a) || naoAvaliado(b)) return 'nao-avaliado';
  return (a.qtd || 0) === (b.qtd || 0) ? 'conforme' : 'divergente';
}

/** Divergência normalizada 0..1, usada pelo traço do painel. */
function magnitude(a, b, status) {
  if (status === 'conforme') return 0;
  if (status === 'nao-avaliado') return 0.25;
  if (status === 'so-origem' || status === 'so-destino') return 1;
  const x = a.qtd || 0, y = b.qtd || 0;
  const maior = Math.max(x, y) || 1;
  return Math.min(1, Math.abs(x - y) / maior);
}

// ------------------------------------------------------- comparação profunda
function comparaProfundo(profA, profB) {
  const out = [];
  const telasA = (profA || {}).telas || {};
  const telasB = (profB || {}).telas || {};
  const codigos = new Set([
    ...Object.values(telasA).map(t => t.modulo + '::' + chaveTela(t)),
    ...Object.values(telasB).map(t => t.modulo + '::' + chaveTela(t)),
  ]);
  const porCodigo = telas => {
    const m = {};
    for (const t of Object.values(telas)) m[t.modulo + '::' + chaveTela(t)] = t;
    return m;
  };
  const A = porCodigo(telasA), B = porCodigo(telasB);

  for (const cod of codigos) {
    const ta = A[cod], tb = B[cod];
    const regA = (ta && ta.registros) || {};
    const regB = (tb && tb.registros) || {};
    const nomes = new Set([
      ...Object.values(regA).map(r => r.nome),
      ...Object.values(regB).map(r => r.nome),
    ]);
    const porNome = regs => {
      const m = {};
      for (const r of Object.values(regs)) m[r.nome] = r;
      return m;
    };
    const RA = porNome(regA), RB = porNome(regB);
    const registros = [];

    for (const nome of nomes) {
      const ra = RA[nome], rb = RB[nome];
      if (ra && !rb) { registros.push({ nome, status: 'so-origem' }); continue; }
      if (!ra && rb) { registros.push({ nome, status: 'so-destino' }); continue; }
      const campoMap = r => {
        const m = {};
        for (const c of (r.campos || [])) m[c.campo || c.rotulo] = c;
        return m;
      };
      const ca = campoMap(ra), cb = campoMap(rb);
      const difs = [];
      for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
        const va = ca[k] ? ca[k].valor : undefined;
        const vb = cb[k] ? cb[k].valor : undefined;
        if (va !== vb) difs.push({ campo: k, rotulo: (ca[k] || cb[k] || {}).rotulo || k, origem: va, destino: vb });
      }
      registros.push({ nome, status: difs.length ? 'divergente' : 'conforme', diferencas: difs });
    }
    const [mod, codigo] = cod.split('::');
    out.push({
      modulo: mod, codigo,
      total: registros.length,
      divergentes: registros.filter(r => r.status !== 'conforme').length,
      registros,
    });
  }
  return out;
}

// ------------------------------------------------------------------ executar
function executar(opts = {}) {
  const ambientes = listaAmbientes();
  const origem = ambientes.find(a => a.slug === opts.origem) ||
                 ambientes.find(a => a.papel === 'origem');
  const destino = ambientes.find(a => a.slug === opts.destino) ||
                  ambientes.find(a => a.papel === 'destino');

  if (!origem || !destino) {
    console.error('Preciso de dois ambientes. Cadastrados: ' +
      (ambientes.map(a => a.slug + ' (' + a.papel + ')').join(', ') || 'nenhum'));
    console.error('Use: node se.js compare --origem <slug> --destino <slug>');
    process.exit(1);
  }

  const mapaA = leJson('mapa.json', null, origem.slug);
  const mapaB = leJson('mapa.json', null, destino.slug);
  if (!mapaA || !mapaB) {
    console.error('Os dois ambientes precisam ter sido mapeados ("node se.js map" em cada um).');
    process.exit(1);
  }
  const contA = leJson('contagem.json', { telas: {} }, origem.slug);
  const contB = leJson('contagem.json', { telas: {} }, destino.slug);

  // ---- componentes ----
  const compA = new Set(mapaA.componentes.map(c => c.nome));
  const compB = new Set(mapaB.componentes.map(c => c.nome));
  const componentes = [...new Set([...compA, ...compB])].sort().map(nome => ({
    nome,
    status: compA.has(nome) && compB.has(nome) ? 'conforme'
      : (compA.has(nome) ? 'so-origem' : 'so-destino'),
  }));

  // ---- telas ----
  const A = indexaTelas(contA), B = indexaTelas(contB);
  const chaves = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();
  const telas = chaves.map(k => {
    const a = A[k], b = B[k];
    const st = statusTela(a, b);
    const ref = a || b;
    return {
      chave: k, modulo: ref.modulo, codigo: ref.codigo, funcao: ref.funcao,
      tipo: (a && a.tipo) || (b && b.tipo) || 'outro',
      qtdOrigem: a ? (a.qtd || 0) : null,
      qtdDestino: b ? (b.qtd || 0) : null,
      paginadoOrigem: !!(a && a.paginado),
      paginadoDestino: !!(b && b.paginado),
      erroOrigem: a ? a.erro : undefined,
      erroDestino: b ? b.erro : undefined,
      status: st,
      magnitude: magnitude(a, b, st),
    };
  });

  const profundo = comparaProfundo(
    leJson('profundo.json', { telas: {} }, origem.slug),
    leJson('profundo.json', { telas: {} }, destino.slug),
  );

  const conta = s => telas.filter(t => t.status === s).length;
  const resultado = {
    geradoEm: new Date().toISOString(),
    origem: { ...origem, qualidade: qualidade(origem.slug) },
    destino: { ...destino, qualidade: qualidade(destino.slug) },
    componentes,
    telas,
    profundo,
    resumo: {
      componentes: componentes.length,
      componentesDivergentes: componentes.filter(c => c.status !== 'conforme').length,
      telas: telas.length,
      conforme: conta('conforme'),
      divergente: conta('divergente'),
      soOrigem: conta('so-origem'),
      soDestino: conta('so-destino'),
      naoAvaliado: conta('nao-avaliado'),
    },
  };

  fs.writeFileSync(path.join(DADOS, 'comparacao.json'), JSON.stringify(resultado, null, 2), 'utf8');
  const r = resultado.resumo;
  console.log('\nComparação ' + origem.nome + '  ->  ' + destino.nome);
  console.log('  componentes .......... ' + r.componentes + ' (' + r.componentesDivergentes + ' divergentes)');
  console.log('  telas ................ ' + r.telas);
  console.log('    conformes .......... ' + r.conforme);
  console.log('    divergentes ........ ' + r.divergente);
  console.log('    só na origem ....... ' + r.soOrigem);
  console.log('    só no destino ...... ' + r.soDestino);
  console.log('    não avaliadas ...... ' + r.naoAvaliado);
  console.log('\ndados/comparacao.json gravado. Rode "node se.js dash" para o painel.');
  return resultado;
}

module.exports = { executar, comparaProfundo, statusTela, magnitude };
