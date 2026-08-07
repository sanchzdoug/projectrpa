'use strict';
/**
 * Painel: acompanhamento do mapeamento e comparação entre ambientes.
 *
 * Estrutura: faixa de comando escura no topo (identidade, veredito, traço e
 * indicadores) e, no papel, uma tabela única e buscável com todas as telas —
 * não acordeões: com 301 telas, procurar módulo a módulo não serve para trabalhar.
 */
const fs = require('fs');
const path = require('path');
const { leJson, leSelecao, ambienteAtual, qualidade, DADOS } = require('./core');

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ROTULO = {
  conforme: 'confere', divergente: 'diverge',
  'so-origem': 'só na origem', 'so-destino': 'só no destino',
  'nao-avaliado': 'não avaliada', erro: 'exceção', 'sem-conteudo': 'sem leitura', lida: 'lida',
};

const dataHora = s => { try { return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return '—'; } };

const CSS = `
:root{
  --noite:#0A0E13; --noite-2:#141A22; --noite-3:#212B36; --claro:#E9EFF4; --claro-2:#8A9BAB;
  --papel:#F7F8F9; --papel-2:#FFFFFF; --tinta:#11161B; --grafite:#4C5762; --tenue:#818D99;
  --vinco:#D8DDE1; --vinco-2:#EBEEF0;
  --ok:#2FB894; --dif:#F0A32E; --falha:#FF6072; --org:#8C8DF2; --dst:#4FB2E3;
  --ok-p:#1B6B55; --dif-p:#9A5A16; --falha-p:#A32235; --org-p:#43479A; --dst-p:#1F6E8C;
  --display:"Bahnschrift Condensed","Bahnschrift","Segoe UI Variable Display","Segoe UI",sans-serif;
  --corpo:"Segoe UI",system-ui,-apple-system,sans-serif;
  --dado:"Cascadia Mono",Consolas,ui-monospace,monospace;
}
/* a página tem esquema próprio (faixa escura + corpo claro); sem isto o modo
   escuro automático do navegador repinta tudo e destrói a hierarquia */
:root{color-scheme:light}
*{box-sizing:border-box}
html,body{margin:0;padding:0;min-height:100%;background:var(--papel)}
body{font-family:var(--corpo);color:var(--tinta);font-size:13.5px;line-height:1.55;
  -webkit-font-smoothing:antialiased}
:focus-visible{outline:2px solid var(--dst);outline-offset:2px}
/* ocupa a largura da tela: é ferramenta de dados, coluna estreita desperdiça monitor.
   Os blocos de texto corrido têm limite próprio de medida. */
.env{width:100%;max-width:2400px;margin:0 auto;padding:0 clamp(16px,2.2vw,40px)}

/* ============ faixa de comando ============ */
.cmd{background:var(--noite);color:var(--claro);padding-bottom:4px}
.cmd__id{display:flex;align-items:baseline;justify-content:space-between;gap:20px;flex-wrap:wrap;
  padding:14px 0 16px;border-bottom:1px solid var(--noite-3)}
.marca{font-family:var(--display);font-size:17px;font-weight:600;letter-spacing:.32em;text-transform:uppercase}
.marca span{color:var(--claro-2);letter-spacing:.1em;font-size:12px;margin-left:14px;text-transform:none}
.carimbo{font-family:var(--dado);font-size:11px;color:var(--claro-2)}

.alvos{display:flex;gap:34px;flex-wrap:wrap;padding:18px 0 4px}
.alvo{border-left:3px solid var(--noite-3);padding-left:13px}
.alvo--org{border-left-color:var(--org)} .alvo--dst{border-left-color:var(--dst)}
.alvo__p{font-family:var(--display);font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--claro-2)}
.alvo__n{font-family:var(--display);font-size:24px;font-weight:600;line-height:1.15}
.alvo__u{font-family:var(--dado);font-size:11px;color:#6B7E8F}

.tese{font-family:var(--display);font-weight:600;font-size:clamp(23px,2.9vw,36px);line-height:1.18;
  letter-spacing:-.005em;margin:22px 0 6px;max-width:30ch}
.tese em{font-style:normal;color:var(--dif)}
.tese em.ok{color:var(--ok)} .tese em.mal{color:var(--falha)}
.tese__ap{font-size:13.5px;color:var(--claro-2);max-width:72ch;margin-bottom:20px;font-family:var(--corpo);font-weight:400}

.traco{border:1px solid var(--noite-3);background:var(--noite-2);margin-bottom:20px}
.traco__c{display:flex;justify-content:space-between;gap:16px;padding:8px 13px;border-bottom:1px solid var(--noite-3)}
.traco__t{font-family:var(--display);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--claro-2)}
.traco__l{font-size:11px;color:#6B7E8F}
.traco svg{display:block;width:100%;height:94px;padding:10px 13px 0}
.traco__m{display:flex;font-family:var(--dado);font-size:9.5px;color:#6B7E8F;border-top:1px solid var(--noite-3)}
.traco__m>div{flex:1 1 0;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  padding:5px 2px;border-right:1px solid var(--noite-3)}
.traco__m>div:last-child{border-right:0}

.ind{display:flex;flex-wrap:wrap;gap:1px;background:var(--noite-3);border:1px solid var(--noite-3);margin-bottom:22px}
.ind__c{background:var(--noite);padding:12px 17px;flex:1 1 140px;border-top:2px solid transparent}
.ind__c--ok{border-top-color:var(--ok)} .ind__c--dif{border-top-color:var(--dif)}
.ind__c--falha{border-top-color:var(--falha)} .ind__c--org{border-top-color:var(--org)} .ind__c--dst{border-top-color:var(--dst)}
.ind__n{font-family:var(--display);font-size:29px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
.ind__n small{font-size:14px;color:var(--claro-2);font-weight:400}
.ind__r{font-family:var(--display);font-size:10.5px;letter-spacing:.15em;text-transform:uppercase;color:var(--claro-2);margin-top:6px}

/* ============ papel ============ */
.corpo{padding:26px 0 30px}
.sec{margin-bottom:30px}
.sec__c{display:flex;align-items:baseline;justify-content:space-between;gap:16px;
  border-bottom:1.5px solid var(--tinta);padding-bottom:6px;margin-bottom:13px}
.sec__t{font-family:var(--display);font-size:13px;letter-spacing:.18em;text-transform:uppercase;font-weight:600;margin:0}
.sec__n{font-family:var(--dado);font-size:11.5px;color:var(--tenue)}

.barra-f{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.busca{flex:1 1 260px;min-width:200px;font:inherit;font-family:var(--dado);font-size:12.5px;
  padding:7px 11px;border:1px solid var(--vinco);background:var(--papel-2)}
.filtro{font:inherit;font-size:12px;padding:6px 13px;border:1px solid var(--vinco);background:var(--papel-2);
  cursor:pointer;color:var(--grafite);white-space:nowrap}
.filtro[aria-pressed="true"]{background:var(--tinta);color:#fff;border-color:var(--tinta)}

.quadro{border:1px solid var(--vinco);background:var(--papel-2)}
.rolagem{max-height:min(62vh,760px);overflow:auto}
table{width:100%;border-collapse:collapse}
thead th{position:sticky;top:0;z-index:1;background:var(--papel-2);
  font-family:var(--display);font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--tenue);
  text-align:left;padding:8px 12px;border-bottom:1.5px solid var(--tinta);font-weight:600;white-space:nowrap}
tbody td{padding:5px 12px;border-bottom:1px solid var(--vinco-2);vertical-align:top}
tbody tr:hover{background:#F1F5F7}
tbody tr.marcada{background:#FFF8EC}
td.cod,th.cod{font-family:var(--dado);font-size:12px;white-space:nowrap}
td.num,th.num{font-family:var(--dado);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.mid{text-align:center;color:var(--tenue);font-family:var(--dado)}
td.mod{color:var(--grafite);white-space:nowrap}
.chk{width:30px}

.sit{font-family:var(--display);font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;white-space:nowrap;
  padding-left:8px;border-left:2px solid currentColor}
.sit--conforme,.sit--lida{color:var(--ok-p)} .sit--divergente,.sit--sem-conteudo{color:var(--dif-p)}
.sit--so-origem{color:var(--org-p)} .sit--so-destino{color:var(--dst-p)}
.sit--nao-avaliado{color:var(--tenue)} .sit--erro{color:var(--falha-p)}
.mais{color:var(--dif-p);font-family:var(--dado);cursor:help}
.nota{font-size:12.5px;color:var(--grafite)}
.vazio{padding:18px;border:1px dashed var(--vinco);color:var(--grafite);background:var(--papel-2)}

/* qualidade por módulo */
.mods{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:1px;background:var(--vinco);
  border:1px solid var(--vinco)}
.mod{background:var(--papel-2);padding:10px 12px}
.mod__n{font-family:var(--display);font-size:14px;font-weight:600;display:flex;justify-content:space-between;gap:8px}
.mod__n span{font-family:var(--dado);font-size:11px;color:var(--tenue);font-weight:400}
.mod__b{height:4px;background:var(--vinco);margin:7px 0 5px;display:flex}
.mod__b i{display:block;height:100%}
.mod__b i.ok{background:var(--ok-p)} .mod__b i.dif{background:var(--dif)} .mod__b i.err{background:var(--falha-p)}
.mod__l{font-family:var(--dado);font-size:10.5px;color:var(--tenue)}

.dif-l{font-family:var(--dado);font-size:11.5px;line-height:1.7}
.dif-l .de{color:var(--org-p)} .dif-l .para{color:var(--dst-p)}

/* seleção por módulo */
.selmod{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.chipm{font:inherit;font-size:12px;padding:5px 11px;border:1px solid var(--vinco);background:var(--papel-2);
  cursor:pointer;color:var(--grafite);display:inline-flex;gap:7px;align-items:baseline}
.chipm span{font-family:var(--dado);font-size:10.5px;color:var(--tenue)}
.chipm[data-sel="parcial"]{border-color:var(--dif-p);color:var(--dif-p)}
.chipm[data-sel="parcial"] span{color:var(--dif-p)}
.chipm[data-sel="todos"]{background:var(--tinta);border-color:var(--tinta);color:#fff}
.chipm[data-sel="todos"] span{color:#B9C6D1}

/* amostragem */
.amostra{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.amostra label{font-family:var(--display);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--claro-2);margin:0}
.amostra select{font:inherit;font-family:var(--dado);font-size:12px;padding:6px 9px;
  border:1px solid var(--noite-3);background:var(--noite-2);color:var(--claro)}
.estimativa{font-family:var(--dado);font-size:12px;color:var(--claro-2)}
.estimativa b{color:var(--dif)}

.rodape{position:sticky;bottom:0;background:var(--noite);color:var(--claro);border-top:1px solid var(--noite-3)}
.rodape__i{display:flex;align-items:center;gap:16px;padding:12px 0;flex-wrap:wrap}
.acao{font:inherit;font-family:var(--display);font-size:12.5px;letter-spacing:.1em;text-transform:uppercase;
  font-weight:600;padding:9px 20px;border:1.5px solid var(--claro);background:var(--claro);color:var(--noite);cursor:pointer}
.acao:disabled{background:transparent;color:#5E7183;border-color:var(--noite-3);cursor:not-allowed}
.contagem{font-family:var(--dado);font-size:12px;color:var(--claro-2)}

@media (max-width:820px){ .env{padding:0 15px} .sec__c{flex-direction:column;align-items:flex-start;gap:2px} }
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
@media print{
  body{background:#fff;font-size:10pt}
  .cmd,.rodape{background:#fff;color:var(--tinta);border-bottom:2px solid var(--tinta)}
  .tese em{color:var(--tinta)} .alvo__u,.carimbo,.tese__ap,.traco__l{color:var(--grafite)}
  .traco{background:#fff;border-color:var(--vinco)} .traco__m>div{border-color:var(--vinco)}
  .ind,.ind__c{background:#fff;border-color:var(--vinco)} .ind__r{color:var(--grafite)}
  .barra-f,.chk,.rodape{display:none} .rolagem{max-height:none;overflow:visible}
  thead th{position:static}
}
`;

