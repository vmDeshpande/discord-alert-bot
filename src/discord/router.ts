import {
  Interaction,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { Logger } from '../logger';
import { AlertStorage } from '../database/storage';
import { TradeStorage } from '../database/tradeStorage';
import { LevelStorage } from '../database/levelStorage';
import { TradeInteractionStorage } from '../database/tradeInteractionStorage';
import { handleCommandExported, handleSelectMenu, handleLevelCommand } from './client';
import { parseTradeCustomId } from './interactions';
import {
  buildTradeManageEmbed,
  buildManageButtons,
  buildAddLevelModal,
  buildLevelSelectMenu,
} from './tradeInteractions';

export interface RouterDeps {
  logger: Logger;
  storage: AlertStorage;
  channelToSymbol: Record<string, string>;
  tradeStorage?: TradeStorage;
  levelStorage?: LevelStorage;
  tradeInteractionStorage?: TradeInteractionStorage;
}

function generateId(): string {
  return `int_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function isFinitePositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

export async function routeInteraction(interaction: Interaction, deps: RouterDeps): Promise<void> {
  const { logger } = deps;

  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'level') {
        if (deps.tradeStorage && deps.levelStorage) {
          await handleLevelCommand(
            interaction as ChatInputCommandInteraction,
            deps.tradeStorage,
            deps.levelStorage,
            deps.logger,
          );
        } else {
          await (interaction as ChatInputCommandInteraction)
            .reply({ content: 'Trade management not available.' })
            .catch(() => {});
        }
        return;
      }
      await handleCommandExported(
        interaction as ChatInputCommandInteraction,
        deps.storage,
        deps.logger,
        deps.channelToSymbol,
      );
      return;
    }

    if (interaction.isStringSelectMenu()) {
      const menu = interaction as StringSelectMenuInteraction;
      const customId = menu.customId;
      if (
        customId === 'alert:delete' ||
        customId === 'alert:activate' ||
        customId === 'alert:deactivate'
      ) {
        await handleSelectMenu(menu, deps.storage, deps.logger);
        return;
      }
      if (customId.startsWith('trade:levelsel:')) {
        const parts = customId.split(':');
        const tradeId = parts[2];
        const action = parts[3];
        const levelId = menu.values[0];
        const trade = deps.tradeStorage?.getById(tradeId);
        if (!trade) {
          await menu.reply({ content: 'Trade not found.' }).catch(() => {});
          return;
        }
        if (trade.monitoringStatus === 'closed') {
          await menu.reply({ content: 'Trade is closed.' }).catch(() => {});
          return;
        }
        const level = deps.levelStorage?.getById(levelId);
        if (!level || level.tradeId !== tradeId) {
          await menu.reply({ content: 'Invalid level.' }).catch(() => {});
          return;
        }
        if (action === 'activate') {
          if (trade.stopLossStatus !== 'verified') {
            await menu
              .reply({
                content: 'Stop must be verified before activating levels.',
                ephemeral: true,
              })
              .catch(() => {});
            return;
          }
          const now = new Date().toISOString();
          deps.levelStorage?.upsert({
            ...level,
            status: 'active' as any,
            monitoringState: 'monitoring' as any,
            updatedAt: now,
          });
          await menu.reply({ content: 'Level activated.' }).catch(() => {});
          return;
        }
        if (action === 'deactivate') {
          const now = new Date().toISOString();
          deps.levelStorage?.upsert({
            ...level,
            status: 'inactive' as any,
            monitoringState: 'idle' as any,
            updatedAt: now,
          });
          await menu.reply({ content: 'Level deactivated.' }).catch(() => {});
          return;
        }
        if (action === 'delete') {
          deps.levelStorage?.deleteById(levelId);
          await menu.reply({ content: 'Level deleted.' }).catch(() => {});
          return;
        }
        await menu.reply({ content: 'Unknown action.' }).catch(() => {});
        return;
      }
      return;
    }

    if (interaction.isButton()) {
      const buttonInteraction = interaction as ButtonInteraction;
      const customId = buttonInteraction.customId;
      // Check for manage trade buttons
      if (customId.startsWith('trade:manage:')) {
        const parts = customId.split(':');
        const tradeId = parts[2];
        const action = parts[3];
        const trade = deps.tradeStorage?.getById(tradeId);
        if (!trade) {
          await buttonInteraction.reply({ content: 'Trade session not found.' }).catch(() => {});
          return;
        }
        if (trade.monitoringStatus === 'closed') {
          await buttonInteraction.reply({ content: 'Trade session is closed.' }).catch(() => {});
          return;
        }
        if (deps.tradeInteractionStorage) {
          try {
            deps.tradeInteractionStorage.create({
              id: generateId(),
              tradeId: trade.id,
              type: `manage_${action}`,
              state: 'open',
              userId: buttonInteraction.user.id,
              channelId: buttonInteraction.channelId,
              messageId: buttonInteraction.message.id,
              data: JSON.stringify({ customId }),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          } catch {
            // ignore
          }
        }
        if (action === 'add') {
          if (trade.stopLossStatus !== 'verified') {
            await buttonInteraction
              .reply({ content: 'Stop must be verified before adding levels.' })
              .catch(() => {});
            return;
          }
          const modal = buildAddLevelModal(tradeId);
          await buttonInteraction.showModal(modal).catch(() => {});
          return;
        }
        if (action === 'list') {
          const levels = deps.levelStorage?.getByTrade(tradeId) || [];
          const embed = buildTradeManageEmbed(trade, levels);
          const rows = buildManageButtons(tradeId);
          await buttonInteraction.reply({ embeds: [embed], components: rows }).catch(() => {});
          return;
        }
        if (action === 'activate' || action === 'deactivate' || action === 'delete') {
          const levels = deps.levelStorage?.getByTrade(tradeId) || [];
          if (levels.length === 0) {
            await buttonInteraction.reply({ content: 'No levels to manage.' }).catch(() => {});
            return;
          }
          if (action === 'activate' && trade.stopLossStatus !== 'verified') {
            await buttonInteraction
              .reply({
                content: 'Stop must be verified before activating levels.',
                ephemeral: true,
              })
              .catch(() => {});
            return;
          }
          const menu = buildLevelSelectMenu(tradeId, levels, action);
          await buttonInteraction
            .reply({ content: `Select level to ${action}:`, components: [menu] })
            .catch(() => {});
          return;
        }
        if (action === 'refresh') {
          const levels = deps.levelStorage?.getByTrade(tradeId) || [];
          const embed = buildTradeManageEmbed(trade, levels);
          const rows = buildManageButtons(tradeId);
          await buttonInteraction.reply({ embeds: [embed], components: rows }).catch(() => {});
          return;
        }
        await buttonInteraction.reply({ content: 'Unknown action.' }).catch(() => {});
        return;
      }
      // Also support old format via parseTradeCustomId
      const parsed = parseTradeCustomId(customId);
      if (parsed) {
        const trade = deps.tradeStorage?.getById(parsed.tradeId);
        if (!trade || trade.monitoringStatus === 'closed') {
          await buttonInteraction
            .reply({ content: 'Trade session not found or closed.' })
            .catch(() => {});
          return;
        }
        const levels = deps.levelStorage?.getByTrade(trade.id) || [];
        const embed = buildTradeManageEmbed(trade, levels);
        const rows = buildManageButtons(trade.id);
        await buttonInteraction.reply({ embeds: [embed], components: rows }).catch(() => {});
        return;
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      const modal = interaction as ModalSubmitInteraction;
      const customId = modal.customId;
      if (customId.startsWith('trade:modal:')) {
        const parts = customId.split(':');
        const tradeId = parts[2];
        const trade = deps.tradeStorage?.getById(tradeId);
        if (!trade || trade.monitoringStatus === 'closed') {
          await modal.reply({ content: 'Trade session not found or closed.' }).catch(() => {});
          return;
        }
        if (trade.stopLossStatus !== 'verified') {
          await modal
            .reply({ content: 'Stop must be verified before adding levels.' })
            .catch(() => {});
          return;
        }
        const priceStr = modal.fields.getTextInputValue('level_price');
        const conditionStr = modal.fields.getTextInputValue('level_condition').toUpperCase();
        const price = parseFloat(priceStr);
        if (!isFinitePositive(price)) {
          await modal.reply({ content: 'Invalid price.' }).catch(() => {});
          return;
        }
        if (conditionStr !== 'BUY' && conditionStr !== 'SELL') {
          await modal.reply({ content: 'Condition must be BUY or SELL.' }).catch(() => {});
          return;
        }
        const now = new Date().toISOString();
        const level: any = {
          id: `level_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          tradeId: trade.id,
          symbol: trade.symbol,
          side: trade.side,
          levelPrice: price,
          condition: conditionStr as any,
          status: 'inactive',
          monitoringState: 'idle',
          triggerCandleTs: null,
          nextCandleTs: null,
          lastProcessedCandleTs: null,
          holdCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        deps.levelStorage?.upsert(level);
        await modal.reply({ content: 'Level added (inactive).' }).catch(() => {});
        return;
      }
      return;
    }
  } catch (err) {
    logger.error('Router interaction handling error', {
      error: String(err),
      type: interaction.type,
    });
  }
}
