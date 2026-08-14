'use strict';
/**
 * Mapeamento: componentes instalados, menus (Geral + Configuração),
 * tarefas em aberto e contagem de registros por tela.
 * Grava checkpoint a cada tela — retomável.
 */
const { conecta, abaDeTrabalho, leJson, gravaJson, SEL, espera, pesquisar,
        melhorFrame, dirPrints, registraErro, ambienteAtual } = require('./core');
const path = require('path');

const limpa = s => (s || '').toString().replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------- Componentes
async function listaComponentes(page) {
  const top = page.mainFrame();
  await top.evaluate(() => {
    document.querySelectorAll('.dropdown.open').forEach(e => e.classList.remove('open'));
    const o = document.getElementById('pendency-overlay'); if (o) o.style.display = 'none';
  }).catch(() => {});
  await top.locator(SEL.lancadorComponentes).first().click({ force: true, timeout: 10000 });
  await espera(2500);
  return top.evaluate((sel) => {
    const lp = s => (s || '').replace(/\s+/g, ' ').trim();

    /**
     * O lancador separa o que a empresa CONTRATOU do que esta apenas
     * disponivel para teste, sob o titulo "Produtos disponiveis para teste
     * gratuito". Kanban aparece ali. Sem essa distincao, um produto nao
     * contratado vira "componente que nao abriu" — falha inventada onde o
     * certo e dizer que ele nao faz parte do escopo.
     */
    const RE_TESTE = /dispon[ií]ve(l|is)\s+para\s+teste|free\s+trial|teste\s+gratuito/i;
    let limiteTeste = Infinity;
    for (const e of document.querySelectorAll('div, span, h1, h2, h3, p')) {
      if (RE_TESTE.test(lp(e.innerText)) && lp(e.innerText).length < 80) {
        const r = e.getBoundingClientRect();
        if (r.top > 0 && r.top < limiteTeste) limiteTeste = r.top;
      }
    }
    const vistos = new Set();
    const saida = [];
    for (const e of document.querySelectorAll(sel)) {
      const nome = lp(e.innerText);
      if (!nome || vistos.has(nome)) continue;
      vistos.add(nome);
      // tudo que estiver ABAIXO do titulo da secao de teste e nao contratado
      saida.push({ nome, contratado: e.getBoundingClientRect().top < limiteTeste });
    }
    return saida;
  }, SEL.cardComponente);
}

