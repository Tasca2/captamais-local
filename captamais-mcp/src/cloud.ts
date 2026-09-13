import type { CaptaMaisConfig } from './config.js';
import type { Lead } from './db.js';

export type MeteredResult<T> =
  | { ok: true; data: T; usage?: { action: string; tokens: number; balanceLeft?: number | null } }
  | { ok: false; error: string; code?: string };

/**
 * Chama a nuvem CaptaMais para uma ação de IA. A nuvem autentica pela chave do usuário,
 * MEDE o consumo (server-side, fonte da verdade) e devolve o resultado + o uso.
 * Ações locais (CRUD) NÃO passam por aqui — só as de IA.
 */
async function callCloudAi<T>(config: CaptaMaisConfig, path: string, body: unknown): Promise<MeteredResult<T>> {
  if (!config.apiKey) {
    return { ok: false, error: 'Sem CAPTAMAIS_API_KEY. Gere sua chave no CaptaMais (Minha Conta) e configure no cliente MCP.', code: 'no_api_key' };
  }
  try {
    const res = await fetch(`${config.cloudUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-captamais-key': config.apiKey },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json?.success === false) {
      return {
        ok: false,
        error: String(json?.message || `Falha na nuvem (HTTP ${res.status}).`),
        code: typeof json?.code === 'string' ? json.code : undefined,
      };
    }
    return {
      ok: true,
      data: json.data as T,
      usage: json.usage as { action: string; tokens: number; balanceLeft?: number | null } | undefined,
    };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || 'Erro de rede ao falar com a nuvem.', code: 'network' };
  }
}

/** Ação de IA do MVP: preparar uma reunião a partir de um lead. Consome tokens (medido na nuvem). */
export function prepareMeeting(config: CaptaMaisConfig, lead: Lead): Promise<MeteredResult<{ prep: string }>> {
  return callCloudAi<{ prep: string }>(config, '/api/mcp/ai/prepare-meeting', {
    lead: {
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      city: lead.city,
      stage: lead.stage,
      description: lead.description,
      subtitle: lead.subtitle,
    },
  });
}
