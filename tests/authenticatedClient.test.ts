import { buildSignature, createAuthenticatedDeltaClient } from '../src/delta/authenticatedClient';
import { Logger } from '../src/logger';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

describe('authenticated delta client', () => {
  it('builds signature per docs', () => {
    const sig = buildSignature('7b6f39dcf660ec1c7c664f612c60410a2bd0c258416b498bf0311f94228f', 'GET', '1542110948', '/v2/orders', '?product_id=1&state=open', '');
    expect(sig).toBe('4e38dda3e6477092f360ba70399266d8145630b22bcc34c0ec7f804d5746877a');
  });

  it('normalizes positions and filters flat', async () => {
    const transport = async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({
        success: true,
        result: [
          { product_id: 27, product_symbol: 'BTCUSD', size: 2, entry_price: '50000', user_id: 1, margin: '1', liquidation_price: '49000', bankruptcy_price: '48000', adl_level: 0 },
          { product_id: 27, product_symbol: 'BTCUSD', size: 0, entry_price: '50000', user_id: 1, margin: '1', liquidation_price: '49000', bankruptcy_price: '48000', adl_level: 0 },
          { product_id: 27, product_symbol: 'BTCUSD', size: 1, entry_price: 'bad', user_id: 1, margin: '1', liquidation_price: '49000', bankruptcy_price: '48000', adl_level: 0 },
        ],
      }),
    });
    const client = createAuthenticatedDeltaClient({ baseUrl: 'https://api.india.delta.exchange', apiKey: 'k', apiSecret: 's' }, logger, transport);
    const positions = await client.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0].size).toBe(2);
    expect(positions[0].entry_price).toBe('50000');
  });

  it('throws on api error', async () => {
    const transport = async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ success: false, error: { code: 'invalid_api_key', message: 'bad key' } }),
    });
    const client = createAuthenticatedDeltaClient({ baseUrl: 'https://api.india.delta.exchange', apiKey: 'k', apiSecret: 's' }, logger, transport);
    await expect(client.getPositions()).rejects.toThrow('bad key');
  });

  it('throws on rate limit', async () => {
    const transport = async () => ({
      status: 429,
      headers: { 'x-rate-limit-reset': '1000' },
      body: JSON.stringify({ success: false, error: { code: 'rate_limit' } }),
    });
    const client = createAuthenticatedDeltaClient({ baseUrl: 'https://api.india.delta.exchange', apiKey: 'k', apiSecret: 's' }, logger, transport);
    await expect(client.getPositions()).rejects.toThrow(/Rate limited/);
  });
});
