# 中小学知识图谱插件（cn-knowledge-graph）需求文档

> 状态：M1–M4 已落地（内置数学/物理，面板浏览 + 先修链 + 其余学科按需下载 + 考点打通 + 排期建议 + 局部先修关系图）
> 上游数据：https://github.com/xiaoyang111222/cn-math-taxonomy
> 许可证：CC BY-NC 4.0（署名-非商业性使用）

---

## 1. 背景

TimeQuest 现在有两个「知识点」来源，都不完整：

- **教材导入**：从 PDF 目录解析出的章节考点，是纯文本，粒度取决于那本教材，且不跨学科。
- **内置考点目录**：AI 生成的提纲，会落后于最新考纲。

学生真正想问的是两件事：

1. **这个考点到底考什么？** —— 需要对齐课标的、可检索的知识点全集。
2. **我是不是该先补前面那个？** —— 需要知识点之间的先修关系。

开源项目 `cn-math-taxonomy` 提供了国内 K12 的知识点节点与先修边数据，数学 870 个知识点 / 1459 条先修边，物理 269 个 / 637 条，还带章节、领域、掌握标准、诊断题。它正好覆盖上面两件事。

## 2. 上游数据摸底

| 文件 | 体积 | 内容 |
|---|---|---|
| `data/topics.json` | 3.36 MB | 知识点节点，裸数组 |
| `data/dependencies.json` | 1.02 MB | 先修边 `{topicId, prerequisiteId, strength, reason}` |
| `data/questions.json` | 10.8 MB | 练习题，**本期不接** |
| `data/cn-curriculum-standards.json` | 522 KB | 课标条目，本期不接 |

节点字段：`id` / `name` / `domain` / `grade` / `semester` / `chapter` / `type` / `description` / `mastery_criteria` / `diagnostic_question` / `mathLinks`。

先修边语义：**`topicId` 依赖 `prerequisiteId`**。`strength` 分 `hard`（硬门槛，不会就学不了）和 `soft`（有帮助但不是门槛）。

上游只发布全量文件，**没有按学科拆分的版本**，`explore/` 目录下只有 `app.js` 和 `index.html`。所以按学科切分要自己做。

id 前缀即学科：`cnm_` 数学、`cnp_` 物理、`cne_` 英语、`cnc_` 语文、`cns_` 科学、`cnd_` 道法，其余 `cnh_` / `cng_` / `cnb_` / `cnk_` 归「其他学科」。

物理与数学的关联走 `mathLinks` 字段，**不在先修边里**——先修边始终不跨学科。

## 3. 许可证与署名

上游是 **CC BY-NC 4.0**，TimeQuest 本体是 MIT。两者不兼容，但用户已明确「无商业化计划」，因此走内置 embed 路线，接受 NC 约束。

必须履行的义务：

- **BY（署名）**：插件作者写 `xiaoyang111222 / cn-math-taxonomy`；面板底部展示出处与协议名；数据文件头部带 `license` 字段。
- **NC（非商业）**：当前无商业化行为。

**处置路径**：一旦 TimeQuest 转向商业化，必须先取得上游书面授权，或从内置资源与下载源中移除该数据集。这条约束写进代码注释与本节，不靠口头记忆。

## 4. 目标与非目标

### 目标

- 内置数学、物理两科，不联网就能浏览知识点、看先修关系。
- 其余学科沿用教材插件的按需下载模式：清单内置，用户点哪个下哪个。
- 先修关系要能区分「硬门槛」和「有帮助」，并能沿硬门槛回溯出深层前置。
- 不新增数据表，不影响导出/导入。

### 非目标（本期不做）

- 不做全局力导向图 / 关系大屏。M4 只画单个知识点周边的局部先修关系图（详见第 14 节）。
- 不接 `questions.json`（10.8 MB）与课标文件。
- 不做跨学科先修边（上游本身没有）。
- M1 阶段不接任务考点：图谱知识点要落到任务上，得给 `task_knowledge_points` 加外部 id 字段并同步导出导入，这块单列在 M2 落地。

## 5. 用户视角

学生装上插件后打开插件详情页，看到：

