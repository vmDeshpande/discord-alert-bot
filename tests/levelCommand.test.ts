import { handleLevelCommand } from '../src/discord/client';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function makeInteraction(options: Record<string, string | null> = {}) {
  const interaction: any = {
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    options: {
      getSubcommand: () => 'set',
      getString: (k: string) => (options[k] ?? null),
    },
  };
  return interaction;
}

function makeStorage(trades: any[] = [], levels: any[] = []) {
  return {
    tradeStorage: {
      getById: jest.fn((id: string) => trades.find((t) => t.id === id)),
      getAll: jest.fn(() => trades),
    },
    levelStorage: {
      getByTrade: jest.fn(() => levels),
      upsert: jest.fn(),
      deleteById: jest.fn(),
    },
  };
}

describe('/level set command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates and activates a level when trade_id + price + condition are provided', async () => {
    const interaction = makeInteraction({
      trade_id: 't1',
      price: '45000',
      condition: 'BUY',
    });
    const { tradeStorage, levelStorage } = makeStorage([
      {
        id: 't1',
        symbol: 'BTCUSD',
        side: 'BUY',
        entryPrice: 50000,
        size: 1,
        monitoringStatus: 'active',
        stopLossStatus: 'verified',
      },
    ]);

    await handleLevelCommand(interaction, tradeStorage, levelStorage, logger);

    expect(levelStorage.upsert).toHaveBeenCalledTimes(1);
    const saved = (levelStorage.upsert as jest.Mock).mock.calls[0][0];
    expect(saved.status).toBe('active');
    expect(saved.monitoringState).toBe('monitoring');
    expect(saved.tradeId).toBe('t1');
    expect(saved.levelPrice).toBe(45000);
    expect(saved.condition).toBe('BUY');
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('monitoring active'),
      }),
    );
  });

  it('rejects when trade is closed', async () => {
    const interaction = makeInteraction({
      trade_id: 't1',
      price: '45000',
      condition: 'BUY',
    });
    const { tradeStorage, levelStorage } = makeStorage([
      {
        id: 't1',
        symbol: 'BTCUSD',
        side: 'BUY',
        entryPrice: 50000,
        size: 1,
        monitoringStatus: 'closed',
        stopLossStatus: 'verified',
      },
    ]);

    await handleLevelCommand(interaction, tradeStorage, levelStorage, logger);

    expect(levelStorage.upsert).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Trade not found or closed.' }),
    );
  });

  it('rejects when stop is not verified', async () => {
    const interaction = makeInteraction({
      trade_id: 't1',
      price: '45000',
      condition: 'BUY',
    });
    const { tradeStorage, levelStorage } = makeStorage([
      {
        id: 't1',
        symbol: 'BTCUSD',
        side: 'BUY',
        entryPrice: 50000,
        size: 1,
        monitoringStatus: 'active',
        stopLossStatus: 'pending',
      },
    ]);

    await handleLevelCommand(interaction, tradeStorage, levelStorage, logger);

    expect(levelStorage.upsert).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Stop must be verified before adding levels.',
      }),
    );
  });

  it('rejects invalid price', async () => {
    const interaction = makeInteraction({
      trade_id: 't1',
      price: 'abc',
      condition: 'BUY',
    });
    const { tradeStorage, levelStorage } = makeStorage([
      {
        id: 't1',
        symbol: 'BTCUSD',
        side: 'BUY',
        entryPrice: 50000,
        size: 1,
        monitoringStatus: 'active',
        stopLossStatus: 'verified',
      },
    ]);

    await handleLevelCommand(interaction, tradeStorage, levelStorage, logger);

    expect(levelStorage.upsert).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Invalid price.' }),
    );
  });

  it('rejects invalid condition', async () => {
    const interaction = makeInteraction({
      trade_id: 't1',
      price: '45000',
      condition: 'INVALID',
    });
    const { tradeStorage, levelStorage } = makeStorage([
      {
        id: 't1',
        symbol: 'BTCUSD',
        side: 'BUY',
        entryPrice: 50000,
        size: 1,
        monitoringStatus: 'active',
        stopLossStatus: 'verified',
      },
    ]);

    await handleLevelCommand(interaction, tradeStorage, levelStorage, logger);

    expect(levelStorage.upsert).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Condition must be BUY or SELL.' }),
    );
  });

  it('shows select menu when no arguments provided and open trades exist', async () => {
    const interaction = makeInteraction({});
    const { tradeStorage, levelStorage } = makeStorage([
      {
        id: 't1',
        symbol: 'BTCUSD',
        side: 'BUY',
        entryPrice: 50000,
        size: 1,
        monitoringStatus: 'active',
        stopLossStatus: 'verified',
      },
      {
        id: 't2',
        symbol: 'ETHUSD',
        side: 'SELL',
        entryPrice: 3000,
        size: 2,
        monitoringStatus: 'closed',
        stopLossStatus: 'verified',
      },
    ]);

    await handleLevelCommand(interaction, tradeStorage, levelStorage, logger);

    expect(levelStorage.upsert).not.toHaveBeenCalled();
    const call = (interaction.reply as jest.Mock).mock.calls[0][0];
    expect(call.ephemeral).toBeUndefined();
    expect(call.content).toContain('Select the trade');
    expect(call.components).toHaveLength(1);
    const row = call.components[0];
    const rowJson = row.toJSON();
    expect(rowJson.type).toBe(1);
    const menu = rowJson.components[0];
    expect(menu.custom_id).toBe('level:set:trade:select');
    expect(menu.options).toHaveLength(1);
    expect(menu.options[0].value).toBe('t1');
    expect(menu.options[0].label).toContain('BTCUSD');
    expect(menu.options[0].label).toContain('LONG');
  });

  it('reports no open trades when none exist', async () => {
    const interaction = makeInteraction({});
    const { tradeStorage, levelStorage } = makeStorage([
      {
        id: 't1',
        symbol: 'BTCUSD',
        side: 'BUY',
        entryPrice: 50000,
        size: 1,
        monitoringStatus: 'closed',
        stopLossStatus: 'verified',
      },
    ]);

    await handleLevelCommand(interaction, tradeStorage, levelStorage, logger);

    expect(levelStorage.upsert).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('No open trades found'),
      }),
    );
  });

  it('rejects when only partial arguments provided', async () => {
    const interaction = makeInteraction({ price: '45000' });
    const { tradeStorage, levelStorage } = makeStorage([]);

    await handleLevelCommand(interaction, tradeStorage, levelStorage, logger);

    expect(levelStorage.upsert).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('trade_id, price, and condition'),
      }),
    );
  });
});
