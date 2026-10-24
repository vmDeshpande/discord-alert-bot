import crypto from 'crypto';
import { Logger } from '../logger';
import { DeltaPosition, DeltaProduct, ApiResponse } from '../types';
export interface AuthenticatedDeltaConfig {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  timeoutMs?: number;
  userAgent?: string;
}
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export type HttpTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<HttpResponse>;
export interface AuthenticatedDeltaClient {
  getPositions: () => Promise<DeltaPosition[]>;
  getProduct: (symbol: string) => Promise<DeltaProduct | null>;
  getOpenOrders: (productId?: number) => Promise<unknown[]>;
  placeOrder: (payload: unknown) => Promise<unknown>;
}
function defaultTransport(url: string, init: Parameters<HttpTransport>[1]): Promise<HttpResponse> {
  return fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  }).then(async (res) => {
    const body = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    return { status: res.status, headers, body };
  });
}
export function buildSignature(
  secret: string,
  method: string,
  timestamp: string,
  path: string,
  queryString: string,
  body: string,
): string {
  const message = method.toUpperCase() + timestamp + path + queryString + body;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}
export function createAuthenticatedDeltaClient(
  config: AuthenticatedDeltaConfig,
  logger: Logger,
  transport: HttpTransport = defaultTransport,
): AuthenticatedDeltaClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? 10000;
  const userAgent = config.userAgent ?? 'discord-alert-bot';
  async function request(
    method: string,
    path: string,
    query: Record<string, string | number | undefined> = {},
    body?: unknown,
  ): Promise<unknown> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const queryEntries = Object.entries(query).filter(([, v]) => v !== undefined);
    const queryString =
      queryEntries.length > 0
        ? '?' +
          queryEntries
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join('&')
        : '';
    const bodyStr = body === undefined ? '' : JSON.stringify(body);
    const signature = buildSignature(
      config.apiSecret,
      method,
      timestamp,
      path,
      queryString,
      bodyStr,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = `${baseUrl}${path}${queryString}`;
    let res: HttpResponse;
    try {
      res = await transport(url, {
        method: method.toUpperCase(),
        headers: {
          'api-key': config.apiKey,
          timestamp,
          signature,
          'User-Agent': userAgent,
          'Content-Type': 'application/json',
        },
        body: bodyStr || undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      logger.error('Delta REST request failed', { method, path, error: String(err) });
      throw err;
    } finally {
      clearTimeout(timer);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      logger.error('Delta REST invalid JSON', { method, path, status: res.status });
      throw new Error(`Invalid JSON response from Delta (${res.status})`);
    }
    const apiResponse = parsed as ApiResponse<unknown>;
    if (res.status === 429) {
      const reset = res.headers['x-rate-limit-reset'];
      logger.warn('Delta rate limit exceeded', { path, reset });
      throw new Error(`Rate limited by Delta Exchange (reset ${reset ?? 'unknown'})`);
    }
    if (res.status >= 400) {
      logger.error('Delta REST HTTP error', { method, path, status: res.status });
      throw new Error(`Delta HTTP ${res.status}`);
    }
    if (!apiResponse || typeof apiResponse !== 'object' || !('success' in apiResponse)) {
      throw new Error('Malformed Delta response');
    }
    if (apiResponse.success !== true) {
      const err = (apiResponse as { error?: { code?: string; message?: string } }).error;
      logger.error('Delta API error', { method, path, code: err?.code, message: err?.message });
      throw new Error(err?.message || err?.code || 'Delta API error');
    }
    return apiResponse.result;
  }
  function normalizePosition(raw: unknown): DeltaPosition | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const productId = Number(r.product_id);
    if (!Number.isFinite(productId)) return null;
    const size = Number(r.size);
    if (!Number.isFinite(size)) return null;
    const entryPrice = String(r.entry_price ?? '');
    if (entryPrice === '' || !Number.isFinite(Number(entryPrice))) return null;
    const symbol = String(r.product_symbol ?? '');
    if (!symbol) return null;
    if (size === 0) return null;
    return {
      user_id: Number(r.user_id ?? 0),
      size,
      entry_price: entryPrice,
      margin: String(r.margin ?? '0'),
      liquidation_price: String(r.liquidation_price ?? '0'),
      bankruptcy_price: String(r.bankruptcy_price ?? '0'),
      adl_level: Number(r.adl_level ?? 0),
      product_id: productId,
      product_symbol: symbol,
      commission: r.commission !== undefined ? String(r.commission) : undefined,
      realized_pnl: r.realized_pnl !== undefined ? String(r.realized_pnl) : undefined,
      unrealized_pnl: r.unrealized_pnl !== undefined ? String(r.unrealized_pnl) : undefined,
      unrealized_pnl_currency:
        r.unrealized_pnl_currency !== undefined ? String(r.unrealized_pnl_currency) : undefined,
      mark_price: r.mark_price !== undefined ? String(r.mark_price) : undefined,
      margin_mode: r.margin_mode !== undefined ? String(r.margin_mode) : undefined,
      created_at: r.created_at !== undefined ? String(r.created_at) : undefined,
      updated_at: r.updated_at !== undefined ? String(r.updated_at) : undefined,
    };
  }
  return {
    async getPositions(): Promise<DeltaPosition[]> {
      const result = await request('GET', '/v2/positions/margined');
      if (!Array.isArray(result)) return [];
      const out: DeltaPosition[] = [];
      for (const item of result) {
        const p = normalizePosition(item);
        if (p) out.push(p);
      }
      return out;
    },
    async getProduct(symbol: string): Promise<DeltaProduct | null> {
      try {
        const result = await request('GET', `/v2/products/${encodeURIComponent(symbol)}`);
        if (!result || typeof result !== 'object') return null;
        const r = result as Record<string, unknown>;
        return {
          id: Number(r.id),
          symbol: String(r.symbol),
          tick_size: String(r.tick_size ?? '1'),
          contract_value: String(r.contract_value ?? '1'),
          contract_unit_currency: String(r.contract_unit_currency ?? ''),
          state: String(r.state ?? ''),
          trading_status: String(r.trading_status ?? ''),
          contract_type: String(r.contract_type ?? ''),
          position_size_limit:
            r.position_size_limit === null ? null : Number(r.position_size_limit),
          product_specs: (r.product_specs as DeltaProduct['product_specs']) ?? undefined,
        };
      } catch (err) {
        logger.error('Failed to fetch product', { symbol, error: String(err) });
        return null;
      }
    },
    async getOpenOrders(productId?: number): Promise<unknown[]> {
      const query: Record<string, string | number | undefined> = { state: 'open' };
      if (productId !== undefined) query.product_id = productId;
      const result = await request('GET', '/v2/orders', query);
      return Array.isArray(result) ? result : [];
    },
    async placeOrder(payload: unknown): Promise<unknown> {
      return request('POST', '/v2/orders', {}, payload);
    },
  };
}