1. **学科包条**：数学 870、物理 269（已内置），英语 791、语文 683……（需下载）。
2. **浏览区**：学段 tab（全部 / 小学 / 初中 / 高中 / 其他）+ 搜索框 + 知识点列表。
3. **详情区**：点某个知识点 → 名称、领域、章节、说明、掌握标准、诊断题，以及先修链。
4. **先修链**：分「直接先修」和「深层前置（沿硬门槛回溯）」两段，每条带硬门槛/有帮助徽标和上游给的理由。
5. **前置关系图**：先修链上方的一张局部图，中心是当前知识点，往下是直接先修；点图上的节点可以以它为中心继续往下展开。
6. 面板末尾展示署名与免责文案（固定文案，不随列表滚动吸顶）。

## 6. 功能需求

| 编号 | 需求 |
|---|---|
| FR-1 | 插件清单内置学科包清单（哪些内置、哪些可下、各多少点、上游仓库与 commit）。 |
| FR-2 | 内置数学（870 点 / 1459 边）与物理（269 点 / 637 边）数据文件。 |
| FR-3 | 按学科浏览知识点，支持学段筛选与关键词搜索（命中名称 / 章节 / 领域 / 说明，忽略大小写）。 |
| FR-4 | 查某知识点的先修：直接先修（hard 在前）+ 沿 hard 边回溯的深层前置（带 depth，环不死循环）。 |
| FR-5 | 其余学科按需下载：拉上游全量文件 → 本地按 id 前缀切片 → 落盘缓存；原始文件也缓存，下次换学科不用重下。 |

## 7. 技术方案

### 数据流

```
上游 GitHub（blob / raw 双通道）
  └─ 下载全量 topics.json + dependencies.json
       └─ 按 id 前缀切片
            └─ packs/topics.<subject>.json + packs/dependencies.<subject>.json
                 └─ 后端解析 → 前端面板
```

内置包则跳过下载，直接读随二进制 embed 的资源文件。

上游原始文件是裸数组（`[...]`），我们自己的内置包和下载缓存带信封（`{"topics": [...]}`）。解析层两种形态都认。节点字段名也两套都认：上游写 `mastery_criteria` / `diagnostic_question`，构建脚本转成 `masteryCriteria` / `diagnosticQuestion`。

### 分层

| 层 | 文件 | 职责 |
|---|---|---|
| 纯函数 | `src-tauri/src/knowledge_graph.rs` | 数据模型、解析、筛选、前缀切片、先修回溯。不碰数据库和文件系统，可单测。 |
| 命令 | `src-tauri/src/commands/knowledge_graph.rs` | 5 个 Tauri command：列包、列知识点、查先修、下学科包、查排期冲突（M3）。 |
| 构建脚本 | `scripts/build-cn-knowledge-graph.mjs` | 从上游快照切片并生成内置资源；点数对不上直接中止。 |
| 前端 | `src/components/PluginKnowledgeLibrary.tsx` | 插件详情页的面板。 |
| 前端数据 | `src/hooks/useKnowledgeGraph.ts` | 5 个 React Query hook。 |
| 前端（M4） | `src/lib/prerequisiteGraph.ts` | 纯函数：先修链 → 分层图 → 坐标。 |
| 前端（M4） | `src/components/PrerequisiteGraph.tsx` | SVG 画局部先修关系图。 |

### 命令

| 命令 | 参数 | 返回 |
|---|---|---|
| `list_plugin_knowledge_packs` | `pluginId` | `KnowledgePackEntry[]`（`state` 为 `builtin` / `downloaded` / `available`） |
| `list_plugin_knowledge_points` | `pluginId`, `subject`, `stage?`, `query?` | `KnowledgeTopic[]` |
| `list_plugin_prerequisites` | `pluginId`, `subject`, `topicId` | `PrerequisiteResult`（`topic` + `direct` + `ancestors`） |
| `download_plugin_knowledge_pack` | `pluginId`, `subject` | `KnowledgePack` |
| `list_task_prerequisite_conflicts` | `pluginId`, `taskId` | `PrerequisiteConflict[]`（M3） |

### 缓存目录

```
appData/plugins/cn-knowledge-graph/
├── resources/            # 插件自带的资源（安装时解包）
│   ├── packs.json        # 学科包清单：哪些内置、哪些可下、各多少点
│   ├── topics.math.json
│   ├── topics.physics.json
│   ├── dependencies.math.json
│   └── dependencies.physics.json
└── packs/                # 下载缓存，卸载插件时一起删
    ├── topics.english.json
    ├── dependencies.english.json
    ├── topics.chinese.json
    └── _raw/
        ├── topics.<sha>.json      # 上游原始文件，文件名带 sha
        └── dependencies.<sha>.json
```

