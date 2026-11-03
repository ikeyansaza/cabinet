//! ドラッグ&ドロップで渡された画像を、アクティブカテゴリのフォルダへコピーする。
//! 反映（photos.json 更新・画面更新）はファイルウォッチャーに任せる。

use crate::scan;
use std::path::{Path, PathBuf};

/// dir 内で衝突しないコピー先パスを返す。
/// 既存なら `name_2.ext`, `name_3.ext` … と連番を付ける（上書きしない）。
fn unique_dest(dir: &Path, file_name: &str) -> PathBuf {
    let first = dir.join(file_name);
    if !first.exists() {
        return first;
    }
    let p = Path::new(file_name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(file_name);
    let ext = p.extension().and_then(|s| s.to_str());
    let mut n = 2;
    loop {
        let name = match ext {
            Some(e) => format!("{stem}_{n}.{e}"),
            None => format!("{stem}_{n}"),
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

/// 取り込み結果。画面の通知に使う。
#[derive(Debug, Default, PartialEq, serde::Serialize)]
pub struct ImportResult {
    /// コピーできたファイル名（衝突時は _2 などを付けた後の名前）
    pub imported: Vec<String>,
    /// 非対応形式（.heic など）またはコピーに失敗したファイル名。理由を画面に出すため
    /// 黙って捨てない。
    pub skipped: Vec<String>,
}

/// 画像ファイルだけを dir にコピーする。
/// ディレクトリ・存在しないパスは対象外（フォルダごとドロップされても落とさない）で、
/// skipped にも数えない。ファイルなのに非対応形式／コピー失敗のものは skipped に入れる。
pub fn import_files(dir: &Path, paths: &[PathBuf]) -> ImportResult {
    let mut result = ImportResult::default();
    for src in paths {
        if !src.is_file() {
            continue;
        }
        let Some(name) = src.file_name().and_then(|n| n.to_str()) else { continue };
        if !scan::is_supported_image(src) {
            result.skipped.push(name.to_string());
            continue;
        }
        let dest = unique_dest(dir, name);
        match std::fs::copy(src, &dest) {
            Ok(_) => {
                if let Some(n) = dest.file_name().and_then(|n| n.to_str()) {
                    result.imported.push(n.to_string());
                }
            }
            Err(_) => result.skipped.push(name.to_string()),
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(p: &Path, body: &str) {
        fs::write(p, body).unwrap();
    }

    #[test]
    fn copies_images_into_dir() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        write(&src.path().join("a.jpg"), "A");
        let got = import_files(dst.path(), &[src.path().join("a.jpg")]).imported;
        assert_eq!(got, vec!["a.jpg"]);
        assert_eq!(fs::read_to_string(dst.path().join("a.jpg")).unwrap(), "A");
        assert!(src.path().join("a.jpg").exists(), "元ファイルは残す（コピー）");
    }

    #[test]
    fn never_overwrites_existing_file() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        write(&dst.path().join("a.jpg"), "OLD");
        write(&dst.path().join("a_2.jpg"), "OLD2");
        write(&src.path().join("a.jpg"), "NEW");
        let got = import_files(dst.path(), &[src.path().join("a.jpg")]).imported;
        assert_eq!(got, vec!["a_3.jpg"]);
        assert_eq!(fs::read_to_string(dst.path().join("a.jpg")).unwrap(), "OLD");
        assert_eq!(fs::read_to_string(dst.path().join("a_3.jpg")).unwrap(), "NEW");
    }

    #[test]
    fn ignores_directories_and_missing_paths_silently() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        fs::create_dir(src.path().join("sub.jpg")).unwrap();
        let got = import_files(
            dst.path(),
            &[src.path().join("sub.jpg"), src.path().join("missing.jpg")],
        );
        assert_eq!(got, ImportResult::default());
        assert_eq!(fs::read_dir(dst.path()).unwrap().count(), 0);
    }

    #[test]
    fn unsupported_files_are_reported_as_skipped_and_not_copied() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        write(&src.path().join("IMG_1.HEIC"), "h");
        write(&src.path().join("ok.png"), "p");
        let got = import_files(
            dst.path(),
            &[src.path().join("IMG_1.HEIC"), src.path().join("ok.png")],
        );
        assert_eq!(got.imported, vec!["ok.png"]);
        assert_eq!(got.skipped, vec!["IMG_1.HEIC"]);
        assert!(!dst.path().join("IMG_1.HEIC").exists());
    }

    #[test]
    fn same_name_twice_in_one_drop_gets_distinct_names() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        write(&a.path().join("x.JPG"), "1");
        write(&b.path().join("x.JPG"), "2");
        let got = import_files(dst.path(), &[a.path().join("x.JPG"), b.path().join("x.JPG")]).imported;
        assert_eq!(got, vec!["x.JPG", "x_2.JPG"]);
    }
}
