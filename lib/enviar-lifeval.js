'use strict';
/**
 * Exporta e envia a configuração levantada direto para a API do LifeVal.
 *
 * Existe separado do `exportar-lifeval` por uma razão de arquitetura: o
 * levantamento de um ambiente passa de 5 MB, e fazer esse volume atravessar o
 * n8n (ler arquivo → item → HTTP Request) é caro e frágil. O dado pesado anda
 * na máquina; o n8n só orquestra e lê o resumo desta saída.
 *
 * Autenticação: obtém o token no Keycloak com as credenciais passadas por
 * ambiente. Senha nunca vem por linha de comando — argumento de processo é
 * visível na lista de processos da máquina.
 *
 * Uso:
 *   set LIFEVAL_USER=manager
 *   set LIFEVAL_PASS=...
 *   node se.js enviar-lifeval --ambiente desenvolvimento --environment-id <uuid>
 */
const path = require('path');
const fs = require('fs');
const { ambienteAtual } = require('./core');
const exportar = require('./exportar-lifeval');

const PADRAO = {
  api: 'http://localhost:3001/api/v1',
  keycloak: 'http://localhost:8080',
  realm: 'lifeval',
  clientId: 'lifeval-web',
  clientSecret: 'lifeval-web-secret',
};

async function token(o) {
  const usuario = process.env.LIFEVAL_USER || o.usuario;
  const senha = process.env.LIFEVAL_PASS;
  if (!usuario || !senha) {
    throw new Error(
      'Defina LIFEVAL_USER e LIFEVAL_PASS no ambiente. ' +
      'A senha não é aceita por argumento — ficaria visível na lista de processos.');
  }
  const url = `${o.keycloak || PADRAO.keycloak}/realms/${o.realm || PADRAO.realm}` +
    '/protocol/openid-connect/token';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: o.clientId || PADRAO.clientId,
      client_secret: o.clientSecret || PADRAO.clientSecret,
      username: usuario,
      password: senha,
      scope: 'openid',
    }),
  });
  if (!res.ok) throw new Error(`Keycloak ${res.status} ao autenticar "${usuario}"`);
  return (await res.json()).access_token;
}

async function executar(o) {
  const slug = o.ambiente || o.amb || (ambienteAtual() || {}).slug;
  const environmentId = o['environment-id'] || o.environmentId;
  if (!slug) throw new Error('Informe --ambiente <slug>.');
  if (!environmentId) {
    throw new Error('Informe --environment-id <uuid> (o ambiente-alvo cadastrado no LifeVal).');
  }

  // Reaproveita o exportador: uma única definição do payload e das quatro situações.
  // `silencioso` mantém o stdout limpo — é dele que o nó do n8n lê o resultado.
  const tmp = path.join(require('os').tmpdir(), `lifeval-import-${slug}-${Date.now()}.json`);
  let payload;
  let resposta;
  try {
    payload = exportar.executar({ ...o, ambiente: slug, saida: tmp, silencioso: true });
    const api = o.api || PADRAO.api;
    const t = await token(o);

    const res = await fetch(`${api}/target-environments/${environmentId}/configuration-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify(payload),
    });

    let corpo = null;
    try { corpo = await res.json(); } catch { /* resposta sem json */ }
    if (!res.ok) {
      throw new Error(`LifeVal ${res.status}: ${(corpo && corpo.error) || res.statusText}`);
    }
    resposta = corpo;
  } finally {
    // O temporário carrega configuração GxP de cliente — nunca fica para trás.
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
  const corpo = resposta;

  // Saída em JSON numa linha: é o que o nó do n8n lê do stdout.
  console.log(JSON.stringify({
    ok: true,
    ambiente: slug,
    environmentId,
    snapshotId: corpo.snapshotId,
    cobertura: corpo.cobertura,
    descartados: {
      script: payload.cobertura.descartadosScript,
      colapsados: payload.cobertura.colapsadosEmLista,
    },
  }));
}

module.exports = {
  executar: (o) => executar(o).catch((e) => {
    console.error(JSON.stringify({ ok: false, erro: e.message }));
    process.exit(1);
  }),
};