缓存放在 `packs/` 而不是 `resources/`，避免被 `unpack_plugin_resources` 清空，也不会被 `plugin_resource_text` 误命中。

一个学科包的两个文件是一套：知识点文件与先修边文件都写好才算下载成功。清单里的「已下载」以知识点文件为准，它在就说明两个文件都齐了。

### 关键取舍

- **学段由后端统一推导**：1–6 小学、7–9 初中、10+ 高中，其余「其他」。解析时写进 `stage` 字段，前后端共用一套口径，不在前端重复实现年级映射。
- **筛选在后端做**：后端整包解析一次就能筛，前端只拿结果。搜索词做 300ms 防抖，避免每敲一个字就传一次 560 KB。
- **原始文件缓存**：上游只发全量，下载一次 4 MB 出头。原始文件按 sha 缓存，换学科时本地切片即可；sha 变了自然换一份缓存。
- **先修只走 hard 回溯**：软边表示「会了有帮助」，回溯它会淹没重点。
- **不新增数据表**：图谱本体是插件资源文件，用户数据仍走 `app_settings`，导出/导入护栏不受影响。

## 8. 边界

- **学科代号**只允许小写字母、数字、下划线、横线，用来拼缓存文件名，防路径穿越。
- **下载**优先用插件选项指定的通道，另一个通道留作备用；两个通道指向同一 commit 下的同一份文件，字节一致。
- **下载内容**必须能解析成完整 JSON 才落盘；先写 `.tmp` 再 rename，避免半截文件被当成完整数据。学科包的两个文件是一套，先修边先落盘、知识点文件最后落盘，清单里的「已下载」以知识点文件为准。
- **上游原始文件是裸数组**，与内置包 / 下载缓存的信封格式不同。解析层两种形态都认，节点字段名的 camelCase（`masteryCriteria`）与 snake_case（`mastery_criteria`）也都认。
- **卸载插件**会连 `packs/` 缓存一起删掉，重装后需要重新下载。
- **上游新增学科**时脚本会归入「其他学科」包，不漏数据也不猜错学科。

## 9. 验收标准

| 编号 | 验收项 | 对应测试 |
|---|---|---|
| AC-1 | 学科包清单锁定仓库与 commit，写明 CC BY-NC 4.0 | `packs_manifest_builtin_math_and_physics` |
| AC-2 | 内置数学 870 点、物理 269 点，边数 1459 / 637，与上游一致 | `builtin_math_topics_match_upstream_count` 等 |
| AC-3 | 内置先修边两端都能在知识点里找到，不出现悬空引用 | `builtin_dependencies_reference_known_topics` |
| AC-4 | 物理与数学的关联只出现在 `mathLinks`，先修边不跨学科 | `physics_links_to_math_through_math_links_not_dependencies` |
| AC-5 | 学段按年级推导并填进字段；筛选按学段与关键词生效 | `stage_is_derived_from_grade`、`filter_topics_*` |
| AC-6 | 直接先修 hard 在前；深层前置只沿 hard 边回溯；环不炸 | `direct_prerequisites_put_hard_before_soft`、`ancestors_*` |
| AC-7 | 面板默认落在内置学科，可按学段筛、搜关键词、点开看先修链 | `knowledge_library_*`（vitest） |
| AC-8 | 未下载的学科点下载才拉数据，失败要报错而不是装作成功 | `knowledge_library_downloads_*`、`knowledge_library_reports_a_failed_download_*` |

### 补充：下载通道

2026-11-19 审计发现：下载通道从未被端到端跑通过。上游原始文件是裸数组，解析层却按信封格式读，下载必然失败；即便解析过了，掌握标准与诊断题还会因上游用 snake_case 字段名被静默丢弃。以下四条是补上的回归护栏。

| 编号 | 验收项 | 对应测试 |
|---|---|---|
| AC-35 | 上游原始文件（裸数组 + snake_case 字段）能解析，掌握标准与诊断题不丢 | `upstream_raw_topics_keep_mastery_criteria_and_diagnostic_question` |
| AC-36 | 上游原始先修边文件（裸数组）能解析 | `upstream_raw_dependencies_are_parsed` |
| AC-37 | 内置包 / 下载缓存的信封格式（camelCase 字段）同样不丢掌握标准与诊断题 | `envelope_topics_keep_mastery_criteria_and_diagnostic_question` |
| AC-38 | 学科包缓存两个文件齐了才算「已下载」，缺一个不算 | `a_pack_needs_both_files_to_count_as_downloaded` |
| AC-39 | 切片结果与清单承诺的点数对得上 | `slicing_the_builtin_pack_matches_the_manifest_count` |

