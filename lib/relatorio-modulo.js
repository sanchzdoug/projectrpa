'use strict';
/**
 * Relatório do percurso de um módulo (saída do `andar --registros`).
 *
 * O foco é o que a coleta conseguiu e o que ficou pendente — em especial os
 * registros com ACESSO NEGADO, que não são falha da automação e sim decisão do
 * cliente: liberar o perfil ou executar a verificação por conta própria.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { leJson, ambienteAtual, dirAmbiente, RAIZ } = require('./core');

/**
 * Campos sem rótulo que repetem o mesmo id são uma LISTA de opções (ex.:
 * `fgmodule` oito vezes, com uma marcada). Despejar oito linhas
 * "(sem rótulo) = INATIVO" é ruído com aparência de dado: o leitor não
 * consegue interpretar e a tabela fica ilegível. Vira uma linha de resumo,
 * dizendo o que se sabe — quantos itens e quantos marcados.
 */
function resumeCampos(campos) {
  const out = [];
  const listas = {};
  for (const c of campos) {
    const semRotulo = !c.rotulo || c.rotulo === '(sem rótulo)';
    const marcavel = c.tipo === 'checkbox' || c.tipo === 'radio';
    if (semRotulo && marcavel && c.campo) {
      (listas[c.campo] = listas[c.campo] || []).push(c);
      continue;
    }
    out.push({ rotulo: c.rotulo, valor: c.valor, aba: c.aba || null, bloqueado: !!c.bloqueado });
  }
  for (const [id, itens] of Object.entries(listas)) {
    if (itens.length === 1) {
      out.push({ rotulo: 'opção «' + id + '»', valor: itens[0].valor, aba: itens[0].aba || null });
    } else {
      const marcados = itens.filter(i => i.valor === 'ATIVO').length;
      out.push({
        rotulo: 'lista «' + id + '» (rótulos não legíveis)',
        valor: itens.length + ' itens · ' + marcados + ' marcado(s)',
        aba: itens[0].aba || null,
        naoLegivel: true,
      });
    }
  }
  return out;
}

/**
 * Transcrições das imagens de evidência.
 *
 * A extração lê o DOM; a transcrição é a leitura da IMAGEM. As duas discordam
 * em pontos que importam para qualificação — um campo cinza (desabilitado) e um
 * campo editável em branco chegam iguais na extração, e só a imagem separa os
 * dois. A chave é «CODIGO/arquivo.png».
 */
function carregaTranscricoes() {
  try { return leJson('transcricoes.json', {}); } catch (e) { return {}; }
}
const TRANSCRICOES = carregaTranscricoes();
function transcricao(caminhoPng) {
  if (!caminhoPng) return null;
  const partes = String(caminhoPng).replace(/\\/g, '/').split('/');
  const chave = partes.slice(-2).join('/');
  const t = TRANSCRICOES[chave];
  return t && t.leitura ? t.leitura : null;
}

