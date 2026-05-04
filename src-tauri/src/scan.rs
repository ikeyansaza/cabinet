use crate::exif;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

const SUPPORTED_EXT: &[&str] = &["jpg", "jpeg", "png", "webp"];
const MANUAL_FIELDS: &[&str] = &["species", "title", "tags"];

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
    let _ = std::fs::write(&path, json + "\n");

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
}
