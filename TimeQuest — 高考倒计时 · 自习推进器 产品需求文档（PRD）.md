# TimeQuest — 高考倒计时 · 自习推进器 产品需求文档（PRD）

**产品名**：TimeQuest（中文副标：高考倒计时 · 自习推进器）  

**版本**：v1.0  

**形态**：Windows 桌面端轻量应用（Tauri 2 + React 19 + TypeScript + SQLite）  

**定位**：单机、本地优先、无账号、无网络依赖的高考自学闭环工具  

**核心闭环**：倒计时 → 任务/排期 → 完成/改期 → 标签统计 → 游戏化反馈

---

## 1. 项目目标与边界

### 1.1 要解决的问题

高考自学场景下，学生同时面对四件事：**时间压力（倒计时）、计划安排（作息/任务）、实际执行记录、自我评估**。现有工具要么只做倒计时（PlainCEETimer），要么只做标签化时间记录（Traggo），要么只做待办（XFocus），数据割裂，无法回答“我的计划 vs 实际差在哪、效率如何”。

### 1.2 产品目标

TimeQuest 用一个本地桌面应用，把“倒计时看板 + 任务进度 + 时段排期 + 实际记录 + 统计 + 轻游戏化”整合在同一个数据模型里，让用户每天打开就能看到：**离高考还有多久、今天该做什么、做了多少、和计划差多少、下一步怎么调**。

### 1.3 明确不做

- 不做云同步、账号体系、排行榜、社交

- 不做复杂甘特图、项目管理级依赖关系

- 不做惩罚性机制（掉级、扣血、断连击清零历史）

- 不做富文本便签（v1 纯文本，富文本后续迭代）

- 不做移动端（v1 只做 Windows 桌面；架构上不排斥后续 Tauri 移动端）

---

## 2. 用户与核心场景

**目标用户**：高三自学/半自学学生，有明确高考日期，需要自己安排每日学习。

**核心场景**：

1. **早晨打开**：看到倒计时、今日排期时间轴、昨日未完成项。

2. **学习一个时段后**：点“完成”，填实际课数和自评；或点“改期”，把没做的挪到晚上/明天。

3. **晚上复盘**：看今日计划达成率、各科目实际投入 vs 计划、连击状态。

4. **周复盘**：看本周各科目/学习方式的分钟统计、达成率、平均自评、成就解锁。

5. **临时想法**：在便签墙写一张彩色便签，置顶提醒自己。

---

## 3. 核心设计原则

1. **进度唯一真相**：任务进度 = `sum(actual_units)`，不单独维护 completed 字段，避免改期/补记对不上。

2. **改期不是失败**：改期保留原记录并标 `rescheduled`，历史可追溯；达成率统计包含改期，不粉饰数据。

3. **奖励真实推进**：XP 只与 `actual_units` 挂钩，不与“打开弹窗/点按钮”挂钩；自评只做小幅乘数，防止虚报。

4. **正向驱动，不制造焦虑**：无惩罚性机制；改期恢复有额外奖励；连击断掉只重置倍率，不清历史。

5. **数据本地可控**：SQLite 单文件，支持导出/导入，用户随时可带走数据。

---

## 4. 功能需求

### M1. 高考倒计时看板

| 编号 | 需求 | 说明 |

|---|---|---|

| M1-1 | 目标日期设置 | 默认高考日期可改；支持多考试（如模考）切换，主看板显示当前主目标 |

| M1-2 | 多粒度倒计时 | 显示剩余总天数、周数、月数，以及时/分/秒实时倒计时 |

| M1-3 | 看板常驻 | 窗口可置顶；关闭时最小化到托盘而非退出（可设置） |

| M1-4 | 防误关 | 关闭按钮可配置为“最小化到托盘”，托盘菜单提供退出 |

| M1-5 | 性能 | 秒级刷新使用单一 interval，组件卸载清理，避免内存泄漏 |

**验收**：修改目标日期后看板立即更新；跨天/跨秒无跳变错误；连续运行 24h 内存无明显增长。

---

### M2. 任务管理（主线 / 副本）

**概念模型**：

- **任务（Task）** 承载“总量、课本、轮次、进度”，是长期存在的实体。

- **排期（Session）** 承载“某天某时段做这个任务的多少课”，是任务在时间轴上的实例。

| 编号 | 需求 | 说明 |

|---|---|---|

| M2-1 | 创建主线任务 | 字段：标题、科目、课本名、计量单位（课/章/节）、总课数、总轮次、颜色 |

| M2-2 | 创建副本任务 | 字段：标题、颜色；总课数/课本可空，进度条隐藏，只显示累计时长与完成次数 |

