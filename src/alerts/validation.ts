export function isValidTargetPrice(price: unknown): boolean {
  return typeof price === 'number' && Number.isFinite(price) && price > 0;
}

export function validateAlertInput(input: {
  price: unknown;
  channelId: string;
  ethChannelId: string;
  solChannelId: string;
  symbol: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!isValidTargetPrice(input.price)) {
    errors.push('price must be a positive finite number');
  }

  const validChannelIds = [input.ethChannelId, input.solChannelId].filter(Boolean);
  if (!validChannelIds.includes(input.channelId)) {
    errors.push('Price alerts can only be configured in #ETHUSD or #SOLUSD.');
  }

  return { valid: errors.length === 0, errors };
}
