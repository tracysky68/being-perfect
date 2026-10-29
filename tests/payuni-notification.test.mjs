import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPayuniNotification as classify } from '../supabase/functions/_shared/payuni-notification.ts';
import { encryptPayuni, decryptPayuni, payuniHash, secureEqual } from '../supabase/functions/_shared/payuni.ts';

const message = {
  outerStatus: 'SUCCESS', merchantId: 'MERCHANT', orderNumber: 'ORDER-1',
  amountTwd: 660, currentStatus: 'created', currentTradeNumber: null,
  details: { MerID: 'MERCHANT', MerTradeNo: 'ORDER-1', TradeAmt: '660', TradeStatus: '1', TradeNo: 'UNI-1' },
};

test('paid requires both outer success and a paid decrypted trade with a UNI number', () => {
  assert.equal(classify(message).kind, 'paid');
  for (const change of [
    { outerStatus: 'ERROR' }, { outerStatus: undefined },
    { details: { ...message.details, TradeStatus: '0' } },
    { details: { ...message.details, TradeNo: '' } },
    { details: { ...message.details, TradeStatus: undefined } },
  ]) assert.notEqual(classify({ ...message, ...change }).kind, 'paid');
});

test('pending, failed and cancelled are distinct from paid', () => {
  assert.equal(classify({ ...message, details: { ...message.details, TradeStatus: '0' } }).kind, 'pending');
  assert.equal(classify({ ...message, details: { ...message.details, Status: 'SUCCESS', TradeStatus: '0' } }).kind, 'pending');
  assert.equal(classify({ ...message, details: { ...message.details, TradeStatus: '2' } }).kind, 'failed');
  assert.equal(classify({ ...message, details: { ...message.details, TradeStatus: '3' } }).kind, 'failed');
  assert.equal(classify({ ...message, details: { ...message.details, TradeStatus: '9' } }).kind, 'review');
});

test('merchant, order, amount and message type must match before any status decision', () => {
  for (const details of [
    { ...message.details, MerID: 'OTHER' },
    { ...message.details, MerTradeNo: 'OTHER' },
    { ...message.details, TradeAmt: '13800' },
    { ...message.details, TradeAmt: '660.00' },
    { ...message.details, ApiType: 'ShipStatus' },
  ]) assert.equal(classify({ ...message, details }).kind, 'review');
});

test('a duplicate paid notice is idempotent; later failed or conflicting notices cannot downgrade it', () => {
  const verified = { ...message, currentStatus: 'verified', currentTradeNumber: 'UNI-1' };
  assert.equal(classify(verified).kind, 'duplicate_paid');
  assert.equal(classify({ ...verified, details: { ...message.details, TradeStatus: '2' } }).kind, 'review');
  assert.equal(classify({ ...verified, details: { ...message.details, TradeNo: 'UNI-2' } }).kind, 'review');
  assert.equal(classify({ ...verified, currentTradeNumber: null }).kind, 'review');
});

test('synthetic encrypted callback keeps pending as pending after hash and decrypt', async () => {
  const key = 'k'.repeat(32), iv = 'i'.repeat(16);
  const encrypted = await encryptPayuni({ ...message.details, TradeStatus: '0' }, key, iv);
  const hash = await payuniHash(encrypted, key, iv);
  assert.equal(secureEqual(hash, await payuniHash(encrypted, key, iv)), true);
  assert.equal(secureEqual(hash, await payuniHash(encrypted.slice(0, -2) + '00', key, iv)), false);
  const details = await decryptPayuni(encrypted, key, iv);
  assert.equal(classify({ ...message, details }).kind, 'pending');
  assert.equal(classify({ ...message, details, outerStatus: 'ERROR' }).kind, 'review');
});
