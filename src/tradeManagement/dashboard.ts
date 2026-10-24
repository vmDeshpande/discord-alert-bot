import { TradeRecord } from '../types';

export interface TradeEmbed {
  title: string;
  fields: { name: string; value: string; inline?: boolean }[];
}

export function buildTradeEmbed(trade: TradeRecord): TradeEmbed {
  return {
    title: `${trade.symbol} ${trade.side === 'BUY' ? 'LONG' : 'SHORT'}`,
    fields: [
      { name: 'Product ID', value: String(trade.productId), inline: true },
      { name: 'Entry Price', value: String(trade.entryPrice), inline: true },
      { name: 'Size', value: `${trade.size}`, inline: true },
      {
        name: 'Mark Price',
        value: trade.markPrice !== null ? String(trade.markPrice) : 'Unavailable',
        inline: true,
      },
      {
        name: 'Unrealized PnL',
        value:
          trade.unrealizedPnl !== null
            ? `${trade.unrealizedPnl} ${trade.unrealizedPnlCurrency ?? ''}`
            : 'Unavailable',
        inline: true,
      },
      {
        name: 'Stop Loss',
        value:
          trade.stopLossPrice !== null
            ? `${trade.stopLossPrice} (${trade.stopLossStatus})`
            : 'Unavailable',
        inline: true,
      },
      { name: 'Status', value: trade.monitoringStatus, inline: true },
      { name: 'Last Event', value: trade.lastEvent ?? 'none', inline: true },
      { name: 'Updated', value: trade.lastSeenAt, inline: true },
    ],
  };
}
