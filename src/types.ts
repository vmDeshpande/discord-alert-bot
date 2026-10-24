export const SUPPORTED_SYMBOLS = ['ETHUSD', 'SOLUSD', 'BTCUSD'] as const;
export type SupportedSymbol = (typeof SUPPORTED_SYMBOLS)[number];

export const SUPPORTED_SIDES = ['BUY', 'SELL'] as const;
export type SupportedSide = (typeof SUPPORTED_SIDES)[number];

export const LEVEL_CONDITIONS = ['BUY', 'SELL'] as const;
export type LevelCondition = (typeof LEVEL_CONDITIONS)[number];

export const CANDLE_RESOLUTION = '3m';
export const CANDLE_INTERVAL_MS = 3 * 60 * 1000;

export const STOP_LOSS_DEFAULT_OFFSET = 100;

export const TRADE_MANAGEMENT_SOURCE = 'trade-management-v2';

export const STOP_LOSS_STATUSES = ['none', 'pending', 'verified', 'failed', 'unavailable'] as const;
export type StopLossStatus = (typeof STOP_LOSS_STATUSES)[number];

export const MONITORING_STATUSES = [
  'pending',
  'active',
  'suspended',
  'orphaned',
  'closed',
] as const;
export type MonitoringStatus = (typeof MONITORING_STATUSES)[number];

export const LEVEL_STATUSES = [
  'inactive',
  'active',
  'monitoring',
  'touched',
  'hold',
  'error',
] as const;
export type LevelStatus = (typeof LEVEL_STATUSES)[number];

export const LEVEL_MONITORING_STATES = [
  'idle',
  'waiting_for_stop',
  'monitoring',
  'triggered',
  'waiting_next_candle',
  'evaluating',
  'hold',
  'error',
] as const;
export type LevelMonitoringState = (typeof LEVEL_MONITORING_STATES)[number];

export const INTERACTION_STATES = ['open', 'closed', 'expired', 'error'] as const;
export type InteractionState = (typeof INTERACTION_STATES)[number];

export interface DeltaProduct {
  id: number;
  symbol: string;
  tick_size: string;
  contract_value: string;
  contract_unit_currency: string;
  state: string;
  trading_status: string;
  contract_type: string;
  position_size_limit: number | null;
  product_specs?: {
    only_reduce_only_orders_allowed?: boolean;
  };
}

export interface DeltaPosition {
  user_id: number;
  size: number;
  entry_price: string;
  margin: string;
  liquidation_price: string;
  bankruptcy_price: string;
  adl_level: number;
  product_id: number;
  product_symbol: string;
  product?: DeltaProduct;
  commission?: string;
  realized_pnl?: string;
  unrealized_pnl?: string;
  unrealized_pnl_currency?: string;
  mark_price?: string;
  margin_mode?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DeltaOrder {
  id: number;
  product_id: number;
  product_symbol: string;
  side: 'buy' | 'sell';
  size: number;
  unfilled_size: number;
  average_fill_price: string;
  limit_price: string | null;
  stop_price: string | null;
  stop_order_type: string | null;
  stop_trigger_method: string | null;
  order_type: string;
  state: string;
  reduce_only: boolean;
  client_order_id: string | null;
  bracket_order?: unknown;
  created_at?: string;
  updated_at?: string;
}

export interface DeltaCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code?: string;
    message?: string;
    context?: Record<string, unknown>;
  };
}

export interface ApiSuccessResponse<T> {
  success: true;
  result: T;
  meta?: {
    after?: string | null;
    before?: string | null;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface TradeRecord {
  id: string;
  productId: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  size: number;
  entryPrice: number;
  markPrice: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlCurrency: string | null;
  liquidationPrice: number | null;
  stopLossOrderId: string | null;
  stopLossPrice: number | null;
  stopLossStatus: StopLossStatus;
  monitoringStatus: MonitoringStatus;
  discordChannelId: string | null;
  discordMessageId: string | null;
  lastEvent: string | null;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

export interface LevelRecord {
  id: string;
  tradeId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  levelPrice: number;
  condition: LevelCondition;
  status: LevelStatus;
  monitoringState: LevelMonitoringState;
  triggerCandleTs: number | null;
  nextCandleTs: number | null;
  lastProcessedCandleTs: number | null;
  holdCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessedCandleRecord {
  levelId: string;
  candleTs: number;
  decision: string;
  createdAt: string;
}

export interface TradeInteractionRecord {
  id: string;
  tradeId: string;
  type: string;
  state: InteractionState;
  userId: string | null;
  channelId: string | null;
  messageId: string | null;
  data: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClosePositionRequest {
  tradeId: string;
  productId: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  size: number;
  reduceOnly: boolean;
  reason: string;
}

export interface StopLossRequest {
  tradeId: string;
  productId: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  stopPrice: number;
  size: number;
}

export interface CandleDecision {
  levelId: string;
  tradeId: string;
  candleTs: number;
  close: number;
  levelPrice: number;
  condition: LevelCondition;
  action: 'close' | 'hold';
  reason: string;
}

export interface LevelEvaluationContext {
  level: LevelRecord;
  trade: TradeRecord;
  candle: DeltaCandle;
}
