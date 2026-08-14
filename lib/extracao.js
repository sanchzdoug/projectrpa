'use strict';
/**
 * Camada de dialetos.
 *
 * O SoftExpert não tem uma única gramática de tela. Entre 2.1.8 e 3.1 convivem:
 *
 *   legado   telas em iframe com ExtJS — botão PESQUISAR, grade #t_content_gridframe,
 *            árvore table.nodeElm, barra #btnnew/#btnedit/#btndel
 *   sg       telas novas no frame principal — botão .sgDFFilterSearchBtn,
 *            grade table.table-hover (id sgWidget*)
 *   filtros  telas novas cujo acionador é o botão "Filtros"
 *
 * O 3.1 mistura os três no mesmo produto. Em vez de amarrar em uma versão, cada
 * estratégia é tentada e a que responder é registrada — assim uma versão futura
 * que reaproveite qualquer uma delas continua funcionando, e uma que traga algo
 * novo aparece como "nenhuma estratégia respondeu" em vez de virar tela vazia.
 */

const ROTULOS_PESQUISA = ['PESQUISAR', 'BUSCAR', 'SEARCH'];

/** Aciona a pesquisa no frame. Devolve o nome da estratégia ou null. */
const ACIONA = (rotulos) => {
  const lp = s => (s || '').toString().replace(/\s+/g, ' ').trim();
  const cima = s => lp(s).toUpperCase();
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
  const clica = e => ['mousedown', 'mouseup', 'click'].forEach(t =>
    e.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));

  /**
   * Escolhe o elemento a clicar. Vários elementos compartilham o texto
   * "Pesquisar" — o botão e os contêineres em volta dele. Clicar no contêiner
   * não dispara o handler do React. Por isso: elemento clicável de verdade
   * primeiro e, entre iguais, o MENOR (o mais específico).
   */
  const escolhe = arr => {
    const peso = e => (e.tagName === 'BUTTON' ? 0 : e.tagName === 'A' ? 1 : e.tagName === 'INPUT' ? 2
      : (e.getAttribute('role') === 'button' || /btn|button/i.test(e.className) ? 3 : 4));
    const area = e => { const r = e.getBoundingClientRect(); return r.width * r.height; };
    return arr.slice().sort((a, b) => (peso(a) - peso(b)) || (area(a) - area(b)))[0] || null;
  };

  // 1) botão de pesquisa das telas novas
  const sg = [...document.querySelectorAll('.sgDFFilterSearchBtn')].filter(vis);
  if (sg.length) { clica(escolhe(sg)); return "sg"; }

  // 2) qualquer elemento cujo texto seja exatamente PESQUISAR/BUSCAR
  const porTexto = [...document.querySelectorAll('button,a,div,span,input[type=button],input[type=submit]')]
    .filter(e => vis(e) && rotulos.includes(cima(e.innerText || e.value)) && e.children.length <= 2);
  if (porTexto.length) { clica(escolhe(porTexto)); return "legado"; }

  // 3) telas cujo acionador é "Filtros": abre o painel e procura a pesquisa dentro
  const filtros = [...document.querySelectorAll('button,a,div')]
    .filter(e => vis(e) && cima(e.innerText) === 'FILTROS' && e.children.length <= 3);
  if (filtros.length) {
    clica(escolhe(filtros));
    return 'filtros';
  }
  return null;
};

