//! Thin native layer: plain-file I/O and change watching for the notes folder.
//! All logic (merging, indexing, rendering) lives in the frontend.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize)]
struct DirEntry {
    name: String,
    is_dir: bool,
}

struct WatchState(Mutex<Option<RecommendedWatcher>>);

fn err<E: std::fmt::Display>(path: &str, e: E) -> String {
    format!("{path}: {e}")
}

/// Write to a temp file in the same folder, fsync, then rename over the target.
fn atomic_write(path: &str, bytes: &[u8]) -> Result<(), String> {
    let target = PathBuf::from(path);
    let dir = target.parent().ok_or_else(|| err(path, "no parent directory"))?;
    fs::create_dir_all(dir).map_err(|e| err(path, e))?;
    let name = target.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = dir.join(format!(".{name}.{}.tmp", std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, &target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(|e| err(path, e))
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| err(&path, e))
}

#[tauri::command]
fn write_atomic(path: String, contents: String) -> Result<(), String> {
    atomic_write(&path, contents.as_bytes())
}

/// Raw bytes straight to the webview (used for large PDFs; avoids base64 inflation).
#[tauri::command]
fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    fs::read(&path).map(tauri::ipc::Response::new).map_err(|e| err(&path, e))
}

#[tauri::command]
fn read_base64(path: String) -> Result<String, String> {
    fs::read(&path).map(|b| STANDARD.encode(b)).map_err(|e| err(&path, e))
}

#[tauri::command]
fn write_base64(path: String, data: String) -> Result<(), String> {
    let bytes = STANDARD.decode(data).map_err(|e| err(&path, e))?;
    atomic_write(&path, &bytes)
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| err(&path, e))? {
        let entry = entry.map_err(|e| err(&path, e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(DirEntry { name, is_dir });
    }
    Ok(out)
}

#[tauri::command]
fn make_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| err(&path, e))
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn move_path(from: String, to: String) -> Result<(), String> {
    if let Some(dir) = Path::new(&to).parent() {
        fs::create_dir_all(dir).map_err(|e| err(&to, e))?;
    }
    fs::rename(&from, &to).map_err(|e| err(&from, e))
}

#[tauri::command]
fn remove_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| err(&path, e))
    } else if p.exists() {
        fs::remove_file(p).map_err(|e| err(&path, e))
    } else {
        Ok(())
    }
}

/// Watch the notes folder recursively and emit `fs-changed` with the touched paths.
/// Debouncing, filtering and merging are done by the frontend.
#[tauri::command]
fn watch_folder(app: AppHandle, state: State<WatchState>, path: String) -> Result<(), String> {
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if matches!(ev.kind, EventKind::Access(_)) {
                return;
            }
            let paths: Vec<String> = ev.paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
            let _ = app.emit("fs-changed", paths);
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| err(&path, e))?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(watcher);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(WatchState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_atomic,
            read_file_bytes,
            read_base64,
            write_base64,
            list_dir,
            make_dir,
            path_exists,
            move_path,
            remove_path,
            watch_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Typebook");
}
