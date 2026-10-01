#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { createActivity, createLead, DEFAULT_STAGES, getLead, listLeads, moveStage, setActivityGoogleEvent } from './db.js';
import { createGoogleCalendarEvent, googleStatus, prepareMeeting } from './cloud.js';
import { buyLeads, creditsSpendingReport, enrichLeadFromPurchase, exportLeadList, redeemCreditsCode, importLeadList, leadCredits, leadLists, searchLeads } from './leads.js';
import { importLeadFile, readLeadFile } from './leadImport.js';

const config = loadConfig();

const server = new McpServer({ name: 'captamais', version: '1.0.2' });

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const jsonText = (obj: unknown) => text(JSON.stringify(obj, null, 2));

// ─────────────── Ferramentas LOCAIS (rodam na máquina do usuário, sem gastar tokens) ───────────────

server.tool(
  'captamais_list_leads',
  'Lista os leads do CRM local do usuário. Filtra por etapa (stage) e/ou busca por nome, email ou telefone. Não gasta tokens (é local).',
  {
    stage: z.string().optional().describe('Etapa do funil (ex.: NEW LEAD, MEETING, WON).'),
    search: z.string().optional().describe('Busca por nome, email ou telefone.'),
    limit: z.number().int().min(1).max(500).optional().describe('Máximo de leads (padrão 50).'),
  },
  async ({ stage, search, limit }) => {
    const leads = listLeads(config, { stage, search, limit });
    return jsonText({ count: leads.length, leads });
  },
);

server.tool(
  'captamais_create_lead',
  'Cria um novo lead no CRM local. Não gasta tokens (é local).',
  {
    name: z.string().min(1).describe('Nome do lead (obrigatório).'),
    email: z.string().optional(),
    phone: z.string().optional(),
    city: z.string().optional(),
    stage: z.string().optional().describe(`Etapa inicial (padrão NEW LEAD). Opções comuns: ${DEFAULT_STAGES.join(', ')}.`),
    description: z.string().optional(),
  },
  async (args) => {
    const lead = createLead(config, args);
    return jsonText({ created: true, lead });
  },
);

server.tool(
  'captamais_import_leads_file',
  'Lê uma planilha local indicada pelo usuário (.xlsx, .csv, .tsv ou .json), identifica nome, telefone, e-mail, cidade e detalhes e importa os leads no CRM local. Use previewOnly=true antes de gravar quando o mapeamento não estiver claro.',
  {
    filePath: z.string().min(1).describe('Caminho completo do arquivo local escolhido pelo usuário.'),
    previewOnly: z.boolean().optional().describe('Se true, mostra o mapeamento e uma amostra sem gravar nada.'),
  },
  async ({ filePath, previewOnly }) => {
    try {
      const parsed = await readLeadFile(filePath);
      if (previewOnly) return jsonText({ preview: true, total: parsed.total, valid: parsed.leads.length, skipped: parsed.skipped, mapping: parsed.mapping, warnings: parsed.warnings, sample: parsed.leads.slice(0, 3) });
      return jsonText({ success: true, ...importLeadFile(config, parsed) });
    } catch (error) {
      return text(`Não foi possível importar a planilha: ${(error as Error)?.message || 'arquivo inválido'}`);
    }
  },
);

server.tool(
  'captamais_move_stage',
  'Move um lead para outra etapa do funil. Não gasta tokens (é local).',
  {
    leadId: z.number().int().describe('ID do lead.'),
    stage: z.string().min(1).describe(`Nova etapa. Opções comuns: ${DEFAULT_STAGES.join(', ')}.`),
  },
  async ({ leadId, stage }) => {
    const lead = moveStage(config, leadId, stage);
    if (!lead) return text(`Lead ${leadId} não encontrado.`);
    return jsonText({ moved: true, lead });
  },
);

// ─────────────── Ferramenta de IA (passa pela nuvem, é MEDIDA e cobra tokens) ───────────────

