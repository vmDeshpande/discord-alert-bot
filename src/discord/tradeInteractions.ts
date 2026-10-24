import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { TradeRecord, LevelRecord } from '../types';
import { buildManageCustomId } from './interactions';

export function buildTradeManageEmbed(trade: TradeRecord, levels: LevelRecord[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${trade.symbol} ${trade.side === 'BUY' ? 'LONG' : 'SHORT'} - Manage`)
    .addFields(
      { name: 'Trade ID', value: trade.id, inline: false },
      { name: 'Product ID', value: String(trade.productId), inline: true },
      { name: 'Entry', value: String(trade.entryPrice), inline: true },
      { name: 'Size', value: String(trade.size), inline: true },
      {
        name: 'Stop Loss',
        value: trade.stopLossPrice
          ? `${trade.stopLossPrice} (${trade.stopLossStatus})`
          : 'Unavailable',
        inline: true,
      },
      { name: 'Status', value: trade.monitoringStatus, inline: true },
      {
        name: 'Levels',
        value: levels.length
          ? levels
              .map(
                (l) => `${l.id}: ${l.levelPrice} ${l.condition} [${l.status}/${l.monitoringState}]`,
              )
              .join('\n')
          : 'None',
        inline: false,
      },
    )
    .setTimestamp();
  return embed;
}

export function buildManageButtons(tradeId: string) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`trade:manage:${tradeId}:add`)
      .setLabel('Add Level')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`trade:manage:${tradeId}:list`)
      .setLabel('List Levels')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`trade:manage:${tradeId}:refresh`)
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
  );
  return [row];
}

export function buildLevelActionButtons(tradeId: string) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`trade:manage:${tradeId}:activate`)
      .setLabel('Activate')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`trade:manage:${tradeId}:deactivate`)
      .setLabel('Deactivate')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`trade:manage:${tradeId}:delete`)
      .setLabel('Delete')
      .setStyle(ButtonStyle.Danger),
  );
  return [row];
}

export function buildAddLevelModal(tradeId: string) {
  const modal = new ModalBuilder()
    .setCustomId(`trade:modal:${tradeId}:addlevel`)
    .setTitle('Add Level');
  const priceInput = new TextInputBuilder()
    .setCustomId('level_price')
    .setLabel('Level Price')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const conditionInput = new TextInputBuilder()
    .setCustomId('level_condition')
    .setLabel('Condition (BUY/SELL)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(priceInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(conditionInput),
  );
  return modal;
}

export function buildLevelSelectMenu(tradeId: string, levels: LevelRecord[], action: string) {
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`trade:levelsel:${tradeId}:${action}`)
      .setPlaceholder(`Select level for ${action}`)
      .addOptions(
        levels.map((l) => ({
          label: `${l.levelPrice} ${l.condition} [${l.status}]`,
          value: l.id,
        })),
      ),
  );
  return row;
}

export { buildManageCustomId };
