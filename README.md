# electerm

仓库地址：https://github.com/zyg1923/electerm

```powershell
git clone https://github.com/zyg1923/electerm.git
```

本仓库不提交依赖目录和安装包。克隆后如何安装、如何打 Windows 包、缺了哪些文件，见 [打包与部署.md](打包与部署.md)。

终端 / SSH / SFTP / FTP / Telnet / 串口 / RDP / VNC / Spice 客户端，支持 Linux、macOS、Windows。

## Features

- Works as a terminal/file manager, ssh/sftp/ftp/telnet/serialport/RDP/VNC/Spice client
- Support Window 7+(X64/ARM64), HarmonyOS, Android, iOS, Mac OS 10.15+(x64/arm64), Linux(x64/arm64/Loong64), including older Linux with glibc 2.17+ such as UOS, Kylin, Ubuntu 18.04
- Global hotkey to toggle window visibility (similar to guake, default is `ctrl + 2`)
- Multi-language support
- Double click to directly edit (small) remote files
- Auth methods: publicKey, password, ssh agent, certificates, otp, netbird
- Zmodem (rz, sz) and trzsz (trz/tsz)
- SSH tunnel and connection hopping
- Customizable UI: themes, background image, transparent window (Mac, Windows)
- Global/session proxy
- Quick commands and triggers
- Sync bookmarks to GitHub/Gitee secret gist, WebDAV, or a custom server
- Quick input and mirror input to one or all terminals
- AI assistant for command suggestions, scripts, and explaining selected terminal content
- Deep link support, for example `ssh://user@host:22` or `telnet://192.168.2.31:34554`

## 开发

```powershell
git clone https://github.com/zyg1923/electerm.git
cd electerm
npm config set legacy-peer-deps true
npm i
npm start
```

另开一个终端运行：

```powershell
npm run app
```

## Windows 本地编译 / 打包

在 PowerShell 中进入仓库根目录后执行：

```powershell
npm run b

if (-not (Test-Path .\work\app\node_modules)) {
  Set-Location .\work\app
  npm i --omit=dev --legacy-peer-deps
  Set-Location ..\..
}

npm run pb

Get-Process electerm -ErrorAction SilentlyContinue | Stop-Process -Force
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npx electron-builder --win dir --x64 --publish never --config.npmRebuild=false
```

产物在 `dist\win-unpacked\electerm.exe`。

| 步骤 | 命令 | 说明 |
|------|------|------|
| 编译 | `npm run b` | clean + compile + prepare-file |
| 补依赖 | 在 `work\app` 里执行 `npm i --omit=dev --legacy-peer-deps` | 仅当 `work\app\node_modules` 不存在时需要 |
| 准备打包 | `npm run pb` | 生成 `electron-builder.json` |
| 打包 | `npx electron-builder --win dir --x64 --publish never --config.npmRebuild=false` | 输出到 `dist\win-unpacked\` |

- `EPERM ... unlink electerm.exe`：先关掉正在运行的 electerm，再打包。
- `ERESOLVE` peer deps：使用上面的 `--legacy-peer-deps`。
- 本机没有 VS C++ 工具链时保留 `--config.npmRebuild=false`。

## License

MIT
