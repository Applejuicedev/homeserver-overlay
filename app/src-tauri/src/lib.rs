use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[tauri::command]
fn set_click_through(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(enabled).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("overlay") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_window_state::Builder::default().build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
            let toggle_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyH);
            if shortcut == &toggle_shortcut && event.state() == ShortcutState::Pressed {
                if let Some(window) = app.get_webview_window("overlay") {
                    let current = window.is_visible().unwrap_or(true);
                    let _ = window.emit("toggle-click-through", ());
                    let _ = current;
                }
            }
        }).build())
        .setup(|app| {
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyH);
            app.global_shortcut().register(shortcut)?;

            let show_item = MenuItem::with_id(app, "show", "Anzeigen", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Verstecken", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .icon(app.default_window_icon().cloned().unwrap())
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("overlay") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(w) = app.get_webview_window("overlay") {
                            let _ = w.hide();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("overlay") {
                let win_clone = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![set_click_through])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
