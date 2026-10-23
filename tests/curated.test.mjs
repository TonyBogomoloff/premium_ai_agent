import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { Catalog } from '../server/catalog.mjs';

test('Shared selection does not consume personal pack allowance', async () => {
  const store = new Store(':memory:');
  try {
    for (let i=0;i<32;i++) store.pack(0,{name:`shared${i}`,title:'Shared',emojis:[]});
    const catalog = new Catalog(store,{call:async(method,{name})=>({name,title:name,sticker_type:'custom_emoji',stickers:[]})},'/tmp');
    assert.equal(store.personalPackCount(10),0);
    for (let i=0;i<24;i++) await catalog.add(10,`personal${i}`);
    assert.equal(store.personalPackCount(10),24);
    await catalog.add(10,'personal0');
    await catalog.add(10,'shared0');
    await assert.rejects(catalog.add(10,'overflow'),/24/);
    assert.equal(store.packs(11).length,32);
    assert.equal(store.packs(10).length,56);
  } finally { store.db.close(); }
});
