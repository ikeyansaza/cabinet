use serde_json::Value;
use std::io::Write;
use std::path::Path;

/// species.json をアクティブディレクトリ直下に atomic 書き込み（temp file → rename）。
/// 上位レイヤから来る値はオブジェクト前提。それ以外は受け付けない。
pub fn write_species_json(dir: &Path, value: &Value) -> Result<(), String> {
    if !value.is_object() {
        return Err("species.json must be a JSON object".into());
    }
    let path = dir.join("species.json");
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    write_atomic(&path, json.as_bytes())
}

/// artists.json をアクティブディレクトリ直下に atomic 書き込み。
/// arts カテゴリでのみ用いる作家マスタ。
pub fn write_artists_json(dir: &Path, value: &Value) -> Result<(), String> {
    if !value.is_object() {
        return Err("artists.json must be a JSON object".into());
    }
    let path = dir.join("artists.json");
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    write_atomic(&path, json.as_bytes())
}

/// photos.json 内の指定 file の species フィールドを上書き。
/// species が None または空文字なら species フィールドを削除する。
/// 該当 file が photos.json に無ければ no-op（scan_and_merge 完了前のレースを許容）。
pub fn update_photo_species(
    dir: &Path,
    file: &str,
    species: Option<&str>,
) -> Result<(), String> {
    update_photo_field(dir, file, "species", species)
}

/// photos.json 内の指定 file の visit（訪問 ID）を上書き。挙動は update_photo_species と同じ。
pub fn update_photo_visit(
    dir: &Path,
    file: &str,
    visit: Option<&str>,
) -> Result<(), String> {
    update_photo_field(dir, file, "visit", visit)
}

fn update_photo_field(
    dir: &Path,
    file: &str,
    key: &str,
    value_str: Option<&str>,
) -> Result<(), String> {
    let path = dir.join("photos.json");
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read photos.json: {e}"))?;
    let mut value: Value = serde_json::from_str(&text)
        .map_err(|e| format!("photos.json parse error: {e}"))?;
    let Some(arr) = value.as_array_mut() else {
        return Err("photos.json is not an array".into());
    };

    let mut found = false;
    for entry in arr.iter_mut() {
        let Some(obj) = entry.as_object_mut() else { continue; };
        if obj.get("file").and_then(|v| v.as_str()) != Some(file) {
            continue;
        }
        found = true;
        match value_str {
            Some(s) if !s.is_empty() => {
                obj.insert(key.into(), Value::String(s.into()));
            }
            _ => {
                obj.remove(key);
            }
        }
    }

    if !found {
        return Ok(());
    }

    let json = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    write_atomic(&path, json.as_bytes())
}

pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    // 同一ディレクトリに一時ファイルを置いてから rename することで、
    // 部分書き込み状態のファイルを watcher / 読み手に見せない
    let tmp = path.with_extension("tmp");
    {
        let mut f = std::fs::File::create(&tmp)
            .map_err(|e| format!("failed to open temp file: {e}"))?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.write_all(b"\n").map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, path).map_err(|e| format!("rename failed: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Map};
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn writes_species_json_object() {
        let tmp = TempDir::new().unwrap();
        let mut obj = Map::new();
        obj.insert(
            "kingfisher".into(),
            json!({ "name_ja": "カワセミ", "features": ["青い背"] }),
        );
        write_species_json(tmp.path(), &Value::Object(obj)).unwrap();

        let text = fs::read_to_string(tmp.path().join("species.json")).unwrap();
        let parsed: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["kingfisher"]["name_ja"].as_str(), Some("カワセミ"));
        assert_eq!(parsed["kingfisher"]["features"][0].as_str(), Some("青い背"));
    }

    #[test]
    fn rejects_non_object_species_json() {
        let tmp = TempDir::new().unwrap();
        let r = write_species_json(tmp.path(), &Value::Array(vec![]));
        assert!(r.is_err());
    }

    #[test]
    fn writes_artists_json_object() {
        let tmp = TempDir::new().unwrap();
        let mut obj = Map::new();
        obj.insert(
            "taro_okamoto".into(),
            json!({ "name": "岡本太郎", "bio": "前衛芸術家" }),
        );
        write_artists_json(tmp.path(), &Value::Object(obj)).unwrap();

        let text = fs::read_to_string(tmp.path().join("artists.json")).unwrap();
        let parsed: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["taro_okamoto"]["name"].as_str(), Some("岡本太郎"));
        assert_eq!(parsed["taro_okamoto"]["bio"].as_str(), Some("前衛芸術家"));
    }

    #[test]
    fn rejects_non_object_artists_json() {
        let tmp = TempDir::new().unwrap();
        let r = write_artists_json(tmp.path(), &Value::Array(vec![]));
        assert!(r.is_err());
    }

    #[test]
    fn write_species_overwrites_existing() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("species.json"), r#"{"old":{}}"#).unwrap();
        write_species_json(tmp.path(), &json!({ "new": { "name_ja": "新" } })).unwrap();
        let text = fs::read_to_string(tmp.path().join("species.json")).unwrap();
        let v: Value = serde_json::from_str(&text).unwrap();
        assert!(v.get("old").is_none());
        assert_eq!(v["new"]["name_ja"].as_str(), Some("新"));
    }

    #[test]
    fn updates_existing_photo_species() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join("photos.json"),
            r#"[{"file":"a.jpg"},{"file":"b.jpg","species":"old"}]"#,
        )
        .unwrap();
        update_photo_species(tmp.path(), "a.jpg", Some("kingfisher")).unwrap();
        let v: Value =
            serde_json::from_str(&fs::read_to_string(tmp.path().join("photos.json")).unwrap())
                .unwrap();
        assert_eq!(v[0]["species"].as_str(), Some("kingfisher"));
        assert_eq!(v[1]["species"].as_str(), Some("old"));
    }

    #[test]
    fn empty_species_removes_field() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join("photos.json"),
            r#"[{"file":"a.jpg","species":"old"}]"#,
        )
        .unwrap();
        update_photo_species(tmp.path(), "a.jpg", Some("")).unwrap();
        let v: Value =
            serde_json::from_str(&fs::read_to_string(tmp.path().join("photos.json")).unwrap())
                .unwrap();
        assert!(v[0].get("species").is_none());
    }

    #[test]
    fn none_species_removes_field() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join("photos.json"),
            r#"[{"file":"a.jpg","species":"old"}]"#,
        )
        .unwrap();
        update_photo_species(tmp.path(), "a.jpg", None).unwrap();
        let v: Value =
            serde_json::from_str(&fs::read_to_string(tmp.path().join("photos.json")).unwrap())
                .unwrap();
        assert!(v[0].get("species").is_none());
    }

    #[test]
    fn unknown_file_is_noop() {
        let tmp = TempDir::new().unwrap();
        let original = r#"[{"file":"a.jpg"}]"#;
        fs::write(tmp.path().join("photos.json"), original).unwrap();
        update_photo_species(tmp.path(), "b.jpg", Some("foo")).unwrap();
        // 該当ファイルが無いときは書き込みも走らない
        assert_eq!(
            fs::read_to_string(tmp.path().join("photos.json")).unwrap(),
            original
        );
    }

    #[test]
    fn missing_photos_json_returns_error() {
        let tmp = TempDir::new().unwrap();
        assert!(update_photo_species(tmp.path(), "a.jpg", Some("foo")).is_err());
    }

    #[test]
    fn sets_photo_visit() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("photos.json"), r#"[{"file":"a.jpg"},{"file":"b.jpg","visit":"old"}]"#).unwrap();
        update_photo_visit(tmp.path(), "a.jpg", Some("2025-10-12-1")).unwrap();
        let v: Value = serde_json::from_str(&fs::read_to_string(tmp.path().join("photos.json")).unwrap()).unwrap();
        assert_eq!(v[0]["visit"].as_str(), Some("2025-10-12-1"));
        assert_eq!(v[1]["visit"].as_str(), Some("old"));
    }

    #[test]
    fn empty_visit_removes_field() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("photos.json"), r#"[{"file":"a.jpg","visit":"old"}]"#).unwrap();
        update_photo_visit(tmp.path(), "a.jpg", Some("")).unwrap();
        let v: Value = serde_json::from_str(&fs::read_to_string(tmp.path().join("photos.json")).unwrap()).unwrap();
        assert!(v[0].get("visit").is_none());
    }

    #[test]
    fn unknown_file_visit_is_noop() {
        let tmp = TempDir::new().unwrap();
        let original = r#"[{"file":"a.jpg"}]"#;
        fs::write(tmp.path().join("photos.json"), original).unwrap();
        update_photo_visit(tmp.path(), "b.jpg", Some("x")).unwrap();
        assert_eq!(fs::read_to_string(tmp.path().join("photos.json")).unwrap(), original);
    }
}
