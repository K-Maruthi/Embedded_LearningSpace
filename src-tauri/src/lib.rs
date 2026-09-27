mod pipeline;
mod toolchain;

use toolchain::ToolchainInfo;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![toolchain_status, pipeline_sources, pipeline_run])
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
