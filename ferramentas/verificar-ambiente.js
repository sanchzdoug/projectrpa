'use strict';
/**
 * Verifica se a maquina tem tudo que o SE-Mapper precisa.
 *
 * Existe porque as falhas de dependencia aparecem tarde e disfarcadas: sem
 * python-docx o relatorio Word simplesmente nao sai, sem o Chromium a coleta
 * morre no meio. Melhor descobrir aqui do que no meio de uma varredura.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const linhas = [];
const ok = (n, d) => linhas.push({ n, estado: 'ok', d });
const falta = (n, d) => linhas.push({ n, estado: 'FALTA', d });

// Node
const v = process.versions.node.split('.').map(Number);
(v[0] >= 18 ? ok : falta)('Node.js', process.version + (v[0] >= 18 ? '' : ' — precisa de 18 ou superior'));

// Playwright + Chromium
try {
  const pw = require(path.join(__dirname, '..', 'lib', 'core')).carregaPlaywright();
  ok('Playwright', 'carregado');
  try {
    const exe = pw.chromium.executablePath();
    (fs.existsSync(exe) ? ok : falta)('Chromium', exe);
  } catch (e) { falta('Chromium', 'rode: npx playwright install chromium'); }
} catch (e) { falta('Playwright', 'rode: npm install'); }

// Python com python-docx (necessario para o relatorio Word)
const cands = [process.env.SE_PYTHON,
  path.join(process.env.LOCALAPPDATA || '', 'Programs/Python/Python313/python.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs/Python/Python312/python.exe'),
  'python3', 'python'].filter(Boolean);
let py = null;
for (const c of cands) {
  const r = spawnSync(c, ['-c', 'import docx'], { encoding: 'utf8' });
  if (r.status === 0) { py = c; break; }
}
(py ? ok : falta)('Python + python-docx',
  py || 'instale o Python e rode: pip install python-docx  (ou defina SE_PYTHON)');

// Chromium de trabalho na porta 9222 (a sessao autenticada)
const http = require('http');
const req = http.get('http://localhost:9222/json/version', { timeout: 1500 }, res => {
  let b = ''; res.on('data', d => b += d);
  res.on('end', () => { imprime('Sessao CDP (porta 9222)', 'ativa'); });
});
req.on('error', () => imprime('Sessao CDP (porta 9222)',
  'inativa — normal antes do login. Rode: node se.js login'));
req.on('timeout', () => { req.destroy(); imprime('Sessao CDP (porta 9222)', 'sem resposta'); });

function imprime(nomeCdp, estadoCdp) {
  console.log('\nVerificacao do ambiente — SE-Mapper\n');
  for (const l of linhas) {
    console.log('  ' + (l.estado === 'ok' ? '[ok]   ' : '[FALTA]') + ' ' + l.n.padEnd(22) + l.d);
  }
  console.log('  [info]  ' + nomeCdp.padEnd(22) + estadoCdp);
  const faltando = linhas.filter(l => l.estado !== 'ok').length;
  console.log('\n' + (faltando ? faltando + ' item(ns) pendente(s) — resolva antes de coletar.'
                               : 'Tudo pronto.') + '\n');
  process.exit(faltando ? 1 : 0);
}