## 10. 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 插件清单 + 内置数学/物理 + 面板浏览 + 先修链 + 其余学科按需下载 + 署名 | ✅ 已落地 |
| M2 | 图谱知识点与任务考点打通：建任务时能挑图谱里的知识点，带上 id | ✅ 已落地 |
| M3 | 排期建议：按先修关系检查排期顺序，把「先修还没学完就排了后面」标出来 | ✅ 已落地 |
| M4 | 可视化：单个知识点的前置关系图（局部展开，不做全局力导向图） | ✅ 已落地 |
| M5 | 与错题本对齐：错题可挂图谱知识点，图谱侧反查「我在这里错过」 | ✅ 已落地 |

## 11. 风险

| 风险 | 影响 | 处置 |
|---|---|---|
| CC BY-NC 与 MIT 冲突 | 一旦商业化即违规 | 已接受 NC（无商业化计划）；内置资源与本节写明转商业前的处置路径 |
| 上游数据变更或仓库消失 | 内置包仍可用，但可下载学科失效 | 内置包随二进制 embed，不依赖网络；下载失败有明确报错 |
| 内置体积增加约 1.2 MB | 安装包变大 | 与既有 china-textbook catalog.json（1.06 MB）同量级，可接受 |
| 上游点数学段分类（部分为「其他」） | 筛选体验下降 | 学段由年级推导兜底；「其他」有独立 tab |
| 全量下载体积大（4 MB） | 首次下载慢 | 原始文件按 sha 缓存，换学科不再重下；进度条反馈 |

## 12. M2 详细设计：图谱知识点接到任务考点上

M1 只能看图谱，看完还得手抄名字。本期让任务考点直接挂上游 id，M3 的排期检查才有依据。

### 用户视角

在任务详情（或今日 / 看板里的任务抽屉）打开「知识点」，多一个「从知识图谱添加」：

1. 学科自动对上任务的科目（任务科目是「数学」就落在数学包），对不上则列出全部学科包供选。
2. 搜索框按名字 / 章节 / 领域筛，勾选后加入任务考点。
3. 加入的考点带一枚「图谱」徽标，和自己手写的考点一眼分得开。
4. 已经加过的图谱考点再点不重复加。

### 数据流

```
packs/topics.<subject>.json
  └─ 后端筛选（学段 / 关键词）
       └─ 前端 GraphPointPicker 列表
            └─ add_custom_knowledge_point(taskId, sectionName, name, graphTopicId, graphSubject)
                 └─ task_knowledge_points 一行，带上游 id
```

### 表结构

`task_knowledge_points` 加两列，都可空：

| 列 | 含义 |
|---|---|
| `graph_topic_id` | 上游知识点 id（如 `cnm_001`）。空 = 自写或教材考点。 |
| `graph_subject` | 该知识点所属学科代号（如 `math`）。空 = 不是图谱考点。 |

- 唯一约束 `UNIQUE(task_id, section_name, name)` 不动，老数据零影响。
- 另加**部分唯一索引** `UNIQUE(task_id, graph_topic_id) WHERE graph_topic_id IS NOT NULL`：同一个图谱考点在同一个任务里只能出现一次，但不影响自写考点。
- 迁移只做 `ALTER TABLE ADD COLUMN` + 建索引，不重建表，老库原地升级。

### 图谱考点落在哪个节

节名用学科名（`数学`），这样同一个任务里「数学」这节装的就是数学图谱的考点，和教材的「第一章 有理数」这类节互不干扰。

### 后端

`add_custom_knowledge_point` 扩两个可选参数（`graphTopicId` / `graphSubject`），不另开命令：

- 两条都空 → 与今天行为完全一样（教材考点 / 自写考点）。
- 给了 `graphTopicId` → 记成图谱考点，节名由前端给（学科名，如「数学」）。
- `graphTopicId` 在同一个任务里重复 → 报「这个考点已经在列表里了」，不覆盖已有那行。

导出 / 导入把两列一起带走。旧备份没有这两个键，导入后留空，等同于普通考点。

### 前端

| 文件 | 职责 |
|---|---|
| `src/components/GraphPointPicker.tsx` | 图谱考点选择器：学科包切换、搜索、勾选加入。 |
| `src/components/KnowledgePointDrawer.tsx` | 抽屉里挂「从知识图谱添加」，考点列表给图谱考点加徽标。 |
| `src/lib/constants.ts` | `KNOWLEDGE_GRAPH_PLUGIN_ID`：图谱插件的 id。 |