/** Extrai listagem (árvore ou grade) de um frame, seja qual for a geração. */
const EXTRAI = () => {
  const lp = s => (s || '').toString().replace(/\s+/g, ' ').trim();
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; };

  // ---- árvore (legado) ----
  const nos = [...document.querySelectorAll('table.nodeElm')].map(tb => {
    const td = tb.querySelector('td.txtContainer');
    const chk = tb.querySelector('input[type=checkbox]');
    const ml = parseInt((tb.style.marginLeft || '0').replace('px', ''), 10) || 0;
    return { id: chk ? chk.value : '', nivel: Math.round(ml / 16), nome: td ? lp(td.innerText) : '' };
  }).filter(x => x.nome);

  // ---- grade ----
  const daTabela = (t) => {
    const linhas = [...t.rows].map(r => [...r.cells].map(c => lp(c.innerText)));
    if (linhas.length < 2) return null;
    const cab = linhas[0].filter(Boolean);
    const dados = linhas.slice(1).map(l => l.filter(v => v !== '')).filter(l => l.length);
    if (!dados.length) return null;
    return { colunas: cab, linhas: dados };
  };

  let grade = null, estrategiaGrade = null;

  // 1) grade clássica
  const g = document.getElementById('t_content_gridframe');
  if (g) { const d = daTabela(g); if (d) { grade = d; estrategiaGrade = 'legado'; } }

  // 2) grades das telas novas / qualquer tabela de dados visível — pega a maior
  if (!grade) {
    const cands = [...document.querySelectorAll('table')]
      .filter(t => vis(t) && t.rows.length > 1 && t.querySelectorAll('td').length > 1)
      // descarta tabelas usadas como layout: poucas células e sem cabeçalho
      .filter(t => t.rows[0].cells.length >= 2);
    let melhor = null, maxLin = 1;
    cands.forEach(t => { if (t.rows.length > maxLin) { maxLin = t.rows.length; melhor = t; } });
    if (melhor) {
      const d = daTabela(melhor);
      if (d) {
        grade = d;
        estrategiaGrade = /sgWidget/i.test(melhor.id) || /table-hover/i.test(melhor.className) ? 'sg' : 'tabela';
      }
    }
  }

  // 3) listas em grade React (sem <table>)
  if (!grade && !nos.length) {
    const rg = [...document.querySelectorAll('[role=grid],[role=table]')].filter(vis)[0];
    if (rg) {
      const linhas = [...rg.querySelectorAll('[role=row]')].map(r =>
        [...r.querySelectorAll('[role=cell],[role=gridcell],[role=columnheader]')].map(c => lp(c.innerText)));
      if (linhas.length > 1) {
        grade = { colunas: linhas[0].filter(Boolean), linhas: linhas.slice(1).filter(l => l.some(Boolean)) };
        estrategiaGrade = 'aria';
      }
    }
  }

  // ---- formulário: nem toda tela é listagem ----
  // Parâmetros gerais, integrações e afins são telas de configuração direta.
  // Tratá-las como "listagem vazia" seria contar como falha o que é natureza da tela.
  let campos = null;
  if (!nos.length && !grade) {
    const rotuloDe = (el) => {
      if (el.id) {
        const l = document.querySelector('label[for="' + el.id.replace(/"/g, '\\"') + '"]');
        if (l && lp(l.innerText)) return lp(l.innerText);
      }
      const lc = el.closest('label');
      if (lc && lp(lc.innerText)) return lp(lc.innerText);
      // Acumula o texto a DIREITA do controle. SCRIPT e STYLE ficam de fora:
      // sem isso o corpo de um <script> vira "rotulo" do campo e entra no
      // relatorio como se fosse nome de parametro de configuracao.
      let n = el.nextSibling, acc = '';
      while (n && acc.length < 110) {
        const tag = n.nodeType === 1 ? n.tagName : '';
        if (tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'NOSCRIPT') acc += (n.textContent || '');
        n = n.nextSibling;
      }
      acc = lp(acc);
      // rotulo com cara de codigo nao e rotulo
      if (acc && !/[{};]|=>|function\s*\(|var\s|window\./.test(acc)) return acc;
      const td = el.closest('td');
      if (td && td.previousElementSibling) return lp(td.previousElementSibling.innerText).slice(0, 100);
      return '(sem rótulo)';
    };
    // A barra de navegação tem caixas de busca anônimas em toda tela. Aceitar
    // qualquer input transformaria tela vazia em "formulário com 3 campos" —
    // um sucesso inventado. Só conta campo com identidade própria.
    const naNavegacao = el => !!el.closest(
      'header, nav, [class*=NavBar], [class*=navbar], [class*=productMenu], [class*=Search], li#components');
    const lista = [];
    document.querySelectorAll('input,select,textarea').forEach(el => {
      const tipo = (el.type || el.tagName).toLowerCase();
      if (['hidden', 'password', 'button', 'submit', 'file', 'image', 'search'].includes(tipo)) return;
      if (!vis(el) || naNavegacao(el)) return;
      const rotulo = rotuloDe(el);
      const identificado = !!(el.id || el.name) || rotulo !== '(sem rótulo)';
      if (!identificado) return;
      const c = { campo: el.id || el.name || '', rotulo, tipo,
                  bloqueado: !!el.disabled || el.readOnly === true };
      if (tipo === 'checkbox' || tipo === 'radio') c.valor = el.checked ? 'ATIVO' : 'INATIVO';
      else if (el.tagName === 'SELECT') { const o = el.options[el.selectedIndex]; c.valor = o ? lp(o.text) : ''; }
      else c.valor = lp(el.value).slice(0, 140);
      lista.push(c);
    });
    if (lista.length >= 3) campos = lista;
  }

  const txt = document.body ? document.body.innerText : '';

  // ---- acesso negado ----
  // Distinto de "tela vazia": aqui o dado existe, mas o perfil da coleta não o
  // alcança. O cliente precisa liberar o acesso ou executar a verificação ele
  // mesmo — por isso vai ao relatório como pendência dele, não como falha nossa.
  const PADROES_NEGADO = [
    /acesso\s+negado/i,
    /permiss[ãa]o\s+negada/i,
    /n[ãa]o\s+(tem|possui|est[áa]\s+autorizad)[^.]{0,40}permiss[ãa]o/i,
    /sem\s+permiss[ãa]o\s+de\s+acesso/i,
    /voc[êe]\s+n[ãa]o\s+tem\s+acesso/i,
    /access\s+denied/i,
    /not\s+authorized/i,
    /privil[ée]gio[s]?\s+insuficiente/i,
  ];
  const negado = PADROES_NEGADO.find(p => p.test(txt));
  const acessoNegado = negado
    ? { mensagem: (txt.match(new RegExp('[^\\n]{0,90}' + negado.source + '[^\\n]{0,90}', 'i')) || [''])[0].replace(/\s+/g, ' ').trim() }
    : null;

  return {
    nos, grade, estrategiaGrade, campos, acessoNegado,
    // Os DOIS-PONTOS são obrigatórios. Sem eles, "Exibir total de registros 1 - 54"
    // casa e devolve 1 — o começo do intervalo virando total. Só depois de clicar
    // no link o texto vira "Total de registros: 54".
    total: (txt.match(/Total de registros:\s*([\d.,]+)/i) || [])[1] || null,
    linkTotal: /Exibir total de registros/i.test(txt),
    vazio: /Nenhum registro|Nenhum resultado|Nenhum item/i.test(txt),
    intervalo: (txt.match(/(\d[\d.,]*)\s*-\s*(\d[\d.,]*)/) || [null])[0],
  };
};

/** Nota de relevância do frame, usada para escolher onde extrair. */
const AVALIA = () => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
  const nos = document.querySelectorAll('table.nodeElm').length;
  const g = document.getElementById('t_content_gridframe');
  const legado = g ? Math.max(0, g.rows.length - 1) : 0;
  let outras = 0;
  document.querySelectorAll('table').forEach(t => {
    if (vis(t) && t.rows.length > 1 && t.rows[0].cells.length >= 2) outras = Math.max(outras, t.rows.length - 1);
  });
  return nos * 5 + legado * 5 + outras * 3;
};

/**
 * Aciona a pesquisa em todos os frames que tiverem um acionador.
 * Devolve as estratégias que responderam.
 */
const pausa = ms => new Promise(r => setTimeout(r, ms));

/**
 * Espera a tela REND ER, em vez de dormir um tempo fixo.
 *
 * Tempo fixo é a origem de duas mentiras: "tela vazia" quando ela só estava
 * lenta, e registro fechado antes de carregar. Aqui a leitura só segue quando
 * aparece conteúdo de verdade (campos, grade, árvore, painel ou mensagem de
 * negativa) — ou quando o limite estoura, e aí isso é registrado.
 */
const TEM_CONTEUDO = () => {
  const txt = document.body ? document.body.innerText : '';
  // Campos da barra de navegação existem em TODA tela: contá-los faz qualquer
  // página parecer pronta no primeiro instante.
  const naNavegacao = el => !!el.closest(
    'header, nav, [class*=NavBar], [class*=navbar], [class*=productMenu], [class*=Search], li#components');
  const campos = [...document.querySelectorAll('input,select,textarea')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; })
    .filter(e => !naNavegacao(e)).length;
  const linhas = [...document.querySelectorAll('table')]
    .filter(t => t.rows.length > 1).reduce((a, t) => a + t.rows.length, 0);
  return {
    campos, linhas,
    nos: document.querySelectorAll('table.nodeElm').length,
    nav: document.querySelectorAll('li.menu-item, span.x-tree-node-text, h2.tab').length,
    // "Faça uma pesquisa" é o estado ANTERIOR à busca — aceitar isso como
    // pronto encerra a espera antes de existir qualquer resultado.
    vazioDeclarado: /Nenhum registro|Nenhum resultado|Nenhum item/i.test(txt),
    aguardandoPesquisa: /Fa[çc]a uma pesquisa/i.test(txt),
    negado: /n[ãa]o possui permiss[ãa]o|acesso negado/i.test(txt),
    // numa tela de listagem, "carregada" antes da busca significa ter o
    // acionador de pesquisa — o conteúdo só existe depois dele
    temAcionador: !!document.querySelector('.sgDFFilterSearchBtn') ||
      [...document.querySelectorAll('button,a,div,span')].some(e => {
        const r = e.getBoundingClientRect();
        return r.width > 4 && r.height > 4 &&
               /^(PESQUISAR|Pesquisar|BUSCAR|Filtros)$/.test((e.innerText || '').trim());
      }),
  };
};

/**
 * @param modo 'conteudo' exige resultado na tela; 'acionador' aceita a tela de
 *             listagem pronta para pesquisar (é o estado normal antes da busca,
 *             e esperar conteúdo ali gastaria o limite inteiro à toa).
 */
async function esperaConteudo(alvo, { limiteMs = 30000, intervalo = 1000, minMs = 1500, modo = 'conteudo' } = {}) {
  const inicio = Date.now();
  let ultimo = null;
  await pausa(minMs);            // nenhuma tela do SoftExpert responde antes disso
  while (Date.now() - inicio < limiteMs) {
    const frames = typeof alvo.frames === 'function' ? alvo.frames() : [alvo];
    for (const f of frames) {
      let d; try { d = await f.evaluate(TEM_CONTEUDO); } catch (e) { continue; }
      if (d.aguardandoPesquisa && modo === 'conteudo') continue;   // ainda não é resposta
      ultimo = d;
      const temConteudo = d.negado || d.vazioDeclarado || d.nos > 0 || d.linhas > 2 ||
                          d.campos >= 3 || d.nav >= 2;
      if (temConteudo || (modo === 'acionador' && d.temAcionador)) {
        return { pronto: true, ms: Date.now() - inicio, ...d };
      }
    }
    await pausa(intervalo);
  }
  return { pronto: false, ms: Date.now() - inicio, ...(ultimo || {}) };
}

