'use strict';
/**
 * Aceite do relatório e expurgo de evidência.
 *
 * A imagem é EVIDÊNCIA de verificação, não arquivo temporário. Apagar sem
 * registro destrói rastreabilidade — num levantamento que sustenta qualificação,
 * isso vale menos que não ter apagado nada. Por isso o expurgo aqui é
 * condicionado, seletivo e sempre auditável.
 *
 * REGRA DE EXPURGO (três níveis)
 *
 *   1. DUPLICATA — sempre segura, roda a qualquer momento.
 *      Arquivos byte a byte idênticos (md5 igual). Guarda-se UM representante
 *      e os demais viram ponteiro no manifesto. Nada se perde: o conteúdo
 *      continua disponível e o vínculo de origem fica registrado.
 *      No módulo Documento isso equivale a ~120 arquivos (114 telas de acesso
 *      negado, idênticas entre si).
 *
 *   2. PÓS-ACEITE — só depois de `aceitar`.
 *      Imagem que está EMBUTIDA no relatório aceito pode sair do disco: o
 *      .docx passa a ser o portador da evidência. O manifesto guarda caminho,
 *      md5, tamanho e a legenda com que a imagem aparece no documento, de modo
 *      que qualquer imagem possa ser localizada dentro do relatório.
 *
 *   3. NUNCA EXPURGAR
 *      - imagem que não está embutida em nenhum relatório aceito;
 *      - evidência de ACESSO NEGADO enquanto a liberação estiver pendente:
 *        é o que o cliente usa para decidir liberar o perfil ou verificar;
 *      - imagem de tela marcada como inconclusiva: a pendência ainda depende
 *        dela para ser resolvida.
 *
 * O aceite congela o relatório: grava o md5 do .docx. Se o arquivo mudar
 * depois, `expurgar` recusa — o que está em disco deixou de ser o que foi
 * aceito, e a premissa do expurgo caiu.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { leJson, gravaJson, ambienteAtual, dirAmbiente } = require('./core');

const md5 = (p) => {
  try { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); }
  catch (e) { return null; }
};

const norm = s => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

/** Todas as imagens referenciadas pelos dados de um módulo, com contexto. */
function inventario(modulo) {
  const d = leJson('passos.json', { telas: {} });
  const itens = [];
  const add = (arq, ctx) => { if (arq) itens.push({ arquivo: arq, ...ctx }); };
  for (const t of Object.values(d.telas || {})) {
    if (modulo && String(t.modulo).toLowerCase() !== String(modulo).toLowerCase()) continue;
    add(t.print, { tela: t.codigo, tipo: 'tela' });
    Object.entries(t.paginas || {}).forEach(([k, v]) => {
      if (k !== '__ignorados' && v) add(v.print, { tela: t.codigo, tipo: 'pagina', pagina: k });
    });
    for (const r of (t.registros || [])) {
      const base = { tela: t.codigo, registro: r.nome,
                     negado: !!r.negado, inconclusivo: !!r.inconclusivo };
      (r.prints || []).forEach(pr => add(pr.arquivo, { ...base, tipo: 'registro', aba: pr.aba || null }));
      Object.entries(r.opcoes || {}).forEach(([k, v]) => {
        if (k !== '__ignorados' && v) add(v.print, { ...base, tipo: 'pagina-registro', pagina: k });
      });
    }
  }
  return itens;
}

/** Inventário com a marca de duplicata resolvida por arquivo único. */
function inventarioComDuplicatas(modulo) {
  const l = inventario(modulo);
  const porHash = {};
  const visto = new Set();
  l.forEach(it => {
    if (!fs.existsSync(it.arquivo)) { it.ausente = true; return; }
    it.md5 = md5(it.arquivo);
    const k = path.resolve(it.arquivo).toLowerCase();
    if (visto.has(k)) return;
    visto.add(k);
    (porHash[it.md5] = porHash[it.md5] || []).push(it.arquivo);
  });
  const dup = {};
  Object.values(porHash).forEach(g => g.slice(1).forEach(x => { dup[path.resolve(x).toLowerCase()] = g[0]; }));
  l.forEach(it => {
    const alvo = dup[path.resolve(it.arquivo || '').toLowerCase()];
    if (alvo) it.duplicataDe = alvo;
  });
  return l;
}

function arquivoAceite(modulo) {
  return path.join(dirAmbiente(), 'aceite-' + norm(modulo) + '.json');
}

function docxDoModulo(modulo) {
  return path.join(dirAmbiente(), 'relatorio-' + norm(modulo) + '.docx');
}

