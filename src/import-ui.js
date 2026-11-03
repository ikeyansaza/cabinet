// 画像のドラッグ&ドロップ取り込み UI（ES module）。
// コピーは Rust の import_photos が行い、画面の更新は watcher の photos-updated に任せる。
// ここでは「ドロップ中の枠」と「結果の一言」だけを担当する。
import { invoke, listen } from './tauri.js';
import { importMessage } from './import-message.js';

const toast = document.getElementById('import-toast');
let hideTimer = null;

const picker = document.getElementById('picker');

/** 取り込めるのは gallery が見えているときだけ。
 *  visits モード中、またはフォルダ選択画面（gallery.js がフォルダ指定として扱う）では動かない */
const active = () => document.body.dataset.mode !== 'visits' && !(picker && !picker.hidden);

function showToast({ text, kind }) {
  toast.textContent = text;
  toast.dataset.kind = kind;
  toast.hidden = false;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { toast.hidden = true; }, kind === 'warn' ? 6000 : 3000);
}

function setDragging(on) {
  document.body.classList.toggle('dragging-files', on && active());
}

listen('tauri://drag-enter', () => setDragging(true));
listen('tauri://drag-leave', () => setDragging(false));
listen('tauri://drag-drop', async (ev) => {
  setDragging(false);
  if (!active()) return;
  const paths = ev && ev.payload && ev.payload.paths;
  if (!paths || !paths.length) return;
  try {
    const msg = importMessage(await invoke('import_photos', { paths }));
    if (msg) showToast(msg);
  } catch (e) {
    console.warn('[album] import_photos failed', e);
    showToast({ text: '取り込みに失敗しました', kind: 'warn' });
  }
});
