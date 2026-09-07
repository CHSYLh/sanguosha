/**
 * 生成 Windows 一键启动/停止脚本。
 *
 * 关键点：.bat 必须以 GBK(936) 编码保存且不能出现 chcp 65001。
 * 原因：cmd 始终按系统当前代码页（简体中文 Windows 为 936）逐字节解析批处理文件，
 *      UTF-8 的中文（3 字节）会被误判成多个 GBK 字符，导致行边界错乱、
 *      命令被截断（如 powershell 变成 ershell），脚本完全不可用。
 *      chcp 只改变「输出」编码，不会改变「文件解析」编码，因此救不了。
 *
 * 本脚本始终把内存中的 UTF-8 内容转成 GBK 后写入，可重复执行且不会破坏已有文件。
 * 用法：node tools/build-launchers.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const START = `@echo off
title 三国杀联机服务
rem 注意：%~dp0 以反斜杠结尾，写成 "%~dp0" 会让 cmd 把结尾的反斜杠当成转义符，
rem      必须用 "%~dp0." 这种形式，否则整条命令会被当成非法路径。
cd /d "%~dp0."

echo ============================================
echo   三国杀联机版 - 一键启动
echo ============================================
echo.

rem ---- 检查 Node.js ----
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js。
  echo        请先到 https://nodejs.org 下载安装。
  echo.
  pause
  exit /b 1
)

rem ---- 首次运行自动安装依赖 ----
if not exist "node_modules" (
  echo 首次运行，正在安装依赖，请稍候...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
  echo 依赖安装完成。
  echo.
)

rem ---- 服务已在别处启动：直接打开浏览器，避免端口占用报错 ----
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://localhost:3000/healthz' -UseBasicParsing -TimeoutSec 2) | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo 检测到服务已经在运行中，直接打开浏览器。
  echo 如需重启，请先关闭此前的运行窗口，或双击「停止三国杀.bat」。
  echo.
  start "" http://localhost:3000
  timeout /t 3 >nul
  exit /b 0
)

echo 正在启动服务，启动后会自动打开浏览器。
echo 局域网内其他设备访问下面输出的「局域网访问」地址即可加入。
echo.
echo 关闭本窗口即可停止服务；也可用「停止三国杀.bat」结束后台进程。
echo ============================================
echo.

start "" http://localhost:3000

node server.js

echo.
echo 服务已停止。
pause
`;

const STOP = `@echo off
title 停止三国杀服务
rem %~dp0 以反斜杠结尾，须写成 %~dp0. 否则引号被当成转义
cd /d "%~dp0."

echo ============================================
echo   停止三国杀联机服务
echo ============================================
echo.
echo 正在查找并停止服务进程...

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\\stop-server.ps1"
if errorlevel 1 (
  echo.
  echo PowerShell 不可用，请改为关闭运行服务时的那个窗口。
) else (
  echo.
)

echo.
echo 若提示没有找到进程，说明服务已经关闭。
echo.
pause
`;

/** 找到根目录下带指定关键字的 .bat（中文名交给 Node 处理，避免命令行转码问题） */
function findBat(marker, fallback) {
  const hit = fs.readdirSync(ROOT).find((f) => f.endsWith('.bat') && f.indexOf(marker) >= 0);
  return hit || fallback;
}

const targets = [
  { tmp: '_build_start.bat', marker: '启动', fallback: '启动三国杀.bat', content: START },
  { tmp: '_build_stop.bat', marker: '停止', fallback: '停止三国杀.bat', content: STOP },
];

const tmpDir = path.join(__dirname, '_launcher_tmp');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

// cmd 解析 .bat 必须使用 CRLF；裸 LF 会让行被错误拼接，导致命令被截断（脚本完全不可用）
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
for (const t of targets) fs.writeFileSync(path.join(tmpDir, t.tmp), crlf(t.content), 'utf8');

// 由 PowerShell 完成 UTF-8 -> GBK（临时路径全为 ASCII，不会有编码歧义）
const psFile = path.join(tmpDir, '_convert.ps1');
fs.writeFileSync(psFile, [
  '$gb = [Text.Encoding]::GetEncoding(936)',
  "Get-ChildItem -LiteralPath '" + tmpDir + "' -Filter '*.bat' | ForEach-Object {",
  '  $s = [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8)',
  '  [IO.File]::WriteAllText($_.FullName, $s, $gb)',
  '}',
].join('\r\n'), 'utf8');

const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error('编码转换失败：', r.stdout, r.stderr);
  process.exit(1);
}

for (const t of targets) {
  const bytes = fs.readFileSync(path.join(tmpDir, t.tmp));
  const dest = path.join(ROOT, findBat(t.marker, t.fallback));
  fs.writeFileSync(dest, bytes);
  const nonAscii = Array.from(bytes).filter((b) => b > 127).length;
  console.log('已生成 ' + path.basename(dest) + ' (' + bytes.length + ' 字节, 中文字节 ' + nonAscii + ') -> GBK');
}

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('完成。');