/**
 * Percorre TODAS as páginas do painel NAVEGAÇÃO de um frame, lendo os campos
 * de cada uma. Serve tanto para telas de parâmetros quanto para janelas de
 * registro — a estrutura é a mesma.
 */
/**
 * Expande o painel de navegacao se ele estiver COLAPSADO.
 *
 * O botao `«` recolhe o painel a uma faixa de icones. Nesse estado os itens
 * nao tem texto e nao existem para a leitura — a tela seria reportada como
 * "sem painel" quando na verdade o painel esta fechado.
 */
async function expandePainel(frame) {
  const alvos = ['[class*=collaps]', '[class*=toggle][class*=nav]', '.sgNavHeader [class*=icon]',
                 '[title*="xpandir" i]', '[aria-label*="xpandir" i]'];
  for (const sel of alvos) {
    try {
      const l = frame.locator(sel).first();
      if (!(await l.count())) continue;
      // so clica se o painel estiver estreito
      const cx = await l.boundingBox();
      if (cx && cx.width > 0) { await l.click({ timeout: 3000 }); await pausa(900); return true; }
    } catch (e) { /* tenta o proximo */ }
  }
  return false;
}

async function percorreNavegacao(frame, { esperaMs = 1500, printBase = null, seletor = SEL_NAV } = {}) {
  let quantos = 0;
  try { quantos = await frame.locator(seletor).count(); } catch (e) { return null; }
  // painel colapsado nao entrega itens: tenta abrir antes de desistir
  if (quantos < 2) {
    try { if (await expandePainel(frame)) quantos = await frame.locator(seletor).count(); }
    catch (e) { /* segue */ }
  }
  if (quantos < 2) return null;

  const porPagina = {};
  // Botões de ação recusados. Ficam FORA de porPagina: lá dentro virariam
  // "página" no relatório. Registrados para que a recusa seja visível.
  const ignorados = [];
  const loc = frame.locator(seletor);

  // Vários passes: itens aninhados (Integração > Google Drive / Microsoft 365)
  // só existem depois que o pai é aberto. Um passe único os perderia.
  for (let passe = 0; passe < 4; passe++) {
    const total = await loc.count().catch(() => 0);
    let novos = 0;
    for (let i = 0; i < total; i++) {
      let rot = '';
      try { rot = (await loc.nth(i).innerText()).replace(/\s+/g, ' ').trim(); } catch (e) { continue; }
      // Com o submenu aberto, o innerText do pai concatena o dos filhos
      // ("Integração Google Drive Microsoft 365"). Fica só a primeira linha,
      // e o item já visitado sob outro rótulo é descartado.
      rot = rot.split('\n')[0].trim();
      if (!rot || rot.length > 40) continue;
      // A faixa mistura seções com botões de AÇÃO. Clicar em Salvar/Excluir
      // numa coleta somente-leitura é inaceitável — a janela do registro abre
      // em modo de edição e o clique grava.
      //
      // A comparação exata não bastava: na DC043 a faixa traz "Salvar e sair" e
      // "Salvar e novo", que passavam pelo filtro e ERAM CLICADOS. Agora basta
      // o rótulo COMEÇAR com um verbo de ação.
      if (/^(salvar|gravar|fechar|cancelar|excluir|apagar|remover|novo|nova|duplicar|copiar|imprimir|atualizar|voltar|enviar|aplicar|confirmar|ok)\b/i.test(rot)) {
        ignorados.push(rot);
        continue;
      }
      // Segunda barreira, independente do texto: o próprio elemento pode se
      // declarar de ação (id btnsave, onclick com submit…). O rótulo pode vir
      // em outro idioma ou com palavra que eu não previ; o atributo não muda.
      // Depois que a contrassenha foi habilitada no ambiente, o sistema não
      // barra mais a gravação — esta camada passou a ser a única proteção.
      let acao = false;
      try {
        acao = await loc.nth(i).evaluate(el => {
          const a = [el.id, el.className, el.getAttribute('name'), el.getAttribute('title'),
                     el.getAttribute('onclick'), el.getAttribute('href')].join(' ').toLowerCase();
          return /btn(save|sav|del|new|ok|apply|send)|\bsave\b|\bsubmit\b|\bdelete\b|\bsalvar\b|\bexcluir\b/.test(a);
        });
      } catch (e) { /* elemento pode ter sumido */ }
      if (acao) {
        ignorados.push(rot + " (por atributo)");
        continue;
      }

      /**
       * Item NÃO CONFIGURADO.
       *
       * No painel de navegação, o item cuja caixa está desmarcada (texto
       * acinzentado) é um recurso que a categoria não usa — "Conhecimento de
       * publicação" e "Treinamento" desmarcados, por exemplo. Não é falha de
       * leitura nem página vazia: é configuração ausente, e assim precisa
       * constar no relatório.
       *
       * E não se clica nele: o item carrega uma caixa de marcação, e clicar
       * pode LIGAR o recurso. Depois do que aconteceu com "Salvar e sair",
       * nenhum clique com potencial de escrita se justifica numa coleta.
       */
      let estado = null;
      try {
        estado = await loc.nth(i).evaluate(el => {
          // O SoftExpert marca isso de duas formas, e as duas concordam:
          //   li.locked                     recurso não habilitado na categoria
          //   ícone .../0.gif  (vs 1.gif)   a caixa de marcação desenhada
          // Não há input[type=checkbox]: a caixa é uma IMAGEM.
          const li = el.closest('li') || el;
          const img = el.querySelector('img.menu-item-icon') || el.querySelector('img');
          const arq = img ? (img.getAttribute('src') || '').split('/').pop() : '';
          return {
            travado: /\blocked\b/.test(li.className || ''),
            caixaVazia: /^0\.(gif|png)$/i.test(arq),
            desabilitado: el.getAttribute('aria-disabled') === 'true'
              || /\b(disabled|inactive|inativ)/i.test(el.className || ''),
          };
        });
      } catch (e) { /* item pode ter sumido entre a listagem e a leitura */ }

      if (estado && (estado.travado || estado.caixaVazia || estado.desabilitado)) {
        porPagina[rot] = { campos: [], naoConfigurado: true,
                           motivo: estado.travado ? 'recurso não habilitado (li.locked)'
                                 : (estado.caixaVazia ? 'caixa de marcação vazia' : 'item desabilitado') };
        novos++;
        continue;
      }
      const jaVisto = Object.keys(porPagina).some(k => k === rot || rot.startsWith(k + ' '));
      if (jaVisto) continue;
      novos++;
      try {
        // Marca o item ANTES de clicar e clica pela marca. Por indice, a lista
        // se redesenha a cada navegacao e `nth(i)` passa a apontar para outro
        // elemento — ou para um ja removido, e o clique estoura o tempo.
        await loc.nth(i).evaluate(el => {
          document.querySelectorAll('[data-se-nav]').forEach(e => e.removeAttribute('data-se-nav'));
          el.setAttribute('data-se-nav', '1');
        });
        await frame.locator('[data-se-nav="1"]').click({ timeout: 5000 });
        await pausa(esperaMs);
        // O conteúdo de cada página costuma carregar dentro de iframe; ler só o
        // documento do painel devolveria a página anterior.
        let d = await frame.evaluate(LE_JANELA);
        let grade = await frame.evaluate(LE_GRADE_ABA).catch(() => null);
        const dono = frame.page ? frame.page() : null;
        // Varre TODOS os frames sempre — antes, achar uma grade interrompia a
        // busca, e a grade encontrada costumava ser a tabela de LAYOUT do
        // formulário. O formulário de "Dados gerais" tem 18 campos e vinha
        // como grade de 5 linhas cujas "colunas" eram rótulos de campo.
        if (dono) {
          for (const f2 of dono.frames()) {
            if (f2 === frame) continue;
            let d2 = null, g2 = null;
            try { d2 = await f2.evaluate(LE_JANELA); } catch (e2) { /* segue */ }
            try { g2 = await f2.evaluate(LE_GRADE_ABA); } catch (e2) { /* segue */ }
            if (d2 && d2.campos && d2.campos.length > (d.campos || []).length) d = d2;
            if (g2 && !grade) grade = g2;
          }
        }
        // Formulário vence grade: uma tabela de layout passa no teste de grade,
        // um formulário de 18 campos não passa por acaso.
        const nCampos = (d.campos || []).length;
        const temConteudo = grade || nCampos;
        const pag = nCampos >= 3 ? { campos: d.campos }
          : (grade ? { grade }
          : (temConteudo ? { campos: d.campos } : { campos: [], apenasAbreSubmenu: true }));

        // Print DESTA página. Sem isso a tela inteira fica com uma única
        // imagem — a da última página aberta — e as outras dez ficam sem
        // evidência nenhuma, como aconteceu na DC035.
        if (printBase && dono && temConteudo) {
          const arq = printBase + '-' + arquivoSeguro(rot) + '.png';
          if (await dono.screenshot({ path: arq, fullPage: true }).then(() => true).catch(() => false))
            pag.print = arq;
        }
        porPagina[rot] = pag;
      } catch (e) { porPagina[rot] = null; }
    }
    if (!novos) break;
  }
  if (ignorados.length) porPagina.__ignorados = ignorados;
  return Object.keys(porPagina).length ? porPagina : null;
}

