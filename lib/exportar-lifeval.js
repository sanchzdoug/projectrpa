'use strict';
/**
 * Exporta a configuração levantada num formato que o LifeVal Suite ingere.
 *
 * O SE-Mapper sabe uma coisa que o LifeVal não sabe: **o que foi realmente
 * lido e o que só pareceu ter sido lido**. Por isso o payload nunca entrega um
 * campo solto — cada valor sai carimbado com a situação em que foi obtido:
 *
 *   VERIFICADO     o registro abriu e o campo foi lido (com imagem, quando há)
 *   ACESSO_NEGADO  o cliente não liberou o perfil — ação dele, não falha nossa
 *   INCONCLUSIVO   a ferramenta não alcançou — o único estado que é problema meu
 *   SEM_DETALHE    escopo decidido: a tela não seria aprofundada
 *
 * Só VERIFICADO pode sustentar afirmação numa Especificação de Configuração.
 * Misturar os quatro é o modo de falha que este projeto existe para evitar:
 * dado plausível e errado é pior do que dado ausente.
 *
 * O hash SHA-256 de cada imagem viaja junto: é ele que liga o valor lido à
 * prova, e permite ao LifeVal detectar depois que a evidência foi trocada.
 *
 * Uso:
 *   node se.js exportar-lifeval --ambiente desenvolvimento --saida lifeval.json
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { leJson, dirAmbiente, ambienteAtual, listaAmbientes } = require('./core');

const SITUACAO = {
  VERIFICADO: 'VERIFICADO',
  NEGADO: 'ACESSO_NEGADO',
  INCONCLUSIVO: 'INCONCLUSIVO',
  SEM_DETALHE: 'SEM_DETALHE',
};

/** Hash da imagem de evidência. Arquivo ausente não vira hash falso — vira null. */
const cacheHash = new Map();
function hashArquivo(p) {
  if (!p) return null;
  if (cacheHash.has(p)) return cacheHash.get(p);
  let h = null;
  try {
    if (fs.existsSync(p)) h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  } catch { h = null; }
  cacheHash.set(p, h);
  return h;
}

/**
 * Rótulo que na verdade é script vazado do DOM.
 *
 * A extração lê o texto ao redor do controle, e em algumas telas o SoftExpert
 * põe um <script> inline ali. O resultado é um "parâmetro" cujo rótulo é
 * `var fgattributetype_timeout = window.setTimeout(...)`, repetido em cada
 * registro. Isso não é configuração — é lixo com aparência de dado, e mandá-lo
 * para a IA produz afirmação inventada numa Especificação de Configuração.
 */
