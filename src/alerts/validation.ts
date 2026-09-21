export function isValidTargetPrice(price: unknown): boolean {
  return typeof price === 'number' && Number.isFinite(price) && price > 0;
}
