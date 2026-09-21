export interface AlertConfig {
  id: string;
  symbol: string;
  channelId: string;
  targetPrice: number;
  baselinePrice: number | null;
  direction: 'upward' | 'downward';
  active: boolean;
  triggered: boolean;
  createdAt: string;
  triggeredAt: string | null;
}

export type AlertDirection = 'upward' | 'downward';

export interface PriceUpdate {
  symbol: string;
  price: number;
  timestamp: number;
}

export interface TriggerResult {
  triggered: boolean;
  targetPrice: number;
  currentPrice: number;
  baselinePrice: number | null;
  direction: AlertDirection;
}
