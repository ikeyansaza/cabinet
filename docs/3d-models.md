# 3D モデル拡張ガイド

cabinet の各 species に 3D モデル（`.glb`）を紐付ける際の取得元・ライセンス・自作コストをまとめたもの。

PR #1（2026-05-06）で `<model-viewer>` ベースのビューア機構を導入済み。本ドキュメントはモデル収集を進めるときの参考。

---

## cabinet が要求するファイル要件

| 項目 | 要件 |
|---|---|
| フォーマット | `.glb`（glTF 2.0 binary）。`.gltf` + 別ファイルテクスチャは未対応 |
| 配置 | `<category>/models/<species_id>.glb`（例 `animals/models/kingfisher.glb`） |
| サイズ目安 | 1〜10MB 推奨。50MB 超はライトボックスでの読み込みが体感もたつく |
| ポリゴン数目安 | 5万〜30万ポリゴン程度。高すぎると WebGL でのインタラクションが重くなる |
| テクスチャ | 1024〜2048px が無難。4K 超は不要 |
| アニメーション | 静止モデル前提。アニメ付き glTF も再生は可能だが現在の UI には停止/再生ボタンが無い |

ファイルが大きい・遅い場合は [glTF-Transform](https://gltf-transform.dev/) のような CLI で圧縮できる（KTX2 / Draco）。

---

## ライセンス基礎

cabinet は **個人 Mac でしか動かさず公開しない** 運用なので、ライセンス上は緩く考えても実質問題は出ない。が、後で「これどこのモデルだっけ」となる事故を避けるため出典は必ず記録する方針にしておきたい。

### Creative Commons の種類（cabinet との相性）

| ライセンス | 改変 | 商用 | 表示義務 | cabinet で使えるか |
|---|---|---|---|---|
| **CC0** | OK | OK | 不要 | ◎（パブリックドメイン同等） |
| **CC-BY** | OK | OK | 必要 | ◎（要 credit 記録） |
| **CC-BY-SA** | OK | OK | 必要 + 派生も同ライセンス | ○（個人鑑賞のみなら問題なし） |
| **CC-BY-NC** | OK | NG | 必要 | ○（cabinet は非商用） |
| **CC-BY-ND** | NG | OK | 必要 | ○（モデル改変しないなら） |
| **All Rights Reserved** | — | — | — | ✕（基本的に避ける） |

### attribution の保存方針

`species.json` に `model_credit` フィールド（任意）を足して各モデルの出典を残しておくのを推奨:

```json
{
  "sheep": {
    "name_ja": "ヒツジ",
    "model": "models/sheep.glb",
    "model_credit": "Sheep by Poly by Google [CC-BY] via Poly Pizza"
  }
}
```

現状 gallery.js は `model_credit` を読まないので UI 表示はされない。表示まで対応したくなったら別 PR で軽量に追加可能（ライトボックスの 3D ビューア下に小さい灰色テキストで表示）。

リポジトリ全体での出典一覧を `docs/CREDITS.md` のような形で持つのも別解（ライセンス的には species.json か CREDITS.md のどちらかに残っていれば義務は果たせる）。

---

## 外部サービス比較

すべて 2026-05 時点。

### 無料・ログイン不要

| サービス | URL | ライセンス傾向 | 量 | 質 | 備考 |
|---|---|---|---|---|---|
| **Poly Pizza** | poly.pizza | CC-BY 中心 | 数千点 | 中（ローポリ系） | Google Poly の後継。スタイライズ調で統一感あり |
| **Quaternius** | quaternius.com | CC0 | パック単位で数百点 | 中（ローポリ） | Ultimate Animals Pack 等が有名 |
| **Smithsonian 3D** | 3d.si.edu | ほぼ CC0 | 数百点 | 高（博物館スキャン） | 化石・骨格・標本中心。生体動物は少ない |
| **Khronos Sample Assets** | github.com/KhronosGroup/glTF-Sample-Assets | 各種 CC | 100点程度 | 高 | テスト用標準モデル。Duck / Fox など |
| **NASA 3D Resources** | nasa3d.arc.nasa.gov | パブドメ | 数百点 | 高 | 宇宙系。動物無し |

### 無料・ログイン必要

| サービス | URL | ライセンス傾向 | 量 | 質 | 備考 |
|---|---|---|---|---|---|
| **Sketchfab** | sketchfab.com | CC0〜CC-BY-NC まで様々 | 数十万点 | **最高** | アカウント作成必須だが無料。生体動物が圧倒的に充実 |
| **Free3D** | free3d.com | 個別記載 | 数万点 | 中 | 質のばらつき大、ライセンス確認注意 |
| **CGTrader Free** | cgtrader.com | Royalty Free 等 | 数千点 | 中〜高 | Free 専用フィルタが必要 |

### Sketchfab で良いモデルを引く時のコツ

検索ページの左サイドバー:
1. **Downloadable**: ON
2. **License**: `CC Attribution` / `CC0` のどちらか選択
3. **Sort**: Best Match か Most Liked
4. **Faces**: 動物なら 50K 以下が WebGL に優しい

`.glb` 直 DL は「Download 3D Model → glTF (.glb)」を選ぶ。`Original` / `Source` だと Blender ファイル等が混じる。

---

## 自作の選択肢

### フォトグラメトリ（写真から 3D 化）

被写体を多角度から撮影し、ソフトが特徴点をマッチングして 3D 復元する手法。**動かない物体 / 自分の釣果 / 標本** に向く。生きた動物は不可。

| ツール | プラットフォーム | コスト | 向き |
|---|---|---|---|
| **Polycam** | iOS / Android / Web | 無料枠あり、Pro $15〜/月 | お手軽。LiDAR 搭載 iPhone なら精度 ↑ |
| **Apple Object Capture** | macOS + iPhone | 無料 | Apple 純正、高品質。Reality Composer Pro 経由 |
| **RealityScan** | iOS / Android | 無料 | Epic 製、無料で完結 |
| **Meshroom** | Windows / Linux | 無料・OSS | デスクトップ。重いが完全フリー |
| **Reality Capture** | Windows | 一定容量無料 / 従量課金 | プロ品質、最強。学習曲線急 |

**コスト感**: 
- iPhone 持っていれば追加費用 0 円から始められる
- Polycam 無料枠は撮影回数や書き出し制限あり。月数本で済む人は無料で十分
- 1 体あたりの作業時間: 撮影 5〜15 分、処理 5〜30 分（クラウド or ローカル）

**コツ**: 被写体を平らな単色背景に置き、周囲をゆっくり 1〜2 周。30〜100 枚程度の写真。光は均一に。

### AI 生成（テキスト or 画像から 3D）

| サービス | 入力 | コスト | 質 |
|---|---|---|---|
| **Meshy** | テキスト / 画像 | 無料 200 credit/月 程度、Pro $20〜/月 | 中〜高。改善が速い |
| **TripoSR** | 画像 | OSS（自分で動かせば無料、Hugging Face Spaces で試用可） | 中 |
| **Luma Genie** | テキスト | 無料ベータ → 有料移行中 | 中〜高 |
| **Rodin** | 画像 / テキスト | 無料枠 + 従量課金 | 高 |

**コスト感**:
- 月 5〜10 体生成なら無料枠で収まることが多い
- 28 体一気に生成だと有料プランになる可能性大（$20 程度）
- 出力品質は被写体次第。「カワセミ」みたいなメジャー種は OK、「シタトゥンガ」みたいなマイナー種は微妙な結果になりがち

### Blender 等で手作業

時間さえ無視すれば最強。ただし 1 体に最低数時間〜数日。28 体やるならそれが本業になる。**現実的にはやらない**。

---

## ワークフロー

新しいモデルを追加する手順:

1. モデル取得（Sketchfab / Poly Pizza / 自作）
2. ファイルを `<category>/models/<species_id>.glb` に配置（id は species.json のキーに合わせる）
3. `species.json` の該当エントリに以下を追記:
   ```json
   "model": "models/<species_id>.glb",
   "model_credit": "<出典文字列>"
   ```
4. cabinet を再起動 or `cmd+R` で rescan
5. ライトボックスで `[ view in 3D ]` ボタンが出ていれば成功

### 一括配置を効率化したい場合

species.json のキー一覧をまず取り出し、ファイル名を揃えて配置すると編集が機械的になる:

```bash
python3 -c "import json; d=json.load(open('species.json')); print('\n'.join(d.keys()))"
# → alpaca, amur_tiger, bactrian_camel, ...
```

Sketchfab Data API でスクリプト化する場合の参考: https://docs.sketchfab.com/data-api/v3/index.html  
（OAuth トークンが必要、`name_en` で検索 → 上位 CC モデルを DL → 自動配置、までは書ける。ただし「カワセミ」検索でカワセミ柄の小物が引っかかる事故もあるので人手検証は要る）

---

## 全動物カバーのコスト感

species.json には現状約 28 種。全部に 3D を付ける場合の見積もり:

| 戦略 | 1 体あたり時間 | 28 体合計 | 金銭コスト | 質 |
|---|---|---|---|---|
| Sketchfab 手作業 | 5〜15 分 | 3〜7 時間 | 0 円 | 高 |
| Sketchfab API 半自動 + 人手検証 | 2〜5 分 | 1〜2 時間 | 0 円 | 中〜高 |
| Poly Pizza 手作業 | 3〜10 分 | 2〜5 時間 | 0 円 | 中 |
| Polycam（剥製・標本のみ可） | 撮影 + 処理 30 分 | — | 0 円〜$15 | 高 |
| AI 生成（Meshy 等） | 5〜10 分 | 3〜5 時間 | 0〜$20 | 中（種で当たり外れ） |
| **ハイブリッド推奨** | — | 約半日 | 0 円〜$20 | 中〜高 |

**現実的なおすすめ**:
- 主役級（カワセミ・ホッキョクグマ・アムールトラ等）は Sketchfab で時間かけて選ぶ
- マイナー種（ビントロング・シタトゥンガ等）は AI 生成 or Poly Pizza で妥協
- 自分が直接見た動物（動物園で剥製がある等）は Polycam で自分スキャン → 思い出付加

---

## やらないこと（YAGNI）

- 1 動物に複数モデル切替（オス／メス、季節別）
- AR 表示
- モデル管理 UI（追加・削除を GUI で）
- ライセンス自動チェッカー
- モデルマーケットプレイス連携（Sketchfab API も手動で OK）