async function abreComponente(page, nome) {
  const top = page.mainFrame();
  await top.evaluate(() => {
    document.querySelectorAll('.dropdown.open').forEach(e => e.classList.remove('open'));
    const o = document.getElementById('pendency-overlay'); if (o) o.style.display = 'none';
  }).catch(() => {});
  await top.locator(SEL.lancadorComponentes).first().click({ force: true, timeout: 10000 });
  await espera(1800);
  // Marca o card no DOM e clica de VERDADE. Evento sintetico e ignorado pelo
  // React do lancador — foi o que deixou "Administração" fora do mapa. Entre
  // os candidatos com o mesmo texto, vence o MENOR (o mais especifico).
  const achou = await top.evaluate(({ sel, alvo }) => {
    const lp = s => (s || '').replace(/\s+/g, ' ').trim();
    document.querySelectorAll('[data-se-comp]').forEach(e => e.removeAttribute('data-se-comp'));
    const iguais = [...document.querySelectorAll(sel)].filter(e => lp(e.innerText) === alvo);
    if (!iguais.length) return false;
    const area = e => { const r = e.getBoundingClientRect(); return r.width * r.height; };
    iguais.sort((a, b) => area(a) - area(b))[0].setAttribute('data-se-comp', '1');
    return true;
  }, { sel: SEL.cardComponente, alvo: nome });
  if (!achou) return false;

  /**
   * Cadeia de tentativas. Nenhuma serve para todos os cards:
   *   clique real          e o unico que o React aceita (Administração)
   *   clique no <span>     alguns cards so respondem no filho
   *   clique forcado       vence sobreposicao/animacao no primeiro item da lista
   *   evento sintetico     e o que funcionava antes; cards legados respondem a ele
   * Trocar um pelo outro quebrava o que estava de pe — por isso todas ficam,
   * e a que funcionou e devolvida para constar no mapa.
   */
  const tentativas = [
    ['clique', async () => top.locator('[data-se-comp="1"]').click({ timeout: 6000 })],
    ['span', async () => top.locator('[data-se-comp="1"] span').first().click({ timeout: 4000 })],
    ['forcado', async () => top.locator('[data-se-comp="1"]').click({ force: true, timeout: 4000 })],
    ['sintetico', async () => top.evaluate(() => {
      const el = document.querySelector('[data-se-comp="1"]');
      if (!el) return;
      const sp = el.querySelector('span') || el;
      ['mousedown', 'mouseup', 'click'].forEach(t =>
        sp.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
    })],
  ];
  for (const [nomeTent, fn] of tentativas) {
    try { await fn(); } catch (e) { continue; }
    await espera(4000);
    // confirma que saiu do lancador: o card deixou de estar visivel
    const aindaNoLancador = await top.locator('[data-se-comp="1"]').isVisible().catch(() => false);
    if (!aindaNoLancador) return nomeTent;
    // o clique nao levou a lugar nenhum; tenta a proxima forma
  }
  return false;
}

/** Clica na aba indicada (Geral/Configuração) dentro do menu do componente aberto. */
/**
 * Troca de aba no painel do componente (Geral / Configuracao).
 *
 * Tinha os mesmos dois defeitos do lancador: evento SINTETICO, que o React
 * ignora, e escolha do MAIOR elemento com aquele texto — que e o conteiner,
 * nao a aba. O resultado era silencioso e enganoso: as duas abas devolviam o
 * mesmo menu, e o componente parecia ter menos telas do que tem.
 */
async function abreAba(page, rotulo) {
  const top = page.mainFrame();
  const achou = await top.evaluate((alvo) => {
    const lp = s => (s || '').replace(/\s+/g, ' ').trim();
    document.querySelectorAll('[data-se-aba]').forEach(e => e.removeAttribute('data-se-aba'));
    const cands = [...document.querySelectorAll('div, a, span, li, button')]
      .filter(e => lp(e.innerText) === alvo)
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; });
    if (!cands.length) return false;
    // o MENOR: a aba, e nao o painel que a contem
    const area = e => { const r = e.getBoundingClientRect(); return r.width * r.height; };
    cands.sort((a, b) => area(a) - area(b))[0].setAttribute('data-se-aba', '1');
    return true;
  }, rotulo);
  if (!achou) return false;

  const alvo = top.locator('[data-se-aba="1"]');
  for (const tentar of [
    () => alvo.click({ timeout: 5000 }),
    () => alvo.click({ force: true, timeout: 4000 }),
    () => top.evaluate(() => {
      const e = document.querySelector('[data-se-aba="1"]');
      if (!e) return;
      ['mousedown', 'mouseup', 'click'].forEach(t =>
        e.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
    }),
  ]) {
    try { await tentar(); } catch (e) { continue; }
    await espera(1500);
    // confirma pela marca de aba ativa
    const ativa = await top.evaluate((r) => {
      const lp = s => (s || '').replace(/\s+/g, ' ').trim();
      const e = [...document.querySelectorAll('div, a, span, li, button')]
        .filter(x => lp(x.innerText) === r)
        .sort((a, b) => (a.getBoundingClientRect().width * a.getBoundingClientRect().height) -
                        (b.getBoundingClientRect().width * b.getBoundingClientRect().height))[0];
      if (!e) return false;
      const cls = (e.className || '').toString() + ' ' + ((e.parentElement || {}).className || '').toString();
      return /activ|selec|current/i.test(cls) || e.getAttribute('aria-selected') === 'true';
    }, rotulo).catch(() => false);
    if (ativa) return true;
  }
  return false;
}

/** Lê os itens de menu visíveis (links workspace?page=). */
async function leMenu(page) {
  return page.mainFrame().evaluate((sel) => {
    const lp = s => (s || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll(sel)]
      .map(a => ({ txt: lp(a.innerText || a.title), href: a.getAttribute('href') || '' }))
      .filter(x => x.txt);
  }, SEL.itemMenu);
}

/** Itens que pertencem à barra superior, não ao menu do componente. */
const RUIDO_TOPO = new Set(['Meu calendário', 'Apontamento de horas', 'Fórum', 'Feedback',
  'Base de conhecimento', 'Consultas salvas']);

function normalizaItens(brutos, tarefas) {
  const vistos = new Set(); const out = [];
  for (const l of brutos) {
    if (RUIDO_TOPO.has(l.txt) || tarefas.has(l.txt)) continue;
    const pageId = l.href.replace(/^.*page=/, '');
    const chave = pageId + '|' + l.txt;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const m = l.txt.match(/^(.*?)\s*\(([A-Z]{2,3}\d{3})\)\s*$/);
    out.push({ funcao: m ? m[1].trim() : l.txt, codigo: m ? m[2] : '', pageId });
  }
  return out;
}

