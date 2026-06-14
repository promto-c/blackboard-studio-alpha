#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

fn main() {
    configure_linux_webkit();

    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Blackboard Studio desktop app");
}
