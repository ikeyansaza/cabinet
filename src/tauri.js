// Tauri API への薄いラッパ。frontend の他ファイルからはここ経由で呼ぶ。
// プラグイン機能は Rust コマンド経由で公開しているので、ここでは
// window.__TAURI__.core / .event だけ使う。
const T = window.__TAURI__;

if (!T) {
  console.warn('[album] Tauri 環境外で起動されています。フォルダ選択はスキップされます。');
}

export const isTauri = !!T;

export async function invoke(cmd, args) {
  if (!T) return undefined;
  return T.core.invoke(cmd, args);
}

export async function listen(event, handler) {
  if (!T) return () => {};
  return T.event.listen(event, handler);
}

export function convertFileSrc(absPath) {
  if (!T) return absPath;
  return T.core.convertFileSrc(absPath);
}

export async function pickFolder() {
  return await invoke('pick_folder');
}