/**
 * Acesso negado aparece como JANELA, não como texto na página.
 * Ler não basta: o modal precisa ser fechado, senão ele fica de pé e derruba
 * todas as telas seguintes da varredura.
 */
const LE_DIALOGO = (padroes) => {
  const lp = s => (s || '').toString().replace(/\s+/g, ' ').trim();
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 120 && r.height > 60; };
  const caixas = [...document.querySelectorAll(
    '[role=dialog],[role=alertdialog],.x-window,.modal,[class*=Modal],[class*=Dialog],[class*=dialog]')]
    .filter(e => vis(e) && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden');
  if (!caixas.length) return null;
  // o diálogo mais interno costuma ser o de mensagem
  const area = e => { const r = e.getBoundingClientRect(); return r.width * r.height; };
  const cx = caixas.sort((a, b) => area(a) - area(b))[0];
  const texto = lp(cx.innerText).slice(0, 400);
  const negado = padroes.some(p => new RegExp(p, 'i').test(texto));
  const botoes = [...cx.querySelectorAll('button,a,[role=button]')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; })
    .map(e => lp(e.innerText)).filter(Boolean).slice(0, 6);
  return { texto, negado, botoes, classe: lp(cx.className).slice(0, 60) };
};

const FECHA_DIALOGO = () => {
  const lp = s => (s || '').toString().replace(/\s+/g, ' ').trim();
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
  const caixas = [...document.querySelectorAll(
    '[role=dialog],[role=alertdialog],.x-window,.modal,[class*=Modal],[class*=Dialog],[class*=dialog]')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 120 && r.height > 60; });
  for (const cx of caixas) {
    const bt = [...cx.querySelectorAll('button,a,[role=button],[class*=close],[class*=Close]')]
      .filter(vis)
      .find(e => /^(ok|fechar|close|cancelar|entendi|sim)$/i.test(lp(e.innerText)) ||
                 /close/i.test(lp(e.className)) || /fechar|close/i.test(lp(e.title)));
    if (bt) { bt.click(); return true; }
  }
  return false;
};

const PADROES_NEGADO_TXT = [
  'acesso\\s+negado', 'permiss[ãa]o\\s+negada', 'sem\\s+permiss[ãa]o',
  // texto real do SoftExpert 3.1, visto em DC043:
  // "Você não possui permissão para visualizar este registro"
  'n[ãa]o\\s+(tem|possui)[^.]{0,60}permiss[ãa]o', 'access\\s+denied', 'not\\s+authorized',
];

/**
 * Abrir um registro NÃO acontece na mesma página: o SoftExpert abre uma
 * JANELA NOVA (popup). É nela que está a resposta — o formulário do registro
 * ou "Você não possui permissão para visualizar este registro".
 *
 * Ignorar o popup foi o que fez a exploração parecer que "não abria nada".
 *
 * @param acao função que dispara a abertura (duplo clique, lápis…)
 */