| M2-3 | 任务列表 | 主线/副本分组卡片；显示进度环（本轮课数进度 + 总轮次进度） |

| M2-4 | 任务详情 | 课本信息、当前轮次、进度、全部 session 历史（按状态着色） |

| M2-5 | 轮次推进 | 当前轮次手动推进；session 带 `round` 字段；详情页按轮次分组展示“第 2 轮 · 12/40 课” |

| M2-6 | 归档 | 任务可归档，归档后不出现在新建排期的选择列表，历史保留 |

**验收**：新建任务后可在排期中选择；任务进度随 session 完成实时更新；归档任务不影响历史统计。

---

### M3. 排期与今日计划

| 编号 | 需求 | 说明 |

|---|---|---|

| M3-1 | 创建排期 | 选任务、日期、开始/结束时间、轮次（默认任务当前轮）、本次计划课数 |

| M3-2 | 今日时间轴 | 按时间排序展示当天所有 session，主线/副本科目标色区分 |

| M3-3 | 冲突提示 | 同一时段重叠时给出非阻塞提示，不强制阻止 |

| M3-4 | 快速操作 | 每张卡片提供“完成 ✓”和“改期 ↻”两个主操作 |

| M3-5 | 空状态 | 今日无排期时展示引导创建 |

**验收**：创建排期后今日页立即出现；时间轴排序正确；改期后原卡片状态更新。

---

### M4. 完成与改期流程（核心交互）

**三种真实场景，弹窗要区分：**

| 场景 | 触发 | 弹窗内容 | 系统行为 |

|---|---|---|---|

| ① 完全完成 | 点“完成” | 实际课数（默认=计划课数）、1–5 星自评、可选备注 | session → `done`；写 `actual_logs` 学习流水；计算 XP |

| ② 部分完成 | 点“完成”且实际课数 < 计划 | 同上 + 勾选“剩余改到下次” | 原 session → `done`；剩余课数生成新 `planned` session 放到用户选的时间 |

| ③ 完全没做 / 整体改期 | 点“改期” | 只选新日期时段 | 原 session → `rescheduled` 并记录 `rescheduled_to` 指向新 session |

**约束**：

- 完成提交必须**幂等**：若 session 已是 `done`，不重复写流水、不重复加 XP。

- 改期**不删除**原记录。

- 部分完成的“剩余改到下次”生成的新 session 继承原任务的轮次和科目。

**验收**：三种场景各自产生正确状态；重复点击完成不产生重复流水；改期后历史可见且达成率统计正确。

---

### M5. 标签化时间记录与统计

**标签维度**`subject`（科目）+ `method`（学习方式：听课/刷题/整理）+ `tag_type`（学习/运动/游戏/其他）。完成 session 时自动写入 `actual_logs`；也支持手动补记（不绑定 session）。

| 编号 | 需求 | 说明 |

|---|---|---|

| M5-1 | 快速记录 | 只要求选标签 + 可选开始时间，结束时间可后补；时长在 Rust 侧算好存 `duration_min` |

| M5-2 | 计划 vs 实际 | 按周/月切换，每个科目计划总分钟 vs 实际总分钟，并排条形图 |

| M5-3 | 学习方式占比 | 听课/刷题/整理的实际分钟占比 |

| M5-4 | 运动/游戏 | 单独按 `tag_type` 汇总，不计入学习效率 |

| M5-5 | 计划达成率 | `done / (done + missed + rescheduled)`，按周/月 |

| M5-6 | 平均自评 | 按科目/任务聚合自评星级均值 |

**实现约束**：统计查询尽量写在 SQL / Rust command 中，前端只渲染，不拉全量数组在前端 filter。

**验收**：切换周/月数据正确；计划为 0 时不出现除零错误；运动/游戏不计入学习效率分母。

---

### M6. 多颜色便签墙

| 编号 | 需求 | 说明 |

|---|---|---|

| M6-1 | 创建便签 | 纯文本内容 + 6 种预设颜色 |

| M6-2 | 置顶 | 置顶便签排在前面，视觉上有标记 |

| M6-3 | 编辑/删除 | 就地编辑，删除需确认 |

| M6-4 | 排序 | 默认按更新时间倒序；置顶优先 |

**验收**：颜色映射为 Tailwind 类名，不引入复杂主题系统；便签数据持久化在 SQLite。

---

### M7. 游戏化系统

**基调**：正向进度感驱动，无惩罚。XP 只奖励 `actual_units`，不奖励“打开弹窗”。

#### 7.1 XP 规则

