import { validatePriceAgainstTick } from '../src/tradeManagement/priceValidation';

describe('Price validation', () => {
  it('rejects non-finite/non-positive', () => {
    expect(validatePriceAgainstTick(NaN, { tick_size: '0.1' } as any).valid).toBe(false);
    expect(validatePriceAgainstTick(0, { tick_size: '0.1' } as any).valid).toBe(false);
    expect(validatePriceAgainstTick(-1, { tick_size: '0.1' } as any).valid).toBe(false);
  });

  it('rejects when metadata missing', () => {
    const res = validatePriceAgainstTick(100, null);
    expect(res.valid).toBe(false);
  });

  it('rejects invalid tick', () => {
    const res = validatePriceAgainstTick(100, { tick_size: '0' } as any);
    expect(res.valid).toBe(false);
  });

  it('rejects misaligned price', () => {
    const res = validatePriceAgainstTick(100.05, { tick_size: '0.1' } as any);
    expect(res.valid).toBe(false);
  });

  it('accepts aligned price', () => {
    const res = validatePriceAgainstTick(100.1, { tick_size: '0.1' } as any);
    expect(res.valid).toBe(true);
  });
});
