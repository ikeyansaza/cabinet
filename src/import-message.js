// 取り込み結果（{imported, skipped}）から、画面に出す一言を作る純粋関数。

/** ファイル名から「.heic」形式の拡張子（小文字）を返す。無ければ null */
function extOf(name) {
  const i = String(name).lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i).toLowerCase() : null;
}

/** @returns {{text:string, kind:'ok'|'warn'}|null} 対象が何も無ければ null */
export function importMessage(result) {
  const imported = (result && result.imported) || [];
  const skipped = (result && result.skipped) || [];
  if (!imported.length && !skipped.length) return null;
  if (!skipped.length) return { text: `${imported.length} 枚追加しました`, kind: 'ok' };

  // 非対応形式は重複を除いて出現順に並べる
  const exts = [];
  for (const n of skipped) {
    const e = extOf(n) || '拡張子なし';
    if (!exts.includes(e)) exts.push(e);
  }
  const reason = `（非対応形式: ${exts.join(', ')}）`;
  const head = imported.length
    ? `${imported.length} 枚追加 · ${skipped.length} 枚スキップ`
    : `${skipped.length} 枚スキップ`;
  return { text: head + reason, kind: 'warn' };
}
