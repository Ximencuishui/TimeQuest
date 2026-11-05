# TimeQuest

高考倒计时 · 自习推进器。单机本地优先的桌面应用：数据留在本机 SQLite，不设账号，也不做云同步。

当前版本：**1.0.0**

仓库：<https://github.com/Ximencuishui/TimeQuest>

## 功能

- 考试倒计时（默认下一次高考日期可在设置里改）
- 主线与副本任务，按轮次累计实际完成量
- 今日排期：完成、部分完成、改期（改期保留原记录）
- 经验、等级、连击与成就，只按实际完成量发放
- 统计：达成率、科目、学习方式占比
- 本地便签
- JSON 备份的导出与导入（`timequest-backup-YYYYMMDD.json`）

任务进度等于各场次 `actual_units` 之和，不另记一份完成数。

## 技术栈

- 界面：React 19、TypeScript、Vite、Tailwind CSS
- 桌面壳：Tauri 2
- 数据：SQLite（`timequest.db`）。React 不直接打开数据库，读写都走 Tauri command

## 环境

- Node.js 与 [pnpm](https://pnpm.io/)
- Rust stable（`rustup`、`cargo`）
- Windows 打包还需要 WebView2 与 MSVC 构建工具

## 开发

```bash
pnpm install
pnpm tauri dev
```

只启动前端（不含桌面壳）：

```bash
pnpm dev
```

## 测试

```bash
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture
```

## 版本

遵循 SemVer：主版本号.次版本号.修订号。

`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 三处版本必须一致。发布前用下面这条命令一起改，不要只改其中一个文件：

```bash
pnpm bump 1.0.1
```

## 打包

```bash
pnpm tauri build
```

Windows 安装包在 `src-tauri/target/release/bundle/`。若 NSIS 下载超时，可以只打 MSI：

```bash
pnpm tauri build --bundles msi
```

## 数据

- 数据库在应用数据目录中的 `timequest.db`
- 考试日期写在本机 `localStorage`（键 `timequest.exams`），不进数据库
- 导入前，应用会把当前库复制为 `timequest.bak-YYYYMMDDHHMMSS.db`
