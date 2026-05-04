#!/usr/bin/env python3
"""
gen_photos.py — photos/ フォルダを走査して photos.json を生成する

使い方:
  pip install piexif pillow
  python scripts/gen_photos.py

オプション:
  --photos-dir  写真フォルダのパス (default: ./photos)
  --output      出力先 JSON パス  (default: ./photos.json)
  --dry-run     書き込まずに結果を標準出力へ
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

try:
    import piexif
    from PIL import Image
    HAS_EXIF = True
except ImportError:
    HAS_EXIF = False
    print("[warn] piexif / Pillow が見つかりません。EXIF なしで生成します。", file=sys.stderr)
    print("       pip install piexif pillow", file=sys.stderr)

SUPPORTED = {".jpg", ".jpeg", ".png", ".webp"}

# ── EXIF タグマッピング ──────────────────────────────────────────────────────

def rational_to_float(r):
    """(num, denom) タプル → float"""
    if isinstance(r, (list, tuple)) and len(r) == 2 and r[1] != 0:
        return r[0] / r[1]
    return None

def format_fstop(val):
    f = rational_to_float(val)
    if f is None:
        return None
    return f"f/{f:.1f}".rstrip('0').rstrip('.')

def format_shutter(val):
    """シャッタースピードを 1/Ns 形式に"""
    f = rational_to_float(val)
    if f is None:
        return None
    if f >= 1:
        return f"{f:.1f}s"
    denom = round(1 / f)
    return f"1/{denom}s"

def format_iso(val):
    if val is None:
        return None
    return f"ISO {val}"

def get_exif_data(path: Path) -> dict:
    """piexif で EXIF を読んで dict を返す"""
    result = {
        "camera": None,
        "lens":   None,
        "exif":   None,
        "date":   None,
    }

    if not HAS_EXIF:
        return result

    try:
        raw = piexif.load(str(path))
    except Exception:
        return result

    ifd0    = raw.get("0th", {})
    exif    = raw.get("Exif", {})

    # カメラ名
    make  = ifd0.get(piexif.ImageIFD.Make,  b"").decode("utf-8", errors="ignore").strip().rstrip("\x00")
    model = ifd0.get(piexif.ImageIFD.Model, b"").decode("utf-8", errors="ignore").strip().rstrip("\x00")
    if model:
        # make が model の先頭に含まれる場合は除外 (e.g. "SONY ILCE-7M4" → "ILCE-7M4")
        if make and model.upper().startswith(make.upper()):
            model = model[len(make):].strip()
        result["camera"] = model or make or None

    # レンズ名
    lens_model = exif.get(piexif.ExifIFD.LensModel, b"").decode("utf-8", errors="ignore").strip().rstrip("\x00")
    if lens_model:
        result["lens"] = lens_model

    # f値 / シャッタースピード / ISO
    fstop   = format_fstop(exif.get(piexif.ExifIFD.FNumber))
    shutter = format_shutter(exif.get(piexif.ExifIFD.ExposureTime))
    iso     = format_iso(exif.get(piexif.ExifIFD.ISOSpeedRatings))

    parts = [p for p in [fstop, shutter, iso] if p]
    if parts:
        result["exif"] = " · ".join(parts)

    # 撮影日時
    dt_str = exif.get(piexif.ExifIFD.DateTimeOriginal, b"").decode("utf-8", errors="ignore").strip()
    if dt_str:
        try:
            dt = datetime.strptime(dt_str, "%Y:%m:%d %H:%M:%S")
            result["date"] = dt.strftime("%Y-%m-%d")
        except ValueError:
            pass

    return result

# ── タグ推定 ────────────────────────────────────────────────────────────────

# ファイル名のキーワードからタグを自動付与するルール
# 必要に応じて追記してください
TAG_RULES = [
    (r"deer|elk|bear|monkey|macaque|fox|cat|dog|rabbit|shiba|merino|suffolk|sheep|cow|horse|raccoon|tanuki|boar|lion|tiger|leopard", "mammal"),
    (r"heron|kingfisher|eagle|hawk|falcon|owl|sparrow|swallow|duck|swan|crow|pigeon|egret|ibis|stork|crane|tit|warbler|robin|wagtail", "bird"),
    (r"beetle|butterfly|moth|dragonfly|grasshopper|cricket|cicada|ant|bee|wasp|fly|spider|mantis|firefly|caterpillar", "insect"),
    (r"snake|lizard|gecko|turtle|tortoise|frog|toad|salamander|newt|skink|iguana", "reptile"),
    (r"fish|karp|carp|salmon|trout|shark|ray|octopus|squid|jellyfish|crab|shrimp|eel|turtle_sea", "aquatic"),
]

def guess_tags(filename: str) -> list[str]:
    name = filename.lower()
    tags = []
    for pattern, tag in TAG_RULES:
        if re.search(pattern, name) and tag not in tags:
            tags.append(tag)
    return tags

# 機械的なファイル名（カメラ採番）はタイトル化しない
GENERIC_NAME_RE = re.compile(r'^(IMG|PXL|DSC|DSCN|DSCF|P\d|MVI)[\s_\-]', re.IGNORECASE)

def guess_title(filename: str) -> str:
    """ファイル名 → 表示タイトル (例: grey_heron_01.jpg → GREY HERON)
    IMG_5621.JPG / PXL_20241117_xxx.jpg のようなカメラ採番ファイル名は空文字を返す。
    """
    stem = Path(filename).stem
    if GENERIC_NAME_RE.match(stem) or stem.replace('_', '').replace('-', '').isdigit():
        return ""
    # 末尾の _01 _02 などを除去
    stem = re.sub(r'[_\-]\d+$', '', stem)
    return stem.replace("_", " ").replace("-", " ").upper()

# ── メイン ──────────────────────────────────────────────────────────────────

def build_entries(photos_dir: Path) -> list[dict]:
    entries = []

    files = sorted(
        f for f in photos_dir.iterdir()
        if f.suffix.lower() in SUPPORTED
    )

    if not files:
        print(f"[warn] {photos_dir} に対応画像が見つかりませんでした", file=sys.stderr)
        return entries

    for f in files:
        print(f"  processing: {f.name}")
        exif_data = get_exif_data(f)

        entry = {
            "file":   f.name,
            "title":  guess_title(f.name),
            "tags":   guess_tags(f.name),
            "date":   exif_data["date"] or "",
            "camera": exif_data["camera"] or "",
            "lens":   exif_data["lens"] or "",
            "exif":   exif_data["exif"] or "",
        }
        entries.append(entry)

    return entries


def main():
    parser = argparse.ArgumentParser(description="Generate photos.json from photos/ directory")
    parser.add_argument("--photos-dir", default="photos",  help="path to photos directory")
    parser.add_argument("--output",     default="photos.json", help="output JSON path")
    parser.add_argument("--dry-run",    action="store_true",   help="print JSON without writing")
    args = parser.parse_args()

    photos_dir = Path(args.photos_dir)
    if not photos_dir.is_dir():
        print(f"[error] ディレクトリが見つかりません: {photos_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"scanning {photos_dir} ...")
    entries = build_entries(photos_dir)
    print(f"  {len(entries)} photos found")

    output = json.dumps(entries, ensure_ascii=False, indent=2)

    if args.dry_run:
        print(output)
    else:
        out_path = Path(args.output)
        out_path.write_text(output, encoding="utf-8")
        print(f"  → written to {out_path}")


if __name__ == "__main__":
    main()
