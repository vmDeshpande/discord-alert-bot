export function parseTradeCustomId(customId: string): { tradeId: string } | null {
  const parts = customId.split(':');
  if (parts.length !== 3) return null;
  if (parts[0] !== 'manage' || parts[1] !== 'trade') return null;
  const tradeId = parts[2];
  if (!tradeId) return null;
  return { tradeId };
}

export function buildManageCustomId(tradeId: string): string {
  return `manage:trade:${tradeId}`;
}