### 边界

- **不校验上游 id 存不存在**：任务层不依赖插件层。前端列表来自图谱本身，后端只负责存。真要校验也得让任务命令去读插件资源，耦合太重。
- **上游数据变了 id 还在**：上游 id 稳定（M3 的前提）。真找不到时按「普通考点」降级，不报错。
- **下载包里的学科同样能挑**：M1 下载过的学科包，选择器里一样能选。

### 验收标准

| 编号 | 验收项 | 对应测试 |
|---|---|---|
| AC-9 | 图谱考点入库带着上游 id，自写考点没有 id | `graph_point_carries_the_upstream_topic_id` |
| AC-10 | 同一个图谱考点不能在同一任务里加两次 | `graph_topic_cannot_be_added_twice_to_one_task` |
| AC-11 | 图谱考点能导出再导入，id 不丢 | `graph_points_survive_export_import` |
| AC-12 | 旧备份（没有图谱字段）导入后 id 为空，不报错 | `old_backup_without_graph_fields_imports_as_null` |
| AC-13 | 选择器能挑图谱考点并带 id 入库，图谱徽标可见 | `graph_point_picker_*`（vitest） |

## 13. M3 详细设计：先修没学完就排了后面的提醒

M2 让任务考点挂上了上游 id，M3 才能反过来问一句「这个任务的排期顺序对不对」。

### 用户视角

在任务详情页，考点区下面多一块「排期建议」。只要这个任务的图谱考点踩到了先修问题，就列出来：

1. 「『三角函数』要先会『函数』，但『函数』排在这个考点后面了。」——同一个任务里顺序颠倒。
2. 「『三角函数』要先会『函数』，『函数』还在《函数基础》任务里没学完（还差 3 课），而这个任务 11-20 就开课。」——先修在另一个任务里，那边没学完，这边已经排上。

没问题的时候这块不出现，不占地方。

### 判定口径

先修关系取自图谱插件的边，**只报硬门槛（`hard`）**。软边意思是「会了有帮助」，不是「不会就学不了」，报出来只会刷屏。

冲突分两类：

| 类型 | 触发条件 | 含义 |
|---|---|---|
| `order_swapped` | 先修考点也在当前任务的考点里，且它的排位比当前考点靠后 | 同一个任务里顺序排反了 |
| `prerequisite_task_incomplete` | 先修考点在**别的**任务里，那个任务本轮还没学完，且当前任务的第一场排期不晚于先修任务的第一场排期 | 后面要学的东西排在前面了 |

排位比较用 `(position, id)`：先看考点在任务里的序号，序号相同再按入库顺序。

### 数据流

```
任务详情页
  → list_task_prerequisite_conflicts(task_id, plugin_id)
      → 读 task_knowledge_points（图谱考点，带 graph_topic_id / graph_subject）
      → 读 tasks + task_sessions（本轮进度、各任务最早待学日期）
      → 读插件目录里的学科包（topics + dependencies，先修边）
      → 交叉比对，列出冲突
```

### 表结构

**不动任何表。** 本期纯读：M2 已经把 `graph_topic_id` 落库了，检查只需要读。

### 后端

新增一个只读命令：

| 命令 | 参数 | 返回 |
|---|---|---|
| `list_task_prerequisite_conflicts` | `task_id`、`plugin_id` | `PrerequisiteConflict[]` |

`PrerequisiteConflict` 字段：

| 字段 | 含义 |
|---|---|
| `kind` | `order_swapped` 或 `prerequisite_task_incomplete` |
| `topic_id` / `topic_name` | 出问题的那场（依赖先修的考点） |
| `prerequisite_id` / `prerequisite_name` | 先修考点 |
| `strength` | 先修边强度，这里恒为 `hard` |
| `prerequisite_task_id` / `prerequisite_task_title` | 先修考点在哪个任务里 |
| `prerequisite_task_remaining` | 先修任务还差多少单元，学完了就没有 |
| `dependent_session_date` | 本任务第一场还没上的日期 |
| `prerequisite_session_date` | 先修任务第一场还没上的日期 |
| `message` | 一句人话，前端直接显示 |

### 前端

