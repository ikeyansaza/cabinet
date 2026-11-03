use crate::exif;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

const SUPPORTED_EXT: &[&str] = &["jpg", "jpeg", "png", "webp"];
const MANUAL_FIELDS: &[&str] = &["species", "title", "tags", "visit"];

pub fn scan_and_merge(dir: &Path) -> Vec<Value> {
    let existing = load_existing(dir);
    let files = list_image_files(dir);

    let mut entries = Vec::new();
    for file in files {
        let filename = file.file_name().unwrap().to_string_lossy().into_owned();
        let prev = existing.get(&filename).cloned();
        let exif_data = exif::extract(&file);

        let mut entry = Map::new();
        entry.insert("file".into(), Value::String(filename.clone()));

        if let Some(Value::Object(prev_map)) = &prev {
            for k in MANUAL_FIELDS {
                if let Some(v) = prev_map.get(*k) {
                    entry.insert((*k).into(), v.clone());
                }
            }
        }

        if !exif_data.date.is_empty()   { entry.insert("date".into(),   Value::String(exif_data.date)); }
        if !exif_data.camera.is_empty() { entry.insert("camera".into(), Value::String(exif_data.camera)); }
        if !exif_data.lens.is_empty()   { entry.insert("lens".into(),   Value::String(exif_data.lens)); }
        if !exif_data.exif.is_empty()   { entry.insert("exif".into(),   Value::String(exif_data.exif)); }

        entries.push(Value::Object(entry));
    }

    let path = dir.join("photos.json");
    let json = serde_json::to_string_pretty(&entries).unwrap_or_else(|_| "[]".into());
    let json = json + "\n";
    // 内容が変わらないときは書かない。photos.json は watcher の監視対象なので、
    // 毎回書くと「書き込み→検知→再スキャン→書き込み」のループになり、
    // photos-updated が約 500ms ごとに発火して一覧がチカチカする。
    let unchanged = std::fs::read_to_string(&path).map(|cur| cur == json).unwrap_or(false);
    if !unchanged {
        if let Err(e) = std::fs::write(&path, json) {
            eprintln!("[album] failed to write {}: {e}", path.display());
        }
    }

    entries
}

fn load_existing(dir: &Path) -> std::collections::HashMap<String, Value> {
    let path = dir.join("photos.json");
    let Ok(text) = std::fs::read_to_string(&path) else { return Default::default(); };
    let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(&text) else { return Default::default(); };
    arr.into_iter()
        .filter_map(|v| {
            let file = v.get("file")?.as_str()?.to_string();
            Some((file, v))
        })
        .collect()
}

fn list_image_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(read) = std::fs::read_dir(dir) else { return vec![]; };
    let mut files: Vec<PathBuf> = read
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_file())
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(|e| SUPPORTED_EXT.iter().any(|s| s.eq_ignore_ascii_case(e)))
                .unwrap_or(false)
        })
        .collect();
    files.sort();
    files
}

/// parent_dir 直下のサブフォルダで、画像ファイルを 1 枚以上含むものを名前順で返す。
pub fn list_categories(parent: &Path) -> Vec<String> {
    let Ok(read) = std::fs::read_dir(parent) else { return vec![]; };
    let mut categories: Vec<String> = read
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|e| has_images(&e.path()))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|name| !name.starts_with('.'))   // .DS_Store 等の隠しフォルダは除外
        .collect();
    categories.sort();
    categories
}

fn has_images(dir: &Path) -> bool {
    let Ok(read) = std::fs::read_dir(dir) else { return false; };
    read.filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .any(|e| {
            e.path().extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| SUPPORTED_EXT.iter().any(|s| s.eq_ignore_ascii_case(ext)))
                .unwrap_or(false)
        })
}

/// parent 直下のカテゴリ名を実在するディレクトリに解決する。
/// フロントから来た文字列をそのままパスに繋ぐので、区切り文字や `..` を含む名前は拒否する（パストラバーサル防止）。
pub fn category_dir(parent: &Path, category: &str) -> Result<PathBuf, String> {
    if category.is_empty() || category.contains('/') || category.contains('\\') || category.contains("..") {
        return Err(format!("invalid category: {category}"));
    }
    let dir = parent.join(category);
    if !dir.is_dir() {
        return Err(format!("not a category: {category}"));
    }
    Ok(dir)
}

