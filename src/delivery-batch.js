export function restoreBatch(batch = []) {
  return batch.map(item => ({ ...item, status: item.status === 'sending' ? 'unknown' : item.status }));
}

export async function deliverBatch(items, send, save) {
  for (const item of items) {
    if (item.status !== 'queued') continue;
    item.status = 'sending';
    // Persist before any network side effect; a reload must never resend it.
    save();
    try {
      const result = await send(item);
      if (!result.sent) throw Object.assign(new Error('Результат не подтверждён'), { code: 'delivery_unknown' });
      item.status = 'sent'; item.warning = result.emojiDelivery?.preserved === false;
    } catch (error) {
      item.status = ['delivery_unknown', 'network_error'].includes(error.code) ? 'unknown' : 'failed';
      item.error = error.message;
    }
    save();
  }
  return items;
}
