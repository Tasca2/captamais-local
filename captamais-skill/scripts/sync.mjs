/**
 * Sincronização do CRM local com a conta CaptaMais (nuvem). Só leads (contato + funil/etapa).
 *
 * Fase 1: só ENVIA ('up'). O que existe/mudou aqui sobe; nada é gravado no computador vindo da nuvem.
 * O modo 'both' (enviar e baixar) existe no código mas está DESLIGADO (SYNC_DOWN_ENABLED).
 *
 * Regras (seguras por padrão):
 *   - Nunca duplica: a nuvem casa por e-mail/telefone ao receber um lead sem vínculo.
 *   - Alterado só aqui → sobe. Alterado dos dois lados → o mais recente vence (a nuvem mais nova não é sobrescrita).
 *   - Exclusões NÃO são propagadas (apagar num lado nunca apaga no outro).
 *   - Só a "cloud" injetada fala com a rede; a chave nunca passa por aqui.
 */
import * as db from './db.mjs';

const BATCH = 200;
const digits = (v) => String(v ?? '').replace(/\D/g, '');
const norm = (v) => String(v ?? '').trim();
const emailKey = (v) => norm(v).toLowerCase();
const phoneKey = (v) => { const d = digits(v); return d.length >= 10 ? d.slice(-10) : ''; };
const ts = (v) => { const t = Date.parse(String(v || '')); return Number.isNaN(t) ? 0 : t; };

/** Mesmo conteúdo dos dois lados? (evita gravar à toa e fecha conflitos triviais) */
function sameContent(l, c) {
  const eq = (a, b) => norm(a) === norm(b);
  return eq(l.name, c.name) && eq(l.email, c.email) && eq(l.phone, c.phone) && eq(l.city, c.city)
    && eq(l.description, c.description) && eq(l.subtitle, c.subtitle) && eq(l.stage, c.stage)
    && String(l.entity_type || 'PF').toUpperCase() === String(c.entityType || 'PF').toUpperCase();
}

function toPushItem(l) {
  return {
    localId: l.id, cloudId: l.cloud_id || undefined, name: l.name, email: l.email || '', phone: l.phone || '',
    city: l.city || '', description: l.description || '', subtitle: l.subtitle || '',
    entityType: l.entity_type || 'PF', stage: l.stage, layoutName: l.layout_name || '',
  };
}

/** Envia leads em lotes e grava o vínculo do que a nuvem aceitou. Devolve contagens. */
async function pushLeads(cloud, leads, stats, allowRetry = true) {
  const layouts = db.layoutsForSync();
  const byId = new Map(leads.map((l) => [l.id, l]));
  const retry = [];
  for (let i = 0; i < leads.length; i += BATCH) {
    const d = await cloud('/api/mcp/sync/push', { layouts, leads: leads.slice(i, i + BATCH).map(toPushItem) });
    if (!d.ok) throw new Error(d.message || 'A nuvem não aceitou o envio.');
    for (const r of d.results || []) {
      const local = byId.get(r.localId);
      // A nuvem só "vincula" (não grava) quando o lead já existe lá. Se a cópia daqui é mais nova,
      // guarda o id e reenvia uma vez — aí a nuvem atualiza, em vez de fingir que já estava em dia.
      if (allowRetry && r.status === 'linked' && local && r.cloudId && ts(local.updated_at || local.created_at) > ts(r.updatedAt)) {
        db.linkLeadPending(r.localId, r.cloudId);
        retry.push({ ...local, cloud_id: r.cloudId });
        continue;
      }
      if (r.status === 'created' || r.status === 'updated' || r.status === 'linked') {
        db.markLeadSynced(r.localId, r.cloudId, r.updatedAt);
        stats.up[r.status] += 1;
      } else if (r.status === 'limit') stats.up.limit += 1;
      else stats.up.invalid += 1;
      byId.delete(r.localId);
    }
  }
  if (retry.length) await pushLeads(cloud, retry, stats, false);
}

// FASE 1 (decisão LGPD/RGPD): a sincronização SÓ SOBE. Nada de dado pessoal da plataforma desce para o
// computador. Nesta fase a nuvem também só entrega metadados (id + data de alteração).
// O caminho de descida abaixo fica DESLIGADO por esta constante, pronto para uma fase futura já revisada.
const SYNC_DOWN_ENABLED = false;

/**
 * Sincroniza. `cloud(path, body)` é a função autenticada do servidor local.
 * mode: 'up' (única liberada hoje). Lança Error com mensagem amigável se a nuvem falhar antes de gravar algo.
 */
