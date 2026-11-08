mod commands;
mod menu;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance 需最先注册:二次启动携带文件参数时,聚焦原窗口并转发
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let files: Vec<String> = args
                .iter()
                .skip(1)
                .filter(|a| std::path::Path::new(a).is_file())
                .map(|a| commands::normalize_path(a))
                .collect();
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
                let _ = w.emit("open://files", &files);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::stat_file,
            commands::write_text,
            commands::read_dir,
            commands::create_file,
            commands::create_dir,
            commands::rename_entry,
            commands::trash_delete,
            commands::reveal_in_explorer,
            commands::get_cli_files,
            commands::app_version,
            set_menu_checks,
            set_menu_visible,
        ])
        .setup(|app| {
            let m = menu::build(app.handle())?;
            app.set_menu(m)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.emit("menu://action", event.id().as_ref());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 前端同步"查看"菜单勾选状态(前端状态为唯一事实来源)
#[tauri::command]
fn set_menu_checks(
    app: tauri::AppHandle,
    wrap: bool,
    whitespace: bool,
    sidebar: bool,
    preview: bool,
    toolbar: bool,
    tab_bottom: bool,
    menu_hidden: bool,
) -> Result<(), String> {
    use tauri::State;
    let ms: State<menu::MenuState> = app.state();
    ms.wrap.set_checked(wrap).map_err(|e| e.to_string())?;
    ms.whitespace.set_checked(whitespace).map_err(|e| e.to_string())?;
    ms.sidebar.set_checked(sidebar).map_err(|e| e.to_string())?;
    ms.preview.set_checked(preview).map_err(|e| e.to_string())?;
    ms.toolbar.set_checked(toolbar).map_err(|e| e.to_string())?;
    ms.tab_bottom.set_checked(tab_bottom).map_err(|e| e.to_string())?;
    ms.menu_hidden.set_checked(menu_hidden).map_err(|e| e.to_string())?;
    Ok(())
}

/// 显示/隐藏原生菜单栏(隐藏后快捷键走前端兜底,Ctrl+M 呼回)
#[tauri::command]
fn set_menu_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    use tauri::State;
    let ms: State<menu::MenuState> = app.state();
    if let Some(w) = app.get_webview_window("main") {
        if visible {
            w.set_menu(ms.menu.clone()).map_err(|e| e.to_string())?;
        } else {
            w.remove_menu().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