| 文件 | 作用 |
|---|---|
| `src/types.ts` | `PrerequisiteConflict` 类型 |
| `src/api/tauri.ts` | `listTaskPrerequisiteConflicts` |
| `src/hooks/useKnowledgeGraph.ts` | `useTaskPrerequisiteConflicts` |
| `src/components/PrerequisiteAdvice.tsx` | 建议列表：有问题才渲染 |
| `src/pages/TaskDetail.tsx` | 考点区下面挂建议 |

### 边界

- **学科包没下载就跳过**：读不到图谱的学科直接不检查，不报错。这是只读建议，不能因为数据缺失挡住页面。
- **上游找不到这个 topic id**：跳过这一个考点，不报错（上游数据变了，id 还在）。
- **先修考点不在任何任务里**：不报。那是「还没排」，不是「排后面」，混在一起会让提示变噪声。
- **先修任务已经学完**：不报。
- **先修任务没有待学场次**：不报。没排期就谈不上排了后面。
- **副本任务**：不报 `prerequisite_task_incomplete`。副本没有「按单元推进」的概念，进度口径对不上；副本内部的考点顺序颠倒仍按 `order_swapped` 报。
- **同一个图谱考点被多个任务共享**：每个任务各查各的，先修任务已完成就不报。
- **软边一律不报**。

### 验收标准

| 编号 | 验收项 | 对应测试 |
|---|---|---|
| AC-14 | 同任务内先修排在后面会被点出来 | `order_swapped_conflict_is_reported` |
| AC-15 | 同任务内先修在前不报 | `prerequisite_before_dependent_is_not_a_conflict` |
| AC-16 | 先修在另一个任务且没学完、这边先开课 → 报 | `incomplete_prerequisite_task_is_reported` |
| AC-17 | 先修任务已学完 → 不报 | `finished_prerequisite_task_is_not_a_conflict` |
| AC-18 | 先修不在任何任务里 → 不报 | `prerequisite_in_no_task_is_not_a_conflict` |
| AC-19 | 软边不报，只有硬门槛报 | `soft_prerequisite_is_not_a_conflict` |
| AC-20 | 没有图谱考点的任务返回空列表 | `task_without_graph_points_has_no_conflicts` |
| AC-21 | 学科包读不到时降级成空列表，不报错 | `missing_pack_degrades_to_empty_conflicts` |
| AC-22 | 前端能展示建议，有问题时才出现 | `prerequisite_advice_*`（vitest） |

## 14. M4 详细设计：单个知识点的局部先修关系图

M1 的先修链是两层列表，看得出「谁要先会谁」，看不出结构。M4 把它画成图：以单个知识点为中心，向下展开它的局部先修邻域。

### 用户视角

插件详情页点开一个知识点，详情区多一块图：

1. **中心是当前知识点**，往下第一层是它的直接先修：实线=硬门槛，虚线=有帮助。
2. **深层前置默认收起**，显示成「展开深层前置（N 个）」，展开后按跳数分层，一层一层往下排。
3. **点图上任意先修节点** → 以它为中心重新展开，可以一路往下钻（这就是「局部展开」）。
4. **「← 返回上一个知识点」** 退回刚才看的那一个。

### 数据流

```
list_plugin_prerequisites(pluginId, subject, topicId)   ← M1 已有命令，M4 不动后端
  └─ topic + direct + ancestors
       └─ src/lib/prerequisiteGraph.ts（纯函数：分层、去重、排序、算坐标）
            └─ src/components/PrerequisiteGraph.tsx（SVG 渲染 + 折叠 + 点节点换中心）
```

### 边的口径

上游的先修链只给了跳数（`depth`），没给「谁是谁的父节点」：

| 层 | 边的含义 | 画法 |
|---|---|---|
| 第 1 层（直接先修） | 就是中心节点的先修，边是精确的 | 中心 → 每个直接先修，实线（hard）/ 虚线（soft） |
| 第 2 层往下 | 上游只说「离中心几跳」，没说经过谁 | 左侧一条层带把各层串起来，层内不连父子边 |

为什么不反推父节点：拿上游给的理由文案去上一层里认父节点，数学 20276 条深层前置里只有约 60% 能唯一认定，其余要么文案里没提，要么有多个候选。猜出来的边比不画更危险。

### 后端

**不动。** 没有新命令、没有新字段、没有新表。「局部展开」就是拿同一个命令换个 `topicId` 再调一次。

### 前端

