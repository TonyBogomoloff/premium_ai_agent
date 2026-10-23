import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverBatch, restoreBatch } from '../src/delivery-batch.js';

test('Partial batch records each result and never repeats sent or uncertain recipients', async () => {
  const items = ['ok', 'rejected', 'timeout'].map(key => ({ key, requestId: key, status: 'queued' }));
  const calls = []; let saved;
  const send = async item => {
    assert.equal(saved.find(x => x.key === item.key).status, 'sending');
    calls.push(item.key);
    if (item.key !== 'ok') throw Object.assign(new Error('failure'), { code: item.key === 'timeout' ? 'network_error' : 'telegram_rejected' });
    return { sent: true, emojiDelivery: { preserved: false } };
  };
  const save = () => { saved = structuredClone(items); };
  await deliverBatch(items, send, save);
  assert.deepEqual(items.map(x => x.status), ['sent', 'failed', 'unknown']);
  assert.equal(items[0].warning, true);
  await deliverBatch(items, send, save);
  assert.deepEqual(calls, ['ok', 'rejected', 'timeout']);
});

test('Interrupted sending restores as unknown; storage failure prevents network send', async () => {
  assert.deepEqual(restoreBatch([{status:'sent'}, {status:'sending'}, {status:'queued'}]).map(x => x.status), ['sent','unknown','queued']);
  let sends = 0;
  await assert.rejects(deliverBatch([{status:'queued'}], async () => { sends++; }, () => { throw Error('storage'); }), /storage/);
  assert.equal(sends, 0);
});