server.tool(
  'captamais_prepare_meeting',
  'Usa a IA do CaptaMais (nuvem) para preparar uma reunião com um lead: pontos de contato, perguntas e próximos passos. GASTA TOKENS (medido na nuvem).',
  {
    leadId: z.number().int().describe('ID do lead para preparar a reunião.'),
  },
  async ({ leadId }) => {
    const lead = getLead(config, leadId);
    if (!lead) return text(`Lead ${leadId} não encontrado no CRM local.`);
    const result = await prepareMeeting(config, lead);
    if (!result.ok) return text(`Não foi possível preparar (IA): ${result.error}`);
    const usage = result.usage ? `\n\n_(uso: ${result.usage.tokens} tokens${result.usage.balanceLeft != null ? `, saldo restante ${result.usage.balanceLeft}` : ''})_` : '';
    return text(`${result.data.prep}${usage}`);
  },
);

server.tool(
  'captamais_google_status',
  'Verifica se Gmail e Google Agenda estão conectados à conta CaptaMais.',
  {},
  async () => {
    const result = await googleStatus(config);
    if (!result.ok) return text(`Não foi possível verificar a conexão Google: ${result.error}`);
    return jsonText(result.data);
  },
);

server.tool(
  'captamais_schedule_activity',
  'Agenda uma tarefa, ligação, follow-up ou reunião no CRM local e, opcionalmente, no Google Agenda. Reuniões sincronizadas recebem Google Meet.',
  {
    leadId: z.number().int().describe('ID do lead.'),
    type: z.enum(['call', 'followup', 'meeting', 'task']).describe('Tipo da atividade.'),
    title: z.string().min(1).describe('Título da atividade.'),
    dueAt: z.string().datetime().describe('Data e hora em ISO 8601 com fuso horário.'),
    notes: z.string().optional().describe('Notas opcionais.'),
    syncGoogleCalendar: z.boolean().optional().describe('Cria também no Google Agenda (padrão false).'),
  },
  async ({ leadId, type, title, dueAt, notes, syncGoogleCalendar }) => {
    const lead = getLead(config, leadId);
    if (!lead) return text(`Lead ${leadId} não encontrado no CRM local.`);
    const activity = createActivity(config, leadId, { type, title, dueAt, notes });
    if (!syncGoogleCalendar) return jsonText({ created: true, activity, googleCalendar: false });
    const result = await createGoogleCalendarEvent(config, lead, {
      localId: activity.id, type, title: activity.title, startAt: dueAt, notes: activity.notes,
    });
    const saved = setActivityGoogleEvent(config, activity.id, result.ok ? result.data : null);
    if (!result.ok) return jsonText({ created: true, activity: saved, googleCalendar: false, warning: result.error });
    return jsonText({ created: true, activity: saved, googleCalendar: true });
  },
);

// ─────────────── Pesquisar / Gerar leads (busca e créditos na nuvem; lista comprada fica no banco local) ───────────────

const yesNo = z.enum(['sim']).optional();
const filtersSchema = z.object({
  cnae: z.string().optional().describe('Código CNAE, ex.: 8630503.'),
  uf: z.string().optional().describe('Sigla do estado, ex.: RS.'),
  municipio: z.string().optional().describe('Cidade (precisa de uf).'),
  situacao: z.enum(['Ativa', 'Baixada', 'Inapta', 'Suspensa', 'Nula']).optional(),
  matrizFilial: z.enum(['matriz', 'filial']).optional(),
  porte: z.string().optional().describe('Porte conforme a base (ex.: MICRO EMPRESA, EMPRESA DE PEQUENO PORTE, MEDIO/GRANDE PORTE).'),
  naturezaJuridica: z.string().optional(),
  qtdFuncionarios: z.string().optional(),
  temCelular: yesNo.describe('"sim" = apenas com celular cadastrado.'),
  temTelefone: yesNo, temEmail: yesNo, temSite: yesNo,
  capitalMin: z.string().optional().describe('Capital social mínimo em R$, ex.: 1.000.000.'),
  capitalMax: z.string().optional(),
  faixaFaturamento: z.string().optional(),
  temDividas: z.enum(['sim', 'nao']).optional().describe('Dívidas federais.'),
  regimeTributario: z.enum(['mei', 'simples', 'presumido', 'real', 'presumido_ou_real', 'imune_isento']).optional(),
  dataAberturaMin: z.string().optional().describe('AAAA-MM-DD'),
  dataAberturaMax: z.string().optional().describe('AAAA-MM-DD'),
}).describe('Filtros do perfil ideal — os mesmos da tela EnriqueceLead (use ao menos um).');