| 文件 | 作用 |
|---|---|
| `src/lib/prerequisiteGraph.ts` | 纯函数：`buildPrerequisiteGraph` 分层去重、`layoutPrerequisiteGraph` 算坐标、`measureNodeWidth` 量节点宽、`truncateToWidth` 截长名字 |
| `src/components/PrerequisiteGraph.tsx` | SVG 图：节点、连线、深层前置折叠、点节点回调 |
| `src/components/PluginKnowledgeLibrary.tsx` | 详情区挂图；记展开历史，提供返回 |
| `src/hooks/useKnowledgeGraph.ts` | `usePrerequisites` 加 `placeholderData`，换中心时详情区不闪 |

### 边界

- **只画拿到的数据**：上游没给的父子关系不补，层带就是层带。
- **深层前置可能几十个**：数学里最深的链条 8 层、最多 68 个节点，所以默认收起，展开后横向滚动。
- **节点宽度跟着名字走**：短名字的节点不占地方，长名字也不截断（宽度夹在 108–200 px 之间）。估宽留 1 px 容差，刚好放得下的名字不被砍；名字真塞不下时才截断，且截断处不留孤零零的开括号，完整名字放在 `<title>` 里悬停可见。
- **焦点不跟着最宽的层跑**：直接先修多的时候整张图能有九百多像素宽，而面板只有五百多。焦点单独居中，限在首屏可见的那一段（480 px）里——展开的第一眼必须能看到主角。
- **软边照样画**：样式上用虚线和更暗的配色，和硬门槛一眼能分开。
- **点节点会重新拉数据**：走同一个命令，React Query 按 key 缓存，来回切不会重复解析整包。
- **展开历史按访问顺序记**：同一个知识点再次被展开也记一笔，不去重。去重会让「返回」退错地方——看完 A → B → 又点回 A，按去重算返回会停在 A 自己，而用户以为自己在 B。
- **没有先修关系**：图区写「没有记录先修关系，这个知识点可以直接学。」，不画空框。

### 验收标准

| 编号 | 验收项 | 对应测试 |
|---|---|---|
| AC-23 | 先修链按跳数分层，直接先修在第 1 层 | `prerequisite_graph_splits_direct_and_deep_prerequisites_into_layers` |
| AC-24 | 中心不会出现在自己的先修里（成环保护） | `prerequisite_graph_keeps_the_focus_out_of_its_own_layers` |
| AC-25 | 只有中心到直接先修是精确边，深层前置按层带状连 | `prerequisite_graph_layout_draws_exact_edges_only_from_the_focus_to_direct` |
| AC-26 | 深层前置默认收起，展开才画 | `prerequisite_graph_collapses_deep_prerequisites_until_they_are_expanded` |
| AC-27 | 硬边实线、软边虚线，图上分得清 | `prerequisite_graph_distinguishes_hard_edges_from_soft_ones` |
| AC-28 | 点图上的节点以它为中心重新展开，并能退回上一个 | `knowledge_library_recenters_the_graph_on_a_clicked_prerequisite` |
| AC-29 | 节点宽度跟着名字长短走，短名不占地方、长名不被砍 | `prerequisite_graph_layout_widens_nodes_for_longer_names` |
| AC-30 | 直接先修很多时，焦点仍落在首屏可见处 | `prerequisite_graph_layout_keeps_the_focus_on_screen_when_the_layer_is_wide` |
| AC-31 | 刚好放得下的名字不被截断，截断处不留孤立开括号 | `truncate_to_width_keeps_a_name_that_just_fits` |
| AC-32 | 「返回」真的退回上一个知识点 | `knowledge_library_goes_back_to_the_previous_topic` |
| AC-33 | 重复访问同一知识点后，「返回」仍退到上一个 | `knowledge_library_goes_back_to_the_last_visited_topic_even_after_revisiting_one` |
| AC-34 | 连线本身硬边实线、软边虚线 | `prerequisite_graph_draws_hard_edges_solid_and_soft_edges_dashed` |

## 15. M5 详细设计：与错题本对齐

M2 把图谱知识点接到了任务考点上，M5 把同一套 id 接到了错题本上。

### 为什么不是「第二张图」

错题本和知识图谱是两件事，但**不是两个互不相干的知识点体系**：

- 知识图谱回答「这块知识该先会什么」——结构层，先修关系。
- 错题本回答「我在哪儿翻过车」——证据层，我的真实失误。

两边如果各自造一个「知识点」（图谱是 `cnm_001` 这样的 id，错题本是自由文本标题），学生看到两个都叫「知识点」的面板就会以为有两个知识体系。所以必须共用同一个 id。

