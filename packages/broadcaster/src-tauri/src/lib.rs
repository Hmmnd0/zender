use tauri::Manager;

#[tauri::command]
async fn launch_channel_server(
    node_bin: String,
    script: String,
    config: String,
    cwd: String,
) -> Result<u32, String> {
    let child = std::process::Command::new(&node_bin)
        .arg(&script)
        .arg(&config)
        .current_dir(&cwd)
        .spawn()
        .map_err(|e| format!("Failed to spawn node: {e}"))?;
    Ok(child.id())
}

#[tauri::command]
async fn kill_channel_server(pid: u32) -> Result<(), String> {
    std::process::Command::new("kill")
        .arg(pid.to_string())
        .spawn()
        .map_err(|e| format!("Failed to kill server: {e}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![launch_channel_server, kill_channel_server])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