/// 全カテゴリの photos.json を読み、各要素に `category` を足して連結する。
/// 読めない／配列でないカテゴリは飛ばす（visits の写真集計で他カテゴリを巻き込まないため）。
pub fn read_all_photos(parent: &Path) -> Vec<Value> {
    let mut all = Vec::new();
    for category in list_categories(parent) {
        let path = parent.join(&category).join("photos.json");
        let Ok(text) = std::fs::read_to_string(&path) else { continue; };
        let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(&text) else { continue; };
        for mut entry in arr {
            if let Some(obj) = entry.as_object_mut() {
                obj.insert("category".into(), Value::String(category.clone()));
                all.push(entry);
            }
        }
    }
    all
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn empty_dir_returns_empty() {
        let tmp = TempDir::new().unwrap();
        let entries = scan_and_merge(tmp.path());
        assert!(entries.is_empty());
    }

    #[test]
    fn preserves_manual_fields() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("a.jpg"), b"").unwrap();
        fs::write(
            tmp.path().join("photos.json"),
            r#"[{"file":"a.jpg","species":"kingfisher","title":"X","tags":["bird"]}]"#,
        )
        .unwrap();

        let entries = scan_and_merge(tmp.path());
        assert_eq!(entries.len(), 1);
        let e = entries[0].as_object().unwrap();
        assert_eq!(e.get("species").unwrap().as_str(), Some("kingfisher"));
        assert_eq!(e.get("title").unwrap().as_str(), Some("X"));
    }

    #[test]
    fn unchanged_rescan_does_not_rewrite_photos_json() {
        // photos.json の書き込みを watcher が検知して再スキャン→再書き込み…と
        // 無限ループし、画面がチカチカした。内容が同じなら書かないこと。
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("a.jpg"), b"").unwrap();
        scan_and_merge(tmp.path());
        let path = tmp.path().join("photos.json");
        let before = fs::metadata(&path).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
        scan_and_merge(tmp.path());
        let after = fs::metadata(&path).unwrap().modified().unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn drops_missing_files() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("a.jpg"), b"").unwrap();
        fs::write(
            tmp.path().join("photos.json"),
            r#"[{"file":"a.jpg"},{"file":"b.jpg"}]"#,
        )
        .unwrap();

        let entries = scan_and_merge(tmp.path());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].get("file").unwrap().as_str(), Some("a.jpg"));
    }

    #[test]
    fn list_categories_empty_dir_returns_empty() {
        let tmp = TempDir::new().unwrap();
        let cats = list_categories(tmp.path());
        assert!(cats.is_empty());
    }

    #[test]
    fn list_categories_excludes_subdirs_without_images() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir(tmp.path().join("animals")).unwrap();
        fs::write(tmp.path().join("animals/a.jpg"), b"").unwrap();
        fs::create_dir(tmp.path().join("notes")).unwrap();
        fs::write(tmp.path().join("notes/memo.txt"), b"").unwrap();
        let cats = list_categories(tmp.path());
        assert_eq!(cats, vec!["animals".to_string()]);
    }

    #[test]
    fn list_categories_sorts_and_skips_hidden() {
        let tmp = TempDir::new().unwrap();
        for name in &["food", "animals", ".trash"] {
            fs::create_dir(tmp.path().join(name)).unwrap();
            fs::write(tmp.path().join(name).join("x.jpg"), b"").unwrap();
        }
        let cats = list_categories(tmp.path());
        assert_eq!(cats, vec!["animals".to_string(), "food".to_string()]);
    }

    #[test]
    fn preserves_visit_field() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("a.jpg"), b"").unwrap();
        fs::write(
            tmp.path().join("photos.json"),
            r#"[{"file":"a.jpg","visit":"2025-10-12-1"}]"#,
        )
        .unwrap();
        let entries = scan_and_merge(tmp.path());
        assert_eq!(entries[0].get("visit").unwrap().as_str(), Some("2025-10-12-1"));
    }

    #[test]
    fn category_dir_rejects_traversal() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir(tmp.path().join("animals")).unwrap();
        assert!(category_dir(tmp.path(), "../x").is_err());
        assert!(category_dir(tmp.path(), "a/b").is_err());
        assert!(category_dir(tmp.path(), "a\\b").is_err());
        assert!(category_dir(tmp.path(), "").is_err());
        assert!(category_dir(tmp.path(), "missing").is_err());
        assert_eq!(category_dir(tmp.path(), "animals").unwrap(), tmp.path().join("animals"));
    }

    #[test]
    fn read_all_photos_tags_category() {
        let tmp = TempDir::new().unwrap();
        for (cat, json) in [
            ("animals", r#"[{"file":"a.jpg"}]"#),
            ("arts", r#"[{"file":"b.jpg"},{"file":"c.jpg"}]"#),
            ("food", "not json"),
        ] {
            fs::create_dir(tmp.path().join(cat)).unwrap();
            fs::write(tmp.path().join(cat).join("x.jpg"), b"").unwrap();
            fs::write(tmp.path().join(cat).join("photos.json"), json).unwrap();
        }
        let all = read_all_photos(tmp.path());
        assert_eq!(all.len(), 3);
        assert_eq!(all[0]["category"].as_str(), Some("animals"));
        assert_eq!(all[0]["file"].as_str(), Some("a.jpg"));
        assert_eq!(all[2]["category"].as_str(), Some("arts"));
    }
}
