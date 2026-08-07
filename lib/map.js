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
    return [...document.querySelectorAll(sel)].map(e => lp(e.innerText)).filter(Boolean);
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
  const ok = await top.evaluate(({ sel, alvo }) => {
    const lp = s => (s || '').replace(/\s+/g, ' ').trim();
    const el = [...document.querySelectorAll(sel)].find(e => lp(e.innerText) === alvo);
    if (!el) return false;
    const sp = el.querySelector('span') || el;
    ['mousedown', 'mouseup', 'click'].forEach(t =>
      sp.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
    return true;
  }, { sel: SEL.cardComponente, alvo: nome });
  if (ok) await espera(4000);
  return ok;
}

/** Clica na aba indicada (Geral/Configuração) dentro do menu do componente aberto. */
async function abreAba(page, rotulo) {
  return page.mainFrame().evaluate((alvo) => {
    const lp = s => (s || '').replace(/\s+/g, ' ').trim();
    const cands = [...document.querySelectorAll('div')].filter(e => lp(e.innerText) === alvo && e.children.length <= 1);
    if (!cands.length) return false;
    let melhor = cands[0], area = 0;
    cands.forEach(e => { const r = e.getBoundingClientRect(); if (r.width * r.height > area) { area = r.width * r.height; melhor = e; } });
    ['mousedown', 'mouseup', 'click'].forEach(t =>
      melhor.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
    return true;
  }, rotulo);
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
    for (const nome of componentes) {
      process.stdout.write('  ' + nome + ' ... ');
      // Componente que não abre precisa CONSTAR como falha. Pular com continue
      // faz o módulo sumir do mapa sem deixar rastro — foi assim que
      // Administração desapareceu de um ambiente onde ela existe.
      if (!(await abreComponente(page, nome))) {
        console.log('NÃO ABRIU — registrado como falha');
        mapa.componentes.push({ nome, menuGeral: [], menuConfiguracao: [], erro: 'componente não abriu no lançador' });
        continue;
      }
      const geral = normalizaItens(await leMenu(page), new Set());
      await abreAba(page, SEL.abaMenu);
      await espera(2500);
      const conf = normalizaItens(await leMenu(page), new Set());
      console.log('geral=' + geral.length + ' config=' + conf.length);
      mapa.componentes.push({ nome, menuGeral: geral, menuConfiguracao: conf });
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
