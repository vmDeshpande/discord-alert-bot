import { routeInteraction } from '../src/discord/router';

function makeInteraction(type: string, customId?: string, commandName?: string) {
  const interaction: any = {
    isChatInputCommand: () => type === 'command',
    isStringSelectMenu: () => type === 'select',
    isButton: () => type === 'button',
    isModalSubmit: () => type === 'modal',
    commandName,
    customId,
    options: {
      getSubcommand: () => 'list',
      getString: () => null,
    },
    reply: jest.fn().mockResolvedValue(undefined),
    showModal: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    user: { id: 'u1' },
    channelId: 'c1',
    message: { id: 'm1' },
    fields: {
      getTextInputValue: (k: string) => (k === 'level_price' ? '100' : 'BUY'),
    },
    values: ['lvl1'],
  };
  return interaction;
}

describe('Discord Router', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
  const storage = { getAllByChannel: jest.fn().mockReturnValue([]) } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes /alert command', async () => {
    const interaction = makeInteraction('command', undefined, 'alert');
    interaction.options.getSubcommand = () => 'list';
    await routeInteraction(interaction, { logger, storage, channelToSymbol: { c1: 'ETHUSD' } });
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('routes /level command when storages missing', async () => {
    const interaction = makeInteraction('command', undefined, 'level');
    await routeInteraction(interaction, { logger, storage, channelToSymbol: {} });
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('routes alert select menu', async () => {
    const interaction = makeInteraction('select', 'alert:delete');
    const alertStorage = {
      getById: jest.fn().mockReturnValue({ id: 'a1', channelId: 'c1', symbol: 'ETHUSD' }),
      deleteById: jest.fn(),
      update: jest.fn(),
    };
    await routeInteraction(interaction, { logger, storage: alertStorage as any, channelToSymbol: {} });
    expect(interaction.update).toHaveBeenCalled();
  });

  it('rejects manage trade button for closed/missing session', async () => {
    const interaction = makeInteraction('button', 'trade:manage:t1:list');
    const tradeStorage = {
      getById: jest.fn().mockReturnValue({ id: 't1', monitoringStatus: 'closed' }),
    };
    await routeInteraction(interaction, {
      logger,
      storage,
      channelToSymbol: {},
      tradeStorage: tradeStorage as any,
    });
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('rejects add level without verified stop', async () => {
    const interaction = makeInteraction('button', 'trade:manage:t1:add');
    const tradeStorage = {
      getById: jest.fn().mockReturnValue({ id: 't1', monitoringStatus: 'active', stopLossStatus: 'pending' }),
    };
    await routeInteraction(interaction, {
      logger,
      storage,
      channelToSymbol: {},
      tradeStorage: tradeStorage as any,
    });
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('rejects level activation for different trade', async () => {
    const interaction = makeInteraction('select', 'trade:levelsel:t1:activate');
    const tradeStorage = {
      getById: jest.fn().mockReturnValue({ id: 't1', monitoringStatus: 'active', stopLossStatus: 'verified' }),
    };
    const levelStorage = { getById: jest.fn().mockReturnValue({ id: 'lvl1', tradeId: 't2' }) };
    await routeInteraction(interaction, {
      logger,
      storage,
      channelToSymbol: {},
      tradeStorage: tradeStorage as any,
      levelStorage: levelStorage as any,
    });
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('rejects modal add without verified stop', async () => {
    const interaction = makeInteraction('modal', 'trade:modal:t1:addlevel');
    const tradeStorage = {
      getById: jest.fn().mockReturnValue({ id: 't1', monitoringStatus: 'active', stopLossStatus: 'pending' }),
    };
    await routeInteraction(interaction, {
      logger,
      storage,
      channelToSymbol: {},
      tradeStorage: tradeStorage as any,
    });
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('creates and activates a level from the level set select menu', async () => {
    const interaction = makeInteraction('select', 'level:set:select:45000:BUY');
    interaction.values = ['t1'];
    const tradeStorage = {
      getById: jest.fn().mockReturnValue({
        id: 't1',
        symbol: 'BTCUSD',
        side: 'BUY',
        monitoringStatus: 'active',
        stopLossStatus: 'verified',
      }),
    };
    const levelStorage = { upsert: jest.fn() };
    await routeInteraction(interaction, {
      logger,
      storage,
      channelToSymbol: {},
      tradeStorage: tradeStorage as any,
      levelStorage: levelStorage as any,
    });
    expect(levelStorage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'active',
        monitoringState: 'monitoring',
        tradeId: 't1',
        levelPrice: 45000,
        condition: 'BUY',
      }),
    );
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('monitoring active') }),
    );
  });

  it('rejects level set select menu for closed trade', async () => {
    const interaction = makeInteraction('select', 'level:set:select:45000:BUY');
    interaction.values = ['t1'];
    const tradeStorage = {
      getById: jest.fn().mockReturnValue({
        id: 't1',
        symbol: 'BTCUSD',
        side: 'BUY',
        monitoringStatus: 'closed',
        stopLossStatus: 'verified',
      }),
    };
    const levelStorage = { upsert: jest.fn() };
    await routeInteraction(interaction, {
      logger,
      storage,
      channelToSymbol: {},
      tradeStorage: tradeStorage as any,
      levelStorage: levelStorage as any,
    });
    expect(levelStorage.upsert).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Trade is closed.' }),
    );
  });

  it('rejects level set select menu when trade not found', async () => {
    const interaction = makeInteraction('select', 'level:set:select:45000:BUY');
    interaction.values = ['missing'];
    const tradeStorage = { getById: jest.fn().mockReturnValue(undefined) };
    const levelStorage = { upsert: jest.fn() };
    await routeInteraction(interaction, {
      logger,
      storage,
      channelToSymbol: {},
      tradeStorage: tradeStorage as any,
      levelStorage: levelStorage as any,
    });
    expect(levelStorage.upsert).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Trade not found.' }),
    );
  });

  it('rejects level set select menu when stop not verified', async () => {
    const interaction = makeInteraction('select', 'level:set:select:45000:BUY');
    interaction.values = ['t1'];
    const tradeStorage = {
      getById: jest.fn().mockReturnValue({
        id: 't1',
        symbol: 'BTCUSD',
        side: 'BUY',
        monitoringStatus: 'active',
        stopLossStatus: 'pending',
      }),
    };
    const levelStorage = { upsert: jest.fn() };
    await routeInteraction(interaction, {
      logger,
      storage,
      channelToSymbol: {},
      tradeStorage: tradeStorage as any,
      levelStorage: levelStorage as any,
    });
    expect(levelStorage.upsert).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Stop must be verified before adding levels.',
        ephemeral: true,
      }),
    );
  });
});
