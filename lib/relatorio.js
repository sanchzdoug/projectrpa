'use strict';
/**
 * Geração de relatório Word.
 *
 * Monta o payload a partir dos dados coletados e chama ferramentas/gerar_docx.py.
 * O Python precisa de python-docx; se faltar, o comando avisa como instalar
 * em vez de falhar com rastro de pilha.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { leJson, leSelecao, listaAmbientes, ambienteAtual, qualidade, RAIZ, DADOS } = require('./core');

/** Procura um Python com python-docx disponível. */
function achaPython() {
  const candidatos = [
    process.env.SE_PYTHON,
    path.join(process.env.LOCALAPPDATA || '', 'Programs/Python/Python313/python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs/Python/Python312/python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs/Python/Python311/python.exe'),
    'python3', 'python',
  ].filter(Boolean);
  for (const c of candidatos) {
    const r = spawnSync(c, ['-c', 'import docx'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
}

const situacaoDe = t => t.erro ? 'excecao' : ((!t.tipo || t.tipo === 'outro') ? 'sem-leitura' : 'lida');

const RESSALVAS_BASE = [
  'A coleta é um retrato do ambiente no momento indicado; não representa outro instante nem outro perfil de acesso.',
  'A visibilidade é a do usuário que fez o login. Outro perfil pode enxergar um conjunto diferente de telas e módulos.',
  'A ausência de uma tela não distingue módulo não licenciado de ausência de permissão para o usuário da coleta.',
  'Campos de senha e de upload de arquivo são deliberadamente excluídos da extração.',
  'Grades exibem 50 registros por página; telas marcadas como paginadas têm mais registros do que o número apresentado.',
  'A verificação em profundidade abre cada registro em modo de edição — único caminho oferecido pelo SoftExpert — e sai sem salvar. O acesso fica registrado na trilha de auditoria.',
];

/**
 * O critério de amostragem precisa constar no relatório: sem ele, "5 registros
 * conferem" não diz se foram 5 de 5 ou 5 de 262.
 */
function ressalvaAmostragem(prof, selecao) {
  const a = (prof && prof.amostragem) || (selecao && selecao.amostragem);
  if (!a) return [];
  if (!a.limite) return ['Verificação em profundidade sem amostragem: todos os registros das telas selecionadas foram abertos.'];
  return ['Verificação em profundidade por amostragem: ' + (a.descricao || ('até ' + a.limite + ' registros por tela')) +
    '. Registros fora da amostra não foram verificados — a ausência de divergência neles é desconhecida, não comprovada.'];
}

function payloadMapeamento(slug) {
  const amb = listaAmbientes().find(a => a.slug === slug);
  const mapa = leJson('mapa.json', null, slug);
  const contagem = leJson('contagem.json', { telas: {} }, slug);
  const prof = leJson('profundo.json', { telas: {} }, slug);
  const q = qualidade(slug);
  const telas = Object.values(contagem.telas);

  const porMod = {};
  telas.forEach(t => (porMod[t.modulo] = porMod[t.modulo] || []).push(t));

  return {
    tipo: 'mapeamento',
    ambiente: amb,
    geradoEm: new Date().toLocaleString('pt-BR'),
    capturadoEm: mapa ? new Date(mapa.capturadoEm).toLocaleString('pt-BR') : '—',
    componentes: mapa ? mapa.componentes.length : 0,
    previstas: mapa ? mapa.componentes.reduce((a, c) => a + c.menuConfiguracao.length, 0) : telas.length,
    registros: telas.reduce((a, t) => a + (t.qtd || 0), 0),
    qualidade: q,
    modulos: Object.entries(porMod).map(([nome, ts]) => ({
      nome, telas: ts.length,
      lidas: ts.filter(t => situacaoDe(t) === 'lida').length,
      semLeitura: ts.filter(t => situacaoDe(t) === 'sem-leitura').length,
      excecoes: ts.filter(t => situacaoDe(t) === 'excecao').length,
      registros: ts.reduce((a, t) => a + (t.qtd || 0), 0),
    })),
    telas: telas.map(t => ({ ...t, situacao: situacaoDe(t) })),
    profundo: Object.values(prof.telas).map(t => ({
      modulo: t.modulo, codigo: t.codigo,
      registros: Object.values(t.registros || {}),
    })),
    ressalvas: RESSALVAS_BASE.concat(ressalvaAmostragem(prof, leSelecao())),
  };
}

function payloadComparacao() {
  const p = path.join(DADOS, 'comparacao.json');
  if (!fs.existsSync(p)) return null;
  const cmp = JSON.parse(fs.readFileSync(p, 'utf8'));
  return {
    tipo: 'comparacao',
    geradoEm: new Date(cmp.geradoEm).toLocaleString('pt-BR'),
    origem: cmp.origem, destino: cmp.destino,
    resumo: cmp.resumo, componentes: cmp.componentes, telas: cmp.telas, profundo: cmp.profundo,
    qualidades: [
      { nome: cmp.origem.nome, q: cmp.origem.qualidade },
      { nome: cmp.destino.nome, q: cmp.destino.qualidade },
    ],
    ressalvas: RESSALVAS_BASE.concat([
      'A comparação usa o código da tela como chave; o identificador de página muda entre ambientes e não serve para parear.',
      'Telas marcadas como não avaliadas falharam ou não renderam conteúdo em ao menos um dos ambientes — a divergência ali é desconhecida, não ausente.',
    ]),
  };
}

function executar(opts = {}) {
  const py = achaPython();
  if (!py) {
    console.error('Python com python-docx não encontrado.');
    console.error('Instale com:  python -m pip install python-docx');
    console.error('Ou aponte o interpretador certo em SE_PYTHON.');
    process.exit(1);
  }

  const comparacao = opts.comparacao || (!opts.mapeamento && fs.existsSync(path.join(DADOS, 'comparacao.json')));
  let dados, nome;
  if (comparacao) {
    dados = payloadComparacao();
    if (!dados) { console.error('Nenhuma comparação gerada. Rode "node se.js compare" antes.'); process.exit(1); }
    nome = 'Comparacao_' + dados.origem.slug + '_x_' + dados.destino.slug;
  } else {
    const amb = ambienteAtual();
    if (!amb) { console.error('Nenhum ambiente ativo.'); process.exit(1); }
    if (!leJson('mapa.json', null, amb.slug)) { console.error('Ambiente ainda não mapeado.'); process.exit(1); }
    dados = payloadMapeamento(amb.slug);
    nome = 'Mapeamento_' + amb.slug;
  }

  const dir = path.join(DADOS, 'relatorios');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const carimbo = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const saida = path.join(dir, nome + '_' + carimbo + '.docx');
  const tmp = path.join(dir, '.payload.json');
  fs.writeFileSync(tmp, JSON.stringify(dados), 'utf8');

  try {
    const out = execFileSync(py, [path.join(RAIZ, 'ferramentas', 'gerar_docx.py'), tmp, saida], { encoding: 'utf8' });
    console.log(out.trim());
    console.log('Tamanho: ' + (fs.statSync(saida).size / 1024).toFixed(0) + ' KB');
  } catch (e) {
    console.error('Falha ao gerar o documento:');
    console.error((e.stderr || e.message || '').toString().split('\n').slice(-12).join('\n'));
    process.exit(1);
  } finally {
    fs.existsSync(tmp) && fs.unlinkSync(tmp);
  }
  return saida;
}

module.exports = { executar, payloadMapeamento, payloadComparacao };