// ------------------------------------------------------- Tarefas em aberto
async function leTarefasEmAberto(page) {
  const top = page.mainFrame();
  await top.evaluate(() => {
    document.querySelectorAll('.dropdown.open').forEach(e => e.classList.remove('open'));
  }).catch(() => {});
  try {
    await top.locator('li#myTasks').first().click({ force: true, timeout: 8000 });
    await espera(3000);
  } catch (e) { return { erro: 'menu de tarefas não abriu' }; }

  const dados = await top.evaluate(() => {
    const lp = s => (s || '').replace(/\s+/g, ' ').trim();
    const painel = document.querySelector('li#myTasks');
    if (!painel) return null;
    const badge = document.querySelector('#notificationAlertButton');
    return {
      textoPainel: lp(painel.innerText).slice(0, 4000),
      notificacoes: badge ? lp(badge.innerText) : '',
    };
  });
  await top.evaluate(() => {
    document.querySelectorAll('.dropdown.open').forEach(e => e.classList.remove('open'));
    const o = document.getElementById('pendency-overlay'); if (o) o.style.display = 'none';
  }).catch(() => {});
  return dados || {};
}

// ------------------------------------------ Contagem de registros por tela
const AVALIA_FRAME = () => {
  const nos = document.querySelectorAll('table.nodeElm').length;
  const g = document.getElementById('t_content_gridframe');
  const linhas = g ? Math.max(0, g.rows.length - 1) : 0;
  return nos * 5 + linhas * 5;
};

const EXTRAI_CONTEUDO = () => {
  const lp = s => (s || '').toString().replace(/\s+/g, ' ').trim();
  const nos = [...document.querySelectorAll('table.nodeElm')].map(tb => {
    const td = tb.querySelector('td.txtContainer');
    const chk = tb.querySelector('input[type=checkbox]');
    const ml = parseInt((tb.style.marginLeft || '0').replace('px', ''), 10) || 0;
    return { id: chk ? chk.value : '', nivel: Math.round(ml / 16), nome: td ? lp(td.innerText) : '' };
  }).filter(x => x.nome);

  const g = document.getElementById('t_content_gridframe');
  let grade = null;
  if (g && g.rows.length > 1) {
    grade = {
      colunas: [...g.rows[0].cells].map(c => lp(c.innerText)).filter(Boolean),
      linhas: [...g.rows].slice(1).map(r => [...r.cells].map(c => lp(c.innerText)).filter(v => v !== '')).filter(l => l.length),
    };
  }
  const txt = document.body ? document.body.innerText : '';
  return {
    nos, grade,
    intervalo: (txt.match(/(\d+)\s*-\s*(\d+)/) || [null])[0],
    vazio: /Nenhum registro|Nenhum resultado/i.test(txt),
  };
};

