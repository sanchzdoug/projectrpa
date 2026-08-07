'use strict';
/**
 * Análise profunda: abre registro a registro das telas selecionadas.
 *
 * Fluxo verificado no SoftExpert 2.2.3 (não altere sem reinspecionar):
 *   1. duplo clique na linha/nó  -> apenas SELECIONA (não abre nada)
 *   2. clique em #btnedit        -> abre a tela de configuração do registro
 *   3. lê os campos              -> nunca aciona Salvar
 *   4. fecha/volta               -> retorna à listagem
 *
 * A tela abre em modo de edição; isso fica registrado na trilha de auditoria.
 */
const path = require('path');
const { conecta, abaDeTrabalho, leJson, gravaJson, leSelecao, SEL, espera, pesquisar,
        melhorFrame, registraErro, ambienteAtual } = require('./core');

const AVALIA_LISTA = () => {
  const nos = document.querySelectorAll('table.nodeElm').length;
  const g = document.getElementById('t_content_gridframe');
  return nos * 5 + (g ? Math.max(0, g.rows.length - 1) * 5 : 0);
};

const LISTA_ITENS = () => {
  const lp = s => (s || '').toString().replace(/\s+/g, ' ').trim();
  const nos = [...document.querySelectorAll('table.nodeElm')].map(tb => {
    const td = tb.querySelector('td.txtContainer');
    const chk = tb.querySelector('input[type=checkbox]');
    const ml = parseInt((tb.style.marginLeft || '0').replace('px', ''), 10) || 0;
    return { id: chk ? chk.value : '', nivel: Math.round(ml / 16), nome: td ? lp(td.innerText) : '', tipo: 'no' };
  }).filter(x => x.nome);
  if (nos.length) return nos;
  const g = document.getElementById('t_content_gridframe');
  if (!g) return [];
  return [...g.rows].slice(1).map((r, i) => ({
    id: String(i), nivel: 0, tipo: 'linha',
    nome: [...r.cells].map(c => lp(c.innerText)).filter(Boolean).join(' | '),
  })).filter(x => x.nome);
};

