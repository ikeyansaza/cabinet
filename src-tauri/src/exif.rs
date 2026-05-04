use std::path::Path;

#[derive(Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct ExifData {
    pub date: String,
    pub camera: String,
    pub lens: String,
    pub exif: String,
}

pub fn extract<P: AsRef<Path>>(path: P) -> ExifData {
    let Ok(file) = std::fs::File::open(&path) else {
        return ExifData::default();
    };
    let mut reader = std::io::BufReader::new(file);
    let exifreader = exif::Reader::new();
    let Ok(meta) = exifreader.read_from_container(&mut reader) else {
        return ExifData::default();
    };

    ExifData {
        date:   format_date(&meta),
        camera: format_camera(&meta),
        lens:   format_lens(&meta),
        exif:   format_exposure(&meta),
    }
}

fn get_str(meta: &exif::Exif, tag: exif::Tag) -> Option<String> {
    let field = meta.get_field(tag, exif::In::PRIMARY)?;
    let value = field.display_value().with_unit(meta).to_string();
    let trimmed = value.trim().trim_matches('"').trim().to_string();
    if trimmed.is_empty() { None } else { Some(trimmed) }
}

fn format_date(meta: &exif::Exif) -> String {
    let raw = match get_str(meta, exif::Tag::DateTimeOriginal) {
        Some(s) => s,
        None => return String::new(),
    };
    // "2024:05:20 12:34:56" → "2024-05-20"
    let date_part = raw.split(' ').next().unwrap_or("");
    date_part.replace(':', "-")
}

fn format_camera(meta: &exif::Exif) -> String {
    let make  = get_str(meta, exif::Tag::Make).unwrap_or_default();
    let model = get_str(meta, exif::Tag::Model).unwrap_or_default();
    if model.is_empty() { return make; }
    if !make.is_empty() && model.to_uppercase().starts_with(&make.to_uppercase()) {
        return model[make.len()..].trim().to_string();
    }
    model
}

fn format_lens(meta: &exif::Exif) -> String {
    get_str(meta, exif::Tag::LensModel).unwrap_or_default()
}

fn format_exposure(meta: &exif::Exif) -> String {
    let mut parts = Vec::new();
    if let Some(f) = get_str(meta, exif::Tag::FNumber) {
        let stripped = f.trim_start_matches("f/").trim();
        if let Ok(n) = stripped.parse::<f64>() {
            // 末尾 .0 は落とす（"2.0" → "2", "6.3" は維持）
            let s = if n.fract() == 0.0 { format!("{n:.0}") } else { format!("{n}") };
            parts.push(format!("f/{s}"));
        }
    }
    if let Some(s) = get_str(meta, exif::Tag::ExposureTime) {
        parts.push(format!("{s}s").replace("ss", "s"));
    }
    if let Some(iso) = get_str(meta, exif::Tag::PhotographicSensitivity) {
        parts.push(format!("ISO {iso}"));
    }
    parts.join(" · ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_exif_returns_default() {
        let data = extract("/nonexistent.jpg");
        assert_eq!(data, ExifData::default());
    }

    #[test]
    fn parse_real_jpeg_if_available() {
        let Ok(path) = std::env::var("ALBUM_TEST_JPEG") else { return; };
        let data = extract(&path);
        assert!(!data.date.is_empty() || !data.camera.is_empty() || !data.exif.is_empty(),
                "EXIF empty for {path}: {data:?}");
    }

    #[test]
    fn format_exposure_handles_whole_fnumber() {
        // 直接 format_exposure はテストできない（exif::Exif が必要）が、
        // 文字列処理ロジックを検証するために局所関数で再現
        // 直接 inline で検証
        let cases = [
            ("f/10",   "f/10"),
            ("f/10.0", "f/10"),
            ("f/2",    "f/2"),
            ("f/2.0",  "f/2"),
            ("f/6.3",  "f/6.3"),
            ("f/1.8",  "f/1.8"),
        ];
        for (input, expected) in cases {
            let stripped = input.trim_start_matches("f/").trim();
            let n: f64 = stripped.parse().unwrap();
            let s = if n.fract() == 0.0 { format!("{n:.0}") } else { format!("{n}") };
            let actual = format!("f/{s}");
            assert_eq!(actual, expected, "input: {input}");
        }
    }
}