export async function runSync(cloud, mode = 'up') {
  if (mode !== 'up' && !(mode === 'both' && SYNC_DOWN_ENABLED)) throw new Error('Por enquanto a sincronização só envia seus leads para a nuvem.');
  const stats = { mode, up: { created: 0, updated: 0, linked: 0, limit: 0, invalid: 0 }, down: { created: 0, updated: 0 }, keptCloudNewer: 0, missingInCloud: 0, truncated: false };

  const pull = await cloud('/api/mcp/sync/pull', mode === 'both' ? { full: true } : {});
  if (!pull.ok) throw new Error(pull.message || 'Não foi possível consultar a nuvem.');
  stats.truncated = !!pull.truncated;
  const metaOnly = !!pull.metaOnly; // só {cloudId, updatedAt}: nenhum dado pessoal
  const cloudLeads = pull.leads || [];
  const cloudById = new Map(cloudLeads.map((c) => [c.cloudId, c]));

  let local = db.listLeadsForSync();

  // Passo 0 — (só com dados completos) vincula leads iguais que ainda não se conhecem. Em "só metadados" quem
  // evita duplicar é a própria nuvem, que casa por e-mail/telefone ao receber o envio.
  const linkedCloud = new Set(local.filter((l) => l.cloud_id).map((l) => l.cloud_id));
  if (!metaOnly) {
    const freeByEmail = new Map(), freeByPhone = new Map();
    for (const c of cloudLeads) {
      if (linkedCloud.has(c.cloudId)) continue;
      if (emailKey(c.email) && !freeByEmail.has(emailKey(c.email))) freeByEmail.set(emailKey(c.email), c);
      if (phoneKey(c.phone) && !freeByPhone.has(phoneKey(c.phone))) freeByPhone.set(phoneKey(c.phone), c);
    }
    for (const l of local) {
      if (l.cloud_id) continue;
      const c = (emailKey(l.email) && freeByEmail.get(emailKey(l.email))) || (phoneKey(l.phone) && freeByPhone.get(phoneKey(l.phone)));
      if (!c || linkedCloud.has(c.cloudId)) continue;
      linkedCloud.add(c.cloudId);
      db.linkLeadPending(l.id, c.cloudId);
    }
    local = db.listLeadsForSync();
  }

  // Funis da nuvem → funis daqui (só quando vamos baixar algo).
  const layoutMap = new Map();
  if (mode === 'both') for (const cl of pull.layouts || []) layoutMap.set(cl.id, db.ensureLayoutFromCloud(cl));

  // Passo 1 — decide, lead a lead.
  const toPush = [];
  for (const l of local) {
    if (!l.cloud_id) { toPush.push(l); continue; }
    const c = cloudById.get(l.cloud_id);
    if (!c) { stats.missingInCloud += 1; continue; } // sumiu da nuvem: não ressuscita nem apaga aqui
    const localDirty = db.isLeadDirty(l);
    const cloudDirty = String(c.updatedAt || '') !== String(l.cloud_seen_at || '');
    if (!metaOnly && sameContent(l, c)) { if (localDirty || cloudDirty) db.markLeadSynced(l.id, c.cloudId, c.updatedAt); continue; }
    const cloudNewer = cloudDirty && (!localDirty || ts(c.updatedAt) >= ts(l.updated_at || l.created_at));
    if (cloudNewer) {
      if (mode === 'both' && !metaOnly) {
        db.applyCloudLead(l.id, c, layoutMap.get(c.layoutId) || db.getDefaultLayoutId());
        stats.down.updated += 1;
      } else if (localDirty) stats.keptCloudNewer += 1; // mudou dos dois lados e a nuvem é mais nova: não sobrescreve
    } else if (localDirty) toPush.push(l);
  }

  // Passo 2 — leads que só existem na nuvem descem (só no modo "enviar e baixar", hoje desligado).
  if (mode === 'both' && !metaOnly) {
    for (const c of cloudLeads) {
      if (linkedCloud.has(c.cloudId)) continue;
      db.applyCloudLead(null, c, layoutMap.get(c.layoutId) || db.getDefaultLayoutId());
      stats.down.created += 1;
    }
  }

  // Passo 3 — envia o que é daqui.
  if (toPush.length) await pushLeads(cloud, toPush, stats);
  return stats;
}

/** Garante que UM lead exista na nuvem (para abrir ferramentas do site). Devolve o id lá. */
export async function ensureLeadInCloud(cloud, leadId) {
  const l = db.listLeadsForSync().find((x) => x.id === Number(leadId));
  if (!l) throw new Error('Lead não encontrado.');
  if (l.cloud_id) return l.cloud_id; // já existe lá: usa a cópia da nuvem, sem sobrescrevê-la
  const stats = { up: { created: 0, updated: 0, linked: 0, limit: 0, invalid: 0 } };
  await pushLeads(cloud, [l], stats);
  if (stats.up.limit) throw new Error('Seu plano não comporta mais leads na nuvem. Amplie o acesso na sua conta para enviar este lead.');
  const fresh = db.listLeadsForSync().find((x) => x.id === Number(leadId));
  if (!fresh?.cloud_id) throw new Error('Não foi possível enviar este lead para a nuvem.');
  return fresh.cloud_id;
}