/** Monta o payload que o gerador Word consome. */
function montaPayload(amb, telas, modulo) {
  const sit = r => r.negado ? 'acesso negado'
    : (r.divergente ? 'divergente' : (r.inconclusivo ? 'inconclusivo' : 'verificado'));
  const msgs = new Set();
  telas.forEach(t => (t.registros || []).forEach(r => { if (r.negado && r.mensagem) msgs.add(r.mensagem.slice(0, 180)); }));

  const linhas = telas.map(t => {
    const rs = t.registros || [];
    const abertos = rs.filter(r => r.abriu && !r.negado && !r.inconclusivo);
    const exemplo = abertos.find(r => (r.campos || []).length) || null;
    const paginas = {};
    Object.entries(t.paginas || {}).forEach(([k, v]) => {
      // __ignorados é o registro dos botões de ação recusados, não uma página.
      if (!v || k === '__ignorados') return;
      paginas[k] = { campos: (v.campos || []).length,
                     ativos: (v.campos || []).filter(c => c.valor === 'ATIVO').length,
                     print: v.print || null,
                     // A leitura da imagem registra o que a extração não alcança:
                     // agrupamento dos blocos, campos desabilitados e o texto de
                     // rótulos que o DOM entrega separado do controle.
                     leitura: transcricao(v.print),
                     detalhe: (v.campos || []).map(c => ({ rotulo: c.rotulo, valor: c.valor,
                                                           bloqueado: !!c.bloqueado })) };
    });
    return {
      codigo: t.codigo || '—', funcao: t.funcao, tipo: t.tipo || 'nada',
      acionador: t.acionador, print: t.print, total: t.total,
      registros: rs.length,
      abertos: abertos.length,
      negados: rs.filter(r => r.negado).length,
      inconclusivos: rs.filter(r => r.inconclusivo).length,
      colunas: t.colunas, amostraGrade: t.tipo === 'grade' ? (t.amostra || []) : null,
      amostraArvore: t.tipo === 'arvore' ? (t.amostra || []) : null,
      paginas: Object.keys(paginas).length ? paginas : null,
      registrosDetalhe: rs.map(r => ({
        nome: r.nome, identificador: r.identificador, campos: (r.campos || []).length,
        paginas: Object.keys(r.opcoes || {}), situacao: sit(r),
      })),
      // Configuração completa de CADA registro aberto. Mostrar só um exemplo
      // desperdiça a coleta: é justamente esse detalhe que permite comparar
      // ambientes campo a campo.
      registrosCompletos: abertos.map(r => ({
        nome: r.nome,
        identificador: r.identificador,
        campos: resumeCampos(r.campos || []),
        paginas: Object.entries(r.opcoes || {}).map(([nome, v]) => ({
          nome,
          campos: (v && v.campos ? v.campos : []).map(c => ({ rotulo: c.rotulo, valor: c.valor })),
          grade: v && v.grade ? { colunas: v.grade.colunas, linhas: v.grade.linhas.slice(0, 30) } : null,
        })),
        abasGrade: Object.entries(r.camposPorAba || {})
          .filter(([, v]) => v && v.grade)
          .map(([nome, v]) => ({ nome, colunas: v.grade.colunas, linhas: v.grade.linhas.slice(0, 30) })),
        prints: (r.prints || []).map(pr => ({
          arquivo: pr.arquivo, aba: pr.aba, leitura: transcricao(pr.arquivo),
        })),
      })),
      exemploNome: exemplo ? exemplo.nome : null,
      exemploCampos: exemplo ? (exemplo.campos || []).map(c => ({
        rotulo: c.rotulo, valor: c.valor, aba: c.aba })) : null,
    };
  });

  return {
    modulo,
    ambiente: amb,
    geradoEm: new Date().toLocaleString('pt-BR'),
    mensagensNegado: [...msgs],
    telas: linhas,
    resumo: {
      telas: linhas.length,
      abertos: linhas.reduce((a, t) => a + t.abertos, 0),
      negados: linhas.reduce((a, t) => a + t.negados, 0),
      inconclusivos: linhas.reduce((a, t) => a + t.inconclusivos, 0),
    },
    ressalvas: [
      'A coleta é um retrato do ambiente no momento indicado na capa.',
      'A visibilidade é a do perfil autenticado; outro perfil pode enxergar conjunto diferente.',
      'As telas de detalhe abrem em modo de edição — único caminho oferecido pelo SoftExpert — e são fechadas sem salvar. O acesso fica na trilha de auditoria.',
      'Grades exibem 100 registros por página; o total vem do próprio sistema, após o clique em "Exibir total de registros".',
      'Registro cujo identificador não confere com o item pedido é descartado e marcado como inconclusivo, em vez de virar dado.',
    ],
  };
}