### 用户视角

**错题本 → 图谱**

错题表单多一个「关联知识点（可选）」，点开能从图谱里挑一个；挑完科目自动跟着走，不用再手选一遍。记好的错题卡片上多一个 📘 标签：

- 装了图谱插件：标签可点，跳到图谱里那个知识点。
- 没装插件：标签只是标签，不给死链。

错因是「概念不清 / 公式记错 / 方法不会」时，卡片下多一句「这类错因多半是前面没学扎实，点上面的知识点看看它的前置关系。」

**图谱 → 错题本**

知识点详情区多一块「我在这里错过」：在这个知识点上记过几道错题、还有几道没订正，每条列出题目与错因。一个错题都没记过时给一个「记一条」入口，跳到错题本并把知识点带过去，表单直接预填。

### 技术方案

- **存储**：迁移 `20261119150000_add_graph_topic_to_mistakes.sql` 给 `mistakes` 加三列 `graph_topic_id / graph_subject / graph_topic_name`。id 是主角（决定这条错题落在图谱哪个点上），学科代号用来拼深链，名字用来显示标签——不拉整包图谱就能渲染。
- **写入**：错题本走 rusqlite 同步连接（与便签同款）。三个字段各自归一，空白当「没挂」，不做「要么都有要么都没有」的强绑定。
- **读取**：新增只读命令 `list_topic_mistakes(pluginId, subject, topicId)`，走 sqlx 池查 `mistakes WHERE graph_topic_id = ?`，排序 `is_mastered ASC, created_at DESC, id DESC`（未订正排前面，与错题本一致）。
- **降级**：图谱读不到时知识点名留空，错题照样返回。不能因为缺一个学科包就把学生已经记下的错题藏起来。
- **深链**：错题本 → 图谱走 `/toolbox/plugins/cn-knowledge-graph?subject=&topic=`；图谱 → 错题本走 `/mistakes?graphTopic=&graphSubject=&graphSubjectName=&graphTopicName=`。两侧都只应用一次深链，用户自己换知识点后不再被弹回去。
- **备份**：三列进 `export_json_impl` / `import_json_impl`；旧备份缺这三个 key，导入后是 NULL，当作没挂知识点的普通错题。

### 边界

- **图谱插件不是记错题的前置条件**：没装插件、没下载学科包，错题照记，只是没有「关联知识点」可选。
- **错因闸门**：只有结构类错因才引图谱。执行层问题（审题/计算/粗心）往图谱上拽只会制造噪音，还会让两个面板看起来像两套东西。
- **术语纪律**：界面不出现「错题图谱」「第二张图」。错题本里叫「关联知识点」，图谱里叫「我在这里错过」。

### 验收标准

| 编号 | 验收项 | 对应测试 |
|---|---|---|
| AC-40 | 错题能挂上图谱知识点 id / 学科 / 名字 | `mistake_carries_the_graph_topic_id` |
| AC-41 | 空白知识点 id 当作没挂 | `blank_graph_topic_id_is_treated_as_not_attached` |
| AC-42 | 知识点跟着备份往返；旧备份导入后为空 | `graph_topics_survive_export_import_round_trip` / `old_backup_without_graph_fields_imports_as_null` |
| AC-43 | 图谱侧能查到某知识点上错过哪些题 | `list_topic_mistakes_returns_the_mistakes_of_one_knowledge_point` |
| AC-44 | 缺学科包时错题照返，不藏 | `missing_pack_still_returns_the_mistakes_of_one_knowledge_point` |
| AC-45 | 只有结构类错因才提示去看先修关系 | `suggests_prerequisites_only_for_structure_reasons` |
| AC-46 | 错题页能挂知识点、卡片能跳回图谱 | `mistakes_page_attaches_a_knowledge_point_from_the_graph` / `mistakes_page_links_a_mistake_to_the_knowledge_point_in_the_graph` |
| AC-47 | 没装插件时知识点只当标签 | `mistakes_page_keeps_the_knowledge_point_as_a_plain_tag_without_the_graph_plugin` |
| AC-48 | 两侧深链互相打通并预填 | `mistakes_page_prefills_the_form_from_a_deep_link` / `knowledge_library_sends_the_topic_over_to_the_mistake_book` |
| AC-49 | 图谱详情区显示「我在这里错过」 | `knowledge_library_shows_the_mistakes_recorded_on_this_topic` |