import { AlertCondition } from './types';

const VALID_CONDITIONS: AlertCondition[] = [
  'crossed_above',
  'crossed_below',
  'reaches_or_above',
  'reaches_or_below',
];

export function isValidSymbol(symbol: string): boolean {
  return typeof symbol === 'string' && /^[A-Z0-9_]+$/.test(symbol) && symbol.length <= 32;
}

export function isValidCondition(condition: string): condition is AlertCondition {
  return VALID_CONDITIONS.includes(condition as AlertCondition);
}

export function isValidTargetPrice(price: unknown): boolean {
  return typeof price === 'number' && Number.isFinite(price) && price > 0;
}

export function isValidChannelId(channelId: string): boolean {
  return typeof channelId === 'string' && /^\d{10,}$/.test(channelId);
}

export function validateAlertInput(input: {
  symbol: string;
  condition: string;
  targetPrice: number;
  discordChannelId: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!isValidSymbol(input.symbol)) {
    errors.push('symbol must be a non-empty alphanumeric string (max 32 chars)');
  }
  if (!isValidCondition(input.condition)) {
    errors.push(`condition must be one of: ${VALID_CONDITIONS.join(', ')}`);
  }
  if (!isValidTargetPrice(input.targetPrice)) {
    errors.push('targetPrice must be a positive finite number');
  }
  if (!isValidChannelId(input.discordChannelId)) {
    errors.push('discordChannelId must be a valid Discord channel ID (numeric, 10+ digits)');
  }

  return { valid: errors.length === 0, errors };
}
