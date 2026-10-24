import { createDashboardService } from '../src/tradeManagement/dashboardService';

describe('DashboardService', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates message when none exists', async () => {
    const trade = {
      id: 't1',
      monitoringStatus: 'active',
      discordMessageId: null,
    } as any;
    const tradeStorage = {
      getAll: jest.fn().mockReturnValue([trade]),
      upsert: jest.fn(),
    };
    const discord = {
      sendMessage: jest.fn().mockResolvedValue({ id: 'm1' }),
      editMessage: jest.fn().mockResolvedValue(true),
    };
    const service = createDashboardService(tradeStorage as any, discord as any, 'ch1', 1000, logger);
    await service.initialize();
    expect(discord.sendMessage).toHaveBeenCalled();
    expect(tradeStorage.upsert).toHaveBeenCalled();
  });

  it('updates existing message', async () => {
    const trade = {
      id: 't1',
      monitoringStatus: 'active',
      discordMessageId: 'm1',
      discordChannelId: 'ch1',
    } as any;
    const tradeStorage = {
      getAll: jest.fn().mockReturnValue([trade]),
      upsert: jest.fn(),
    };
    const discord = {
      sendMessage: jest.fn().mockResolvedValue({ id: 'm2' }),
      editMessage: jest.fn().mockResolvedValue(true),
    };
    const service = createDashboardService(tradeStorage as any, discord as any, 'ch1', 1000, logger);
    await service.refresh();
    expect(discord.editMessage).toHaveBeenCalled();
  });

  it('recovers from deleted message by recreating', async () => {
    const trade = {
      id: 't1',
      monitoringStatus: 'active',
      discordMessageId: 'm1',
      discordChannelId: 'ch1',
    } as any;
    const tradeStorage = {
      getAll: jest.fn().mockReturnValue([trade]),
      upsert: jest.fn(),
    };
    const discord = {
      sendMessage: jest.fn().mockResolvedValue({ id: 'm2' }),
      editMessage: jest.fn().mockResolvedValue(false),
    };
    const service = createDashboardService(tradeStorage as any, discord as any, 'ch1', 1000, logger);
    await service.refresh();
    expect(discord.editMessage).toHaveBeenCalled();
    expect(discord.sendMessage).toHaveBeenCalled();
  });

  it('handles Discord failures without crashing', async () => {
    const trade = {
      id: 't1',
      monitoringStatus: 'active',
      discordMessageId: null,
    } as any;
    const tradeStorage = {
      getAll: jest.fn().mockReturnValue([trade]),
      upsert: jest.fn(),
    };
    const discord = {
      sendMessage: jest.fn().mockRejectedValue(new Error('perm')),
      editMessage: jest.fn().mockRejectedValue(new Error('rate')),
    };
    const service = createDashboardService(tradeStorage as any, discord as any, 'ch1', 1000, logger);
    await expect(service.refresh()).resolves.not.toThrow();
  });

  it('does not crash on database failure', async () => {
    const tradeStorage = {
      getAll: jest.fn().mockImplementation(() => {
        throw new Error('db');
      }),
      upsert: jest.fn(),
    };
    const discord = {
      sendMessage: jest.fn().mockResolvedValue({ id: 'm1' }),
      editMessage: jest.fn().mockResolvedValue(true),
    };
    const service = createDashboardService(tradeStorage as any, discord as any, 'ch1', 1000, logger);
    await expect(service.refresh()).resolves.not.toThrow();
  });
});