/** Lê todos os campos de formulário do frame de detalhe. */
const LE_CAMPOS = () => {
  const lp = s => (s || '').toString().replace(/\s+/g, ' ').trim();
  const rotuloDe = (el) => {
    if (el.id) {
      const l = document.querySelector('label[for="' + el.id.replace(/"/g, '\\"') + '"]');
      if (l && lp(l.innerText)) return lp(l.innerText);
    }
    const lc = el.closest('label');
    if (lc && lp(lc.innerText)) return lp(lc.innerText);
    let n = el.nextSibling, acc = '';
    while (n && acc.length < 120) { acc += (n.textContent || ''); n = n.nextSibling; }
    if (lp(acc)) return lp(acc);
    const td = el.closest('td');
    if (td && td.previousElementSibling && lp(td.previousElementSibling.innerText)) return lp(td.previousElementSibling.innerText);
    const row = el.closest('tr, div');
    return row ? lp(row.innerText).slice(0, 110) : '(sem rótulo)';
  };
  const campos = [];
  document.querySelectorAll('input, select, textarea').forEach(el => {
    const tipo = (el.type || el.tagName).toLowerCase();
    if (['hidden', 'password', 'button', 'submit', 'file', 'image'].includes(tipo)) return;
    const c = { campo: el.id || el.name || '', rotulo: rotuloDe(el), tipo, bloqueado: !!el.disabled || el.readOnly === true };
    if (tipo === 'checkbox' || tipo === 'radio') c.valor = el.checked ? 'ATIVO' : 'INATIVO';
    else if (el.tagName === 'SELECT') { const o = el.options[el.selectedIndex]; c.valor = o ? lp(o.text) : ''; }
    else c.valor = lp(el.value).slice(0, 160);
    campos.push(c);
  });
  const secoes = [...document.querySelectorAll('a.page-has-content, a.item-active, [role=tab]')]
    .map(e => lp(e.innerText)).filter(Boolean);
  return { campos, secoes, titulo: lp(document.title || '') };
};

async function abreDetalhe(page, frameLista, item) {
  // 1) seleciona
  if (item.tipo === 'no') {
    await frameLista.locator(SEL.textoNo, { hasText: item.nome.slice(0, 40) }).first()
      .dblclick({ force: true, timeout: 12000 });
  } else {
    await frameLista.locator(SEL.gradeConteudo + ' tr').nth(Number(item.id) + 1)
      .dblclick({ force: true, timeout: 12000 });
  }
  await espera(2000);

  // 2) lápis
  let clicou = false;
  for (const f of page.frames()) {
    try {
      const n = await f.locator(SEL.btnEditar).count();
      if (n) { await f.locator(SEL.btnEditar).first().click({ force: true, timeout: 8000 }); clicou = true; break; }
    } catch (e) { /* segue */ }
  }
  if (!clicou) return { erro: 'botão Editar não encontrado' };
  await espera(6000);

  // 3) lê o frame com mais campos
  const { frame, nota } = await melhorFrame(page, () => document.querySelectorAll('input,select,textarea').length);
  if (!frame || nota < 3) return { erro: 'tela de detalhe não abriu' };
  const dados = await frame.evaluate(LE_CAMPOS).catch(e => ({ erro: e.message }));
  return dados;
}

async function fechaDetalhe(page, urlLista) {
  // volta pela URL da listagem — mais confiável que caçar o botão fechar
  try {
    await page.goto(urlLista, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await espera(5000);
    await pesquisar(page);
    await espera(6000);
  } catch (e) { /* segue */ }
}

async function executar(opts = {}) {
  const amb = ambienteAtual();
  if (!amb) throw new Error('Nenhum ambiente ativo.');
  const selecao = leSelecao();
  if (!selecao.telas || !selecao.telas.length) {
    console.error('dados/selecao.json vazio ou ausente. Marque as telas no painel ("node se.js dash").');
    process.exit(1);
  }
  const contagem = leJson('contagem.json', { telas: {} });
  // a seleção é por CÓDIGO de tela: o pageId muda de um ambiente para outro
  const porCodigo = {};
  for (const t of Object.values(contagem.telas)) porCodigo[t.modulo + '::' + t.codigo] = t;

  console.log('Ambiente: ' + amb.nome + ' · ' + selecao.telas.length + ' tela(s) selecionada(s)');
  const { browser, ctx } = await conecta();
  const page = await abaDeTrabalho(ctx);

  const resultado = leJson('profundo.json', { telas: {} });
  // --limite na linha de comando vence; senão vale o critério de amostragem da seleção
  const amostragem = selecao.amostragem || { modo: 'todos', limite: 0 };
  const limite = opts.limite ? Number(opts.limite)
    : (amostragem.limite ? Number(amostragem.limite) : Infinity);
  resultado.amostragem = { ...amostragem, aplicadoEm: new Date().toISOString() };
  console.log('Amostragem: ' + (limite === Infinity ? 'todos os registros' : 'até ' + limite + ' registros por tela'));

  for (const alvo of selecao.telas) {
    const chaveSel = alvo.modulo + '::' + alvo.cod;
    const tela = porCodigo[chaveSel];
    if (!tela) {
      console.log('tela ausente neste ambiente: ' + chaveSel);
      registraErro({ fase: 'profundo', modulo: alvo.modulo, codigo: alvo.cod,
        severidade: 'ausente', mensagem: 'tela selecionada não existe neste ambiente' });
      continue;
    }
    alvo.k = chaveSel;
    console.log('\n===== ' + tela.modulo + ' / ' + tela.codigo + ' ' + tela.funcao + ' =====');

    const reg = resultado.telas[alvo.k] || { ...tela, registros: {} };
    try {
      await page.goto(tela.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await espera(6000);
      await pesquisar(page);
      await espera(7000);

      const { frame: fl } = await melhorFrame(page, AVALIA_LISTA);
      if (!fl) { console.log('  listagem não carregou'); continue; }
      const itens = (await fl.evaluate(LISTA_ITENS)).slice(0, limite);
      console.log('  registros a abrir: ' + itens.length);

      for (let i = 0; i < itens.length; i++) {
        const it = itens[i];
        const chaveItem = it.id + '|' + it.nome.slice(0, 60);
        if (reg.registros[chaveItem] && !reg.registros[chaveItem].erro) continue;
        process.stdout.write('   [' + (i + 1) + '/' + itens.length + '] ' + it.nome.slice(0, 55) + ' ... ');
        try {
          const det = await abreDetalhe(page, fl, it);
          if (det.erro) {
            console.log('ERRO: ' + det.erro);
            reg.registros[chaveItem] = { ...it, erro: det.erro };
            registraErro({ fase: 'profundo', modulo: tela.modulo, codigo: tela.codigo,
              registro: it.nome, severidade: 'excecao', mensagem: det.erro });
          } else {
            const nAtivos = (det.campos || []).filter(c => c.valor === 'ATIVO').length;
            console.log(det.campos.length + ' campos (' + nAtivos + ' ativos)');
            reg.registros[chaveItem] = { ...it, ...det };
          }
        } catch (e) {
          const msg = e.message.split('\n')[0];
          console.log('ERRO: ' + msg.slice(0, 60));
          reg.registros[chaveItem] = { ...it, erro: msg };
          registraErro({ fase: 'profundo', modulo: tela.modulo, codigo: tela.codigo,
            registro: it.nome, severidade: 'excecao', mensagem: msg });
        }
        await fechaDetalhe(page, tela.url);
        resultado.telas[alvo.k] = reg;
        gravaJson('profundo.json', resultado);
      }
    } catch (e) {
      console.log('  ERRO na tela: ' + e.message.split('\n')[0]);
      reg.erro = e.message.split('\n')[0];
    }
    resultado.telas[alvo.k] = reg;
    gravaJson('profundo.json', resultado);
  }

  console.log('\nAnálise profunda concluída: dados/profundo.json');
  await browser.close();
}

module.exports = { executar };
