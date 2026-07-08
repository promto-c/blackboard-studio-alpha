#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(target_os = "linux")]
fn configure_linux_webkit() {
    let dmabuf_enabled = std::env::var("BLACKBOARD_STUDIO_ENABLE_WEBKIT_DMABUF")
        .map(|value| {
            value == "1" || value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("yes")
        })
        .unwrap_or(false);

    if !dmabuf_enabled {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

#[cfg(not(target_os = "linux"))]
fn configure_linux_webkit() {}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OcioConfigFile {
    relative_path: String,
    data: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OcioConfigPackage {
    config_path: String,
    config_relative_path: String,
    files: Vec<OcioConfigFile>,
}

fn collect_directory_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<OcioConfigFile>,
) -> Result<(), String> {
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Could not read OCIO config directory: {error}"))?;

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Could not read OCIO directory entry: {error}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_directory_files(root, &path, files)?;
            continue;
        }
        if !path.is_file() {
            continue;
        }

        let relative_path = path
            .strip_prefix(root)
            .map_err(|_| "OCIO config dependency escaped its source directory.".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let data = fs::read(&path)
            .map_err(|error| format!("Could not read \"{relative_path}\": {error}"))?;
        files.push(OcioConfigFile {
            relative_path,
            data,
        });
    }

    Ok(())
}

#[tauri::command]
fn read_ocio_config_package(config_path: String) -> Result<OcioConfigPackage, String> {
    let canonical_config = fs::canonicalize(PathBuf::from(&config_path))
        .map_err(|error| format!("Could not locate OCIO config \"{config_path}\": {error}"))?;
    if !canonical_config.is_file() {
        return Err(format!("OCIO config \"{config_path}\" is not a file."));
    }

    let root = canonical_config
        .parent()
        .ok_or_else(|| format!("OCIO config \"{config_path}\" has no parent directory."))?;
    let config_relative_path = canonical_config
        .strip_prefix(root)
        .map_err(|_| "OCIO config escaped its source directory.".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let mut files = Vec::new();
    collect_directory_files(root, root, &mut files)?;
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    Ok(OcioConfigPackage {
        config_path: canonical_config.to_string_lossy().into_owned(),
        config_relative_path,
        files,
    })
}

fn main() {
    configure_linux_webkit();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_ocio_config_package])
        .run(tauri::generate_context!())
        .expect("error while running Blackboard Studio desktop app");
}
