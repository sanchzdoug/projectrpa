'use strict';
/**
 * Modo "andar junto": percorre as telas de um módulo devagar, guardando
 * PRINT + LEITURA DE DOM de cada uma, lado a lado.
 *
 * Existe porque a extração por DOM erra em silêncio: ela devolve vazio e não
 * há como saber se a tela estava vazia mesmo ou se o seletor não serviu. Com o
 * print ao lado, dá para conferir e corrigir a receita de cada tipo de tela.
 *
 * Diferença central para o `map`: aqui os cliques são REAIS (Playwright), não
 * eventos sintéticos. A interface nova ignora evento sintético em link React —
 * foi o que fazia telas carregarem vazias.
 */
const fs = require('fs');
const path = require('path');
const { conecta, abaDeTrabalho, leJson, gravaJson, ambienteAtual, dirAmbiente, espera } = require('./core');
const { EXTRAI, AVALIA, trataDialogo, escutaDialogosNativos, colheAvisos,
        abreRegistro, percorreNavegacao, esperaConteudo, PADROES_NEGADO_TXT,
        SEL_NAV, SEL_LISTA_REACT } = require('./extracao');

/** Nomes dos itens listados, seja árvore ou grade. */
async function listaNomes(frame, tipo) {
  if (tipo === 'arvore') {
    return frame.evaluate(() => {
      const lp = s => (s || '').replace(/\s+/g, ' ').trim();
      return [...document.querySelectorAll('table.nodeElm')].map(tb => {
        const td = tb.querySelector('td.txtContainer');
        const ml = parseInt((tb.style.marginLeft || '0').replace('px', ''), 10) || 0;
        return { nivel: Math.round(ml / 16), nome: td ? lp(td.innerText) : '' };
      }).filter(x => x.nome && x.nivel >= 1).map(x => x.nome);
    }).catch(() => []);
  }
  return frame.evaluate(() => {
    const lp = s => (s || '').replace(/\s+/g, ' ').trim();
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
    const t = [...document.querySelectorAll('table')].filter(x => vis(x) && x.rows.length > 1)
      .sort((a, c) => c.rows.length - a.rows.length)[0];
    if (!t) return [];
    // primeira célula com texto de cada linha serve de identificador
    return [...t.rows].slice(1)
      .map(r => [...r.cells].map(c => lp(c.innerText)).find(v => v && v.length > 1))
      .filter(Boolean);
  }).catch(() => []);
}

/** Aciona a pesquisa com clique REAL, tentando os dialetos conhecidos. */
async function pesquisaReal(page) {
  const tentativas = [
    { nome: 'sg', achar: f => f.locator('.sgDFFilterSearchBtn').first() },
    { nome: 'botao', achar: f => f.getByRole('button', { name: /^\s*(pesquisar|buscar)\s*$/i }).first() },
    { nome: 'texto', achar: f => f.getByText(/^\s*(PESQUISAR|Pesquisar|BUSCAR)\s*$/).first() },
  ];
  for (const f of page.frames()) {
    for (const t of tentativas) {
      try {
        const loc = t.achar(f);
        if (await loc.count() === 0) continue;
        await loc.click({ timeout: 6000 });
        return t.nome;
      } catch (e) { /* tenta o próximo */ }
    }
  }
  // telas cujo acionador é "Filtros": abre o painel e procura a pesquisa dentro
  for (const f of page.frames()) {
    try {
      const fl = f.getByRole('button', { name: /^\s*filtros\s*$/i }).first();
      if (await fl.count()) {
        await fl.click({ timeout: 6000 });
        await espera(2500);
        for (const t of tentativas) {
          try {
            const loc = t.achar(f);
            if (await loc.count() === 0) continue;
            await loc.click({ timeout: 6000 });
            return 'filtros+' + t.nome;
          } catch (e) { /* segue */ }
        }
        return 'filtros';
      }
    } catch (e) { /* segue */ }
  }
  return null;
}

/**
 * Expande a árvore até o fim. Sem isso, só o primeiro nível é listado — e as
 * categorias filhas, que são a maior parte do conteúdo, ficam invisíveis.
 * O expansor é o ícone de estado que NÃO é o espaçador em branco.
 */
