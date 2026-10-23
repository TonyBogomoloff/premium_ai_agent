import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const tiptapRequire = createRequire(require.resolve('@tiptap/core'));
const { Schema } = tiptapRequire('@tiptap/pm/model');
const { EditorState, TextSelection } = tiptapRequire('@tiptap/pm/state');
import { attachClipboard } from '../src/clipboard.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' }, paragraph: { content: 'inline*' },
    text: { group: 'inline' },
    customEmoji: { inline: true, group: 'inline', atom: true, attrs: { id: {}, alt: {} } },
  },
  marks: { bold: {} },
});
function fixture(t, clipboard) {
  const buttons = Object.fromEntries(['cut', 'copy', 'paste'].map(id => [id, { addEventListener() {} }]));
  for (const [key, value] of Object.entries({
    document: { getElementById: id => buttons[id], execCommand: () => false },
    navigator: { clipboard }, window: {},
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [
    schema.text('Hello', [schema.mark('bold')]),
    schema.node('customEmoji', { id: '123', alt: '✨' }),
  ])]);
  const messages = [];
  const editor = {
    state: EditorState.create({ doc, selection: TextSelection.create(doc, 1, 7) }),
    view: {
      focus() {},
      serializeForClipboard: () => ({ dom: { outerHTML: '<b>Hello</b>✨' }, text: 'Hello✨' }),
      dispatch(tr) { editor.state = editor.state.apply(tr); },
      pasteText(text) { editor.view.dispatch(editor.state.tr.insertText(text)); },
    },
    chain() { return { focus() { return this; }, deleteSelection() { return this; }, run() { editor.view.dispatch(editor.state.tr.deleteSelection()); } }; },
  };
  const attach = () => attachClipboard({ getEditor: () => editor, blocked: () => false, toast: message => messages.push(message) });
  attach();
  return { buttons, editor, doc, messages, attach };
}

test('cut/paste preserves formatting and custom emoji when system clipboard is denied', async t => {
  const f = fixture(t, { writeText: async () => { throw new Error('Denied'); }, read: async () => { throw new Error('Must not read'); } });
  await f.buttons.cut.onclick();
  assert.equal(f.editor.state.doc.textContent, '');
  await f.buttons.paste.onclick();
  assert.deepEqual(f.editor.state.doc.toJSON(), f.doc.toJSON());
  assert.match(f.messages[0], /внутри редактора/);
});

test('copy also writes to system clipboard and internal paste survives external clipboard changes', async t => {
  let written;
  const f = fixture(t, { writeText: async text => { written = text; }, readText: async () => 'external' });
  await f.buttons.copy.onclick();
  assert.equal(written, 'Hello✨');
  assert.deepEqual(f.editor.state.doc.toJSON(), f.doc.toJSON());
  await f.buttons.paste.onclick();
  assert.deepEqual(f.editor.state.doc.toJSON(), f.doc.toJSON());
  f.attach(); // A fresh session has no internal clipboard.
  await f.buttons.paste.onclick();
  assert.equal(f.editor.state.doc.textContent, 'Helloexternal');
});

test('delayed clipboard write does not cut a changed document', async t => {
  let resolve;
  const f = fixture(t, { writeText: () => new Promise(r => { resolve = r; }) });
  const pending = f.buttons.cut.onclick();
  f.editor.view.dispatch(f.editor.state.tr.insertText('changed'));
  resolve();
  await pending;
  assert.equal(f.editor.state.doc.textContent, 'changed');
  assert.match(f.messages[0], /вырезание отменено/);
});
