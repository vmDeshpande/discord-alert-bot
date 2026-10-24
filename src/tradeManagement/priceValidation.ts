import { DeltaProduct } from '../types';

export function validatePriceAgainstTick(
  price: number,
  product: DeltaProduct | null,
): { valid: boolean; reason?: string } {
  if (!Number.isFinite(price) || price <= 0) {
    return { valid: false, reason: 'Price must be a positive finite number.' };
  }
  if (!product || !product.tick_size) {
    return {
      valid: false,
      reason: 'Instrument metadata unavailable; price increment validation failed.',
    };
  }
  const tick = Number(product.tick_size);
  if (!Number.isFinite(tick) || tick <= 0) {
    return { valid: false, reason: 'Invalid instrument tick size.' };
  }
  const ratio = price / tick;
  if (!Number.isFinite(ratio)) {
    return { valid: false, reason: 'Invalid price.' };
  }
  const rounded = Math.round(ratio);
  if (Math.abs(ratio - rounded) > 1e-9) {
    return { valid: false, reason: `Price must be a multiple of tick size ${tick}.` };
  }
  return { valid: true };
}