async function expandeArvore(frame, maxPasses = 15) {
  // A seta é definida por CLASSE, não pela imagem: todos os src são blank.gif e
  // o desenho vem do CSS. "arrowplus" = recolhido, "arrowminus" = já aberto.
  // Procurar por src nunca encontra nada.
  const SETAS_FECHADAS = 'td.stateImgContainer img.arrowplus';
  const conta = () => frame.evaluate(() => document.querySelectorAll('table.nodeElm').length);
  const fechadas = () => frame.locator(SETAS_FECHADAS).count();

  let nos = await conta().catch(() => 0);
  if (!nos) return { nos: 0, passes: 0, expandidos: 0 };

  let expandidos = 0, passes = 0;
  for (let p = 1; p <= maxPasses; p++) {
    let n = 0;
    try { n = await fechadas(); } catch (e) { break; }
    if (!n) break;
    passes = p;
    // clique REAL, uma seta por vez: a árvore se redesenha a cada expansão
    for (let i = 0; i < n; i++) {
      try {
        const seta = frame.locator(SETAS_FECHADAS).first();
        if (!(await seta.count())) break;
        await seta.click({ timeout: 4000 });
        expandidos++;
        await espera(600);
      } catch (e) { break; }
    }
    await espera(1200);
    const agora = await conta().catch(() => nos);
    if (agora === nos && !(await fechadas().catch(() => 0))) { nos = agora; break; }
    nos = agora;
  }
  return { nos, passes, expandidos };
}

/** Clica em "Exibir total de registros" e devolve o total revelado. */
async function revelaTotal(page) {
  for (const f of page.frames()) {
    try {
      const loc = f.getByText(/exibir total de registros/i).first();
      if (await loc.count() === 0) continue;
      await loc.click({ timeout: 6000 });
      await espera(4000);
      const t = await f.evaluate(() => {
        const txt = document.body ? document.body.innerText : '';
        // dois-pontos obrigatórios: sem eles, "Exibir total de registros 1 - 54"
        // devolveria 1 — o início do intervalo passando por total
        return (txt.match(/Total de registros:\s*([\d.,]+)/i) || [])[1] || null;
      });
      if (t) return { total: t, revelado: true };
    } catch (e) { /* segue */ }
  }
  // algumas telas já mostram o total sem pedir
  for (const f of page.frames()) {
    try {
      const t = await f.evaluate(() => {
        const txt = document.body ? document.body.innerText : '';
        // dois-pontos obrigatórios: sem eles, "Exibir total de registros 1 - 54"
        // devolveria 1 — o início do intervalo passando por total
        return (txt.match(/Total de registros:\s*([\d.,]+)/i) || [])[1] || null;
      });
      if (t) return { total: t, revelado: false };
    } catch (e) { /* segue */ }
  }
  return { total: null, revelado: false };
}

/** Telas que o cliente dispensou do detalhamento — foto sim, registro a registro nao. */
function carregaSemDetalhe() {
  try {
    const p = path.join(__dirname, '..', 'dados', 'ignorar.json');
    if (!fs.existsSync(p)) return {};
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    delete d._nota;
    return d;
  } catch (e) { return {}; }
}
const SEM_DETALHE = carregaSemDetalhe();

/**
 * Telas com painel de navegacao interno declarado pelo cliente.
 *
 * Serve de EXPECTATIVA: se o percurso nao achar o painel, a tela vira
 * pendencia em vez de passar como lida. Sem isso, "painel nao percorrido" e
 * "tela sem painel" chegam iguais no relatorio — e o primeiro caso e falha.
 */
function carregaComNavegacao() {
  try {
    const p = path.join(__dirname, '..', 'dados', 'navegar.json');
    if (!fs.existsSync(p)) return {};
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    delete d._nota;
    return d;
  } catch (e) { return {}; }
}
const COM_NAVEGACAO = carregaComNavegacao();

