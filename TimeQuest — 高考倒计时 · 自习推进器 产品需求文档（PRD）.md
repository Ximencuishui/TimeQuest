# TimeQuest 产品需求文档（PRD）

**本文档已归档，内容已合并至仓库根目录 [`PRD.md`](PRD.md)。**

---

## 说明

本文件曾是 `PRD.md` 的副本（v1.0，对应产品 1.x – 2.0）。为避免两份需求文档互相冲突：

- **唯一权威文档**：仓库根目录 [`PRD.md`](PRD.md)
- **当前文档版本**：v2.0（对应产品 3.10.1 现状 → 4.0.0 升级目标）
- **更新方式**：直接在 `PRD.md` 上修改，不要在本文件维护副本

## v2.0 相对 v1.0 的主要变化

1. 补全 2.0 – 3.10 已实现但此前未入文档的功能：教材导入与任务矩阵（M10）、错题本与知识图谱（M11）、专注模式与桌面悬浮窗（M12）、计划视图与复盘（M13）。
2. 产品定位由「高考专属」泛化为「**考试型自学者通用**」，高考降级为默认赛道模板。
3. 新增 **M14 目标与档案管理**：`goals` 表落库、`tracks` / `subjects` 赛道与科目字典、`exam_sessions` / `exam_scores` 成绩行化、计分参数化、引导与文案解耦、赛道包插件。
4. 新增第 5.5 节迁移策略、第 5.6 节导出/导入 payload 兼容规则、第 9.6 节兼容性与迁移非功能需求、第 10 节 4.0.0 升级开发阶段规划。
5. 数据模型章节补全为 3.10.1 的实际表结构（含 `mistakes`、`task_knowledge_points`、`imported_textbooks`、`app_settings`、`is_mock`、`deleted_at`、`note_date` 等）。

## 相关文档

- 架构与开发约定：[`AGENTS.md`](AGENTS.md)
- 知识图谱插件设计：[`docs/cn-knowledge-graph-plugin.md`](docs/cn-knowledge-graph-plugin.md)
- 自动排期说明：[`docs/auto-today-schedule.md`](docs/auto-today-schedule.md)
- 变更记录：[`CHANGELOG.md`](CHANGELOG.md)
