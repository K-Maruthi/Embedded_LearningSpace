mod pipeline;
mod toolchain;

use tauri_plugin_dialog::DialogExt;
use toolchain::ToolchainInfo;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            toolchain_status,
            pipeline_sources,
            pipeline_run,
            backup_save_dialog,
            backup_open_dialog,
            backup_write,
            backup_read
        ])
        .run(tauri::generate_context!())
        .expect("error while running Embedded Learning Space");
}

/// Report whether an arm-none-eabi-gcc toolchain was detected and its version.
#[tauri::command]
async fn toolchain_status() -> Result<ToolchainInfo, String> {
    tauri::async_runtime::spawn_blocking(toolchain::detect)
        .await
        .map_err(|e| e.to_string())
}

/// The fixed example sources shown in the lab bench editors by default.
#[tauri::command]
fn pipeline_sources() -> pipeline::SourcesBundle {
    pipeline::default_sources()
}

/// Compile the lab example (optionally user-edited) through the real toolchain.
/// Only the three fixed source slots are accepted; filenames and flags are ours.
#[tauri::command]
async fn pipeline_run(sources: Option<pipeline::Sources>) -> Result<pipeline::PipelineReport, String> {
    let defaults = pipeline::default_sources();
    let src = pipeline::resolve_sources(sources)?;
    let custom = src.main_c != defaults.main_c
        || src.startup_s != defaults.startup_s
        || src.linker_ld != defaults.linker_ld;
    let info = tauri::async_runtime::spawn_blocking(toolchain::detect)
        .await
        .map_err(|e| e.to_string())?;
    if !info.found {
        return Err("toolchain-not-found".into());
    }
    tauri::async_runtime::spawn_blocking(move || Ok(pipeline::run_pipeline(&info, &src, custom)))
        .await
        .map_err(|e| e.to_string())?
}

/// Ask the user where to save the backup file. Returns the chosen absolute
/// path, or None when the dialog was cancelled. The app writes the file
/// itself, so no fs-plugin scope over the whole disk is needed.
#[tauri::command]
async fn backup_save_dialog(
    app: tauri::AppHandle,
    default_name: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        app.dialog()
            .file()
            .set_file_name(&default_name)
            .add_filter("Embedded C Roadmap backup", &["json"])
            .pick_file(move |p| {
                let _ = tx.send(p.map(|f| f.to_string()));
            });
        rx.recv().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ask the user which backup file to open. Returns the chosen absolute path,
/// or None when cancelled; the app reads the file itself.
#[tauri::command]
async fn backup_open_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        app.dialog()
            .file()
            .add_filter("Embedded C Roadmap backup", &["json"])
            .pick_file(move |p| {
                let _ = tx.send(p.map(|f| f.to_string()));
            });
        rx.recv().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

const BACKUP_LIMIT: u64 = 20_000_000;

/// Write the exported backup to the path the user picked in the native
/// dialog. The path is only ever one the dialog returned; the .json
/// extension and a size cap are belt-and-braces sanity checks.
#[tauri::command]
async fn backup_write(path: String, contents: String) -> Result<(), String> {
    if !path.to_lowercase().ends_with(".json") {
        return Err("backup path must end in .json".into());
    }
    if contents.len() as u64 > BACKUP_LIMIT {
        return Err("backup too large".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::write(&path, contents).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read back the backup the user picked in the native dialog.
#[tauri::command]
async fn backup_read(path: String) -> Result<String, String> {
    if !path.to_lowercase().ends_with(".json") {
        return Err("backup path must end in .json".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if meta.len() > BACKUP_LIMIT {
            return Err("backup too large".into());
        }
        std::fs::read_to_string(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