/** Lê os campos visíveis da janela, com o rótulo de cada um. */
const LE_JANELA = () => {
  const lp = s => (s || '').toString().replace(/\s+/g, ' ').trim();
  const rotuloDe = (el) => {
    if (el.id) {
      const l = document.querySelector('label[for="' + el.id.replace(/"/g, '\\"') + '"]');
      if (l && lp(l.innerText)) return lp(l.innerText);
    }
    const lc = el.closest('label'); if (lc && lp(lc.innerText)) return lp(lc.innerText);

    // texto imediatamente à direita do campo (padrão de listas com caixa de marcar)
    let n = el.nextSibling, acc = '';
    while (n && acc.length < 90) { acc += (n.textContent || ''); n = n.nextSibling; }
    if (lp(acc)) return lp(acc).slice(0, 80);

    const td = el.closest('td');
    if (td) {
      // o rótulo pode estar na célula ANTERIOR ou na SEGUINTE
      const ant = td.previousElementSibling, seg = td.nextElementSibling;
      if (seg && lp(seg.innerText)) return lp(seg.innerText).slice(0, 80);
      if (ant && lp(ant.innerText)) return lp(ant.innerText).slice(0, 80);
      // ou ser o texto da linha inteira, descontando a própria célula
      const tr = el.closest('tr');
      if (tr) {
        const resto = [...tr.cells].filter(c => c !== td).map(c => lp(c.innerText)).filter(Boolean).join(' ');
        if (resto) return resto.slice(0, 80);
      }
    }
    let par = el.parentElement;
    for (let i = 0; i < 3 && par; i++, par = par.parentElement) {
      const t = lp(par.innerText || '');
      if (t && t.length < 70) return t;
    }
    return '(sem rótulo)';
  };
  const campos = [];
  document.querySelectorAll('input,select,textarea').forEach(el => {
    const tipo = (el.type || el.tagName).toLowerCase();
    if (['hidden', 'password', 'button', 'submit', 'file', 'image'].includes(tipo)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const c = { campo: el.id || el.name || '', rotulo: rotuloDe(el), tipo,
                bloqueado: !!el.disabled || el.readOnly === true };
    if (tipo === 'checkbox' || tipo === 'radio') c.valor = el.checked ? 'ATIVO' : 'INATIVO';
    else if (el.tagName === 'SELECT') { const o = el.options[el.selectedIndex]; c.valor = o ? lp(o.text) : ''; }
    else c.valor = lp(el.value).slice(0, 140);
    campos.push(c);
  });
  return { texto: lp(document.body ? document.body.innerText : '').slice(0, 500), campos, url: location.href };
};

/**
 * Abas da janela de registro. No SoftExpert são `h2.tab` dentro de `div.tab-row`,
 * e a ativa carrega a classe `selected` — verificado em DC046 (Geral/Responsável).
 */
const SEL_ABAS = 'h2.tab, .tab-row .tab, [role=tab]';

/**
 * Nem toda aba é formulário: a "Responsável" da DC046 é uma GRADE de pessoas
 * (Matrícula, Nome, Área, Função). Lida como campos, cada linha viraria um
 * "campo sem rótulo" com o conteúdo da linha no lugar do nome.
 */
const LE_GRADE_ABA = () => {
  const lp = s => (s || '').toString().replace(/\s+/g, ' ').trim();
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 20; };
  // A BARRA DE BOTÕES é uma <table>. Sem excluí-la, ela vence como "maior
  // tabela visível" em janelas sem grade e a página inteira era reportada como
  // uma grade de uma linha com colunas "Salvar" e "Salvar e sair".
  const barra = e => !!e.closest('[class*=ribbon], [class*=toolbar], [class*=seribbon]')
    || /ribbon|toolbar/i.test(e.className || '');
  const t = [...document.querySelectorAll('table')]
    .filter(x => vis(x) && x.rows.length > 1 && x.rows[0].cells.length >= 2 && !barra(x))
    .sort((a, b) => b.rows.length - a.rows.length)[0];
  if (!t) return null;
  const linhas = [...t.rows].map(r => [...r.cells].map(c => lp(c.innerText)));
  const colunas = linhas[0].filter(Boolean);
  const dados = linhas.slice(1).map(l => l.filter(v => v !== '')).filter(l => l.length);
  if (!dados.length || colunas.length < 2) return null;
  return { colunas, linhas: dados };
};

/**
 * Painel NAVEGAÇÃO e faixas de seção.
 *
 * A mesma tela pode ter várias "páginas" que só existem depois de um clique:
 *   - painel lateral: li.menu-item (principais) e li.submenu-item (aninhados,
 *     como Integração > Google Drive / Microsoft 365)
 *   - a[href="#pnXxx"].page-has-content — âncora da página correspondente
 *   - faixa de botões no topo da janela de registro (Dados gerais, Segurança…)
 *
 * Ler só a página aberta perde a maior parte da configuração. Vale para telas
 * de parâmetros E para janelas de registro.
 */
// Três formas de painel encontradas até aqui:
//   li.menu-item / li.submenu-item — painel NAVEGAÇÃO das telas de parâmetros
//   a.page-has-content             — âncora #pnXxx da página correspondente
//   span.x-tree-node-text          — árvore ExtJS dentro da janela de registro
//                                     (DC045: Cópia controlada, Revisão em…)
// Quatro formas de painel encontradas até aqui:
//   li.menu-item / li.submenu-item    painel NAVEGAÇÃO das telas de parâmetros
//   a.page-has-content                âncora #pnXxx da página correspondente
//   span.x-tree-node-text             árvore ExtJS na janela (DC045: Cópia controlada…)
//   a.x-btn-seribbon-toolbar-large    faixa "Dados do registro" (DC043/AQF:
//                                     Dados gerais, Arquivo eletrônico, Segurança,
//                                     Controle, Distribuição eletrônica)
// ATENCAO: `div.sgNavHeader` NAO entra aqui. Ele e o TITULO da secao
// ("NAVEGAÇÃO", "GERAL"), nao um item clicavel. Incluido no seletor, ele
// desloca os indices do percurso — e como a lista se redesenha a cada clique,
// o indice passa a apontar para elemento errado ou ja solto do DOM. Foi assim
// que as 14 paginas do CM006 e do CM008 viraram todas nulas, deixando so os
// dois cabecalhos com o conteudo da mesma pagina contado duas vezes.
//   ul.tabs > li.tab > a.tabText   painel das telas de parametro do 3.1
//                                   (CM006 Sistema, CM008 Autenticacao,
//                                   CM022 Notificacao). Medido: nenhuma das
//                                   outras partes casa nessas telas — zero.
//   [class*=newSimpleListItem_simpleList]
//                                   painel em lista React. No CM056 ele vem
//                                   dentro de Sidebar_listBody; no CM032, nao —
//                                   exigir o embrulho deixava a tela sem painel.
//                                   (CM056: Cobranca, Addons, Licencas,
//                                   Consumo, DNS Customizado, Backup, Trilha
//                                   de auditoria, Versao do sistema).
//                                   As classes trazem hash de build
//                                   (_aA7QD, _Y8Vcs) — casar por PREFIXO,
//                                   nunca pelo nome completo.
const SEL_NAV = 'li.menu-item, li.submenu-item, a.page-has-content, span.x-tree-node-text, ' +
                'a[class*=seribbon-toolbar], ul.tabs > li.tab > a.tabText';

/**
 * Lista React usada como painel (CM056, CM032). Fica FORA do seletor padrao:
 * o mesmo componente monta os atalhos "Acesso rapido" do CM007 (Portal, URL),
 * que nao sao painel — inclui-lo sempre criava painel falso e, pior, o
 * percurso navegava a tela e destruia a listagem. So entra quando o cliente
 * declarou que aquela tela tem painel.
 */
const SEL_LISTA_REACT = '[class*=newSimpleListItem_simpleList]';

/**
 * A janela de registro tem DUAS navegações, não uma.
 *
 *   FAIXA   "Dados do registro", no topo — Dados gerais · Arquivo eletrônico ·
 *           Segurança · Controle · Distribuição eletrônica
 *   PAINEL  "NAVEGAÇÃO", à esquerda — muda conforme a página da faixa ativa
 *           (em Dados gerais: Dados gerais · Atributo · Evento acionável;
 *            em Distribuição eletrônica: Conhecimento de publicação · Treinamento ·
 *            Lista de distribuição)
 *
 * O conteúdo é o CRUZAMENTO das duas. Tratá-las como uma lista só percorria a
 * faixa e nunca entrava no painel — cada página vinha com zero campos.
 */
const SEL_FAIXA = 'a[class*=seribbon-toolbar]';
// `:visible` é obrigatório aqui. O painel de TODAS as páginas da faixa existe
// no DOM ao mesmo tempo; só o da página ativa aparece. Sem o filtro, a página
// "Distribuição eletrônica" trazia 18 itens — 15 deles de painéis de outras
// páginas, todos com zero campos, como se fossem conteúdo dela.
const SEL_PAINEL = 'li.menu-item:visible, li.submenu-item:visible, ' +
                   'a.page-has-content:visible, span.x-tree-node-text:visible, ' +
                   'ul.tabs > li.tab > a.tabText:visible, ' +
                   '[class*=newSimpleListItem_simpleList]:visible';

/** Rótulo que representa AÇÃO (grava/exclui), nunca navegação. */
const RE_ACAO = /^(salvar|gravar|fechar|cancelar|excluir|apagar|remover|novo|nova|duplicar|copiar|imprimir|atualizar|voltar|enviar|aplicar|confirmar|ok)\b/i;
const ITENS_NAV = () => {
  const lp = s => (s || '').toString().replace(/\s+/g, ' ').trim();
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
  const itens = [];
  const visto = new Set();
  document.querySelectorAll('li.menu-item, li.submenu-item, a.page-has-content, ' +
                            'span.x-tree-node-text, a[class*=seribbon-toolbar]').forEach(e => {
    if (!vis(e)) return;
    const rot = lp(e.querySelector('.menu-item-label') ? e.querySelector('.menu-item-label').innerText : e.innerText);
    if (!rot || rot.length > 40 || visto.has(rot)) return;
    visto.add(rot);
    itens.push({ rotulo: rot,
                 ancora: (e.getAttribute('href') || (e.querySelector('a') ? e.querySelector('a').getAttribute('href') : '') || ''),
                 aninhado: e.classList.contains('submenu-item') });
  });
  return itens;
};

const ABAS_JANELA = () => {
  const lp = s => (s || '').toString().replace(/\s+/g, ' ').trim();
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 8 && r.height > 6; };
  return [...document.querySelectorAll('h2.tab, .tab-row .tab, [role=tab]')]
    .filter(vis).map(e => lp(e.innerText)).filter(Boolean);
};

/**
 * Abrir um registro NÃO acontece na mesma página: o SoftExpert abre uma
 * JANELA NOVA (popup). É nela que está a resposta — o formulário ou
 * "Você não possui permissão para visualizar este registro".
 *
 * A espera é no escopo da PÁGINA, não do contexto: com escopo de contexto,
 * dois processos em paralelo disputam a mesma janela e um rouba a do outro.
 *
 * A janela costuma ter ABAS (Geral, Responsável…). Ler só a visível perde a
 * maior parte da configuração — por isso cada aba é percorrida.
 */
/**
 * Maximiza uma janela aberta por window.open.
 *
 * Só o CDP alcança a moldura do navegador: setViewportSize age no conteúdo e
 * não move as bordas, então o formulário continuaria cortado e os campos de
 * fora seriam descartados como se não existissem.
 */
async function maximizaJanela(pop) {
  try {
    const cdp = await pop.context().newCDPSession(pop);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
    await pausa(900);
    return true;
  } catch (e) {
    // sem CDP disponível, tenta ao menos ampliar o conteúdo
    try { await pop.setViewportSize({ width: 1680, height: 1150 }); } catch (e2) { /* segue */ }
    return false;
  }
}

/**
 * Percorre a janela de registro pelos DOIS eixos: faixa × painel.
 *
 * Para cada página da faixa "Dados do registro", abre cada item do painel
 * "NAVEGAÇÃO" e lê o conteúdo do cruzamento. A chave é «Faixa › Painel».
 * Quando a página da faixa não tem painel próprio, lê a página direto.
 *
 * Devolve null se não houver faixa — aí o chamador usa o percurso simples.
 */
async function percorreFaixaEPainel(pop, { printBase = null, esperaMs = 1600 } = {}) {
  const faixa = pop.locator(SEL_FAIXA);
  let n = 0;
  try { n = await faixa.count(); } catch (e) { return null; }
  if (n < 2) return null;

  const out = {};
  const ignorados = [];
  const vistos = new Set();

  for (let i = 0; i < n; i++) {
    let rot = '';
    try { rot = (await faixa.nth(i).innerText()).replace(/\s+/g, ' ').trim().split('\n')[0].trim(); }
    catch (e) { continue; }
    if (!rot || rot.length > 40 || vistos.has(rot)) continue;
    vistos.add(rot);
    if (RE_ACAO.test(rot)) { ignorados.push(rot); continue; }

    try { await faixa.nth(i).click({ timeout: 4000 }); } catch (e) { continue; }
    await pausa(esperaMs);

    const base = printBase ? printBase + '-' + arquivoSeguro(rot) : null;

    // Painel esquerdo DESTA página da faixa. Ele muda de conteúdo a cada
    // página — é o que torna a leitura um cruzamento e não uma lista.
    //
    // O painel vive DENTRO do iframe do conteúdo, não no documento principal:
    // procurar só no principal devolvia nada e a página caía no ramo "sem
    // painel", perdendo o eixo inteiro.
    let dentro = null;
    const candidatos = [pop.mainFrame(), ...(await framesVisiveis(pop))];
    for (const f of candidatos) {
      try {
        dentro = await percorreNavegacao(f, { esperaMs: 1200, seletor: SEL_PAINEL, printBase: base });
      } catch (e) { continue; }
      if (dentro) break;
    }

    if (dentro) {
      Object.entries(dentro).forEach(([sub, v]) => {
        if (sub === '__ignorados') { ignorados.push(...v); return; }
        out[rot + ' › ' + sub] = v;
      });
      continue;
    }

    // Sem painel: a própria página da faixa é o conteúdo.
    let d = { campos: [] };
    try { d = await pop.evaluate(LE_JANELA); } catch (e) { /* segue */ }
    let grade = null;
    for (const f of await framesVisiveis(pop)) {
      let d2; try { d2 = await f.evaluate(LE_JANELA); } catch (e) { d2 = null; }
      if (d2 && d2.campos && d2.campos.length > (d.campos || []).length) d = d2;
      if (!grade) { try { grade = await f.evaluate(LE_GRADE_ABA); } catch (e) { /* segue */ } }
    }
    // Formulário tem prioridade sobre "grade": a tabela de LAYOUT de um
    // formulário passa no teste de grade e devolveria os rótulos dos campos
    // como se fossem colunas ("Categoria superior", "Tipo de conteúdo"…).
    const pag = (d.campos && d.campos.length >= 3) ? { campos: d.campos }
              : (grade ? { grade } : { campos: d.campos || [] });
    if (base) {
      const arq = base + '.png';
      if (await pop.screenshot({ path: arq, fullPage: true }).then(() => true).catch(() => false)) pag.print = arq;
    }
    out[rot] = pag;
  }

  if (ignorados.length) out.__ignorados = ignorados;
  return Object.keys(out).length ? out : null;
}

/**
 * Frames cujo <iframe> ocupa espaço na tela agora.
 *
 * Trocar de aba não descarrega o iframe da aba anterior: ele continua no DOM,
 * respondendo com a grade antiga. Sem esse filtro, a grade da aba "Etapa"
 * era gravada como se fosse o conteúdo da aba "Componente".
 */
async function framesVisiveis(pop) {
  const out = [];
  for (const f of pop.frames()) {
    if (f === pop.mainFrame()) continue;
    try {
      const el = await f.frameElement();
      // A aba inativa esconde o painel com `visibility: hidden` no DIV de cima:
      // o iframe MANTÉM 1894x814 de boundingBox. Só a visibilidade calculada
      // distingue o painel que está no ar do que ficou para trás.
      if (!(await el.isVisible())) continue;
      const cx = await el.boundingBox();
      if (cx && cx.width > 40 && cx.height > 40) out.push(f);
    } catch (e) { /* frame saiu do ar entre a listagem e a medição */ }
  }
  return out;
}

/** Nome de arquivo seguro a partir de um identificador de registro. */
function arquivoSeguro(s) {
  return String(s || 'registro').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'registro';
}

/**
 * Dialogo de registro DENTRO da pagina (terceiro dialeto).
 *
 * Nem todo detalhe abre em janela nova. O CM011 (Grupo de acesso) abre um
 * dialogo "Alterar" na propria pagina, com painel de navegacao proprio
 * (Geral, Permissoes de menus, Outras permissoes, ...). Esperar um popup que
 * nunca chega estourava o tempo em cada caminho de abertura, o dialogo ficava
 * aberto bloqueando os cliques seguintes e o registro seguinte empilhava outro
 * por cima — era o travamento em laco.
 */
/**
 * Medido no CM011 (Grupo de acesso): o SoftExpert usa `div.mask.modalAnimate`
 * com `data-id="semodal_<timestamp>"`, position fixed e z-index 10101. Na tela
 * parece janela nova — tem moldura, titulo e botao de fechar — mas o navegador
 * NAO abre pagina nova: continua tudo no mesmo documento, sem iframe.
 * Os seletores genericos ([role=dialog], .modal.in) nao casam com ele.
 */
const SEL_DIALOGO = '[data-id^=semodal_], .mask.modalAnimate, [role=dialog], .modal.in, ' +
                    '[class*=Dialog][class*=open], [class*=modal-content]';

async function achaDialogo(page) {
  for (const f of page.frames()) {
    let tem = false;
    try {
      tem = await f.evaluate((sel) => {
        const vis = e => { const r = e.getBoundingClientRect(); return r.width > 240 && r.height > 160; };
        // 1) por NOME conhecido (semodal do SoftExpert, modal Bootstrap, role=dialog)
        if ([...document.querySelectorAll(sel)].some(vis)) return true;
        // 2) por COMPORTAMENTO. Medido no CM007: "Editar" abre um <div> SEM
        //    classe, sem data-id e sem role — so um retangulo fixo grande com
        //    z-index 11002. Nenhum seletor por nome alcanca isso, e chamar de
        //    "registro nao abriu" seria afirmar falha onde houve leitura
        //    possivel. O sinal confiavel e a combinacao fixed + z alto + area.
        return [...document.querySelectorAll('div, section')].some(e => {
          if (!vis(e)) return false;
          const cs = getComputedStyle(e);
          if (cs.position !== 'fixed') return false;
          if (Number(cs.zIndex || 0) < 1000) return false;
          const r = e.getBoundingClientRect();
          return r.width > 320 && r.height > 220 && (e.innerText || '').trim().length > 20;
        });
      }, SEL_DIALOGO);
    } catch (e) { continue; }
    if (tem) return f;
  }
  return null;
}

/** Fecha o dialogo. Sem isto, ele bloqueia todo clique seguinte na tela. */
async function fechaDialogo(page) {
  const alvos = ['[data-id^=semodal_] [class*=close]', '[data-id^=semodal_] [class*=Close]',
                 '.mask.modalAnimate [class*=close]',
                 '[role=dialog] [aria-label*="ech" i]', '[role=dialog] [class*=close]',
                 '[class*=modal] [class*=close]'];
  for (const sel of alvos) {
    try {
      const l = page.locator(sel).first();
      if (await l.count()) { await l.click({ timeout: 3000 }); await pausa(900); return true; }
    } catch (e) { /* tenta o proximo */ }
  }
  // sobreposicao sem nome nao tem botao localizavel: Escape e o caminho
  try { await page.keyboard.press('Escape'); await pausa(900); return true; } catch (e) { return false; }
}

async function abreRegistro(page, acoes, espera_ms = 9000, opts = {}) {
  // Uma lista de caminhos, tentados em ordem até a janela aparecer. Grade
  // clássica abre pelo lápis; grade nova, por duplo clique. Retornar no
  // primeiro caminho deixava a outra geração sem abrir nada.
  const lista = Array.isArray(acoes) ? acoes : [acoes];
  let pop = null, caminho = null, dialogo = null;
  for (const [i, acao] of lista.entries()) {
    const aguardando = page.waitForEvent('popup', { timeout: espera_ms }).catch(() => null);
    try { await acao(); } catch (e) { /* a ação pode falhar; a janela decide */ }
    pop = await aguardando;
    if (pop) { caminho = i; break; }
    // sem popup: o detalhe pode ter aberto como DIÁLOGO na própria página
    dialogo = await achaDialogo(page);
    if (dialogo) { caminho = i; break; }
  }
  if (!pop && !dialogo) return { abriu: false };

  // O diálogo em página é lido como a própria página e FECHADO ao final.
  if (!pop && dialogo) {
    let d = { texto: '', campos: [] };
    try { d = await page.evaluate(LE_JANELA); } catch (e) { /* segue */ }
    const negadoD = PADROES_NEGADO_TXT.some(p => new RegExp(p, 'i').test(d.texto || ''));
    let opcoesD = null;
    try {
      opcoesD = await percorreNavegacao(page.mainFrame(), { esperaMs: 1200 });
    } catch (e) { /* sem painel */ }
    const prints = [];
    if (opts.printBase) {
      const arq = opts.printBase + '-' + arquivoSeguro(opts.nome) + '.png';
      if (await page.screenshot({ path: arq, fullPage: true }).then(() => true).catch(() => false))
        prints.push({ arquivo: arq, momento: 'diálogo' });
    }
    await fechaDialogo(page);
    return {
      abriu: true, negado: negadoD, url: page.url(), texto: d.texto,
      abas: [], campos: negadoD ? [] : (d.campos || []),
      opcoes: opcoesD || undefined,
      prints: prints.length ? prints : undefined,
      identificador: ((d.campos || []).find(c => /identificador/i.test(c.rotulo || '')) || {}).valor || null,
      caminho, formato: 'diálogo em página',
      mensagem: negadoD ? (d.texto || '').slice(0, 200) : null,
    };
  }

  try { await pop.waitForLoadState('domcontentloaded', { timeout: 20000 }); } catch (e) { /* segue */ }

  // A janela do registro abre PEQUENA e a leitura só conta campos visíveis:
  // o que fica fora da borda some sem aviso. setViewportSize não resolve —
  // é uma janela de navegador de verdade, aberta por window.open, e precisa
  // ser MAXIMIZADA como o usuário faria.
  await maximizaJanela(pop);
  // Espera a JANELA renderizar. Ler cedo devolve zero campos e o registro
  // seria classificado como inconclusivo sem ter tido chance de carregar.
  const prontidao = await esperaConteudo(pop, { limiteMs: 25000 });
  await new Promise(r => setTimeout(r, 1200));

  /**
   * Lê a janela inteira: documento principal MAIS os iframes.
   * O conteúdo das abas seguintes vive dentro de iframe — ler só o documento
   * principal devolve os campos da primeira aba de novo, agora ocultos e sem
   * rótulo, e eles seriam atribuídos à aba errada.
   */
  const leTudo = async () => {
    const out = [];
    for (const f of pop.frames()) {
      let r;
      try { r = await f.evaluate(LE_JANELA); } catch (e) { continue; }
      (r.campos || []).forEach(c => out.push({ ...c, _frame: f.url() }));
    }
    return out;
  };

  let d = { texto: '', campos: [] }, abas = [];
  try {
    // A primeira aba É o documento principal. Varrer os iframes aqui traria os
    // controles das outras abas (checkbox de grade, por exemplo) misturados
    // como se fossem campos desta.
    d = await pop.evaluate(LE_JANELA);
    abas = await pop.evaluate(ABAS_JANELA);
  } catch (e) { /* janela pode fechar sozinha */ }

  const prints = [];
  const basePrint = opts.printBase ? opts.printBase + '-' + arquivoSeguro(opts.nome) : null;

  // Foto do estado de ENTRADA, antes de qualquer clique. Tirada depois de
  // percorrer a faixa, ela mostrava a última página aberta — na DC043, a
  // "Distribuição eletrônica", que é vazia — como se o registro não tivesse
  // conteúdo nenhum.
  if (basePrint) {
    const arq = basePrint + '.png';
    if (await pop.screenshot({ path: arq, fullPage: true }).then(() => true).catch(() => false))
      prints.push({ arquivo: arq, aba: abas[0] || null, momento: 'abertura' });
  }

  // A janela também pode ter um painel de OPÇÕES (em DC045: Cópia controlada,
  // Revisão em elaboração, Conversão para PDF…) ou a faixa "Dados do registro".
  // Cada opção é uma página que só existe após clique — ler só a primeira perde
  // a configuração inteira, e cada uma merece sua própria imagem.
  let opcoes = null;
  try {
    const baseNav = basePrint ? basePrint + '-pag' : null;
    // Primeiro o cruzamento faixa x painel: e a estrutura real da janela de
    // registro. So se nao houver faixa cai no percurso de eixo unico.
    opcoes = await percorreFaixaEPainel(pop, { printBase: baseNav });
    if (!opcoes) opcoes = await percorreNavegacao(pop.mainFrame(), { esperaMs: 1200, printBase: baseNav });
    if (!opcoes) {
      for (const f of pop.frames()) {
        if (f === pop.mainFrame()) continue;
        opcoes = await percorreNavegacao(f, { esperaMs: 1200, printBase: baseNav });
        if (opcoes) break;
      }
    }
  } catch (e) { /* sem painel de opções */ }
  Object.entries(opcoes || {}).forEach(([nome, v]) => {
    if (v && v.print) prints.push({ arquivo: v.print, pagina: nome });
  });

  const negado = PADROES_NEGADO_TXT.some(p => new RegExp(p, 'i').test(d.texto));

  /**
   * Percorre TODAS as abas, inclusive a primeira, relendo o documento a cada
   * clique. O painel de uma aba inativa existe no DOM mas sem texto: no DC037
   * os oito módulos da aba "Componente" saíam como "(sem rótulo) = INATIVO"
   * porque foram lidos enquanto a aba "Etapa" estava aberta. Ativar a aba ANTES
   * de ler é o que dá nome a eles (Documento, Risco, Treinamento…).
   *
   * O clique é POR POSIÇÃO: casar por texto pega o rótulo de um campo
   * ("Responsável recebimento") em vez da aba.
   */
  const porAba = {};
  if (!negado && abas.length > 1) {
    const loc = pop.locator(SEL_ABAS);
    // a chave inclui o frame: o mesmo id aparece no documento principal e no
    // iframe da aba, e sem isso um sobrescreveria o outro
    const chave = c => (c._frame || '') + '|' + c.campo + '|' + c.rotulo;
    const vistos = new Set();
    const acumulado = [];
    const ondeApareceu = {};       // rótulo|campo -> quantas abas o mostraram

    for (let i = 0; i < abas.length; i++) {
      const nome = abas[i];
      try {
        if (i > 0) {
          await loc.nth(i).click({ timeout: 4000 });
          await new Promise(r => setTimeout(r, 1800));
        }

        let base = { campos: [] };
        try { base = await pop.evaluate(LE_JANELA); } catch (e) { /* aba pode falhar */ }
        // campo sem rótulo aqui é painel de OUTRA aba, ainda inativo: incluí-lo
        // encheria o relatório de linhas "(sem rótulo) = INATIVO" sem sentido
        const nomeados = (base.campos || []).filter(c => c.rotulo && c.rotulo !== '(sem rótulo)');
        nomeados.forEach(c => {
          const k = c.campo + '|' + c.rotulo;
          ondeApareceu[k] = (ondeApareceu[k] || 0) + 1;
        });

        // A grade só vale se o iframe dela estiver VISÍVEL agora: o iframe da
        // aba anterior continua carregado e sua grade seria atribuída a esta.
        let grade = null;
        for (const f of await framesVisiveis(pop)) {
          let g; try { g = await f.evaluate(LE_GRADE_ABA); } catch (e) { continue; }
          if (g) { grade = g; break; }
        }

        const novos = nomeados.filter(c => !vistos.has(chave(c)));
        novos.forEach(c => { vistos.add(chave(c)); acumulado.push({ ...c, aba: nome }); });
        porAba[nome] = grade ? { grade, campos: novos } : { campos: novos };

        // Print de CADA aba: a leitura estruturada pode escapar algo, e a
        // imagem é o que permite conferir depois o que a tela mostrava.
        if (basePrint && i > 0) {
          const arq = basePrint + '-aba' + i + '-' + arquivoSeguro(nome) + '.png';
          if (await pop.screenshot({ path: arq, fullPage: true }).then(() => true).catch(() => false))
            prints.push({ arquivo: arq, aba: nome });
        }
      } catch (e) { porAba[nome] = null; }
    }

    // Identificador, Nome e datas aparecem em todas as abas: são cabeçalho da
    // janela, não conteúdo de uma aba. Rotulá-los com a primeira aba lida
    // sugeriria uma vinculação que não existe.
    acumulado.forEach(c => {
      if ((ondeApareceu[c.campo + '|' + c.rotulo] || 0) >= abas.length) delete c.aba;
    });
    if (acumulado.length) d.campos = acumulado;
  }

  // Identidade do registro aberto, para conferir se é mesmo o que foi pedido.
  const idAberto = (d.campos.find(c => /identificador/i.test(c.rotulo || '')) || {}).valor || null;

  const resultado = {
    abriu: true, negado, url: d.url, texto: d.texto,
    abas, campos: negado ? [] : d.campos,
    camposPorAba: Object.keys(porAba).length ? porAba : undefined,
    prints: prints.length ? prints : undefined,
    opcoes: opcoes || undefined,
    identificador: idAberto,
    caminho,                         // qual dos caminhos de abertura funcionou
    prontidao,                       // se a janela chegou a renderizar, e em quanto tempo
    mensagem: negado ? d.texto.slice(0, 200) : null,
  };
  try { await pop.close(); } catch (e) { /* já fechada */ }
  return resultado;
}

/**
 * Diálogos NATIVOS do navegador (alert/confirm) — é assim que o SoftExpert
 * avisa acesso negado. Sem um ouvinte registrado, o Playwright os descarta
 * sozinho e a mensagem some: a varredura registrava "tela vazia" sem nunca
 * saber que o acesso tinha sido barrado.
 *
 * Chame UMA VEZ por página, antes de navegar. Os avisos ficam em `page._seAvisos`.
 */
function escutaDialogosNativos(page) {
  if (page._seEscutando) return page;
  page._seEscutando = true;
  page._seAvisos = [];
  page.on('dialog', async d => {
    const msg = (d.message() || '').replace(/\s+/g, ' ').trim();
    const negado = PADROES_NEGADO_TXT.some(p => new RegExp(p, 'i').test(msg));
    page._seAvisos.push({ tipo: d.type(), mensagem: msg, negado, quando: new Date().toISOString() });
    try { await d.dismiss(); } catch (e) { /* já fechado pelo próprio navegador */ }
  });
  return page;
}

/** Consome os avisos nativos acumulados desde a última leitura. */
function colheAvisos(page) {
  const a = page._seAvisos || [];
  page._seAvisos = [];
  return a;
}

/** Verifica se há janela aberta, classifica e fecha. */
async function trataDialogo(page) {
  for (const f of page.frames()) {
    let d;
    try { d = await f.evaluate(LE_DIALOGO, PADROES_NEGADO_TXT); } catch (e) { continue; }
    if (!d) continue;
    let fechado = false;
    try { fechado = await f.evaluate(FECHA_DIALOGO); } catch (e) { /* segue */ }
    if (!fechado) { try { await page.keyboard.press('Escape'); fechado = true; } catch (e) { /* segue */ } }
    return { ...d, frame: f.name() || '(principal)', fechado };
  }
  return null;
}

async function acionaPesquisa(page, esperar = 2500) {
  const usadas = [];
  let abriuFiltros = false;
  for (const f of page.frames()) {
    try {
      const r = await f.evaluate(ACIONA, ROTULOS_PESQUISA);
      if (r) { usadas.push({ frame: f.name() || '(principal)', estrategia: r }); if (r === 'filtros') abriuFiltros = true; }
    } catch (e) { /* frame inacessível */ }
  }
  // "Filtros" só abre o painel; a pesquisa fica dentro dele
  if (abriuFiltros) {
    await pausa(esperar);
    for (const f of page.frames()) {
      try {
        const r = await f.evaluate(ACIONA, ROTULOS_PESQUISA);
        if (r && r !== 'filtros') usadas.push({ frame: f.name() || '(principal)', estrategia: r + ' (após filtros)' });
      } catch (e) { /* segue */ }
    }
  }
  return usadas;
}

module.exports = { ACIONA, EXTRAI, AVALIA, acionaPesquisa, trataDialogo, LE_DIALOGO,
  escutaDialogosNativos, colheAvisos, abreRegistro, percorreNavegacao, ITENS_NAV, esperaConteudo,
  SEL_NAV, SEL_LISTA_REACT,
  maximizaJanela,
  ROTULOS_PESQUISA, PADROES_NEGADO_TXT };
