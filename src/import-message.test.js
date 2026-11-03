import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importMessage } from './import-message.js';

test('取り込めた枚数を出す', () => {
  assert.deepEqual(importMessage({ imported: ['a.jpg', 'b.jpg'], skipped: [] }),
    { text: '2 枚追加しました', kind: 'ok' });
});

test('非対応ファイルは拡張子付きでスキップ理由を出す', () => {
  assert.deepEqual(importMessage({ imported: ['a.jpg'], skipped: ['x.HEIC'] }),
    { text: '1 枚追加 · 1 枚スキップ（非対応形式: .heic）', kind: 'warn' });
});

test('全部スキップなら追加0とは言わずスキップだけ出す', () => {
  assert.deepEqual(importMessage({ imported: [], skipped: ['a.heic', 'b.HEIC', 'c.gif'] }),
    { text: '3 枚スキップ（非対応形式: .heic, .gif）', kind: 'warn' });
});

test('拡張子が無いファイルは「拡張子なし」', () => {
  assert.equal(importMessage({ imported: [], skipped: ['README'] }).text,
    '1 枚スキップ（非対応形式: 拡張子なし）');
});

test('何も対象が無ければ null（通知しない）', () => {
  assert.equal(importMessage({ imported: [], skipped: [] }), null);
  assert.equal(importMessage(undefined), null);
});