function achaPython() {
  const cands = [process.env.SE_PYTHON,
    path.join(process.env.LOCALAPPDATA || '', 'Programs/Python/Python313/python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs/Python/Python312/python.exe'),
    'python3', 'python'].filter(Boolean);
  for (const c of cands) {
    const r = spawnSync(c, ['-c', 'import docx'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
}

const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|');

function executar(opts = {}) {
  const amb = ambienteAtual();
  if (!amb) { console.error('Nenhum ambiente ativo.'); process.exit(1); }
  const passos = leJson('passos.json', { telas: {} });
  let telas = Object.values(passos.telas || {});
  if (opts.modulo) telas = telas.filter(t => t.modulo.toLowerCase() === String(opts.modulo).toLowerCase());
  if (!telas.length) { console.error('Nada percorrido. Rode "node se.js andar --modulo <nome> --registros 9999".'); process.exit(1); }

  const modulo = opts.modulo || telas[0].modulo;
  const TIPOS = { grade: 'grade', arvore: 'árvore', formulario: 'formulário', vazio: 'vazio', nada: 'sem leitura' };
  const conta = t => telas.filter(x => x.tipo === t).length;
  const lidas = telas.filter(t => ['grade', 'arvore', 'formulario', 'vazio'].includes(t.tipo)).length;

  const comRegistros = telas.filter(t => Array.isArray(t.registros) && t.registros.length);
  const totRegistros = comRegistros.reduce((a, t) => a + t.registros.length, 0);
  const totAbertos = comRegistros.reduce((a, t) => a + t.registros.filter(r => r.abriu && !r.negado).length, 0);
  const totNegados = comRegistros.reduce((a, t) => a + t.registros.filter(r => r.negado).length, 0);
  const totFalhos = totRegistros - totAbertos - totNegados;

  let md = '';
  const w = s => { md += s + '\n'; };

  w('# Percurso do módulo ' + modulo);
  w('');
  w('| Item | Valor |');
  w('|---|---|');
  w('| Ambiente | ' + amb.nome + ' — `' + amb.url + '` |');
  w('| Papel | ' + amb.papel + ' |');
  w('| Gerado em | ' + new Date().toLocaleString('pt-BR') + ' |');
  w('| Telas percorridas | ' + telas.length + ' |');
  w('| Telas lidas | ' + lidas + ' de ' + telas.length + ' (' + Math.round(lidas * 100 / telas.length) + '%) |');
  w('| Registros abertos | ' + totAbertos + ' |');
  w('| Registros com acesso negado | **' + totNegados + '** |');
  w('');

  // ---------------- acesso negado: a parte acionável pelo cliente
  if (totNegados) {
    w('## Acesso negado — ação necessária do cliente');
    w('');
    w('Os registros abaixo existem, mas o perfil usado na coleta não pode visualizá-los. ');
    w('A automação registrou a mensagem exata devolvida pelo sistema. **Para concluir a ');
    w('verificação, o cliente precisa liberar o acesso a este perfil ou executar a ');
    w('conferência destes itens por conta própria.**');
    w('');
    const msgs = new Set();
    comRegistros.forEach(t => t.registros.forEach(r => { if (r.negado && r.mensagem) msgs.add(r.mensagem.slice(0, 160)); }));
    if (msgs.size) {
      w('Mensagem devolvida pelo sistema:');
      w('');
      [...msgs].forEach(m => w('> ' + m));
      w('');
    }
    w('| Tela | Código | Registros negados | de |');
    w('|---|---|--:|--:|');
    comRegistros.filter(t => t.registros.some(r => r.negado)).forEach(t => {
      const n = t.registros.filter(r => r.negado).length;
      w('| ' + esc(t.funcao) + ' | `' + esc(t.codigo) + '` | **' + n + '** | ' + t.registros.length + ' |');
    });
    w('');
  }

  // ---------------- inventário das telas
  w('## Telas do módulo');
  w('');
  w('| Código | Tela | Tipo | Registros | Total | Abertos | Negados |');
  w('|---|---|---|--:|--:|--:|--:|');
  telas.forEach(t => {
    const abr = (t.registros || []).filter(r => r.abriu && !r.negado).length;
    const neg = (t.registros || []).filter(r => r.negado).length;
    w('| `' + esc(t.codigo) + '` | ' + esc(t.funcao) + ' | ' + (TIPOS[t.tipo] || '—') +
      ' | ' + (t.qtdDom || 0) + ' | ' + (t.total || '—') + ' | ' + (abr || '—') + ' | ' + (neg ? '**' + neg + '**' : '—') + ' |');
  });
  w('');

  // ---------------- registros abertos, com o que foi lido
  const abertos = comRegistros.filter(t => t.registros.some(r => r.abriu && !r.negado));
  if (abertos.length) {
    w('## Registros verificados');
    w('');
    abertos.forEach(t => {
      const rs = t.registros.filter(r => r.abriu && !r.negado);
      w('### ' + t.funcao + ' (`' + t.codigo + '`) — ' + rs.length + ' registro(s)');
      w('');
      w('| Registro | Campos lidos |');
      w('|---|--:|');
      rs.forEach(r => w('| ' + esc(r.nome) + ' | ' + (r.campos || []).length + ' |'));
      w('');
    });
  }

  // ---------------- pendências da automação
  const semLeitura = telas.filter(t => t.tipo === 'nada' || !t.tipo);
  w('## Pendências da coleta');
  w('');
  if (semLeitura.length) {
    w('Telas em que a automação não conseguiu extrair conteúdo. Diferente de acesso ');
    w('negado, aqui a limitação é da ferramenta e precisa de ajuste:');
    w('');
    w('| Código | Tela | Acionador usado |');
    w('|---|---|---|');
    semLeitura.forEach(t => w('| `' + esc(t.codigo) + '` | ' + esc(t.funcao) + ' | ' + (t.acionador || '—') + ' |'));
  } else {
    w('Nenhuma: todas as telas responderam.');
  }
  w('');
  if (totFalhos) {
    w('Além disso, ' + totFalhos + ' registro(s) não abriram janela ao serem acionados — ');
    w('pode ser tela sem detalhe ou falha de acionamento, e precisa de conferência manual.');
    w('');
  }

  // ---------------- como foi lido
  w('## Como a leitura foi feita');
  w('');
  w('Receita verificada contra a interface, aplicável aos demais módulos:');
  w('');
  w('1. **Pesquisar** — clique real no elemento mais específico. Evento sintético não aciona a interface nova, e clicar no contêiner em volta do botão não dispara nada.');
  w('2. **Expandir a árvore** — nós recolhidos escondem os níveis filhos, que são a maior parte do conteúdo.');
  w('3. **Total de registros** — exige um segundo clique em "Exibir total de registros". Sem ele só se vê o intervalo da primeira página (por exemplo `1 - 100` quando o total é 111).');
  w('4. **Abrir um registro** — selecionar e acionar o lápis. O registro **abre em uma janela nova**; é nela que está o formulário ou a negativa de acesso.');
  w('5. **Vazio ≠ falha** — "Nenhum registro encontrado" é resposta válida da tela, não erro de leitura.');
  w('');
  w('Contagens desta coleta: ' + conta('grade') + ' telas em grade, ' + conta('arvore') + ' em árvore, ' +
    conta('formulario') + ' formulário, ' + conta('vazio') + ' vazias, ' + conta('nada') + ' sem leitura.');
  w('');

  const base = 'relatorio-' + String(modulo).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const destino = path.join(dirAmbiente(), base + '.md');
  fs.writeFileSync(destino, md, 'utf8');
  console.log('Relatório: ' + destino);

  // ---- Word com evidências ----
  const py = achaPython();
  if (!py) {
    console.log('(Word não gerado: Python com python-docx não encontrado)');
  } else {
    const payload = montaPayload(amb, telas, modulo);
    const tmp = path.join(dirAmbiente(), '.payload-modulo.json');
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    const docx = path.join(dirAmbiente(), base + '.docx');
    try {
      execFileSync(py, [path.join(RAIZ, 'ferramentas', 'gerar_docx_modulo.py'), tmp, docx], { encoding: 'utf8' });
      console.log('Word:      ' + docx + '  (' + (fs.statSync(docx).size / 1024).toFixed(0) + ' KB)');
    } catch (e) {
      console.error('Falha ao gerar o Word:');
      console.error((e.stderr || e.message || '').toString().split('\n').slice(-8).join('\n'));
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  }
  console.log('  ' + telas.length + ' telas · ' + totRegistros + ' registros · ' +
    totAbertos + ' abertos · ' + totNegados + ' negados');
  return destino;
}

module.exports = { executar };
