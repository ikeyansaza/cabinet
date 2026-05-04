# album

動物写真の個人用デスクトップギャラリー（macOS / Tauri 2）。
公開せず、自分の Mac でだけ動かす想定。

## 必要なもの

- macOS
- Node 20+ / npm
- Rust（rustup 推奨）
- Xcode Command Line Tools

未インストールなら：

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
xcode-select --install
```

## 開発

```bash
npm install            # 初回のみ
npm run tauri dev
```

初回起動時にフォトフォルダ（例 `~/Pictures/album/`）を picker から選択する。
そのフォルダに写真と `photos.json` / `species.json` を置く運用。
新しい写真をフォルダに追加すると 500ms デバウンスで自動再スキャン。

## ビルド（リリース版）

```bash
npm run tauri build
# → src-tauri/target/release/bundle/macos/album.app
```

生成された `album.app` を `/Applications/` にコピー。
署名なしなので初回起動は右クリック → 開く で Gatekeeper を許可。

## ショートカット

| キー | 動作 |
|---|---|
| Cmd+O | フォルダ選択ダイアログ |
| Cmd+R | 手動 rescan |
| Cmd+W | ウィンドウを閉じる |
| Cmd+Q | アプリ終了 |
| ← / → | ライトボックス内でナビ |
| Esc | ライトボックスを閉じる |

## CLI: gen_photos.py（任意）

Tauri アプリの内蔵 rescan が `photos.json` を生成・更新するので、
通常は不要。CLI で生成したい場合のみ：

```bash
pip install piexif pillow
python scripts/gen_photos.py --photos-dir ~/Pictures/album/
```

詳細は `python scripts/gen_photos.py --help`。

## 設計ドキュメント

- `docs/superpowers/specs/` に設計
- `docs/superpowers/plans/` に実装プラン