// -------------------------------------------------------------- Comando map
async function executar(opts = {}) {
  const amb = ambienteAtual();
  if (!amb) throw new Error('Nenhum ambiente ativo. Rode "node se.js env add --nome <nome> --url <url>".');
  const { browser, ctx } = await conecta();
  const page = await abaDeTrabalho(ctx);
  const base = amb.url.replace(/\/+$/, '');
  const HOST = base + '/softexpert/workspace?page=';
  console.log('Ambiente: ' + amb.nome + ' (' + base + ')');

  let mapa = leJson('mapa.json', null);

  // ---------- descoberta de componentes e menus ----------
  if (!mapa || opts.remapear) {
    console.log('Mapeando componentes e menus...');
    const componentes = await listaComponentes(page);
    console.log('Componentes encontrados: ' + componentes.length);

    const tarefas = await leTarefasEmAberto(page);

    mapa = { base, capturadoEm: new Date().toISOString(), tarefas, componentes: [] };
    for (const c of componentes) {
      const nome = typeof c === 'string' ? c : c.nome;
      const contratado = typeof c === 'string' ? true : c.contratado !== false;
      process.stdout.write('  ' + nome + ' ... ');
      if (!contratado) {
        console.log('produto disponivel para teste — nao contratado, fora do escopo');
        mapa.componentes.push({ nome, menuGeral: [], menuConfiguracao: [],
                                contratado: false,
                                observacao: 'produto disponível para teste gratuito — não contratado' });
        continue;
      }
      // Componente que não abre precisa CONSTAR como falha. Pular com continue
      // faz o módulo sumir do mapa sem deixar rastro — foi assim que
      // Administração desapareceu de um ambiente onde ela existe.
      // A abertura e INTERMITENTE: o mesmo componente que abre numa rodada
      // falha na seguinte, conforme o estado em que o lancador ficou. Uma
      // segunda tentativa, com o lancador reaberto do zero, resolve — e evita
      // registrar como falha o que e so instabilidade da interface.
      let caminhoAbertura = await abreComponente(page, nome);
      if (!caminhoAbertura) {
        await espera(2000);
        try { await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 }); await espera(5000); }
        catch (e) { /* segue com o que der */ }
        caminhoAbertura = await abreComponente(page, nome);
        if (caminhoAbertura) process.stdout.write('(2a tentativa) ');
      }
      if (!caminhoAbertura) {
        console.log('NÃO ABRIU — registrado como falha');
        mapa.componentes.push({ nome, menuGeral: [], menuConfiguracao: [], contratado: true,
                                erro: 'componente não abriu no lançador' });
        continue;
      }
      const geral = normalizaItens(await leMenu(page), new Set());
      await abreAba(page, SEL.abaMenu);
      await espera(2500);
      const conf = normalizaItens(await leMenu(page), new Set());
      console.log('geral=' + geral.length + ' config=' + conf.length);
      mapa.componentes.push({ nome, menuGeral: geral, menuConfiguracao: conf,
                              contratado: true, aberturaPor: caminhoAbertura });
    }
    gravaJson('mapa.json', mapa);
    console.log('mapa.json gravado.');
  } else {
    console.log('Reutilizando mapa.json (use --remapear para refazer).');
  }

  // ---------- contagem por tela ----------
  const contagem = leJson('contagem.json', { telas: {} });
  const fila = [];
  for (const c of mapa.componentes)
    for (const it of c.menuConfiguracao)
      fila.push({ modulo: c.nome, ...it });

  console.log('\nContando registros em ' + fila.length + ' telas de configuração...');
  for (let i = 0; i < fila.length; i++) {
    const t = fila[i];
    const chave = t.modulo + '|' + t.pageId;
    if (contagem.telas[chave] && !contagem.telas[chave].erro && !opts.recontar) continue;
    const rot = '[' + (i + 1) + '/' + fila.length + '] ' + t.modulo + ' / ' + (t.codigo || '?') + ' ' + t.funcao;
    const reg = { ...t, url: HOST + t.pageId };
    try {
      await page.goto(HOST + t.pageId, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await espera(6500);
      reg.titulo = await page.title().catch(() => '');
      await pesquisar(page);
      await espera(7500);

      const { frame } = await melhorFrame(page, AVALIA_FRAME);
      if (frame) {
        const d = await frame.evaluate(EXTRAI_CONTEUDO).catch(() => null);
        if (d) {
          reg.frame = frame.name() || '(principal)';
          reg.tipo = d.nos.length ? 'arvore' : (d.grade ? 'grade' : 'outro');
          reg.qtd = d.nos.length || (d.grade ? d.grade.linhas.length : 0);
          reg.paginado = !!(d.grade && d.grade.linhas.length >= 50);
          reg.colunas = d.grade ? d.grade.colunas : undefined;
          reg.amostra = d.nos.length ? d.nos.slice(0, 10) : (d.grade ? d.grade.linhas.slice(0, 10) : []);
          reg.vazio = d.vazio;
        }
      }
      console.log(rot + ' -> ' + (reg.tipo || 'sem conteúdo') + ' qtd=' + (reg.qtd || 0) + (reg.paginado ? ' (paginado)' : ''));
      if (!reg.tipo || reg.tipo === 'outro') {
        registraErro({ fase: 'contagem', modulo: t.modulo, codigo: t.codigo, tela: t.funcao,
          severidade: 'sem-conteudo', mensagem: 'tela abriu sem conteúdo legível' });
      }
      const arq = path.join(dirPrints(), (t.codigo || 'X') + '-' + t.modulo.replace(/[^A-Za-z0-9]+/g, '_') + '.png');
      await page.screenshot({ path: arq }).catch(() => {});
      reg.print = arq;
    } catch (e) {
      reg.erro = e.message.split('\n')[0];
      console.log(rot + ' ERRO: ' + reg.erro);
      registraErro({ fase: 'contagem', modulo: t.modulo, codigo: t.codigo, tela: t.funcao,
        severidade: 'excecao', mensagem: reg.erro });
    }
    contagem.telas[chave] = reg;
    gravaJson('contagem.json', contagem);
  }

  console.log('\nMapeamento concluído. Rode "node se.js dash" para ver o painel.');
  await browser.close();
}

module.exports = { executar, listaComponentes, abreComponente, abreAba, leMenu, leTarefasEmAberto };