// -------------------------------------------------------------------- traço
const COR = { conforme: '#2A6B5C', lida: '#2A6B5C', divergente: '#F0A32E', 'sem-conteudo': '#F0A32E',
  'so-origem': '#8C8DF2', 'so-destino': '#4FB2E3', 'nao-avaliado': '#40505E', erro: '#FF6072' };

function svgTraco(itens, rotulo) {
  if (!itens.length) return '<svg viewBox="0 0 100 40" role="img" aria-label="sem dados"></svg>';
  const L = itens.length, W = Math.max(L, 90), BASE = 34;
  const guias = [0.33, 0.66, 1].map(f =>
    `<line x1="0" y1="${(BASE - 30 * f).toFixed(2)}" x2="${W}" y2="${(BASE - 30 * f).toFixed(2)}" stroke="#1C242D" stroke-width="0.22"/>`).join('');
  const barras = itens.map((it, i) => {
    const h = Math.max(1, (it.magnitude || 0) * 30);
    const x = (i * W) / L, w = Math.max(0.5, (W / L) * 0.66);
    return `<rect x="${x.toFixed(2)}" y="${(BASE - h).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}"
      fill="${COR[it.status] || '#40505E'}"><title>${esc(it.codigo || '')} ${esc(it.funcao || '')} — ${esc(ROTULO[it.status] || it.status)}</title></rect>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} 38" preserveAspectRatio="none" role="img" aria-label="${esc(rotulo)}">
    ${guias}${barras}<line x1="0" y1="${BASE}" x2="${W}" y2="${BASE}" stroke="#3A4956" stroke-width="0.3"/></svg>`;
}

function faixaModulos(itens) {
  const o = [];
  itens.forEach(i => { if (!o.length || o[o.length - 1].nome !== i.modulo) o.push({ nome: i.modulo, n: 0 }); o[o.length - 1].n++; });
  return '<div class="traco__m">' + o.map(x =>
    `<div style="flex-grow:${x.n}" title="${esc(x.nome)} — ${x.n} telas">${esc(x.nome)}</div>`).join('') + '</div>';
}

const ind = (n, r, marca) => `<div class="ind__c${marca ? ' ind__c--' + marca : ''}">
  <div class="ind__n">${n}</div><div class="ind__r">${esc(r)}</div></div>`;

const buscaJS = `
 const linhas = () => [...document.querySelectorAll('tbody tr[data-busca]')];
 let filtro = 'todos', termo = '';
 function aplica(){
   let n = 0;
   linhas().forEach(tr => {
     const okF = filtro === 'todos' || tr.dataset.status === filtro;
     const okT = !termo || tr.dataset.busca.includes(termo);
     tr.hidden = !(okF && okT);
     if (!tr.hidden) n++;
   });
   const c = document.getElementById('visiveis');
   if (c) c.textContent = n + (n === 1 ? ' tela' : ' telas');
 }
 document.querySelectorAll('.filtro[data-f]').forEach(b => b.addEventListener('click', () => {
   document.querySelectorAll('.filtro[data-f]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
   filtro = b.dataset.f; aplica();
 }));
 const cx = document.getElementById('busca');
 if (cx) cx.addEventListener('input', e => { termo = e.target.value.toLowerCase().trim(); aplica(); });
`;

// ------------------------------------------------------- modo: comparação
function htmlComparacao(cmp) {
  const r = cmp.resumo, itens = cmp.telas;
  const qa = cmp.origem.qualidade, qb = cmp.destino.qualidade;
  const divergem = r.divergente + r.soOrigem + r.soDestino;
  const conf = Math.max(qa.taxaFalha, qb.taxaFalha);

  const linhas = itens.map(t => `
    <tr data-status="${t.status}" data-busca="${esc((t.modulo + ' ' + t.codigo + ' ' + t.funcao).toLowerCase())}">
      <td class="mod">${esc(t.modulo)}</td>
      <td class="cod">${esc(t.codigo || '—')}</td>
      <td>${esc(t.funcao)}</td>
      <td class="num">${t.qtdOrigem == null ? '—' : t.qtdOrigem}${t.paginadoOrigem ? '<span class="mais" title="há mais registros além da primeira página">+</span>' : ''}</td>
      <td class="mid">→</td>
      <td class="num">${t.qtdDestino == null ? '—' : t.qtdDestino}${t.paginadoDestino ? '<span class="mais" title="há mais registros além da primeira página">+</span>' : ''}</td>
      <td><span class="sit sit--${t.status}">${ROTULO[t.status]}</span></td>
    </tr>`).join('');

  const prof = (cmp.profundo || []).filter(p => p.total);
  const secProf = prof.length ? prof.map(p => `
    <div class="quadro" style="margin-bottom:10px"><table>
      <thead><tr><th colspan="3">${esc(p.modulo)} · ${esc(p.codigo)} — ${p.divergentes} de ${p.total} registros divergem</th></tr>
      <tr><th>Registro</th><th>Situação</th><th>O que mudou</th></tr></thead><tbody>
      ${p.registros.filter(x => x.status !== 'conforme').slice(0, 200).map(x => `
        <tr><td>${esc(x.nome)}</td><td><span class="sit sit--${x.status}">${ROTULO[x.status]}</span></td>
        <td class="dif-l">${(x.diferencas || []).slice(0, 12).map(d =>
          `<div>${esc(d.rotulo)}: <span class="de">${esc(d.origem == null ? '—' : d.origem)}</span> → <span class="para">${esc(d.destino == null ? '—' : d.destino)}</span></div>`).join('') || '—'}</td></tr>`).join('')}
      </tbody></table></div>`).join('')
    : `<div class="vazio">Nenhuma tela foi aprofundada nos dois ambientes.
       Marque as telas no painel de mapeamento e rode <code>node se.js deep</code> em cada ambiente.</div>`;

  const compDif = cmp.componentes.filter(c => c.status !== 'conforme');

  return `
  <header class="cmd"><div class="env">
    <div class="cmd__id">
      <span class="marca">SE Mapper<span>comparação de ambientes</span></span>
      <span class="carimbo">gerada em ${esc(dataHora(cmp.geradoEm))}</span>
    </div>
    <div class="alvos">
      <div class="alvo alvo--org"><div class="alvo__p">Origem</div>
        <div class="alvo__n">${esc(cmp.origem.nome)}</div><div class="alvo__u">${esc(cmp.origem.url)}</div></div>
      <div class="alvo alvo--dst"><div class="alvo__p">Destino</div>
        <div class="alvo__n">${esc(cmp.destino.nome)}</div><div class="alvo__u">${esc(cmp.destino.url)}</div></div>
    </div>

    <h1 class="tese">${divergem
      ? `<em>${divergem} de ${r.telas} telas</em> não conferem entre os ambientes.`
      : `As <em class="ok">${r.telas} telas</em> conferem entre os ambientes.`}</h1>
    <p class="tese__ap">${r.divergente} com contagens diferentes · ${r.soOrigem} só na origem ·
      ${r.soDestino} só no destino${r.naoAvaliado ? ` · ${r.naoAvaliado} não avaliadas de pelo menos um lado` : ''}${
      conf > 0 ? ` — taxa de falha de coleta de ${conf}% no ambiente mais problemático.` : '.'}</p>

    <div class="traco">
      <div class="traco__c"><span class="traco__t">Traço de divergência</span>
        <span class="traco__l">cada tique é uma tela · altura = tamanho da diferença · reta = alinhado</span></div>
      ${svgTraco(itens, 'Divergência por tela entre os ambientes')}
      ${faixaModulos(itens)}
    </div>

    <div class="ind">
      ${ind(r.telas, 'telas comparadas')}
      ${ind(r.conforme, 'conferem', 'ok')}
      ${ind(r.divergente, 'contagem difere', 'dif')}
      ${ind(r.soOrigem, 'só na origem', 'org')}
      ${ind(r.soDestino, 'só no destino', 'dst')}
      ${ind(conf + '%', 'falha da coleta', 'falha')}
    </div>
  </div></header>

  <main class="env corpo">
    ${compDif.length ? `<section class="sec">
      <div class="sec__c"><h2 class="sec__t">Componentes</h2>
        <span class="sec__n">${compDif.length} de ${cmp.componentes.length} não conferem</span></div>
      <div class="quadro"><table><tbody>
      ${compDif.map(c => `<tr><td>${esc(c.nome)}</td><td><span class="sit sit--${c.status}">${ROTULO[c.status]}</span></td></tr>`).join('')}
      </tbody></table></div></section>` : ''}

    <section class="sec">
      <div class="sec__c"><h2 class="sec__t">Telas de configuração</h2>
        <span class="sec__n" id="visiveis">${itens.length} telas</span></div>
      <div class="barra-f">
        <input class="busca" id="busca" type="search" placeholder="Buscar por módulo, código ou nome da tela" aria-label="Buscar telas">
        <button class="filtro" aria-pressed="true" data-f="todos">Todas</button>
        <button class="filtro" aria-pressed="false" data-f="divergente">Contagem difere</button>
        <button class="filtro" aria-pressed="false" data-f="so-origem">Só na origem</button>
        <button class="filtro" aria-pressed="false" data-f="so-destino">Só no destino</button>
        <button class="filtro" aria-pressed="false" data-f="nao-avaliado">Não avaliadas</button>
      </div>
      <div class="quadro"><div class="rolagem"><table>
        <thead><tr><th>Módulo</th><th class="cod">Código</th><th>Tela</th>
          <th class="num">${esc(cmp.origem.nome)}</th><th></th><th class="num">${esc(cmp.destino.nome)}</th>
          <th>Situação</th></tr></thead>
        <tbody>${linhas}</tbody></table></div></div>
    </section>

    <section class="sec">
      <div class="sec__c"><h2 class="sec__t">Registros e parâmetros</h2>
        <span class="sec__n">telas verificadas em profundidade</span></div>
      ${secProf}
    </section>

    <section class="sec">
      <div class="sec__c"><h2 class="sec__t">Confiabilidade da coleta</h2>
        <span class="sec__n">uma varredura que falha muito não sustenta conclusão</span></div>
      <div class="mods">
      ${[[cmp.origem, qa], [cmp.destino, qb]].map(([a, q]) => `
        <div class="mod"><div class="mod__n">${esc(a.nome)}<span>${q.taxaFalha}% falha</span></div>
          <div class="mod__b">
            <i class="ok" style="width:${q.pctLidas}%"></i>
            <i class="dif" style="width:${q.pctSemConteudo}%"></i>
            <i class="err" style="width:${q.pctExcecao}%"></i></div>
          <div class="mod__l">${q.lidas} lidas · ${q.semConteudo} sem leitura · ${q.comExcecao} exceções</div>
        </div>`).join('')}
      </div>
    </section>
  </main>

  <script>${buscaJS}</script>`;
}

// ---------------------------------------------------- modo: ambiente único
function htmlAmbiente(amb, mapa, contagem, q, selecao) {
  const telas = Object.values(contagem.telas || {});
  const previstas = mapa ? mapa.componentes.reduce((a, c) => a + c.menuConfiguracao.length, 0) : telas.length;
  const pct = previstas ? Math.round(telas.length * 100 / previstas) : 0;
  const totalReg = telas.reduce((a, t) => a + (t.qtd || 0), 0);
  const marcados = new Set((selecao.telas || []).map(t => t.cod));
  const sit = t => t.erro ? 'erro' : ((!t.tipo || t.tipo === 'outro') ? 'sem-conteudo' : 'lida');

  const linhas = telas.map(t => {
    const s = sit(t), m = marcados.has(t.codigo);
    return `<tr data-status="${s}" data-qtd="${t.qtd || 0}" data-busca="${esc((t.modulo + ' ' + t.codigo + ' ' + t.funcao).toLowerCase())}" class="${m ? 'marcada' : ''}">
      <td class="chk"><input type="checkbox" class="sel" data-cod="${esc(t.codigo)}" data-mod="${esc(t.modulo)}" ${m ? 'checked' : ''} aria-label="Aprofundar ${esc(t.codigo)}"></td>
      <td class="mod">${esc(t.modulo)}</td>
      <td class="cod">${esc(t.codigo || '—')}</td>
      <td>${esc(t.funcao)}</td>
      <td class="cod">${esc(t.tipo === 'arvore' ? 'árvore' : (t.tipo === 'grade' ? 'grade' : '—'))}</td>
      <td class="num">${t.qtd || 0}${t.paginado ? '<span class="mais" title="há mais registros além da primeira página">+</span>' : ''}</td>
      <td>${s === 'lida' ? '' : `<span class="sit sit--${s}">${ROTULO[s]}</span>`}</td>
    </tr>`;
  }).join('');

  const porMod = {};
  telas.forEach(t => (porMod[t.modulo] = porMod[t.modulo] || []).push(t));
  const cartoes = Object.entries(porMod).map(([mod, ts]) => {
    const lidas = ts.filter(t => sit(t) === 'lida').length;
    const sc = ts.filter(t => sit(t) === 'sem-conteudo').length;
    const ex = ts.filter(t => sit(t) === 'erro').length;
    const p = n => (ts.length ? n * 100 / ts.length : 0);
    return `<div class="mod">
      <div class="mod__n">${esc(mod)}<span>${ts.length} telas</span></div>
      <div class="mod__b"><i class="ok" style="width:${p(lidas)}%"></i><i class="dif" style="width:${p(sc)}%"></i><i class="err" style="width:${p(ex)}%"></i></div>
      <div class="mod__l">${lidas} lidas${sc ? ' · ' + sc + ' sem leitura' : ''}${ex ? ' · ' + ex + ' exceções' : ''} · ${ts.reduce((a, t) => a + (t.qtd || 0), 0)} registros</div>
    </div>`;
  }).join('');

  const traco = telas.map(t => {
    const s = sit(t);
    return { modulo: t.modulo, codigo: t.codigo, funcao: t.funcao, status: s,
      magnitude: s === 'erro' ? 1 : (s === 'sem-conteudo' ? 0.55 : 0.06) };
  });

  return `
  <header class="cmd"><div class="env">
    <div class="cmd__id">
      <span class="marca">SE Mapper<span>mapeamento de ambiente</span></span>
      <span class="carimbo">${esc(dataHora(mapa && mapa.capturadoEm))}</span>
    </div>
    <div class="alvos">
      <div class="alvo alvo--${amb.papel === 'origem' ? 'org' : 'dst'}">
        <div class="alvo__p">${esc(amb.papel)}</div>
        <div class="alvo__n">${esc(amb.nome)}</div>
        <div class="alvo__u">${esc(amb.url)}</div></div>
    </div>

    <h1 class="tese">${q.total === 0
      ? 'Nenhuma tela varrida ainda.'
      : (q.semConteudo || q.comExcecao
        ? `<em>${q.semConteudo + q.comExcecao} de ${q.total} telas</em> não renderam leitura.`
        : `As <em class="ok">${q.total} telas</em> foram lidas.`)}</h1>
    <p class="tese__ap">${q.total === 0
      ? 'Rode <code>node se.js map</code> para começar a coleta deste ambiente.'
      : `${q.lidas} lidas com conteúdo · ${q.semConteudo} abriram sem nada legível · ${q.comExcecao} falharam com exceção` +
        (previstas > telas.length ? ` — coleta em andamento, ${telas.length} de ${previstas} telas (${pct}%).` : '.')}</p>

    <div class="traco">
      <div class="traco__c"><span class="traco__t">Traço da coleta</span>
        <span class="traco__l">cada tique é uma tela · pico = tela que não rendeu conteúdo ou falhou</span></div>
      ${svgTraco(traco, 'Qualidade da leitura por tela')}
      ${faixaModulos(traco)}
    </div>

    <div class="ind">
      ${ind(mapa ? mapa.componentes.length : '—', 'componentes')}
      ${ind(telas.length + '<small>/' + previstas + '</small>', 'telas varridas')}
      ${ind(totalReg, 'registros contados', 'ok')}
      ${ind(q.semConteudo, 'sem leitura', 'dif')}
      ${ind(q.comExcecao, 'exceções', 'falha')}
      ${ind(q.taxaFalha + '%', 'taxa de falha', 'falha')}
    </div>
  </div></header>

  <main class="env corpo">
    <section class="sec">
      <div class="sec__c"><h2 class="sec__t">Telas de configuração</h2>
        <span class="sec__n" id="visiveis">${telas.length} telas</span></div>
      <p class="nota" style="margin:0 0 11px">Marque o que deve ser aberto registro a registro. A seleção vale para
      todos os ambientes — as mesmas telas serão abertas na origem e no destino.</p>
      <div class="selmod" id="selmod">${Object.keys(porMod).map(m =>
        `<button class="chipm" data-mod="${esc(m)}" data-sel="nenhum" title="Marcar ou desmarcar todas as telas de ${esc(m)}">
          ${esc(m)} <span>0/${porMod[m].length}</span></button>`).join('')}</div>
      <div class="barra-f">
        <input class="busca" id="busca" type="search" placeholder="Buscar por módulo, código ou nome da tela" aria-label="Buscar telas">
        <button class="filtro" aria-pressed="true" data-f="todos">Todas</button>
        <button class="filtro" aria-pressed="false" data-f="lida">Lidas</button>
        <button class="filtro" aria-pressed="false" data-f="sem-conteudo">Sem leitura</button>
        <button class="filtro" aria-pressed="false" data-f="erro">Exceções</button>
        <button class="filtro" id="marcarVis">Marcar visíveis</button>
        <button class="filtro" id="limpar">Limpar seleção</button>
      </div>
      <div class="quadro"><div class="rolagem"><table>
        <thead><tr><th class="chk"></th><th>Módulo</th><th class="cod">Código</th><th>Tela</th>
          <th>Tipo</th><th class="num">Registros</th><th>Situação</th></tr></thead>
        <tbody>${linhas}</tbody></table></div></div>
    </section>

    <section class="sec">
      <div class="sec__c"><h2 class="sec__t">Qualidade por módulo</h2>
        <span class="sec__n">verde lida · âmbar sem leitura · vermelho exceção</span></div>
      <div class="mods">${cartoes}</div>
    </section>
  </main>

  <div class="rodape"><div class="env rodape__i">
    <button class="acao" id="baixar" disabled>Baixar seleção</button>
    <span class="contagem" id="cnt">nenhuma tela marcada</span>
    <span class="amostra">
      <label for="amostra">Amostragem</label>
      <select id="amostra" aria-label="Registros a abrir por tela">
        <option value="0">todos os registros</option>
        <option value="3">3 por tela</option>
        <option value="5" selected>5 por tela</option>
        <option value="10">10 por tela</option>
        <option value="25">25 por tela</option>
        <option value="50">50 por tela</option>
      </select>
    </span>
    <span class="estimativa" id="estimativa"></span>
  </div></div>

  <script>
   ${buscaJS}
   const sels = () => [...document.querySelectorAll('.sel:checked')].map(c => ({cod:c.dataset.cod, modulo:c.dataset.mod}));
   const amostra = () => Number(document.getElementById('amostra').value) || 0;
   const SEG_POR_REGISTRO = 20;   // medido: abrir, ler e voltar à listagem

   function atualiza(){
     const marcadas = [...document.querySelectorAll('.sel:checked')];
     const n = marcadas.length;
     document.getElementById('cnt').textContent = n ? n + (n === 1 ? ' tela marcada' : ' telas marcadas') : 'nenhuma tela marcada';
     document.getElementById('baixar').disabled = !n;
     document.querySelectorAll('.sel').forEach(c => c.closest('tr').classList.toggle('marcada', c.checked));

     // chips de módulo: nenhum / parcial / todos
     document.querySelectorAll('.chipm').forEach(ch => {
       const doMod = [...document.querySelectorAll('.sel[data-mod="' + CSS.escape(ch.dataset.mod) + '"]')];
       const mk = doMod.filter(c => c.checked).length;
       ch.querySelector('span').textContent = mk + '/' + doMod.length;
       ch.dataset.sel = mk === 0 ? 'nenhum' : (mk === doMod.length ? 'todos' : 'parcial');
     });

     // estimativa de registros e tempo
     const lim = amostra();
     let regs = 0;
     marcadas.forEach(c => {
       const q = Number(c.closest('tr').dataset.qtd) || 0;
       regs += lim ? Math.min(q, lim) : q;
     });
     const min = Math.round(regs * SEG_POR_REGISTRO / 60);
     const tempo = min < 60 ? min + ' min' : Math.floor(min / 60) + 'h' + String(min % 60).padStart(2, '0');
     document.getElementById('estimativa').innerHTML = n
       ? '<b>' + regs + '</b> registros a abrir · ~' + tempo
       : '';
   }
   document.addEventListener('change', e => {
     if (e.target.classList.contains('sel') || e.target.id === 'amostra') atualiza();
   });
   document.querySelectorAll('.chipm').forEach(ch => ch.addEventListener('click', () => {
     const alvo = ch.dataset.sel !== 'todos';
     document.querySelectorAll('.sel[data-mod="' + CSS.escape(ch.dataset.mod) + '"]')
       .forEach(c => c.checked = alvo);
     atualiza();
   }));
   document.getElementById('marcarVis').addEventListener('click', () => {
     linhas().filter(tr => !tr.hidden).forEach(tr => { const c = tr.querySelector('.sel'); if (c) c.checked = true; });
     atualiza();
   });
   document.getElementById('limpar').addEventListener('click', () => {
     document.querySelectorAll('.sel').forEach(c => c.checked = false); atualiza();
   });
   const servido = location.protocol.startsWith('http');
   const bt = document.getElementById('baixar');
   if (servido) bt.textContent = 'Salvar seleção';
   bt.addEventListener('click', async () => {
     const telas = sels();
     const lim = amostra();
     const criterio = { modo: lim ? 'amostra' : 'todos', limite: lim,
       descricao: lim ? 'primeiros ' + lim + ' registros de cada tela' : 'todos os registros de cada tela' };
     if (servido) {
       // aberto pelo painel de controle: grava direto, sem passar por download
       try {
         const r = await fetch('/api/selecao', {method:'POST', headers:{'Content-Type':'application/json'},
           body: JSON.stringify({telas, amostragem: criterio})});
         const j = await r.json();
         bt.textContent = j.ok ? 'Seleção salva (' + j.n + ')' : 'Falhou — tente baixar';
         setTimeout(() => bt.textContent = 'Salvar seleção', 2500);
         return;
       } catch (e) { /* cai para o download abaixo */ }
     }
     const blob = new Blob([JSON.stringify({geradoEm:new Date().toISOString(), amostragem:criterio, telas}, null, 2)], {type:'application/json'});
     const a = document.createElement('a');
     a.href = URL.createObjectURL(blob); a.download = 'selecao.json'; a.click();
     URL.revokeObjectURL(a.href);
   });
   atualiza();
  </script>`;
}

// ------------------------------------------------------------------ executar
function executar(opts = {}) {
  const cmpPath = path.join(DADOS, 'comparacao.json');
  const modoComp = opts.comparar || (!opts.ambiente && fs.existsSync(cmpPath));

  let miolo, titulo;
  if (modoComp && fs.existsSync(cmpPath)) {
    const cmp = JSON.parse(fs.readFileSync(cmpPath, 'utf8'));
    miolo = htmlComparacao(cmp);
    titulo = 'SE Mapper — ' + cmp.origem.nome + ' × ' + cmp.destino.nome;
  } else {
    const amb = ambienteAtual();
    if (!amb) { console.error('Nenhum ambiente ativo. Rode "node se.js env add --nome <nome> --url <url>".'); process.exit(1); }
    miolo = htmlAmbiente(amb, leJson('mapa.json', null), leJson('contagem.json', { telas: {} }), qualidade(), leSelecao());
    titulo = 'SE Mapper — ' + amb.nome;
  }

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${opts.acompanhar ? '<meta http-equiv="refresh" content="15">' : ''}
<title>${esc(titulo)}</title><style>${CSS}</style></head><body>${miolo}</body></html>`;

  const saida = path.join(DADOS, 'painel.html');
  fs.writeFileSync(saida, html, 'utf8');
  console.log('Painel: ' + saida);
  if (opts.acompanhar) console.log('Acompanhamento ativo: a página se atualiza a cada 15s.');
  return saida;
}

module.exports = { executar, CSS, svgTraco, faixaModulos, esc, dataHora };