/** Congela o relatório e o inventário de evidência. */
function aceitar(opts) {
  const modulo = opts.modulo;
  if (!modulo) throw new Error('Informe --modulo.');
  const docx = docxDoModulo(modulo);
  if (!fs.existsSync(docx)) throw new Error('Relatório não encontrado: ' + docx);

  const itens = inventario(modulo);
  // O agrupamento é por ARQUIVO ÚNICO, não por ocorrência no inventário.
  // O mesmo print é referenciado em mais de um lugar (em `prints` e de novo
  // em `opcoes`); agrupar por ocorrência tratava a segunda referência como
  // duplicata e mandava apagar o próprio original.
  const porHash = {};
  const vistoArquivo = new Set();
  let semArquivo = 0;
  for (const it of itens) {
    if (!fs.existsSync(it.arquivo)) { it.ausente = true; semArquivo++; continue; }
    const h = md5(it.arquivo);
    it.md5 = h;
    it.bytes = fs.statSync(it.arquivo).size;
    const chave = path.resolve(it.arquivo).toLowerCase();
    if (vistoArquivo.has(chave)) continue;     // mesma imagem, outra referência
    vistoArquivo.add(chave);
    (porHash[h] = porHash[h] || []).push(it.arquivo);
  }
  // representante = primeiro arquivo de cada conteúdo; os demais são duplicata
  const duplicataDe = {};
  for (const lista of Object.values(porHash)) {
    lista.slice(1).forEach(dup => { duplicataDe[path.resolve(dup).toLowerCase()] = lista[0]; });
  }
  itens.forEach(it => {
    const alvo = duplicataDe[path.resolve(it.arquivo || '').toLowerCase()];
    if (alvo) it.duplicataDe = alvo;
  });

  const registro = {
    modulo,
    ambiente: ambienteAtual(),
    aceitoEm: new Date().toISOString(),
    relatorio: { arquivo: docx, md5: md5(docx), bytes: fs.statSync(docx).size },
    resumo: {
      imagens: itens.length,
      distintas: Object.keys(porHash).length,
      duplicatas: itens.filter(x => x.duplicataDe).length,
      ausentes: semArquivo,
      negadas: itens.filter(x => x.negado).length,
      inconclusivas: itens.filter(x => x.inconclusivo).length,
    },
    imagens: itens,
  };
  fs.writeFileSync(arquivoAceite(modulo), JSON.stringify(registro, null, 2), 'utf8');

  console.log('Aceite registrado: ' + arquivoAceite(modulo));
  console.log('  relatório md5 ' + registro.relatorio.md5);
  const r = registro.resumo;
  console.log('  ' + r.imagens + ' imagens · ' + r.distintas + ' distintas · ' + r.duplicatas +
    ' duplicatas · ' + r.negadas + ' de acesso negado · ' + r.inconclusivas + ' inconclusivas' +
    (r.ausentes ? ' · ' + r.ausentes + ' REFERÊNCIAS SEM ARQUIVO' : ''));
  if (semArquivo) console.log('  (referência sem arquivo não impede o aceite, mas fica registrada)');
  return registro;
}

