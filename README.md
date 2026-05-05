# cabinet

個人用デスクトップギャラリー兼コレクション（macOS / Tauri 2）。
動物・絵画・彫刻・食事など、自分が眺めたいものを並べる「驚異の部屋（cabinet of curiosities）」。
mokomoko デザインシステム準拠。公開せず、自分の Mac でだけ動かす想定。

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

初回起動時にライブラリ root（例 `~/Pictures/album/`）を picker から選択する。
その下に `animals/`, `arts/`, `food/` などのサブフォルダを作り、
それぞれの中に写真と `photos.json` / `species.json` を置く。

```text
~/Pictures/album/
├── animals/
│   ├── photos.json
│   ├── species.json
│   └── IMG_*.jpg
└── arts/
    ├── photos.json
    ├── species.json
    └── IMG_*.jpg
```

ヘッダーのタブでカテゴリを切替。新しい写真をフォルダに追加すると 500ms デバウンスで自動再スキャン。

## ビルド（リリース版）

初回ビルド + symlink 設置（一度だけ）：

```bash
npm run tauri build
# → src-tauri/target/release/bundle/macos/cabinet.app

# /Applications/ から symlink で参照（rebuild するだけで反映される運用）
ln -sf "$PWD/src-tauri/target/release/bundle/macos/cabinet.app" \
       /Applications/cabinet.app
```

署名なしなので初回起動は `/Applications/cabinet.app` を **右クリック → 開く** で Gatekeeper を一度だけ許可する。次回以降は通常通りダブルクリックで起動。

## アプリの更新

ソースを修正した後：

```bash
cabinet-update
```

`~/.zshrc` で `alias cabinet-update="cd ~/repositories/my-album && npm run tauri build"` を定義済み。

`/Applications/cabinet.app` は symlink なので rebuild 完了後に再起動するだけで新版が立ち上がる（コピー不要）。

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
python scripts/gen_photos.py --photos-dir ~/Pictures/cabinet/
```

詳細は `python scripts/gen_photos.py --help`。

## 設計ドキュメント

- `docs/superpowers/specs/` に設計
- `docs/superpowers/plans/` に実装プラン