```

单次 session XP = actual_units × 基础单位XP × 质量乘数 × 连击乘数

```

- 基础单位 XP：主线略高于副本，差距不夸张（建议 1.2 : 1）。

- 质量乘数：自评 4–5 星 ×1.2，3 星 ×1.0，1–2 星 ×0.9（小幅，防虚报）。

- 连击乘数：见 7.2。

- `actual_units = 0` 时 XP = 0。

- 改期后在新时段完成：额外一笔 `reschedule_recovery_bonus`。

#### 7.2 连击（Streak）

- 定义：连续 N 天至少有一个 `done` session。

- 倍率随连击天数阶梯提升（如 3 天 ×1.1，7 天 ×1.2，14 天 ×1.3，封顶 ×1.5）。

- 断连击只重置倍率为 1，**不清零历史最长连击记录**。

#### 7.3 等级

- 等级曲线递增：早期升级快、后期放缓。建议 `XP_req(level) ≈ 100 × level^1.5`，可在 `gamification.ts` 中调参。

- 等级只做展示与成就解锁条件，不附带数值惩罚/限制。

#### 7.4 成就（行为模式类，非数值堆砌）

| 成就 | 条件 |

|---|---|

| 首轮完成 | 某主线任务当前轮 `sum(actual_units) >= total_units` |

| 逆风翻盘 | 一个 `rescheduled` session 在新时段完成且自评 ≥4 星 |

| 均衡发展 | 一周内主线和副本都有 `done` 记录 |

| 持续在场 | 连续 5 天有 `done` session（断掉只重置倍率，成就保留） |

成就解锁只记录 + 触发 Toast，**不额外给大额 XP**，保持“身份感”。

#### 7.5 前端组件

- 使用 **Questro**（零依赖、约 50KB）：Combo Meter（连击倍率）、Achievement Toast（全屏庆祝+彩带）、Progress Rings（课数/轮次双环）。

- 成就 Toast 只在重要里程碑触发，不每次完成都弹。

- 改期弹窗用中性色调，文案强调“重新安排也是计划的一部分”。

**验收**：XP 计算为纯函数且有单测；重复提交不重复加 XP；连击跨天判断正确（本地时区）。

---

### M8. 设置与数据管理

| 编号 | 需求 | 说明 |

|---|---|---|

| M8-1 | 目标日期管理 | 主目标 + 多考试切换 |

| M8-2 | 托盘行为 | 关闭最小化/退出可选 |

| M8-3 | 数据导出 | 导出 SQLite 文件或 JSON，文件名 `timequest-backup-YYYYMMDD.json` |

| M8-4 | 数据导入 | 导入前备份当前数据并确认 |

| M8-5 | 主题 | 深色为主，与倒计时看板协调 |

---

## 5. 数据模型（SQLite DDL 草案）

```sql

-- 任务

CREATE TABLE tasks (

  id            INTEGER PRIMARY KEY AUTOINCREMENT,

  title         TEXT NOT NULL,

  type          TEXT NOT NULL CHECK(type IN ('main','side')),

  subject       TEXT,

  textbook      TEXT,

  unit_name     TEXT DEFAULT '课',

  total_units   INTEGER,

  total_rounds  INTEGER DEFAULT 1,

  current_round INTEGER DEFAULT 1,

  color         TEXT,

  archived      INTEGER DEFAULT 0,

  created_at    TEXT NOT NULL DEFAULT (datetime('now'))

);

-- 排期实例

CREATE TABLE task_sessions (

  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  task_id         INTEGER NOT NULL REFERENCES tasks(id),

  date            TEXT NOT NULL,

  start_time      TEXT NOT NULL,

  end_time        TEXT NOT NULL,

  round           INTEGER DEFAULT 1,

  status          TEXT NOT NULL DEFAULT 'planned'

                  CHECK(status IN ('planned','done','missed','rescheduled')),

  planned_units   INTEGER DEFAULT 0,

  actual_units    INTEGER DEFAULT 0,

  self_rating     INTEGER,

  self_note       TEXT,

  rescheduled_to  INTEGER REFERENCES task_sessions(id),

  xp_awarded      INTEGER DEFAULT 0,

  created_at      TEXT NOT NULL DEFAULT (datetime('now'))

);

-- 实际学习流水（标签统计来源）

CREATE TABLE actual_logs (

  id           INTEGER PRIMARY KEY AUTOINCREMENT,

  date         TEXT NOT NULL,

  start_at     TEXT,

  end_at       TEXT,

  duration_min INTEGER NOT NULL,

  subject      TEXT,

  method       TEXT,

  tag_type     TEXT NOT NULL DEFAULT 'study'

               CHECK(tag_type IN ('study','sport','game','other')),

  session_id   INTEGER REFERENCES task_sessions(id),

  note         TEXT,

  created_at   TEXT NOT NULL DEFAULT (datetime('now'))

);

-- 便签

CREATE TABLE notes (

  id         INTEGER PRIMARY KEY AUTOINCREMENT,

  content    TEXT NOT NULL,

  color      TEXT NOT NULL DEFAULT 'yellow',

  pinned     INTEGER DEFAULT 0,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  updated_at TEXT NOT NULL DEFAULT (datetime('now'))

);

-- 用户统计（单行）

CREATE TABLE user_stats (

  id               INTEGER PRIMARY KEY CHECK(id = 1),

  total_xp         INTEGER DEFAULT 0,

  current_level    INTEGER DEFAULT 1,

  current_streak   INTEGER DEFAULT 0,

  longest_streak   INTEGER DEFAULT 0,

  last_done_date   TEXT

);

-- 成就

CREATE TABLE achievements (

  id          TEXT PRIMARY KEY,

  name        TEXT NOT NULL,

  description TEXT

);

CREATE TABLE user_achievements (

  achievement_id TEXT PRIMARY KEY REFERENCES achievements(id),

  unlocked_at    TEXT NOT NULL DEFAULT (datetime('now'))

);

```