/** Aplica a regra de expurgo. Sem --aplicar, apenas simula. */
function expurgar(opts) {
  const modulo = opts.modulo;
  if (!modulo) throw new Error('Informe --modulo.');
  const nivel = opts.nivel || 'duplicatas';
  if (!['duplicatas', 'pos-aceite'].includes(nivel)) {
    throw new Error('--nivel deve ser "duplicatas" ou "pos-aceite".');
  }

  const arq = arquivoAceite(modulo);
  let aceite = null;
  if (fs.existsSync(arq)) aceite = JSON.parse(fs.readFileSync(arq, 'utf8'));

  if (nivel === 'pos-aceite') {
    if (!aceite) throw new Error('Expurgo pós-aceite exige aceite registrado. Rode: se.js aceitar --modulo ' + modulo);
    const atual = md5(aceite.relatorio.arquivo);
    if (atual !== aceite.relatorio.md5) {
      throw new Error('O relatório mudou depois do aceite (md5 diferente). ' +
        'O que está em disco não é o que foi aceito — expurgo recusado. Reaceite antes.');
    }
  }

  const itens = aceite ? aceite.imagens : inventarioComDuplicatas(modulo);

  const protegido = it =>
    it.negado ? 'evidência de acesso negado (pendência do cliente)'
    : it.inconclusivo ? 'leitura inconclusiva (pendência da ferramenta)'
    : null;

  const alvos = [], mantidos = [];
  const jaTratado = new Set();
  for (const it of itens) {
    if (it.ausente || !fs.existsSync(it.arquivo)) continue;
    // uma decisão por ARQUIVO: o mesmo print aparece várias vezes no inventário
    const chaveArq = path.resolve(it.arquivo).toLowerCase();
    if (jaTratado.has(chaveArq)) continue;
    jaTratado.add(chaveArq);
    const p = protegido(it);
    // Duplicata de acesso negado PODE sair: o representante fica, e é ele que
    // sustenta a pendência. O que nunca sai é o último exemplar.
    if (nivel === 'duplicatas') {
      if (it.duplicataDe) alvos.push(it);
      else mantidos.push({ it, motivo: 'representante único do conteúdo' });
      continue;
    }
    if (p && !it.duplicataDe) { mantidos.push({ it, motivo: p }); continue; }
    alvos.push(it);
  }

  /**
   * TRAVA FINAL, independente de tudo que veio antes.
   *
   * Nenhum arquivo sai sem que OUTRO arquivo com o MESMO md5 permaneça em
   * disco. Foi a ausência desta checagem que permitiu apagar 268 evidências
   * ao tratar a segunda referência a um arquivo como duplicata dele mesmo.
   * A conferência é feita contra o conjunto que vai FICAR, não contra o
   * manifesto — assim ela vale mesmo com manifesto desatualizado ou errado.
   */
  if (nivel === 'duplicatas') {
    const sobreviventes = new Set();
    const remover = new Set(alvos.map(x => path.resolve(x.arquivo).toLowerCase()));
    for (const it of itens) {
      if (!it.arquivo || !fs.existsSync(it.arquivo)) continue;
      if (remover.has(path.resolve(it.arquivo).toLowerCase())) continue;
      sobreviventes.add(md5(it.arquivo));
    }
    const recusados = alvos.filter(x => !sobreviventes.has(md5(x.arquivo)));
    if (recusados.length) {
      console.log('  RECUSADOS ' + recusados.length + ' arquivo(s): nenhum outro exemplar do mesmo ' +
        'conteúdo permaneceria em disco. Removê-los seria perda de evidência.');
      recusados.slice(0, 5).forEach(x => console.log('     ' + path.basename(x.arquivo)));
      const fora = new Set(recusados.map(x => x.arquivo));
      for (let i = alvos.length - 1; i >= 0; i--) if (fora.has(alvos[i].arquivo)) alvos.splice(i, 1);
    }
  }

  const bytes = alvos.reduce((a, x) => a + (x.bytes || (fs.existsSync(x.arquivo) ? fs.statSync(x.arquivo).size : 0)), 0);
  console.log('Expurgo nível "' + nivel + '" — módulo ' + modulo);
  console.log('  a remover: ' + alvos.length + ' arquivo(s) · ' + (bytes / 1048576).toFixed(1) + ' MB');
  console.log('  a manter:  ' + mantidos.length + ' arquivo(s)');
  const porMotivo = {};
  mantidos.forEach(m => { porMotivo[m.motivo] = (porMotivo[m.motivo] || 0) + 1; });
  Object.entries(porMotivo).forEach(([k, n]) => console.log('     ' + n + ' — ' + k));

  if (!opts.aplicar) {
    console.log('\n  SIMULAÇÃO. Nada foi removido. Para aplicar: acrescente --aplicar');
    return;
  }

  const removidos = [];
  for (const it of alvos) {
    try { fs.unlinkSync(it.arquivo); removidos.push({ arquivo: it.arquivo, md5: it.md5, de: it.duplicataDe || null }); }
    catch (e) { console.log('  falha ao remover ' + it.arquivo + ': ' + e.message); }
  }
  const log = path.join(dirAmbiente(), 'expurgo-' + norm(modulo) + '.json');
  const anterior = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : { eventos: [] };
  anterior.eventos.push({
    em: new Date().toISOString(), nivel, removidos: removidos.length,
    relatorioMd5: aceite ? aceite.relatorio.md5 : null, itens: removidos,
  });
  fs.writeFileSync(log, JSON.stringify(anterior, null, 2), 'utf8');
  console.log('\n  removidos: ' + removidos.length + ' · registro em ' + log);
}

function executar(opts = {}) {
  if (!ambienteAtual()) throw new Error('Nenhum ambiente ativo.');
  if (opts.expurgar) return expurgar(opts);
  return aceitar(opts);
}

module.exports = { executar, aceitar, expurgar, inventario };