function rotuloEhScript(r) {
  if (!r) return false;
  return /window\.|function\s*\(|document\.|=>|var\s+\w+\s*=|setTimeout|getElementById|new\s+[A-Z]\w*\s*\(|\$\(\s*['"#]/.test(r)
    || r.length > 300;
}

/**
 * Campos sem rótulo que repetem o mesmo id são uma LISTA de opções (ex.:
 * `fgmodule` oito vezes, com uma marcada). Oito linhas "(sem rótulo) = INATIVO"
 * são ilegíveis e sugerem oito parâmetros onde há um. Vira uma linha de resumo.
 * Mesma regra do relatório (`lib/relatorio-modulo.js`), para os dois falarem
 * a mesma língua.
 */
/**
 * Metadado de auditoria do registro — não é configuração.
 *
 * "Atualizado por = Bianca Brasil" e "Criado em = 18/04/2026" descrevem o
 * histórico daquele registro, não como o sistema está configurado. Numa corrida
 * real esses três rótulos sozinhos somaram 1.449 itens (15% do levantamento) e
 * empurraram parâmetros de verdade para fora do orçamento do prompt.
 */
const METADADO = new Set([
  'criado em', 'criado por', 'atualizado em', 'atualizado por',
  'alterado em', 'alterado por', 'modificado em', 'modificado por',
  'data de criação', 'data de alteração', 'data de atualização',
  'última atualização', 'última alteração', 'revisado por', 'incluído por',
]);
const ehMetadado = (r) => METADADO.has(String(r || '').trim().toLowerCase());

/**
 * Rótulo que na verdade é o texto de ajuda da tela, grudado ao controle pela
 * extração ("Visualizar Todos os usuários poderão visualizar..."). Sem valor,
 * não especifica nada: é uma frase ocupando lugar de parâmetro. Com valor,
 * fica — pode ser um rótulo longo legítimo.
 */
function rotuloEhFrase(c) {
  const r = String(c.rotulo || '');
  const semValor = c.valor === null || c.valor === undefined || String(c.valor).trim() === '';
  return semValor && r.length > 60;
}

function resumeCampos(campos, descartados) {
  const out = [];
  const listas = {};
  for (const c of campos || []) {
    if (rotuloEhScript(c.rotulo)) { descartados.script++; continue; }
    if (ehMetadado(c.rotulo)) { descartados.metadado++; continue; }
    if (rotuloEhFrase(c)) { descartados.frase++; continue; }
    const semRotulo = !c.rotulo || c.rotulo === '(sem rótulo)';
    const marcavel = c.tipo === 'checkbox' || c.tipo === 'radio';
    if (semRotulo && marcavel && c.campo) {
      (listas[c.campo] = listas[c.campo] || []).push(c);
      continue;
    }
    // Campo sem rótulo que não é lista marcável: o valor existe, mas não há como
    // dizer do que ele é valor. "= 1" não especifica coisa alguma.
    if (semRotulo) { descartados.semRotulo++; continue; }
    out.push(c);
  }
  for (const [id, itens] of Object.entries(listas)) {
    if (itens.length === 1) {
      out.push({ ...itens[0], rotulo: 'opção «' + id + '»' });
    } else {
      const marcados = itens.filter((i) => i.valor === 'ATIVO').length;
      descartados.colapsados += itens.length - 1;
      out.push({
        campo: id,
        rotulo: 'lista «' + id + '» (rótulos não legíveis)',
        tipo: itens[0].tipo,
        bloqueado: itens.every((i) => i.bloqueado),
        valor: itens.length + ' itens · ' + marcados + ' marcado(s)',
      });
    }
  }
  return out;
}

/** Normaliza um campo capturado em item de configuração. */
function item(tela, base, campo, situacao, evidencia, nota) {
  return {
    modulo: tela.modulo || '—',
    codigoTela: tela.codigo || '—',
    nomeTela: tela.funcao || tela.titulo || '—',
    urlTela: tela.url || null,
    registro: base.registro || null,
    refRegistro: base.refRegistro || null,
    pagina: base.pagina || null,
    chaveCampo: campo ? (campo.campo || null) : null,
    rotulo: campo ? (campo.rotulo || campo.campo || '(sem rótulo)') : (base.rotulo || '(tela)'),
    tipoCampo: campo ? (campo.tipo || null) : null,
    valor: campo ? (campo.valor == null ? null : String(campo.valor)) : null,
    bloqueado: campo ? Boolean(campo.bloqueado) : false,
    situacao,
    notaSituacao: nota || null,
    caminhoEvidencia: evidencia || null,
    shaEvidencia: hashArquivo(evidencia),
  };
}

/**
 * Percorre `passos.json` e produz a lista plana de itens.
 *
 * Telas sem nenhum aprofundamento não somem do payload: viram uma linha
 * SEM_DETALHE. Omiti-las faria a cobertura parecer melhor do que é.
 */
function extrair(passos) {
  const itens = [];
  const descartados = { script: 0, metadado: 0, frase: 0, semRotulo: 0, colapsados: 0 };
  const telas = (passos && passos.telas) || {};
  let comDetalhe = 0;

  for (const tela of Object.values(telas)) {
    let rendeu = false;

    // Páginas de configuração da própria tela (não pertencem a um registro).
    for (const [nome, pag] of Object.entries(tela.paginas || {})) {
      if (nome === '__ignorados' || !pag) continue;
      if (pag.naoConfigurado) {
        itens.push(item(tela, { pagina: nome, rotulo: nome }, null, SITUACAO.SEM_DETALHE,
          pag.print || null, 'página declarada como não configurada'));
        rendeu = true;
        continue;
      }
      for (const c of resumeCampos(pag.campos, descartados)) {
        itens.push(item(tela, { pagina: nome }, c, SITUACAO.VERIFICADO, pag.print || null));
        rendeu = true;
      }
    }

    // Registros abertos um a um.
    for (const r of tela.registros || []) {
      const base = { registro: r.nome || null, refRegistro: r.identificador || null };
      const print = (r.prints || [])[0] ? (r.prints || [])[0].arquivo : null;

      if (r.negado) {
        itens.push(item(tela, { ...base, rotulo: r.nome || '(registro)' }, null,
          SITUACAO.NEGADO, print, r.mensagem || 'perfil sem permissão de leitura'));
        rendeu = true;
        continue;
      }
      if (r.inconclusivo || r.abriu === false) {
        itens.push(item(tela, { ...base, rotulo: r.nome || '(registro)' }, null,
          SITUACAO.INCONCLUSIVO, print, r.mensagem || r.erro || 'registro não pôde ser aberto'));
        rendeu = true;
        continue;
      }

      for (const c of resumeCampos(r.campos, descartados)) {
        itens.push(item(tela, base, c, SITUACAO.VERIFICADO, print));
        rendeu = true;
      }
      for (const [nome, op] of Object.entries(r.opcoes || {})) {
        if (nome === '__ignorados' || !op) continue;
        if (op.naoConfigurado) {
          itens.push(item(tela, { ...base, pagina: nome, rotulo: nome }, null,
            SITUACAO.SEM_DETALHE, op.print || null, 'aba declarada como não configurada'));
          rendeu = true;
          continue;
        }
        for (const c of resumeCampos(op.campos, descartados)) {
          itens.push(item(tela, { ...base, pagina: nome }, c, SITUACAO.VERIFICADO, op.print || null));
          rendeu = true;
        }
      }
    }

    if (rendeu) comDetalhe++;
    else {
      itens.push(item(tela, { rotulo: tela.funcao || tela.codigo || '(tela)' }, null,
        SITUACAO.SEM_DETALHE, tela.print || null, 'tela mapeada sem aprofundamento'));
    }
  }

  return { itens, telasTotal: Object.keys(telas).length, telasComDetalhe: comDetalhe, descartados };
}

function executar(o) {
  const slug = o.ambiente || o.amb || (ambienteAtual() || {}).slug;
  if (!slug) {
    console.error('Informe --ambiente <slug>. Disponíveis: ' +
      listaAmbientes().map((a) => a.slug).join(', '));
    process.exit(1);
  }

  const dir = dirAmbiente(slug);
  const amb = leJson('ambiente.json', null, slug);
  if (!amb) { console.error(`Ambiente "${slug}" não encontrado em ${dir}`); process.exit(1); }

  const passos = leJson('passos.json', null, slug);
  if (!passos) {
    console.error(`Sem passos.json em ${dir} — rode "node se.js andar --registros" antes de exportar.`);
    process.exit(1);
  }

  const mapa = leJson('mapa.json', {}, slug);
  const { itens, telasTotal, telasComDetalhe, descartados } = extrair(passos);

  const conta = (s) => itens.filter((i) => i.situacao === s).length;
  const payload = {
    origem: 'SE_MAPPER',
    refOrigem: slug,
    ambiente: { nome: amb.nome, url: amb.url, papel: amb.papel },
    capturadoEm: mapa.capturadoEm || amb.criadoEm || new Date().toISOString(),
    exportadoEm: new Date().toISOString(),
    cobertura: {
      telasTotal,
      telasComDetalhe,
      itensTotal: itens.length,
      verificados: conta(SITUACAO.VERIFICADO),
      negados: conta(SITUACAO.NEGADO),
      inconclusivos: conta(SITUACAO.INCONCLUSIVO),
      semDetalhe: conta(SITUACAO.SEM_DETALHE),
      evidencias: new Set(itens.map((i) => i.shaEvidencia).filter(Boolean)).size,
      // Declarado, não escondido: quem lê a cobertura precisa saber o que saiu.
      descartadosScript: descartados.script,
      descartadosMetadado: descartados.metadado,
      descartadosFrase: descartados.frase,
      descartadosSemRotulo: descartados.semRotulo,
      colapsadosEmLista: descartados.colapsados,
    },
    itens,
  };

  const saida = o.saida || path.join(dir, 'lifeval-import.json');
  fs.writeFileSync(saida, JSON.stringify(payload, null, 2), 'utf8');

  // Chamado pelo enviar-lifeval, o stdout precisa conter só o JSON de saída.
  if (o.silencioso) return payload;

  const c = payload.cobertura;
  console.log(`\nAmbiente: ${amb.nome} (${slug})`);
  console.log(`Telas: ${c.telasComDetalhe} aprofundadas de ${c.telasTotal}`);
  console.log(`Itens: ${c.itensTotal}`);
  console.log(`  verificados   ${c.verificados}   ← só estes sustentam afirmação na ECS`);
  console.log(`  acesso negado ${c.negados}   ← ação do cliente`);
  console.log(`  inconclusivos ${c.inconclusivos}   ← limitação da ferramenta`);
  console.log(`  sem detalhe   ${c.semDetalhe}   ← escopo decidido`);
  console.log(`Evidências com hash: ${c.evidencias}`);
  console.log('Descartados (declarados, não escondidos):');
  console.log(`  ${c.descartadosScript} rótulos que eram script`);
  console.log(`  ${c.descartadosMetadado} metadados de auditoria (Criado/Atualizado em|por)`);
  console.log(`  ${c.descartadosFrase} rótulos-frase sem valor (texto de ajuda da tela)`);
  console.log(`  ${c.descartadosSemRotulo} campos sem rótulo (valor sem do que é valor)`);
  console.log(`  ${c.colapsadosEmLista} colapsados em lista de opções`);
  console.log(`\nArquivo: ${saida}`);
}

module.exports = { executar, extrair, SITUACAO };
