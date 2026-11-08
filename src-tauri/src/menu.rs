use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::Manager;

/// 菜单句柄与可勾选菜单项,供前端同步勾选状态/显隐菜单栏
pub struct MenuState {
    pub menu: Menu<tauri::Wry>,
    pub wrap: CheckMenuItem<tauri::Wry>,
    pub whitespace: CheckMenuItem<tauri::Wry>,
    pub sidebar: CheckMenuItem<tauri::Wry>,
    pub preview: CheckMenuItem<tauri::Wry>,
    pub toolbar: CheckMenuItem<tauri::Wry>,
    pub tab_bottom: CheckMenuItem<tauri::Wry>,
    pub menu_hidden: CheckMenuItem<tauri::Wry>,
}

/// 事件统一 emit "menu://action" 给前端分发;加速键只在原生菜单注册
pub fn build(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // ── 文件 ──────────────────────────────────────────────
    let file = SubmenuBuilder::new(app, "文件")
        .item(&MenuItem::with_id(app, "new_file", "新建", true, Some("Ctrl+N"))?)
        .item(&MenuItem::with_id(app, "open_file", "打开…", true, Some("Ctrl+O"))?)
        .separator()
        .item(&MenuItem::with_id(app, "save", "保存", true, Some("Ctrl+S"))?)
        .item(&MenuItem::with_id(app, "save_as", "另存为…", true, Some("Ctrl+Shift+S"))?)
        .item(&MenuItem::with_id(app, "save_all", "全部保存", true, Some("Ctrl+Alt+S"))?)
        .separator()
        .item(&MenuItem::with_id(app, "close_tab", "关闭标签", true, Some("Ctrl+W"))?)
        .separator()
        .item(&MenuItem::with_id(app, "quit", "退出", true, Some("Alt+F4"))?)
        .build()?;

    // ── 编辑 ──────────────────────────────────────────────
    // 剪切/复制/粘贴走系统预定义项(作用于焦点控件,IME 友好);
    // 撤销/重做在 Windows 无预定义实现,分发给前端 CodeMirror 处理
    let edit = SubmenuBuilder::new(app, "编辑")
        .item(&MenuItem::with_id(app, "undo", "撤销", true, Some("Ctrl+Z"))?)
        .item(&MenuItem::with_id(app, "redo", "重做", true, Some("Ctrl+Y"))?)
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .item(&PredefinedMenuItem::select_all(app, Some("全选"))?)
        .separator()
        .item(&MenuItem::with_id(app, "duplicate_line", "重复当前行", true, Some("Ctrl+D"))?)
        .item(&MenuItem::with_id(app, "delete_line", "删除当前行", true, Some("Ctrl+Shift+K"))?)
        .separator()
        .item(&MenuItem::with_id(app, "move_line_up", "上移行  Ctrl+Alt+↑", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "move_line_down", "下移行  Ctrl+Alt+↓", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "open_line_below", "在下方插入行  Ctrl+Enter", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "open_line_above", "在上方插入行  Ctrl+Shift+Enter", true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app, "to_upper", "转换为大写  Ctrl+Shift+U", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "to_lower", "转换为小写  Ctrl+U", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "insert_datetime", "插入日期时间  Ctrl+;", true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app, "toggle_bookmark", "切换书签  Ctrl+F2", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "next_bookmark", "下一个书签  F2", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "prev_bookmark", "上一个书签  Shift+F2", true, None::<&str>)?)
        .build()?;

    // ── 搜索 ──────────────────────────────────────────────
    let search = SubmenuBuilder::new(app, "搜索")
        .item(&MenuItem::with_id(app, "find", "查找…", true, Some("Ctrl+F"))?)
        .item(&MenuItem::with_id(app, "replace", "替换…", true, Some("Ctrl+H"))?)
        .separator()
        .item(&MenuItem::with_id(app, "find_next", "查找下一个", true, Some("F3"))?)
        .item(&MenuItem::with_id(app, "find_prev", "查找上一个", true, Some("Shift+F3"))?)
        .separator()
        .item(&MenuItem::with_id(app, "goto", "转到行…", true, Some("Ctrl+G"))?)
        .build()?;

    // ── 查看 ──────────────────────────────────────────────
    let wrap = CheckMenuItem::with_id(app, "toggle_wrap", "自动换行", true, false, Some("Ctrl+Alt+W"))?;
    let whitespace = CheckMenuItem::with_id(app, "toggle_whitespace", "显示空白符", true, false, None::<&str>)?;
    let sidebar = CheckMenuItem::with_id(app, "toggle_sidebar", "文件树侧栏", true, true, Some("Ctrl+B"))?;
    let preview = CheckMenuItem::with_id(app, "toggle_preview", "预览分栏", true, false, Some("Ctrl+Alt+V"))?;
    let toolbar = CheckMenuItem::with_id(app, "toggle_toolbar", "工具栏", true, true, None::<&str>)?;
    let tab_bottom = CheckMenuItem::with_id(app, "toggle_tabs_bottom", "页签在下方", true, false, None::<&str>)?;
    let menu_hidden = CheckMenuItem::with_id(app, "toggle_menubar", "隐藏菜单栏  Ctrl+M", true, false, None::<&str>)?;
    let view = SubmenuBuilder::new(app, "查看")
        .item(&wrap)
        .item(&whitespace)
        .separator()
        .item(&toolbar)
        .item(&sidebar)
        .item(&preview)
        .separator()
        .item(&tab_bottom)
        .item(&menu_hidden)
        .separator()
        .item(&MenuItem::with_id(app, "zoom_in", "字号增大", true, Some("Ctrl+Equal"))?)
        .item(&MenuItem::with_id(app, "zoom_out", "字号减小", true, Some("Ctrl+Minus"))?)
        .item(&MenuItem::with_id(app, "zoom_reset", "字号重置", true, Some("Ctrl+Digit0"))?)
        .separator()
        .item(&MenuItem::with_id(app, "toggle_theme", "切换深浅主题", true, Some("Ctrl+Alt+T"))?)
        .build()?;

    // ── 工具 ──────────────────────────────────────────────
    let tools = SubmenuBuilder::new(app, "工具")
        .item(&MenuItem::with_id(app, "list_single", "合并为列表(单引号)  Ctrl+1", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "list_double", "合并为列表(双引号)  Ctrl+2", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "list_none", "合并为列表(不加引号)  Ctrl+3", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "list_restore", "列表还原(拆分为多行)  Ctrl+4", true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app, "json_format", "JSON 格式化  Ctrl+5", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "json_minify", "JSON 压缩  Ctrl+6", true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app, "sql_format", "SQL 格式化  Ctrl+7", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "sql_minify", "SQL 压缩  Ctrl+8", true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app, "sort_asc", "行排序(升序)", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "sort_desc", "行排序(降序)", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "sort_unique", "删除重复行", true, None::<&str>)?)
        .build()?;

    // ── 帮助 ──────────────────────────────────────────────
    let help = SubmenuBuilder::new(app, "帮助")
        .item(&MenuItem::with_id(app, "about", "关于 LiteEdit", true, None::<&str>)?)
        .build()?;

    let menu = Menu::with_items(app, &[&file, &edit, &search, &view, &tools, &help])?;

    app.manage(MenuState {
        menu: menu.clone(),
        wrap: wrap.clone(),
        whitespace: whitespace.clone(),
        sidebar: sidebar.clone(),
        preview: preview.clone(),
        toolbar: toolbar.clone(),
        tab_bottom: tab_bottom.clone(),
        menu_hidden: menu_hidden.clone(),
    });

    Ok(menu)
}