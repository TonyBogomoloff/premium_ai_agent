export function attachClipboard({ getEditor, blocked, toast }) {
  let busy = false;
  // Session-only: never persist clipboard contents or send them to the server.
  let internalClipboard = null;
  for (const action of ['cut', 'copy', 'paste']) {
    const button = document.getElementById(action);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.onclick = async () => {
      const editor = getEditor();
      if (!editor || blocked() || busy || (action !== 'paste' && editor.state.selection.empty)) return;
      const { doc, selection } = editor.state;
      const unchanged = () => !blocked() && editor.state.doc.eq(doc) && editor.state.selection.eq(selection);
      busy = true;
      try {
        if (action === 'paste') {
          if (internalClipboard) {
            editor.view.focus();
            editor.view.dispatch(editor.state.tr.replaceSelection(internalClipboard).scrollIntoView());
            return;
          }
          let html = '', text = '';
          if (navigator.clipboard?.read) {
            const items = await navigator.clipboard.read();
            for (const item of items) {
              if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
              if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
              if (html || text) break;
            }
          } else if (navigator.clipboard?.readText) text = await navigator.clipboard.readText();
          else throw new Error('Clipboard unavailable');
          if (!unchanged()) { toast('Текст или выделение изменились. Нажми «Вставить» ещё раз.'); return; }
          if (!html && !text) { toast('В буфере нет текста.'); return; }
          editor.view.focus();
          if (html) editor.view.pasteHTML(html);
          else editor.view.pasteText(text);
        } else {
          const slice = selection.content();
          const { dom, text } = editor.view.serializeForClipboard(slice);
          internalClipboard = slice;
          let systemCopied = false;
          let plainOnly = false;
          try {
            if (navigator.clipboard?.write && window.ClipboardItem) {
              await navigator.clipboard.write([new ClipboardItem({
                'text/html': new Blob([dom.outerHTML], { type: 'text/html' }),
                'text/plain': new Blob([text], { type: 'text/plain' }),
              })]);
              systemCopied = true;
            } else {
              editor.view.focus();
              systemCopied = document.execCommand('copy');
            }
          } catch { /* Internal copy remains usable if the system denies access. */ }
          if (!systemCopied && navigator.clipboard?.writeText) {
            try {
              await navigator.clipboard.writeText(text);
              systemCopied = true;
              plainOnly = true;
            } catch { /* System clipboard access is optional. */ }
          }
          if (action === 'cut') {
            if (!unchanged()) { toast('Скопировано. Текст изменился, поэтому вырезание отменено.'); return; }
            editor.chain().focus().deleteSelection().run();
          }
          const label = action === 'cut' ? 'Вырезано' : 'Скопировано';
          toast(!systemCopied ? `${label} внутри редактора. Нажми «Вставить».` : plainOnly ? `${label}. В системный буфер записан текст без оформления.` : label);
        }
      } catch {
        toast(action === 'paste' ? 'Для вставки из другого приложения зажми поле текста и выбери «Вставить».' : 'Не удалось скопировать. Используй меню выделения текста.', true);
      } finally { busy = false; }
    };
  }
}
