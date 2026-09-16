#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { createActivity, createLead, DEFAULT_STAGES, getLead, listLeads, moveStage, setActivityGoogleEvent } from './db.js';
import { createGoogleCalendarEvent, googleStatus, prepareMeeting } from './cloud.js';

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
