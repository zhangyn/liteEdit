use encoding_rs::{BIG5, GB18030, UTF_16LE, WINDOWS_1252};
use serde::Serialize;
use std::fs;
use std::io;
use std::path::PathBuf;
use tauri::ipc::Response;

fn ioerr(e: io::Error) -> String {
    e.to_string()
}

/// 规范化路径:绝对化并去掉 Windows canonicalize 的 `\\?\` 前缀
pub fn normalize_path(p: &str) -> String {
    let pb = PathBuf::from(p);
    let canon = fs::canonicalize(&pb).unwrap_or(pb);
    let s = canon.to_string_lossy().into_owned();
    s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
}

#[derive(Serialize)]
pub struct StatInfo {
    pub mtime_ms: u64,
    pub size: u64,
}

/// 读取原始字节(走二进制 IPC 通道,前端用 TextDecoder 按编码解码)
#[tauri::command]
pub fn read_file(path: String) -> Result<Response, String> {
    let bytes = fs::read(&path).map_err(ioerr)?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn stat_file(path: String) -> Result<StatInfo, String> {
    let meta = fs::metadata(&path).map_err(ioerr)?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(StatInfo { mtime_ms, size: meta.len() })
}

/// 按 UTF-8 / UTF-8 BOM / GB18030 / Big5 / UTF-16LE / Latin-1 编码写入文本
#[tauri::command]
pub fn write_text(path: String, text: String, encoding: String) -> Result<(u64, bool), String> {
    let bytes: Vec<u8> = match encoding.as_str() {
        "utf-8" => text.into_bytes(),
        "utf-8-bom" => {
            let mut b = vec![0xEF, 0xBB, 0xBF];
            b.extend_from_slice(text.as_bytes());
            b
        }
        "utf-16le" => {
            let (cow, _, had) = UTF_16LE.encode(&text);
            let _ = had;
            let mut b = vec![0xFF, 0xFE]; // UTF-16LE BOM,便于系统记事本识别
            b.extend_from_slice(&cow);
            b
        }
        "gb18030" => {
            let (cow, _, had) = GB18030.encode(&text);
            let _ = had;
            cow.into_owned()
        }
        "big5" => {
            let (cow, _, had) = BIG5.encode(&text);
            let _ = had;
            cow.into_owned()
        }
        "latin1" => {
            let (cow, _, had) = WINDOWS_1252.encode(&text);
            let _ = had;
            cow.into_owned()
        }
        _ => return Err(format!("未知编码:{}", encoding)),
    };
    let n = bytes.len() as u64;
    fs::write(&path, &bytes).map_err(ioerr)?;
    Ok((n, false))
}

#[derive(Serialize)]
pub struct DirEntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub fn read_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&path).map_err(ioerr)? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(DirEntryInfo {
            path: entry.path().to_string_lossy().into_owned(),
            name,
            is_dir,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    if std::path::Path::new(&path).exists() {
        return Err("文件已存在".into());
    }
    fs::write(&path, b"").map_err(ioerr)
}

#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(ioerr)
}

#[tauri::command]
pub fn rename_entry(from: String, to: String) -> Result<(), String> {
    if std::path::Path::new(&to).exists() {
        return Err("目标已存在".into());
    }
    fs::rename(&from, &to).map_err(ioerr)
}

/// 删除到系统回收站
#[tauri::command]
pub fn trash_delete(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

/// 在资源管理器中显示(文件则选中,目录则打开)
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = path.replace('/', "\\");
    if std::path::Path::new(&p).is_dir() {
        std::process::Command::new("explorer").arg(&p).spawn().map_err(ioerr)?;
    } else {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", p))
            .spawn()
            .map_err(ioerr)?;
    }
    Ok(())
}

/// 启动参数里传入的文件(文件关联双击打开)
#[tauri::command]
pub fn get_cli_files() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|a| std::path::Path::new(a).is_file())
                .map(|a| normalize_path(a.as_str()))
        .collect()
}

#[tauri::command]
pub fn app_version(app: tauri::AppHandle) -> String {
    format!(
        "LiteEdit v{}(Tauri {})",
        app.package_info().version,
        tauri::VERSION
    )
}