**索引建议**`task_sessions(date)task_sessions(task_id)actual_logs(date)actual_logs(session_id)`。

---

## 6. 技术架构

| 层 | 选型 | 职责 |

|---|---|---|

| 壳 | Tauri 2 | 窗口、托盘、置顶、打包、文件导入导出 |

| 前端 | React 19 + TypeScript + Vite | UI 与交互 |

| 样式 | Tailwind CSS | 主题与布局 |

| 状态 | Zustand | UI 状态（当前页、弹窗、筛选） |

| 数据 | TanStack Query | 持久化数据读写与缓存 |

| 图表 | Recharts | 统计图 |

| 游戏化 UI | Questro | Combo Meter / Toast / Progress Rings |

| 数据库 | SQLite`@tauri-apps/plugin-sql`） | 本地存储 |

| 业务逻辑 | Rust commands | 所有 SQL 读写、XP 写入事务、时长计算 |

**架构约定（写入 Cursor Rules / [AGENTS.md](http://AGENTS.md)）**：

- React **不直接**访问数据库文件，所有读写走 Tauri command。

- XP 计算、等级曲线、成就判定放在 `src/lib/gamification.ts` 纯函数，附 vitest。

- 统计聚合写在 SQL / Rust，前端不拉全量数组 filter。

- 所有状态变更（完成/改期/部分完成）在 Rust command 中用事务保证一致性。

**建议目录**：

```

src/

  pages/        Dashboard / Tasks / Today / Stats / Notes / Settings

  components/   通用 UI + 任务卡片 + 弹窗

  lib/          gamification.ts / date.ts / colors.ts / constants.ts

  hooks/        useTasks / useSessions / useLogs / useStats

  store/        zustand

src-tauri/

  src/commands/ [tasks.rs](http://tasks.rs) / [sessions.rs](http://sessions.rs) / [logs.rs](http://logs.rs) / [stats.rs](http://stats.rs) / [gamification.rs](http://gamification.rs)

  src/[db.rs](http://db.rs)     迁移与连接

```

---

## 7. 命名与品牌规范

| 场景 | 写法 | 说明 |

|---|---|---|

| 产品名（展示） | **TimeQuest** | 英文主名，首字母大写，不拆成 Time Quest |

| 中文副标 | **高考倒计时 · 自习推进器** | 固定搭配，出现在标题栏、README 首行、关于页 |

| 完整署名 | **TimeQuest — 高考倒计时 · 自习推进器** | 用于 README 标题、安装包描述、关于页 |

| 仓库名 | `timequest` | 全小写，GitHub 仓库 |

| npm 包名（如需要） | `@yourname/timequest` 或 `timequest-app` | 避免与已有 `timequest` 包冲突，先查重 |

| Tauri identifier | `com.yourname.timequest` | 反向域名`yourname` 换成你的 GitHub 名 |

| 窗口标题 | `TimeQuest` | 副标放关于页，标题栏保持干净 |

| 托盘 tooltip | `TimeQuest · 高考倒计时` | 托盘空间有限，用短副标 |

| 数据库文件名 | `timequest.db` | 放在 Tauri appData 目录 |

| 导出文件名 | `timequest-backup-YYYYMMDD.json` | 便于识别 |

| 主题色 | 深色底 + 单一强调色 | 建议强调色取“冲刺橙”或“专注青”，不要多色混战 |

**一致性原则**：代码里凡是出现产品名的地方，统一引用 `src/lib/constants.ts`：

```ts

export const APP_NAME = "TimeQuest";

export const APP_SUBTITLE = "高考倒计时 · 自习推进器";

export const APP_FULL_NAME = `${APP_NAME} — ${APP_SUBTITLE}`;

export const DB_FILE = "timequest.db";

```

---

## 8. 页面清单

| 页面 | 内容 |

|---|---|

| 倒计时看板（首页） | 倒计时、今日排期摘要、连击/等级状态条 |

| 任务 | 主线/副本分组卡片、新建任务、任务详情（进度环 + session 历史） |

| 今日计划 | 时间轴、完成/改期入口、冲突提示 |

| 统计 | 计划 vs 实际、学习方式占比、达成率、平均自评，周/月切换 |

| 便签墙 | 彩色便签、置顶、编辑 |

| 设置 | 目标日期、托盘行为、数据导入导出、主题 |

---

## 9. 非功能需求

- **性能**：冷启动 < 2s；倒计时 tick 不影响页面交互；统计查询在 1 万条 session 量级下 < 200ms。

- **可靠性**：完成/改期操作事务化；重复提交幂等；导入前自动备份。

- **数据安全**：全部本地存储，无网络请求；导出文件明确提示包含个人学习数据。

- **可维护性**`gamification.ts` 纯函数 + 单测；SQL 集中在 Rust command；表结构迁移有版本号。

- **可访问性**：深色主题下对比度达标；关键操作有键盘可达路径（至少完成/改期）。

---

## 10. 开发阶段规划（建议按此顺序交给 Cursor）

| 阶段 | 内容 | 完成标志 |

|---|---|---|

| P1 | Tauri + React + Tailwind 骨架，倒计时看板（localStorage 版） | `tauri dev` 跑通，倒计时正确，窗口标题为 TimeQuest |

| P2 | 接入 SQLite，建全部表，任务 CRUD + 任务列表/详情 | 能建主线/副本任务并看到进度 |

| P3 | 排期 + 今日时间轴 | 能创建 session 并在今日页展示 |

| P4 | 完成 / 部分完成 / 改期三流程（事务 + 幂等） | 三种场景状态正确，无重复流水 |

| P5 | 标签记录 + 统计页（计划 vs 实际、达成率、平均自评） | 周/月切换数据正确 |

| P6 | 便签墙 | 增删改、置顶、颜色持久化 |

| P7 | 游戏化：XP/等级/连击/成就 + Questro 组件 | XP 单测通过，Toast 正常触发 |

| P8 | 设置、托盘、导入导出、打磨与打包 | 可安装的 Windows 包，安装后显示名称为 TimeQuest |

**Cursor 使用建议**：每个阶段新开对话；先用 Plan 模式确认实现计划再写码；每阶段结束让 Agent 跑 `pnpm tauri dev` 并修复报错；架构约定与命名规范写入 Rules。

---

## 11. 风险与取舍

| 风险 | 应对 |

|---|---|

| 游戏化诱导虚报/刷 XP | XP 只绑 `actual_units`；自评仅小幅乘数；完成提交幂等；不做排行榜 |

| 改期功能被滥用导致数据失真 | 保留 `rescheduled` 状态并计入达成率分母；改期恢复有奖励但不掩盖历史 |

| 统计查询随数据增长变慢 | 聚合下沉 SQL + 索引；必要时按周预聚合 |

| 功能膨胀 | v1 严格按本文档范围；富文本、甘特图、云同步列入后续版本 |

| Tauri Rust 门槛 | 业务逻辑集中在少量 command；前端纯函数可单测；Agent 负责编译错误修复 |

| 产品名商标风险 | `TimeQuest` 为英文通用词组，公开前查第 9/41 类商标；必要时用“TimeQuest 自习/高三”做限定 |

---

## 12. 后续版本（不在 v1 范围）

- 便签富文本 / 贴边吸附 / 托盘常驻（参考 sticker-note）

- 学习计划时间轴 / 甘特视图

- 周报导出（PDF/图片）

- 多设备同步（需重新评估隐私与账号体系）

- 移动端（Tauri 2 跨端）

---

**文档使用说明**：将本文件保存为仓库根目录 `PRD.md`；把第 3 节设计原则、第 6 节架构约定、第 7 节命名规范摘录到 `.cursor/rules` 或 `AGENTS.md`，作为 Cursor 的长期上下文。