server.tool(
  'captamais_lead_credits',
  'Mostra o saldo de créditos para comprar leads e o preço por lead. Não gasta créditos.',
  {},
  async () => {
    const r = await leadCredits(config);
    return r.ok ? jsonText(r.data) : text(`Não foi possível consultar os créditos: ${r.error}`);
  },
);

server.tool(
  'captamais_credits_report',
  'Mostra o saldo de créditos (plano e comprados, validade) e o relatório de gastos: cada pesquisa ou geração de leads com o que foi buscado, quantos leads e o custo. Cada linha tem um listId para exportar (captamais_export_lead_list) ou importar no CRM (captamais_import_lead_list). Não gasta créditos.',
  { limit: z.number().int().min(1).max(200).optional().describe('Quantas operações recentes listar (padrão 50).') },
  async ({ limit }) => {
    const credits = await leadCredits(config);
    return jsonText({
      credits: credits.ok ? credits.data : { aviso: `Não foi possível consultar o saldo: ${credits.error}` },
      relatorio: creditsSpendingReport(config, limit ?? 50),
    });
  },
);

server.tool(
  'captamais_redeem_credits',
  'Ativa um código de créditos recebido por e-mail depois da compra. Sem chave configurada, cria a carteira e guarda a chave neste computador (vale também para o CRM). Não gasta créditos.',
  { code: z.string().min(6).describe('Código no formato CM-XXXX-XXXX-XXXX.') },
  async ({ code }) => {
    const r = await redeemCreditsCode(config, code);
    if (!r.ok) return text(`Não foi possível ativar o código: ${r.error}`);
    return jsonText({
      ativado: true, saldo: r.balance, validade: r.expiresAt || undefined,
      aviso: r.accountExists ? 'Os créditos foram para a sua conta CaptaMais. Conecte a conta (chave de API) para usá-los.' : r.keySaved ? 'Chave da carteira salva neste computador. Reinicie o cliente de IA para o MCP usá-la.' : undefined,
    });
  },
);

server.tool(
  'captamais_search_leads',
  'Pesquisa empresas no banco do Capta+ SEM gastar créditos: devolve quantos resultados existem, o custo por lead, o saldo e uma prévia mascarada. mode="lookup" busca por nome/CNPJ/sócio/e-mail/telefone (query); mode="filters" monta uma lista pelo perfil ideal (filters). O resultado traz um searchId para gerar a lista.',
  {
    mode: z.enum(['lookup', 'filters']),
    query: z.string().optional().describe('Texto da pesquisa (mode=lookup).'),
    field: z.enum(['all', 'nome', 'cnpj', 'socio', 'email', 'telefone']).optional().describe('Onde pesquisar (mode=lookup); padrão: all (tudo).'),
    filters: filtersSchema.optional(),
  },
  async ({ mode, query, field, filters }) => {
    if (mode === 'lookup' && !query?.trim()) return text('Informe o que pesquisar (query).');
    const clean = Object.fromEntries(Object.entries(filters || {}).filter(([, v]) => v !== undefined && v !== ''));
    if (mode === 'filters' && !Object.keys(clean).length) return text('Informe ao menos um filtro.');
    const r = await searchLeads(config, mode === 'lookup' ? { mode, query: query!.trim(), field: field || 'all' } : { mode, filters: clean as Record<string, string | number | boolean> });
    if (!r.ok) return text(`A busca não pôde ser feita: ${r.error}`);
    const d = r.data;
    return jsonText({ ...d, custoTotalSeComprarTudo: d.total * d.pricePerLead, leadsQueOSaldoCobre: d.pricePerLead > 0 ? Math.floor(d.balance / d.pricePerLead) : d.total });
  },
);

