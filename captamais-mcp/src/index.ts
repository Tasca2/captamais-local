#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { createLead, DEFAULT_STAGES, getLead, listLeads, moveStage } from './db.js';
import { prepareMeeting } from './cloud.js';

const config = loadConfig();

const server = new McpServer({ name: 'captamais', version: '0.1.0' });

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