async function executar(opts = {}) {
  const amb = ambienteAtual();
  if (!amb) throw new Error('Nenhum ambiente ativo.');
  const contagem = leJson('contagem.json', { telas: {} });
  let telas = Object.values(contagem.telas || {});

  if (opts.modulo) telas = telas.filter(t => t.modulo.toLowerCase() === String(opts.modulo).toLowerCase());
  if (opts.tela) {
    const cods = String(opts.tela).split(',').map(s => s.trim().toUpperCase());
    telas = telas.filter(t => cods.includes((t.codigo || '').toUpperCase()));
  }
  if (opts.limite) telas = telas.slice(0, Number(opts.limite));
  if (!telas.length) { console.error('Nenhuma tela encontrada com esse filtro.'); process.exit(1); }

  // ---- retomada: pula o que já foi percorrido ----
  const feito = leJson('passos.json', { telas: {} });
  const limitePedido = opts.registros === true ? 9999 : Number(opts.registros || 0);
  // Uma tela lida com limite menor NÃO está pronta: tratá-la como feita
  // esconderia registros que nunca foram abertos.
  const jaCompleta = t => {
    const r = feito.telas[t.modulo + '::' + t.codigo];
    if (!r) return false;
    if (r.erro) return false;
    return (r.limiteRegistros || 0) >= limitePedido;
  };
  const pendentes = opts.refazer ? telas : telas.filter(t => !jaCompleta(t));
  const jaFeitas = telas.length - pendentes.length;

  // ---- blocos: coleta longa não sobrevive ao tempo de sessão do SoftExpert ----
  const bloco = opts.bloco === true ? 5 : (opts.bloco ? Number(opts.bloco) : 0);
  const daVez = bloco > 0 ? pendentes.slice(0, bloco) : pendentes;

  if (!daVez.length) {
    console.log('Nada pendente: as ' + telas.length + ' telas do filtro já foram percorridas.');
    console.log('Use --refazer para percorrer de novo.');
    return;
  }
  console.log(jaFeitas + ' já percorrida(s) · ' + pendentes.length + ' pendente(s) · ' +
              daVez.length + ' neste bloco\n');
  telas = daVez;

  const destino = path.join(dirAmbiente(), 'passos');
  if (!fs.existsSync(destino)) fs.mkdirSync(destino, { recursive: true });

  console.log('Ambiente: ' + amb.nome + ' · ' + telas.length + ' tela(s)\n');
  const resultado = leJson('passos.json', { telas: {} });

  const { browser, ctx } = await conecta();
  const page = await abaDeTrabalho(ctx, true);   // aba própria, não atrapalha a sua
  await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => {});
  escutaDialogosNativos(page);   // acesso negado chega como alert nativo

  let sessaoCaiu = false;
  for (let i = 0; i < telas.length; i++) {
    const t = telas[i];
    const rot = '[' + (i + 1) + '/' + telas.length + '] ' + (t.codigo || '?').padEnd(7) + t.funcao;
    const reg = { modulo: t.modulo, codigo: t.codigo, funcao: t.funcao, url: t.url };
    try {
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Sessão expirada devolve a tela de login. Continuar daqui gravaria telas
      // vazias como se fossem resultado — o percurso para e avisa.
      if (/\/login\b/i.test(page.url())) {
        console.log('\n  SESSÃO EXPIRADA — o SoftExpert devolveu a tela de login.');
        console.log('  Faça o login na janela do navegador e rode o mesmo comando de novo:');
        console.log('  ele retoma a partir de ' + t.codigo + ', sem refazer o que já foi lido.\n');
        sessaoCaiu = true;
        break;
      }

      // Espera a tela existir, em vez de dormir um tempo fixo. Ler cedo demais
      // produz "vazio" que na verdade é "não esperei o suficiente".
      reg.carga = await esperaConteudo(page, { limiteMs: 35000, modo: 'acionador' });
      if (!reg.carga.pronto) reg.aviso = 'tela não renderizou dentro do limite';

      // 1) janela na cara (acesso negado costuma aparecer aqui)
      let dlg = await trataDialogo(page);
      if (dlg) {
        reg.dialogoAoAbrir = dlg;
        if (dlg.negado) reg.acessoNegado = dlg.texto;
        await espera(1500);
      }

      // 2) pesquisa com clique real, esperando o resultado aparecer
      reg.acionador = await pesquisaReal(page);
      reg.cargaPosPesquisa = await esperaConteudo(page, { limiteMs: 35000 });

      // 3) janela após a pesquisa
      dlg = await trataDialogo(page);
      if (dlg) {
        reg.dialogoAposPesquisa = dlg;
        if (dlg.negado) reg.acessoNegado = dlg.texto;
        await espera(1200);
      }

      // 4) total
      const tot = await revelaTotal(page);
      reg.total = tot.total;
      reg.totalRevelado = tot.revelado;

      // 5) leitura de DOM
      let melhor = null, nota = -1;
      for (const f of page.frames()) {
        let n; try { n = await f.evaluate(AVALIA); } catch (e) { continue; }
        if (n > nota) { nota = n; melhor = f; }
      }
      // Telas de parâmetros não têm árvore nem grade: a nota empata em zero em
      // todos os frames e a escolha sairia arbitrária. Nesse caso vale quem tem
      // mais campos de formulário — é lá que está o painel NAVEGAÇÃO.
      if (nota <= 0) {
        let maxCampos = -1;
        for (const f of page.frames()) {
          let n; try { n = await f.evaluate(() => document.querySelectorAll('input,select,textarea').length); }
          catch (e) { continue; }
          if (n > maxCampos) { maxCampos = n; melhor = f; }
        }
      }
      // 5a) árvore recolhida esconde a maior parte do conteúdo
      if (melhor) {
        const exp = await expandeArvore(melhor);
        if (exp.passes) { reg.expansao = exp; await espera(1500); }
      }
      // A LEITURA DA LISTAGEM VEM PRIMEIRO. Percorrer o painel navega a tela
      // e a grade desaparece: o CM007 perdeu os 3 registros que tinha, e o
      // CM006 e o CM008 saiam como 'nada' pelo mesmo motivo. Ler antes de
      // navegar preserva as duas coisas.
      if (melhor) {
        let d = await melhor.evaluate(EXTRAI).catch(() => null);
        // SEGUNDA CHANCE. Tela que devolve nada pode so nao ter terminado de
        // renderizar — o CM012 (configuracao da trilha de auditoria) saiu como
        // "nao consegui ler" e tinha a tela inteira preenchida quatro segundos
        // depois. Declarar ilegivel o que so precisava de mais um instante e o
        // pior erro possivel aqui, entao vale uma releitura antes de desistir.
        const vazio = x => !x || (!x.nos.length && !x.grade && !x.campos);
        if (vazio(d)) {
          await espera(4500);
          const d2 = await melhor.evaluate(EXTRAI).catch(() => null);
          if (!vazio(d2)) { d = d2; reg.leituraNaSegundaTentativa = true; }
        }
        if (d) {
          // "vazio" é resultado, não falha: a tela respondeu "Nenhum registro
          // encontrado". Misturar isso com "não consegui ler" inflava a taxa de
          // falha e escondia o número real de telas sem configuração.
          // Árvore só com o nó raiz é árvore VAZIA. Chamar de "árvore com 0
          // registros" sugere leitura falha quando o cadastro é que está vazio.
          const arvoreComFilhos = d.nos.filter(n => n.nivel >= 1).length > 0;
          reg.tipo = arvoreComFilhos ? 'arvore'
            : (d.grade ? 'grade'
            : (d.campos ? 'formulario'
            : ((d.vazio || d.nos.length) ? 'vazio' : 'nada')));
          reg.qtdDom = d.nos.length || (d.grade ? d.grade.linhas.length : (d.campos ? d.campos.length : 0));
          reg.colunas = d.grade ? d.grade.colunas : undefined;
          reg.amostra = d.nos.length ? d.nos.slice(0, 8)
            : (d.grade ? d.grade.linhas.slice(0, 8) : (d.campos ? d.campos.slice(0, 8) : []));
          reg.intervalo = d.intervalo;
          if (d.acessoNegado) reg.acessoNegado = d.acessoNegado.mensagem;
        }
      }

      // Tela marcada como SEM DETALHAMENTO: e percorrida, contada e fotografada
      // — a foto principal entra no relatorio —, mas os registros nao sao
      // abertos um a um. E decisao do cliente, nao limitacao da ferramenta, e
      // por isso fica declarada no registro em vez de virar lacuna silenciosa.
      const semDet = SEM_DETALHE[reg.codigo];
      if (semDet) {
        reg.semDetalhe = { motivo: semDet.motivo, definidoPor: semDet.definidoPor, em: semDet.em };
        console.log('        (sem detalhamento por decisão: ' + semDet.motivo + ')');
      }

      // 5b) explorar os itens listados, abrindo a janela de cada um
      if (!semDet && opts.registros && melhor && (reg.tipo === 'arvore' || reg.tipo === 'grade')) {
        const limite = Number(opts.registros) > 1 ? Number(opts.registros) : 9999;
        const nomes = await listaNomes(melhor, reg.tipo);
        const alvos = nomes.slice(0, limite);
        reg.registros = [];
        // Evidência por registro: uma pasta por tela, para o relatório poder
        // mostrar a imagem ao lado da tabela extraída dela.
        const dirEvid = path.join(destino, 'evidencias', t.codigo || 'X' + i);
        if (!fs.existsSync(dirEvid)) fs.mkdirSync(dirEvid, { recursive: true });
        const baseEvid = path.join(dirEvid, 'reg');
        let neg = 0, abr = 0, inc = 0;
        process.stdout.write('        abrindo ' + alvos.length + ' de ' + nomes.length + ' registro(s): ');
        for (const nome of alvos) {
          // Seleção: em grade clássica quem seleciona é a LINHA, não o texto da
          // célula. Clicar no texto deixa a seleção anterior de pé e o lápis
          // reabre o registro errado.
          // A linha alvo é MARCADA no DOM e clicada pela marca. Índice não serve:
          // ele é calculado dentro da maior tabela, mas o seletor enumera as
          // linhas de todas as tabelas do frame — e os registros saem trocados.
          let selecionou = false;
          if (reg.tipo === 'grade') {
            try {
              const achou = await melhor.evaluate((alvo) => {
                const lp = s => (s || '').replace(/\s+/g, ' ').trim();
                document.querySelectorAll('[data-se-alvo]').forEach(e => e.removeAttribute('data-se-alvo'));
                const t = [...document.querySelectorAll('table')].filter(x => x.rows.length > 1)
                  .sort((a, c) => c.rows.length - a.rows.length)[0];
                if (!t) return false;
                for (let i = 1; i < t.rows.length; i++) {
                  if ([...t.rows[i].cells].map(c => lp(c.innerText)).some(v => v === alvo)) {
                    t.rows[i].setAttribute('data-se-alvo', '1');
                    return true;
                  }
                }
                return false;
              }, nome);
              if (achou) { await melhor.locator('tr[data-se-alvo="1"]').click({ timeout: 5000 }); selecionou = true; }
            } catch (e) { /* tenta pelo texto abaixo */ }
          }
          if (!selecionou) {
            try { await melhor.getByText(nome, { exact: true }).first().click({ timeout: 5000 }); }
            catch (e) { /* pode não ser clicável; o lápis ainda pode servir */ }
          }
          await espera(900);
          // Índice da linha por CÉLULA exata: casar pelo texto da linha erra
          // quando o identificador é subcadeia de outro ("Padrão" está dentro
          // de "Padrão Logbook").
          const r = await abreRegistro(page, [
            // 1) duplo clique na linha marcada — grade da interface nova
            async () => {
              if (selecionou) await melhor.locator('tr[data-se-alvo="1"]').dblclick({ timeout: 5000 });
              else await melhor.getByText(nome, { exact: true }).first().dblclick({ timeout: 5000 });
            },
            // 2) lápis da barra — grade e árvore clássicas
            async () => {
              for (const f of page.frames()) {
                try {
                  const bt = f.locator('#btnedit');
                  if (await bt.count()) { await bt.first().click({ timeout: 4000 }); return; }
                } catch (e) { /* segue */ }
              }
            },
            // 3) MENU DA LINHA e depois EDITAR — grade React nova.
            //
            // Medido no CM007 (Home): "Ações" ali e uma COLUNA, nao um botao
            // de barra. Cada linha traz um kebab em
            //   div.NewBodyRow_actionBodyCellContainer_* > button > i.seicon-more
            // Procurar um botao chamado "Ações" na barra nunca acha nada — e a
            // busca larga por /ações/ chegava a casar dentro de "notificações",
            // clicando no sino em vez do menu.
            async () => {
              for (const f of page.frames()) {
                try {
                  const marcou = await f.evaluate((alvo) => {
                    const lp = s => (s || '').replace(/\s+/g, ' ').trim();
                    document.querySelectorAll('[data-se-kebab]').forEach(e => e.removeAttribute('data-se-kebab'));
                    const linhas = [...document.querySelectorAll('tr, [role=row]')];
                    const linha = linhas.find(l => [...l.querySelectorAll('*')]
                      .some(c => lp(c.innerText) === alvo)) ||
                      document.querySelector('tr[data-se-alvo="1"]');
                    if (!linha) return false;
                    const k = linha.querySelector('i.seicon-more, [class*=seicon-more], ' +
                      '[class*=actionBodyCell] button, [class*=ActionCell] button');
                    if (!k) return false;
                    (k.closest('button') || k).setAttribute('data-se-kebab', '1');
                    return true;
                  }, nome);
                  if (!marcou) continue;
                  await f.locator('[data-se-kebab="1"]').click({ timeout: 4000 });
                  await espera(1400);
                  const ed = f.getByText(/^\s*(editar|alterar)\s*$/i).first();
                  if (await ed.count()) { await ed.click({ timeout: 4000 }); return; }
                } catch (e) { /* segue */ }
              }
            },
          ], 8000, { printBase: baseEvid, nome });

          // Trava contra dado trocado: se o registro aberto não for o pedido,
          // vale como inconclusivo. Reportar dado de outro item é pior que
          // reportar que não deu para ler.
          const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
          if (r.abriu && !r.negado && r.identificador &&
              !norm(nome).startsWith(norm(r.identificador)) &&
              !norm(nome).includes(norm(r.identificador))) {
            r.divergente = { pedido: nome, aberto: r.identificador };
            r.campos = [];
          }
          // Janela que abre sem campo e sem aba não é leitura: é inconclusiva.
          // Contá-la como "aberta" afirmaria verificação que não houve.
          // Uma janela cujo conteúdo está nas PÁGINAS da faixa "Dados do
          // registro" não é vazia: os campos ficam no iframe da página, não no
          // documento principal. Ignorar isso marcava as 10 categorias do DC043
          // como inconclusivas e as tirava do relatório detalhado.
          const vazia = r.abriu && !r.negado && !(r.campos || []).length
                        && !(r.abas || []).length && !Object.keys(r.opcoes || {}).length;
          if (r.negado) { neg++; process.stdout.write('N'); }
          else if (r.divergente) { inc++; process.stdout.write('X'); }
          else if (vazia) { inc++; process.stdout.write('?'); }
          else if (r.abriu) { abr++; process.stdout.write('.'); }
          else process.stdout.write('-');
          reg.registros.push({ nome, abriu: r.abriu, negado: !!r.negado,
                               inconclusivo: !!(vazia || r.divergente), divergente: r.divergente,
                               identificador: r.identificador || null,
                               mensagem: r.mensagem || null, campos: r.campos || [],
                               abas: r.abas || [], camposPorAba: r.camposPorAba, opcoes: r.opcoes,
                               prints: r.prints, formato: r.formato || null });
          await espera(700);
        }
        reg.registrosAbertos = abr;
        reg.registrosInconclusivos = inc;
        reg.registrosNegados = neg;
        console.log('  -> ' + abr + ' abertos, ' + neg + ' negados' + (inc ? ', ' + inc + ' inconclusivos' : ''));
      }

      // 5a') painel NAVEGAÇÃO: cada item é uma página que só existe após clique
      if (melhor) {
        const dirNav = path.join(destino, 'evidencias', t.codigo || 'X' + i);
        if (!fs.existsSync(dirNav)) fs.mkdirSync(dirNav, { recursive: true });
        // A lista React so entra no seletor quando a tela foi DECLARADA como
        // tendo painel: o mesmo componente monta atalhos que nao sao navegacao.
        const decl = COM_NAVEGACAO[reg.codigo];
        const seletor = (decl && !decl.soNoRegistro)
          ? SEL_NAV + ', ' + SEL_LISTA_REACT
          : SEL_NAV;
        const nav = await percorreNavegacao(melhor, { printBase: path.join(dirNav, 'pag'), seletor });
        // expectativa declarada: esta tela deveria ter painel
        // `soNoRegistro` diz que o painel vive dentro da janela do registro,
        // nao na tela. Exigi-lo na tela produzia pendencia onde nao ha falha.
        if (COM_NAVEGACAO[reg.codigo] && !COM_NAVEGACAO[reg.codigo].soNoRegistro && !nav) {
          reg.navegacaoEsperada = {
            resultado: 'painel NÃO encontrado',
            definidoPor: COM_NAVEGACAO[reg.codigo].definidoPor,
          };
          console.log('        ATENÇÃO: painel de navegação esperado e não encontrado.');
        }
        if (nav) {
          reg.paginas = nav;
          reg.totalPaginas = Object.keys(nav).filter(k => k !== '__ignorados').length;
          if (nav.__ignorados) reg.botoesRecusados = nav.__ignorados;
          const somaCampos = Object.values(nav).reduce((a, v) => a + ((v && v.campos) ? v.campos.length : 0), 0);
          reg.camposNavegacao = somaCampos;
        }
      }
      // 6) avisos nativos acumulados nesta tela (alert de acesso negado)
      const avisos = colheAvisos(page);
      if (avisos.length) {
        reg.avisosNativos = avisos;
        const neg = avisos.find(a => a.negado);
        if (neg) reg.acessoNegado = neg.mensagem;
      }

      // 7) print — a evidência que não mente
      const arq = path.join(destino, (t.codigo || 'X' + i) + '.png');
      await page.screenshot({ path: arq, fullPage: false }).catch(() => {});
      reg.print = arq;

      console.log(rot);
      console.log('        acionador=' + (reg.acionador || '—') +
        ' | tipo=' + (reg.tipo || '—') + ' | domQtd=' + (reg.qtdDom || 0) +
        ' | total=' + (reg.total || '—') + (reg.totalRevelado ? ' (revelado)' : '') +
        (reg.acessoNegado ? ' | ACESSO NEGADO' : ''));
      if (reg.acessoNegado) console.log('        >>> ' + reg.acessoNegado.slice(0, 120));
    } catch (e) {
      reg.erro = e.message.split('\n')[0];
      console.log(rot + '\n        ERRO: ' + reg.erro);
    }
    // Marca de completude em TODA tela percorrida, inclusive as vazias: sem
    // isso, a retomada nunca as dá por prontas e o bloco reprocessa as mesmas
    // telas indefinidamente, sem avançar.
    // Tela cujo conteudo esta no PAINEL nao e "nada": houve leitura. O percurso
    // consome a tela e a grade some, mas `nada` significa "nao consegui ler" —
    // rotular assim uma tela com 8 paginas lidas seria acusar falha onde ha dado.
    if (reg.totalPaginas && (reg.tipo === 'nada' || reg.tipo === 'vazio')) reg.tipo = 'painel';
    reg.limiteRegistros = limitePedido;
    resultado.telas[t.modulo + '::' + t.codigo] = reg;
    gravaJson('passos.json', resultado);
  }

  // Cada execução cria a própria aba; sem fechar, blocos sucessivos acumulam
  // dezenas de abas e acabam derrubando o navegador.
  try { await page.close(); } catch (e) { /* já fechada */ }

  const restantes = pendentes.length - telas.length + (sessaoCaiu ? 1 : 0);
  console.log('\nPrints em: ' + destino);
  console.log('Leitura em: passos.json');
  if (sessaoCaiu) {
    console.log('\nBLOCO INTERROMPIDO PELA SESSÃO. Relogue e repita o comando.');
  } else if (restantes > 0) {
    console.log('\nBloco concluído. Faltam ' + restantes + ' tela(s) — repita o comando para o próximo.');
  } else {
    console.log('\nMódulo concluído.');
  }
  await browser.close();
}

module.exports = { executar, pesquisaReal, revelaTotal, expandeArvore, listaNomes };