server.tool(
  'captamais_generate_leads',
  'GASTA CRÉDITOS. Abre/gera dados de uma busca (searchId de captamais_search_leads) e os salva no banco local: use resultIds para abrir resultados escolhidos de uma pesquisa por nome, ou quantity para gerar uma lista de filtros. Só use depois que a pessoa confirmar a quantidade e o custo. Se o saldo não cobrir tudo, sai proporcional ao saldo. Depois ofereça: exportar para Excel/CSV, importar no CRM, enriquecer um lead existente ou manter só no banco.',
  {
    searchId: z.string().describe('searchId devolvido por captamais_search_leads.'),
    quantity: z.number().int().min(1).optional().describe('Quantos leads gerar (busca por filtros).'),
    resultIds: z.array(z.string()).optional().describe('IDs dos resultados escolhidos (pesquisa por nome).'),
    maxCredits: z.number().int().min(1).describe('Teto de créditos que a pessoa autorizou gastar nesta compra.'),
    confirmed: z.literal(true).describe('Só envie true se a pessoa confirmou explicitamente o gasto de créditos.'),
    name: z.string().optional().describe('Nome da lista.'),
  },
  async ({ searchId, quantity, resultIds, maxCredits, name }) => {
    if (!quantity && !resultIds?.length) return text('Informe quantity (filtros) ou resultIds (pesquisa por nome).');
    const r = await buyLeads(config, { searchId, quantity, resultIds, maxCredits, name });
    return r.ok ? jsonText(r) : text(`Não foi possível gerar a lista: ${r.error}`);
  },
);

server.tool(
  'captamais_enrich_lead',
  'Enriquece um lead que já está no CRM com um dado comprado (marketLeadIds de captamais_generate_leads): preenche só campos vazios e acrescenta CNPJ/sócios/CNAE às anotações. Não gasta créditos.',
  { leadId: z.number().int().describe('ID do lead no CRM.'), marketLeadId: z.number().int().describe('ID do dado comprado.') },
  async ({ leadId, marketLeadId }) => {
    try { return jsonText(enrichLeadFromPurchase(config, marketLeadId, leadId)); }
    catch (e) { return text((e as Error).message); }
  },
);

server.tool(
  'captamais_lead_lists',
  'Lista as listas de leads já compradas (guardadas no banco local). Não gasta créditos.',
  {},
  async () => jsonText({ lists: leadLists(config) }),
);

server.tool(
  'captamais_import_lead_list',
  'Importa uma lista comprada para o CRM (cria os leads no funil, sem duplicar e-mail/telefone). Não gasta créditos.',
  { listId: z.number().int() },
  async ({ listId }) => jsonText(importLeadList(config, listId)),
);

server.tool(
  'captamais_export_lead_list',
  'Exporta uma lista comprada em CSV (abre no Excel) na pasta de dados do CaptaMais e devolve o caminho. Não gasta créditos.',
  { listId: z.number().int() },
  async ({ listId }) => {
    const r = exportLeadList(config, listId);
    return r ? jsonText(r) : text(`Lista ${listId} não encontrada.`);
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log em stderr (stdout é reservado para o protocolo MCP).
  console.error(`[captamais-mcp] pronto. Dados locais: ${config.dbPath} · Nuvem: ${config.cloudUrl}${config.apiKey ? '' : ' (sem API key — ações de IA desativadas)'}`);
}

main().catch((e) => {
  console.error('[captamais-mcp] erro fatal:', e);
  process.exit(1);
});
