import { evaluateAlert, shouldMonitorSymbol } from '../src/alerts/engine';
import { AlertConfig, PriceUpdate } from '../src/alerts/types';
import { validateAlertInput } from '../src/alerts/validation';

describe('Alert Engine', () => {
  const baseAlert: AlertConfig = {
    id: 'test-alert-1',
    symbol: 'BTCUSD',
    condition: 'crossed_above',
    targetPrice: 100000,
    discordChannelId: '123456789012345678',
    enabled: true,
    triggered: false,
    createdAt: '2024-01-01T00:00:00Z',
    triggeredAt: null,
  };

  describe('Price crosses above target', () => {
    it('should trigger when price crosses above target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_above' };
      const priceUpdate: PriceUpdate = { symbol: 'BTCUSD', price: 100020, timestamp: Date.now() };
      const result = evaluateAlert(alert, priceUpdate, 99950);
      expect(result.triggered).toBe(true);
    });

    it('should not trigger when price is already above target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_above' };
      const priceUpdate: PriceUpdate = { symbol: 'BTCUSD', price: 100020, timestamp: Date.now() };
      const result = evaluateAlert(alert, priceUpdate, 100050);
      expect(result.triggered).toBe(false);
    });

    it('should not trigger when price is below target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_above' };
      const priceUpdate: PriceUpdate = { symbol: 'BTCUSD', price: 99900, timestamp: Date.now() };
      const result = evaluateAlert(alert, priceUpdate, 99950);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Price crosses below target', () => {
    it('should trigger when price crosses below target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_below' };
      const priceUpdate: PriceUpdate = { symbol: 'BTCUSD', price: 99980, timestamp: Date.now() };
      const result = evaluateAlert(alert, priceUpdate, 100050);
      expect(result.triggered).toBe(true);
    });

    it('should not trigger when price is already below target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_below' };
      const priceUpdate: PriceUpdate = { symbol: 'BTCUSD', price: 99900, timestamp: Date.now() };
      const result = evaluateAlert(alert, priceUpdate, 99800);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Price reaches or above target', () => {
    it('should trigger when price reaches target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'reaches_or_above' };
      const priceUpdate: PriceUpdate = { symbol: 'BTCUSD', price: 100000, timestamp: Date.now() };
      const result = evaluateAlert(alert, priceUpdate, 99950);
      expect(result.triggered).toBe(true);
    });

    it('should trigger when price is above target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'reaches_or_above' };
      const priceUpdate: PriceUpdate = { symbol: 'BTCUSD', price: 105000, timestamp: Date.now() };
      const result = evaluateAlert(alert, priceUpdate, 99000);
      expect(result.triggered).toBe(true);
    });

    it('should not trigger when price is below target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'reaches_or_above' };
      const priceUpdate: PriceUpdate = { symbol: 'BTCUSD', price: 95000, timestamp: Date.now() };
      const result = evaluateAlert(alert, priceUpdate, 94000);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Price reaches or below target', () => {
    it('should trigger when price reaches target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'reaches_or_below' };
      const priceUpdate: PriceUpdate = { symbol: 'BTCUSD', price: 95000, timestamp: Date.now() };
      const result = evaluateAlert(alert, priceUpdate, 100000);
      expect(result.triggered).toBe(true);
    });

    it('should trigger when price is below target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'reaches_or_below' };
      const priceUpdate: PriceUpdate = { symbol: 'BTCUSD', price: 80000, timestamp: Date.now() };
      const result = evaluateAlert(alert, priceUpdate, 90000);
      expect(result.triggered).toBe(true);
    });

    it('should not trigger when price is above target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'reaches_or_below' };
      const priceUpdate: PriceUpdate = { symbol: 'BTCUSD', price: 105000, timestamp: Date.now() };
      const result = evaluateAlert(alert, priceUpdate, 110000);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Price jumping over target', () => {
    it('should trigger crossed_above even when price jumps over target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_above' };
      const priceUpdate: PriceUpdate = { symbol: 'BTCUSD', price: 105000, timestamp: Date.now() };
      const result = evaluateAlert(alert, priceUpdate, 95000);
      expect(result.triggered).toBe(true);
    });

    it('should trigger crossed_below even when price drops below target', () => {
      const alert: AlertConfig = { ...baseAlert, condition: 'crossed_below' };
      const priceUpdate: PriceUpdate = { symbol: 'BTCUSD', price: 85000, timestamp: Date.now() };
      const result = evaluateAlert(alert, priceUpdate, 105000);
      expect(result.triggered).toBe(true);
    });
  });

  describe('Alert deduplication', () => {
    it('should not trigger if alert is already triggered', () => {
      const alert: AlertConfig = { ...baseAlert, triggered: true };
      const priceUpdate: PriceUpdate = { symbol: 'BTCUSD', price: 105000, timestamp: Date.now() };
      const result = evaluateAlert(alert, priceUpdate, 100000);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Disabled alerts', () => {
    it('should not trigger disabled alerts', () => {
      const alert: AlertConfig = { ...baseAlert, enabled: false };
      const priceUpdate: PriceUpdate = { symbol: 'BTCUSD', price: 105000, timestamp: Date.now() };
      const result = evaluateAlert(alert, priceUpdate, 95000);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Symbol filtering', () => {
    it('should return true for matching symbol', () => {
      const alert: AlertConfig = { ...baseAlert };
      expect(shouldMonitorSymbol(alert, 'BTCUSD')).toBe(true);
    });

    it('should return false for non-matching symbol', () => {
      const alert: AlertConfig = { ...baseAlert };
      expect(shouldMonitorSymbol(alert, 'ETHUSD')).toBe(false);
    });

    it('should return false for disabled alerts', () => {
      const alert: AlertConfig = { ...baseAlert, enabled: false };
      expect(shouldMonitorSymbol(alert, 'BTCUSD')).toBe(false);
    });

    it('should return false for triggered alerts', () => {
      const alert: AlertConfig = { ...baseAlert, triggered: true };
      expect(shouldMonitorSymbol(alert, 'BTCUSD')).toBe(false);
    });
  });

  describe('Validation', () => {
    it('should validate correct input', () => {
      const result = validateAlertInput({
        symbol: 'BTCUSD',
        condition: 'crossed_above',
        targetPrice: 100000,
        discordChannelId: '123456789012345678',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid symbol', () => {
      const result = validateAlertInput({
        symbol: 'btc$%',
        condition: 'crossed_above',
        targetPrice: 100000,
        discordChannelId: '123456789012345678',
      });
      expect(result.valid).toBe(false);
    });

    it('should reject invalid condition', () => {
      const result = validateAlertInput({
        symbol: 'BTCUSD',
        condition: 'invalid_condition',
        targetPrice: 100000,
        discordChannelId: '123456789012345678',
      });
      expect(result.valid).toBe(false);
    });

    it('should reject invalid target price', () => {
      const result = validateAlertInput({
        symbol: 'BTCUSD',
        condition: 'crossed_above',
        targetPrice: -100,
        discordChannelId: '123456789012345678',
      });
      expect(result.valid).toBe(false);
    });

    it('should reject invalid channel ID', () => {
      const result = validateAlertInput({
        symbol: 'BTCUSD',
        condition: 'crossed_above',
        targetPrice: 100000,
        discordChannelId: 'abc',
      });
      expect(result.valid).toBe(false);
    });
  });
});
