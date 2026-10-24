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
    followUp: jest.fn().mockResolvedValue(undefined),
    showModal: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    user: { id: 'u1' },
    channelId: 'c1',
    message: { id: 'm1' },
    fields: {
      getTextInputValue: (k: string) => (k === 'level_price_1' ? '45000' : ''),
    },
    values: ['t1'],
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

  it('shows modal when trade selected from level set dropdown', async () => {
    const interaction = makeInteraction('select', 'level:set:trade:select');
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
    await routeInteraction(interaction, {
      logger,
      storage,
      channelToSymbol: {},
      tradeStorage: tradeStorage as any,
    });
    expect(interaction.showModal).toHaveBeenCalled();
    const modalArg = (interaction.showModal as jest.Mock).mock.calls[0][0];
    const modalData = modalArg.toJSON ? modalArg.toJSON() : modalArg;
    expect(modalData.custom_id).toBe('level:set:modal:t1');
    expect(modalData.title).toContain('BTCUSD');
    expect(modalData.title).toContain('LONG');
  });

  it('rejects trade select for closed trade', async () => {
    const interaction = makeInteraction('select', 'level:set:trade:select');
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

  it('rejects trade select when trade not found', async () => {
    const interaction = makeInteraction('select', 'level:set:trade:select');
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

  it('rejects trade select when stop not verified', async () => {
    const interaction = makeInteraction('select', 'level:set:trade:select');
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
      }),
    );
  });

  it('saves multiple levels as active/monitoring from modal submission', async () => {
    const interaction = makeInteraction('modal', 'level:set:modal:t1');
    interaction.fields.getTextInputValue = (k: string) => {
      if (k === 'level_price_1') return '45000';
      if (k === 'level_price_2') return '44000';
      if (k === 'level_price_3') return '';
      return '';
    };
    const tradeStorage = {
      getById: jest.fn().mockReturnValue({
        id: 't1',
        symbol: 'BTCUSD',
        side: 'BUY',
        monitoringStatus: 'active',
        stopLossStatus: 'verified',
      }),
      getByTrade: jest.fn().mockReturnValue([]),
    };
    const levelStorage = { upsert: jest.fn(), getByTrade: jest.fn().mockReturnValue([]) };
    await routeInteraction(interaction, {
      logger,
      storage,
      channelToSymbol: {},
      tradeStorage: tradeStorage as any,
      levelStorage: levelStorage as any,
    });
    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('monitoring active') }),
    );
    // Two valid levels saved
    expect(levelStorage.upsert).toHaveBeenCalledTimes(2);
    const calls = (levelStorage.upsert as jest.Mock).mock.calls;
    expect(calls[0][0].status).toBe('active');
    expect(calls[0][0].monitoringState).toBe('monitoring');
    expect(calls[0][0].levelPrice).toBe(45000);
    expect(calls[0][0].condition).toBe('BUY');
    expect(calls[1][0].status).toBe('active');
    expect(calls[1][0].monitoringState).toBe('monitoring');
    expect(calls[1][0].levelPrice).toBe(44000);
  });

  it('rejects modal submission for closed trade', async () => {
    const interaction = makeInteraction('modal', 'level:set:modal:t1');
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
      expect.objectContaining({ content: 'Trade session not found or closed.' }),
    );
  });
});
