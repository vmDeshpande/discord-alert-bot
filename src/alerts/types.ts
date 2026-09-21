export interface AlertConfig {
  id: string;
  symbol: string;
  condition: AlertCondition;
  targetPrice: number;
  discordChannelId: string;
  enabled: boolean;
  triggered: boolean;
  createdAt: string;
  triggeredAt: string | null;
}

export type AlertCondition =
  'crossed_above' | 'crossed_below' | 'reaches_or_above' | 'reaches_or_below';

export interface PriceUpdate {
  symbol: string;
  price: number;
  timestamp: number;
}

export interface TriggerResult {
  triggered: boolean;
  condition: AlertCondition;
  previousPrice: number;
  currentPrice: number;
  targetPrice: number;
}
