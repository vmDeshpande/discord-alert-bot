import {
  Interaction,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
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
      if (customId === 'level:list:trade:select') {
        const tradeId = menu.values[0], trade = deps.tradeStorage?.getById(tradeId);
        if (!trade) { await menu.update({ content: 'Trade not found.', components: [] }).catch(() => {}); return; }
        const levels = deps.levelStorage?.getByTrade(tradeId) || [];
        if (!levels.length) { await menu.update({ content: 'No levels found for that trade.', components: [] }).catch(() => {}); return; }
        const message = `Levels for ${trade.symbol} ${trade.side} (${tradeId}):\\n` + levels.map((l: any) => `- ${l.id}: ${l.levelPrice} ${l.condition} [${l.status}/${l.monitoringState}]`).join('\\n');
        await menu.update({ content: message, components: [] }).catch(() => {}); return;
      }
      if (customId.startsWith('level:command:')) {
        const action = customId.split(':')[2], levelId = menu.values[0], level = deps.levelStorage?.getById(levelId);
        if (!level) { await menu.update({ content: 'Level not found. It may have already been deleted.', components: [] }).catch(() => {}); return; }
        const trade = deps.tradeStorage?.getById(level.tradeId);
        if (!trade || trade.monitoringStatus === 'closed') { await menu.update({ content: 'This level belongs to a closed or missing trade.', components: [] }).catch(() => {}); return; }
        if (action === 'activate') {
          if (trade.stopLossStatus !== 'verified') { await menu.update({ content: 'Stop must be verified before activating levels.', components: [] }).catch(() => {}); return; }
          deps.levelStorage?.upsert({ ...level, status: 'active' as any, monitoringState: 'monitoring' as any, updatedAt: new Date().toISOString() });
          await menu.update({ content: `Level ${level.levelPrice} activated for ${level.symbol} ${level.side}.`, components: [] }).catch(() => {});
          logger.info('Level activated via command select menu', { levelId, tradeId: trade.id }); return;
        }
        if (action === 'deactivate') {
          deps.levelStorage?.upsert({ ...level, status: 'inactive' as any, monitoringState: 'idle' as any, updatedAt: new Date().toISOString() });
          await menu.update({ content: `Level ${level.levelPrice} deactivated for ${level.symbol} ${level.side}.`, components: [] }).catch(() => {});
          logger.info('Level deactivated via command select menu', { levelId, tradeId: trade.id }); return;
        }
        if (action === 'delete') {
          deps.levelStorage?.deleteById(levelId);
          await menu.update({ content: `Level ${level.levelPrice} deleted for ${level.symbol} ${level.side}.`, components: [] }).catch(() => {});
          logger.info('Level deleted via command select menu', { levelId, tradeId: trade.id }); return;
        }
        await menu.update({ content: 'Unknown level action.', components: [] }).catch(() => {}); return;
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
      if (customId === 'level:set:trade:select') {
        const selectedTradeId = menu.values[0];
        const trade = deps.tradeStorage?.getById(selectedTradeId);
        if (!trade) {
          await menu.reply({ content: 'Trade not found.' }).catch(() => {});
          return;
        }
        if (trade.monitoringStatus === 'closed') {
          await menu.reply({ content: 'Trade is closed.' }).catch(() => {});
          return;
        }
        if (trade.stopLossStatus !== 'verified') {
          await menu
            .reply({
              content: 'Stop must be verified before adding levels.',
            })
            .catch(() => {});
          return;
        }

        const direction = trade.side === 'BUY' ? 'LONG' : 'SHORT';
        const modal = new ModalBuilder()
          .setCustomId(`level:set:modal:${trade.id}`)
          .setTitle(`Add Levels — ${trade.symbol} ${direction}`)
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('level_price_1')
                .setLabel('Level 1 Price')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. 45000')
                .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('level_price_2')
                .setLabel('Level 2 Price (optional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. 44000')
                .setRequired(false),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('level_price_3')
                .setLabel('Level 3 Price (optional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. 43000')
                .setRequired(false),
            ),
          );

        await menu.showModal(modal).catch(() => {});
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
          status: 'active',
          monitoringState: 'monitoring',
          triggerCandleTs: null,
          nextCandleTs: null,
          lastProcessedCandleTs: null,
          holdCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        deps.levelStorage?.upsert(level);
        await modal
          .reply({
            content: `Level added and monitoring active for ${trade.symbol} ${trade.side} at ${price}.`,
          })
          .catch(() => {});
        return;
      }
      if (customId.startsWith('level:set:modal:')) {
        const parts = customId.split(':');
        // level:set:modal:{tradeId}
        const selectedTradeId = parts[3];
        const trade = deps.tradeStorage?.getById(selectedTradeId);
        if (!trade || trade.monitoringStatus === 'closed') {
          await modal.reply({ content: 'Trade session not found or closed.' }).catch(() => {});
          return;
        }
        if (trade.stopLossStatus !== 'verified') {
          await modal
            .reply({
              content: 'Stop must be verified before adding levels.',
            })
            .catch(() => {});
          return;
        }

        const direction = trade.side === 'BUY' ? 'LONG' : 'SHORT';
        const now = new Date().toISOString();
        const savedPrices: number[] = [];

        for (let i = 1; i <= 3; i++) {
          const priceStr = modal.fields.getTextInputValue(`level_price_${i}`);
          if (!priceStr || priceStr.trim() === '') continue;
          const price = parseFloat(priceStr);
          if (!isFinitePositive(price)) continue;

          // Prevent duplicate levels for the same trade at the same price
          const existing = (deps.levelStorage?.getByTrade(trade.id) || []).some(
            (l: any) => l.levelPrice === price,
          );
          if (existing) continue;

          const level: any = {
            id: `level_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            tradeId: trade.id,
            symbol: trade.symbol,
            side: trade.side,
            levelPrice: price,
            condition: trade.side,
            status: 'active',
            monitoringState: 'monitoring',
            triggerCandleTs: null,
            nextCandleTs: null,
            lastProcessedCandleTs: null,
            holdCount: 0,
            createdAt: now,
            updatedAt: now,
          };
          deps.levelStorage?.upsert(level);
          savedPrices.push(price);
          logger.info('Level created via modal', {
            id: level.id,
            tradeId: trade.id,
            symbol: trade.symbol,
            direction,
            price,
          });
        }

        if (savedPrices.length === 0) {
          await modal.reply({ content: 'No valid level prices provided.' }).catch(() => {});
          return;
        }

        const priceList = savedPrices.join(', ');
        await modal.deferReply().catch(() => {});
        await modal
          .followUp({
            content: `Levels saved and monitoring active for ${trade.symbol} ${direction} (trade ${trade.id}): ${priceList}`,
          })
          .catch(() => {});
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
