# TimeQuest — Agent / Architecture Notes

**TimeQuest — 高考倒计时 · 自习推进器**

## Design principles

1. **进度唯一真相**：任务进度 = `sum(actual_units)`，不单独维护 completed 字段。
2. **改期不是失败**：改期保留原记录并标 `rescheduled`；达成率统计包含改期。
3. **奖励真实推进**：XP 只与 `actual_units` 挂钩；自评只做小幅乘数。
4. **正向驱动**：无惩罚性机制；断连击只重置倍率，不清历史最长连击。
5. **数据本地可控**：SQLite 单文件，支持导出/导入。

## Architecture

- React **不直接**访问数据库；所有读写走 Tauri command。
- XP / 等级 / 成就判定纯函数在 `src/lib/gamification.ts`，附 vitest。
- 统计聚合写在 SQL / Rust，前端不拉全量数组 filter。
- 完成 / 改期 / 部分完成在 Rust command 中用事务保证一致性。
- 完成路径的 XP / 连击 / 成就写在 `complete_session_impl` 事务内联逻辑中；
  已删除未使用的 `gamification_sqlx.rs`（曾与内联路径不一致，避免误用）。
  权威纯函数：`src-tauri/src/gamification.rs`（`update_streak_values` 等）。

## Naming

- 产品名：`TimeQuest`（见 `src/lib/constants.ts`）
- 窗口标题：`TimeQuest`
- 数据库：`timequest.db`
- 导出：`timequest-backup-YYYYMMDD.json`
- Tauri identifier：`com.timequest.app`

## 版本规范

- 遵循 SemVer：主版本号.次版本号.修订号（`MAJOR.MINOR.PATCH`）。
- 版本号同时存在于 `package.json`、`src-tauri/Cargo.toml` 的 `[package].version`、`src-tauri/tauri.conf.json` 的 `version`。三处必须一致。设置页底部的版本文案从 `package.json` 读取。
- 所有发布的构建必须使用 `pnpm bump <version>` 统一更新三端版本（脚本：`scripts/bump-version.mjs`）。
- 禁止手改某一端的版本号。

## 测试规范

运行：`cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`

| 测试名 | 覆盖场景 | 文件位置 |
|--------|----------|----------|
| setup_and_seed_helpers_work | 内存库迁移 + 插入 task/session 基建 | `src-tauri/tests/sessions_test.rs` |
| complete_session_is_idempotent | 重复完成不双写流水、不加双倍 XP | `src-tauri/tests/sessions_test.rs` |
| partial_completion_spawns_remainder_session | 部分完成生成剩余 planned session（含时段） | `src-tauri/tests/sessions_test.rs` |
| rescheduled_then_completed_gets_recovery_bonus_once | 改期后完成只加一次 recovery bonus，原记录保留 | `src-tauri/tests/sessions_test.rs` |
| completion_rolls_back_on_log_insert_failure | actual_logs 失败时事务回滚，status/XP 不变 | `src-tauri/tests/sessions_test.rs` |
| completion_with_zero_units_awards_no_xp | actual_units=0 允许 done 但不发 XP、时长为 0 | `src-tauri/tests/sessions_test.rs` |
| streak_across_midnight_uses_local_date | 相邻本地日连击递增；隔日重置但保留 longest | `src-tauri/tests/sessions_test.rs` |
| earlier_date_after_last_done_keeps_streak | 先完成 D+1 再完成 D：XP 照加，streak/last_done 不倒退；解析失败重置为 1 | `src-tauri/tests/sessions_test.rs` |
| complete_rescheduled_or_missed_session_rejected | 完成 rescheduled/missed 返回 InvalidCompleteStatus；改期目标幂等完成 | `src-tauri/tests/sessions_test.rs` |
| negative_actual_units_do_not_corrupt_progress | actual_units 为负拒绝，进度/XP/剩余场次不变 | `src-tauri/tests/sessions_test.rs` |
| complete_allows_actual_units_above_planned_and_awards_full_xp | planned=3、actual=5：Ok 且 actual 不封顶为 3；XP 按 5 单位（72 而非 43）；不生成负数剩余场次；duration_min 按时段 60 | `src-tauri/tests/sessions_test.rs` |
| zero_units_after_reschedule_does_not_unlock_comeback | 改期后 0 单位+高自评不解锁 comeback | `src-tauri/tests/achievements_test.rs` |
| create_session_rejects_archived_task | 归档任务不可排期；非归档可创建 | `src-tauri/tests/sessions_test.rs` |
| create_session_defaults_round_to_task_current_round | 未传 round 跟 current_round；显式 round 不回退任务轮次 | `src-tauri/tests/sessions_test.rs` |
| advance_round_increments_and_respects_total_rounds | 轮次 +1；达 total_rounds 后仍递增（无封顶） | `src-tauri/tests/sessions_test.rs` |
| reschedule_done_session_fails | status=done 不可改期 | `src-tauri/tests/sessions_test.rs` |
| reschedule_missed_session_fails | status=missed 不可改期 | `src-tauri/tests/sessions_test.rs` |
| reschedule_already_rescheduled_is_idempotent | 已改期再调返回 Ok + 已有 rescheduled_to，不新建 | `src-tauri/tests/sessions_test.rs` |
| second_completion_same_day_keeps_streak | 同日二次完成 streak/longest/last_done_date 不变 | `src-tauri/tests/sessions_test.rs` |
| unlocks_first_round_once_when_round_progress_meets_total | 主线当前轮 sum(actual_units)≥total_units 解锁且只一次 | `src-tauri/tests/achievements_test.rs` |
| unlocks_comeback_once_after_reschedule_with_high_rating | 改期后完成且自评≥4 解锁且只一次 | `src-tauri/tests/achievements_test.rs` |
| unlocks_balanced_once_when_main_and_side_done_in_week | 近7日本周主线+副本均 done 解锁且只一次 | `src-tauri/tests/achievements_test.rs` |
| unlocks_streak_5_once_after_five_consecutive_days | 连续5本地日完成解锁且只一次 | `src-tauri/tests/achievements_test.rs` |
| first_round_unlocks_only_when_sum_reaches_total | 同轮合计 6、9 不解锁；到 10 解锁且只一行；再完成不重复插入 | `src-tauri/tests/achievements_test.rs` |
| first_round_unlocks_on_exact_and_above_total | 刚好 10 与超额 12 都解锁且各只一行；`>=` 不是 `==`；第二例在另一份库，避免全局一行挡住超额分支 | `src-tauri/tests/achievements_test.rs` |
| first_round_ignores_other_rounds | 历史轮的 actual_units 不并进本场 round 的合计；本场 round 达标才解锁，历史行不改 | `src-tauri/tests/achievements_test.rs` |
| first_round_not_unlocked_for_side_task | side 任务达到 total_units 不解锁 first_round，total_xp 仍增加 | `src-tauri/tests/achievements_test.rs` |
| first_round_does_not_unlock_on_null_or_zero_total | total_units 为 0 或 NULL 不解锁；NULL 完成不报错 | `src-tauri/tests/achievements_test.rs` |
| comeback_unlocks_only_when_units_positive_and_rating_high | 改期恢复后仅 单位>0 且自评≥4 解锁；3 星不含恢复 XP；0 单位 total_xp 不变；非改期不解锁 | `src-tauri/tests/achievements_test.rs` |
| comeback_recovery_xp_and_achievement_stay_in_sync | 改期 + 3 单位 + 4 星时恢复 XP 与 comeback 在同一次完成里一起发生 | `src-tauri/tests/achievements_test.rs` |
| balanced_window_uses_session_date_not_wall_clock | 窗口锚在本场 session.date；today-10 不计入，today-3 与 today-2 计入 | `src-tauri/tests/achievements_test.rs` |
| balanced_requires_positive_units_in_window | 窗口内 0 单位 done 不计入；两侧 actual_units>0 才解锁 | `src-tauri/tests/achievements_test.rs` |
| balanced_boundary_days_inclusive | 本场 date 的 [date-6, date] 含两端；today-6 解锁，today-7 不解锁 | `src-tauri/tests/achievements_test.rs` |
| balanced_same_task_multiple_sessions_counts_once | 同一主线多场仍只表示有主线；再出现一条副本才解锁且只一行 | `src-tauri/tests/achievements_test.rs` |
| achievement_check_is_not_the_removed_helper | clippy `-D dead_code` 护栏占位：`check_achievements_after_complete` 已删除，不得以死代码形式加回 | `src-tauri/tests/dead_code_guard_test.rs` |
| overlap_unpadded_hour_is_not_a_text_hit | 未补零 `9:00–10:00` 与 `9:30–10:00` 写入后为 `HH:MM`，文本比较命中重叠；`start_time` 长度均为 5 | `src-tauri/tests/overlaps_test.rs` |
| tag_type_totals_sum_duration_without_mixing_tags | 日期闭区间内 study/sport/game 各自 `SUM(duration_min)`，不串扰、不补未出现的 tag | `src-tauri/tests/stats_test.rs` |
| method_share_only_counts_study_tag | method 占比分母只含 study（100），听课 40%、刷题 60%；sport/game 不入分母 | `src-tauri/tests/stats_test.rs` |
| completion_writes_study_tag_by_default | `complete_session_impl` 插入 `tag_type='study'`、`method='刷题'` | `src-tauri/tests/stats_test.rs` |
| manual_log_respects_selected_tag_type | 无 session 的 sport 流水进入 tag 合计，不进入 method 分母 | `src-tauri/tests/stats_test.rs` |
| unknown_subject_stays_in_plan_vs_actual | （原提案 `manual_log_unknown_subject_and_method_remain_in_stats` 之 A）自定义 subject / NULL→未分类 按原串进计划vs实际；总实际分钟不因未知科目减少 | `src-tauri/tests/stats_test.rs` |
| unknown_method_stays_in_method_share | （同上之 B）未知 method 进 study 分母并自成一组，不归「其他」、不丢弃 | `src-tauri/tests/stats_test.rs` |
| subject_whitespace_is_not_normalized | （同上之 C）subject 尾随空格不 trim，统计拆成两组（开放字符串语义） | `src-tauri/tests/stats_test.rs` |
| week_range_boundary_inclusive | 自然周闭区间含本周一与本周日；上周日不计；`to` 是周日，未来的周日仍计入 | `src-tauri/tests/stats_range_test.rs` |
| week_range_uses_session_date_not_wall_clock | `today-10` 的 done 流水不进本周；按 `actual_logs.date` 过滤，不用 `date('now')` | `src-tauri/tests/stats_range_test.rs` |
| week_start_day_matches_definition | 周一起始：本周一计入，紧邻的上周日不计入 | `src-tauri/tests/stats_range_test.rs` |
| month_range_boundary_inclusive | 自然月闭区间含 1 日与月末；上月最后一天不计；`to` 是月末，未来的月末仍计入 | `src-tauri/tests/stats_range_test.rs` |
| month_range_cross_year_safe | `2025-12-31` 与 `2026-01-01` 各自只进对应月；12 月不会变成 13 月 | `src-tauri/tests/stats_range_test.rs` |
| month_does_not_use_rolling_30_days | 上月 28 日不进本月；本月 1 日计入 | `src-tauri/tests/stats_range_test.rs` |
| stats_rejects_inverted_range | `from > to` 返回空结果（Ok），不报错、不对调区间、不查全表 | `src-tauri/tests/stats_range_test.rs` |
| stats_handles_empty_range | 空窗口达成率 `rate = 0.0`；method 无行故分母为 0；计划分钟为 0 时只返回合计、不做除法 | `src-tauri/tests/stats_range_test.rs` |
| stats_date_format_strict | 查询参数 `2026-1-1` 规范为 `2026-01-01` 后命中已补零流水，不命中次日 | `src-tauri/tests/stats_range_test.rs` |
| first_round_after_advance_stays_on_session_round | 推进后完成旧轮计入该场 `session.round`，不进入新轮 sum；`first_round` 仍一行，第 2 轮达标不重复解锁 | `src-tauri/tests/achievements_test.rs` |
| advance_round_without_cap_stays_safe | `current_round` 已等于 `total_rounds` 时再推进得到 +1，返回 Ok，不封顶 | `src-tauri/tests/achievements_test.rs` |
| progress_ring_follows_current_round | 当前轮合计；推进后旧轮离开环；新轮只计本轮 | `src-tauri/tests/progress_test.rs` |
| progress_ring_allows_current_round_units_above_total | 本轮 15+10 后 `round_units=25`，不钳制成 `total_units=20`；环心文案由 `task_detail_progress_ring_shows_units_above_total` 钉成 `25/20` | `src-tauri/tests/sessions_test.rs` |
| progress_ring_and_first_round_can_disagree | 推进后旧轮补完成：环仍为 0；first_round 不重复解锁 | `src-tauri/tests/progress_test.rs` |
| progress_ring_on_round_past_total_rounds | 推进越过 total_rounds 后 ring=0；详情数据源为 N/M 原样；first_round 仍一行 | `src-tauri/tests/progress_test.rs` |
| first_round_can_unlock_on_round_past_total_rounds | 过顶后 round=3 达标：环计入本轮；first_round 全局只一次不重解 | `src-tauri/tests/progress_test.rs` |
| export_import_round_trip_preserves_rows | JSON 全表往返：行数、rescheduled_to、archived/pinned、可空字段、时间戳保留、user_stats | `src-tauri/tests/export_import_test.rs` |
| export_json_includes_every_user_table | sqlite_master 用户表 vs 导出顶层表键双向覆盖；临时 `_probe_table` 自证漏导出红灯 | `src-tauri/tests/export_import_test.rs` |
| set_setting_then_get_is_idempotent | 未写入返回 None；set 后 get 取到值；同 key 再 set 仍一行且值为最后一次（ON CONFLICT DO UPDATE） | `src-tauri/tests/app_settings_test.rs` |
| import_failure_rolls_back_to_pre_import_state | 毒化 rescheduled_to 导入失败；各表行数与 XP 回滚，无半清空 | `src-tauri/tests/export_import_test.rs` |
| import_preserves_foreign_key_integrity | 导入后 `PRAGMA foreign_key_check` 无违规且 `foreign_keys=ON` | `src-tauri/tests/export_import_test.rs` |
| import_preserves_current_round_above_total_rounds | 导入 `current_round=5`、`total_rounds=2` 返回 Ok；两列原样保留；`foreign_key_check` 空 | `src-tauri/tests/export_import_test.rs` |
| import_over_cap_state_does_not_crash_task_detail | 导入过顶后 `task_progress` 不 panic、返回 Ok；按 round=5 过滤，`round_units=0`（round=1 的 8 不计入） | `src-tauri/tests/export_import_test.rs` |
| import_rejects_current_round_when_it_violates_check_constraint | 跳过：`tasks` 无 `CHECK(current_round <= total_rounds)` | `src-tauri/tests/export_import_test.rs` |
| export_round_trip_preserves_over_cap_state | 导入过顶后再导出，`current_round` 仍为 5、`total_rounds` 仍为 2 | `src-tauri/tests/export_import_test.rs` |
| import_user_stats_update_is_noop_when_id_1_row_missing | id=1 缺失时导入仍 Ok；UPSERT 重建一行且 XP/连击与 payload 一致 | `src-tauri/tests/export_import_test.rs` |
| import_positive_streak_with_null_last_done_does_not_reset_on_import | `current_streak=5`、`longest_streak=7`、`last_done_date=NULL` 导入 Ok 且三字段原样保留 | `src-tauri/tests/export_import_test.rs` |
| import_positive_streak_with_null_last_done_resets_on_next_complete | 上述快照导入后完成 actual=3、自评 4、日期今天：current 写成 1，longest 仍为 7，last_done_date 为今天 | `src-tauri/tests/export_import_test.rs` |
| import_rejects_user_stats_payload_with_wrong_id | `user_stats.id=2` 返回 Err 并整单回滚；不静默接受 | `src-tauri/tests/export_import_test.rs` |
| import_rejects_actual_log_with_dangling_session_id | 悬空 session_id 写入前拒绝；Err 点名 log；行数回滚；fk_check 空 | `src-tauri/tests/export_import_test.rs` |
| import_allows_actual_log_with_null_session_id | 手动补记 session_id=NULL 导入成功且保持 NULL | `src-tauri/tests/export_import_test.rs` |
| import_allows_actual_log_for_rescheduled_session | 导入不校验 status：log 指向 rescheduled session 返回 Ok；session_id、status、rescheduled_to 原样；fk_check 空 | `src-tauri/tests/export_import_test.rs` |
| imported_rescheduled_session_log_counts_in_stats | 该 log 的 30 分钟计入 `stats_tag_type_totals` 的 study（统计不 JOIN session.status） | `src-tauri/tests/export_import_test.rs` |
| export_round_trip_preserves_log_for_rescheduled_session | 导入再导出：log.session_id、S.status=rescheduled、rescheduled_to 仍指向目标场 | `src-tauri/tests/export_import_test.rs` |
| import_does_not_auto_flip_rescheduled_to_done | 有 log 指向 S 时导入仍不把 status 改成 done | `src-tauri/tests/export_import_test.rs` |
| import_user_achievements_duplicate_ids_are_idempotent | payload 内重复 achievement_id：Ok；只留一行；unlocked_at 取第一条（INSERT OR IGNORE） | `src-tauri/tests/export_import_test.rs` |
| import_user_achievements_twice_keeps_single_row_per_id | 同 payload 连续导入两次：行不翻倍；DELETE+INSERT 后 unlocked_at 与首次导入后一致 | `src-tauri/tests/export_import_test.rs` |
| import_user_achievements_payload_with_dangling_reference | 悬空 achievement_id 预校验 Err 并回滚（OR IGNORE 会吞 FK，故显式校验） | `src-tauri/tests/export_import_test.rs` |
| import_rejects_user_achievements_when_achievements_catalog_wiped | 本机 achievements 目录被清空后导入含 user_achievements 的 payload：预校验 Err 并回滚；重种子后可再导入 | `src-tauri/tests/export_import_test.rs` |
| export_payload_does_not_include_achievements_catalog | 导出顶层 key 不含 `achievements`；与护栏 `INTENTIONAL_EXPORT_OMISSIONS` 一致 | `src-tauri/tests/export_import_test.rs` |
| import_with_empty_user_achievements_does_not_touch_catalog | payload `user_achievements=[]` 导入成功且本机 achievements 目录行数/id 不变 | `src-tauri/tests/export_import_test.rs` |
| stats_page_empty_charts_render_without_crash | 空数组：计划/方式/自评空态文案；不渲染图表；无 undefined 读属性控制台错 | `src/pages/Stats/__tests__/stats_page.test.tsx` |
| stats_page_empty_does_not_divide_by_zero | 空达成率显示 `0%`，正文无 NaN/Infinity | `src/pages/Stats/__tests__/stats_page.test.tsx` |
| stats_page_single_item_charts_render | 单条 method/subject：饼图 1 扇区 + 明细文案；无空态 | `src/pages/Stats/__tests__/stats_page.test.tsx` |
| update_note_refreshes_updated_at_on_inplace_edit | 改 content 后 updated_at 严格变新；created_at 不变 | `src-tauri/tests/notes_test.rs` |
| list_notes_orders_by_updated_at_desc | 全未置顶时按 updated_at DESC（编辑 A 后顺序 A、C、B） | `src-tauri/tests/notes_test.rs` |
| list_notes_sort_order_is_stable_for_equal_updated_at | 三条 updated_at 相同：连续 3 次顺序一致，且为 id DESC 的 C、B、A | `src-tauri/tests/notes_test.rs` |
| list_notes_pinned_sort_before_updated_at | pinned DESC 先于 updated_at；组内 updated_at DESC, id DESC | `src-tauri/tests/notes_test.rs` |
| notes_page_renders_all_notes_without_virtualization | 120 条一次渲染完，无「加载更多」/分页，无分批卡片 | `src/pages/Notes/__tests__/notes_page.test.tsx` |
| notes_page_pinned_sort_before_updated_at | 页面按 list_notes 返回序渲染：置顶在前，组内 updated_at DESC + id DESC | `src/pages/Notes/__tests__/notes_page.test.tsx` |
| notes_page_does_not_remount_cards_on_scroll | 滚动不二次 `list_notes`；120 个 article DOM 节点引用不变 | `src/pages/Notes/__tests__/notes_page.test.tsx` |
| notes_page_render_is_single_pass_with_memo | Notes 一次 `notes.map` 提交 120 条；卡片在 `NoteCard` 用 `memo`；无虚拟化、无分批 setState | `src/pages/Notes/__tests__/notes_page.test.tsx` |
| notes_page_pinned_toggle_rerenders_only_affected_card | 置顶后只有被点的那张重建 `<article>`（≤ 1）；`key` 为 `note.id`。见「Notes 渲染」 | `src/pages/Notes/__tests__/notes_page.test.tsx` |
| update_note_does_not_change_updated_at_when_no_field_changed | 选 a：字段相同仍刷新 updated_at（无 diff 短路） | `src-tauri/tests/notes_test.rs` |
| create_note_normalizes_invalid_color_to_default | 非法 color（如 neon）创建后库内为 yellow | `src-tauri/tests/notes_test.rs` |
| update_note_normalizes_invalid_color_to_default | 非法 color 更新后库内为 yellow | `src-tauri/tests/notes_test.rs` |
| import_normalizes_invalid_color_to_default | 导入 notes.color=neon 成功且归一为 yellow | `src-tauri/tests/export_import_test.rs` |
| completion_duration_uses_session_length_with_min_one | 完成路径按时段差；零长时段 `.max(1)` 记 1 分钟 | `src-tauri/tests/duration_test.rs` |
| manual_log_duration_uses_time_diff_and_allows_zero | 手动补记起止差；起止相同允许 duration_min=0 | `src-tauri/tests/duration_test.rs` |
| same_duration_two_paths_produce_different_duration_min | 同为 30 分钟：session_id 有/无区分来源；统计 SUM=60 不去重 | `src-tauri/tests/duration_test.rs` |
| complete_dialog_defer_remaining_passes_flag_and_spawns_session | 部分完成勾选「剩余改到下次」：invoke `complete_session` 带 `deferRemaining:true` 与弹窗内 deferDate/Start/End | `src/components/__tests__/complete_dialog.test.tsx` |
| complete_dialog_without_defer_does_not_send_defer_fields | 未勾选 defer：`deferRemaining:false`，`deferDate`/`deferStart`/`deferEnd` 为 null | `src/components/__tests__/complete_dialog.test.tsx` |
| complete_dialog_full_completion_hides_defer_option | actual_units=planned_units 时隐藏「剩余改到下次」 | `src/components/__tests__/complete_dialog.test.tsx` |
| complete_session_rejects_zero_units_with_defer | actual=0 + move_remainder=true → ZeroUnitsCannotDefer；无流水/spawn/XP/连击变更，原场仍 planned | `src-tauri/tests/sessions_test.rs` |
| complete_session_zero_units_without_defer_still_succeeds | actual=0 + move_remainder=false → Ok(done)；duration_min=0 流水；XP/连击不变 | `src-tauri/tests/sessions_test.rs` |
| complete_session_positive_units_with_defer_still_succeeds | actual=2、planned=5、defer → Ok；原场 done；remainder planned_units=3 | `src-tauri/tests/sessions_test.rs` |
| complete_dialog_zero_units_disables_defer | planned=5 改 actual=0：隐藏 defer、提示改期；仍可提交 actual=0 且 deferRemaining=false | `src/components/__tests__/complete_dialog.test.tsx` |
| complete_dialog_defer_reappears_when_units_become_positive | actual 0→2 后 defer 勾选重现；可勾选提交 deferRemaining=true | `src/components/__tests__/complete_dialog.test.tsx` |
| complete_dialog_backend_zero_defer_error_shows_friendly_message | 绕过 UI 强制 0+defer：友好「改期」提示、弹窗不关、无未捕获 rejection | `src/components/__tests__/complete_dialog.test.tsx` |
| complete_dialog_rejects_non_numeric_actual_units | `"abc"`：提示「请输入数字」，提交禁用，不 invoke，无 NaN 警告 | `src/components/__tests__/complete_dialog.test.tsx` |
| complete_dialog_rejects_negative_actual_units | `"-3"`：提示「不能为负数」，提交禁用，不把英文后端错误留给用户 | `src/components/__tests__/complete_dialog.test.tsx` |
| complete_dialog_empty_input_treated_as_zero_not_submitted_silently | 选项 a：空串停在 `""`，提示「请输入课数」，提交禁用；显式 `"0"` 仍可提交 | `src/components/__tests__/complete_dialog.test.tsx` |
| complete_dialog_rejects_overlong_number | 20 个 9 原样留在框里，提示「数值过大」，不把 `1e20` 交给 invoke | `src/components/__tests__/complete_dialog.test.tsx` |
| complete_dialog_decimal_input_behavior_documented | 选项 a：`"3.7"` 提示「请输入整数」，不四舍五入也不截断 | `src/components/__tests__/complete_dialog.test.tsx` |
| countdown_panel_clears_interval_on_unmount | unmount 时 clearInterval 收到 setInterval 返回的同一句柄 | `src/components/__tests__/countdown_panel.test.tsx` |
| countdown_panel_does_not_tick_after_unmount | 行为：tick 后文本变；卸载后再 advanceTimers 无 unmounted setState 警告 | `src/components/__tests__/countdown_panel.test.tsx` |
| countdown_panel_updates_days_without_restarting_the_clock | 主考目标日变化：天数立刻重算；墙钟 interval 仍是原来那一条 | `src/components/__tests__/countdown_panel.test.tsx` |
| compute_countdown_returns_zeros_when_target_in_past | 目标日早于 now：展示字段与 `totalMs` 均为 0，`isPast=true`，无负数 | `src/lib/__tests__/countdown.test.ts` |
| compute_countdown_returns_one_second_when_target_one_second_ahead | 本地零点前 1 秒：`hours`/`minutes`/`seconds` 为 0、`totalMs=1000`、`days=1`（日历跨日）、`isPast=false` | `src/lib/__tests__/countdown.test.ts` |
| compute_countdown_two_days_ahead_returns_days_without_clock | 目标日为后天：`days=2`，时/分/秒全为 0 | `src/lib/__tests__/countdown.test.ts` |
| calculate_today_remaining_minutes_sums_planned_sessions | 今天两场 planned（60 分钟 + 30 分钟）合计 90 | `src/lib/__tests__/studyCountdown.test.ts` |
| calculate_today_remaining_minutes_ignores_done | 同上两场 planned 再加一场 done：仍是 90，done 不计入 | `src/lib/__tests__/studyCountdown.test.ts` |
| resolve_remaining_study_counts_down_the_current_session | 19:15 落在 19:00–20:00：本场还剩 45 分钟，计划合计仍是 120 | `src/lib/__tests__/studyCountdown.test.ts` |
| resolve_remaining_study_counts_down_to_the_next_session | 16:46 距 19:00 的英语还有 2 小时 14 分；done 不进合计 | `src/lib/__tests__/studyCountdown.test.ts` |
| exam_date_sync_replaces_default_seed_for_grade_two | 档案是高二、主考日仍是种子 2027-06-07：改成 2028-06-07 | `src/components/__tests__/exam_date_sync.test.tsx` |
| exam_date_sync_keeps_a_date_the_user_already_chose | 主考日已是用户选的 2030-06-07：不按年级覆盖 | `src/components/__tests__/exam_date_sync.test.tsx` |
| compute_countdown_returns_zeros_when_target_equals_now | now 等于目标日本地零点：全 0 且 `isPast=true` | `src/lib/__tests__/countdown.test.ts` |
| compute_countdown_never_returns_negative_for_large_past_gap | 过去约 10 年：字段有限且 ≥ 0，`totalMs=0`，无 NaN/Infinity | `src/lib/__tests__/countdown.test.ts` |
| compute_countdown_handles_invalid_target_date | `"not-a-date"` 不抛；全 0 且 `isPast=false` | `src/lib/__tests__/countdown.test.ts` |
| countdown_panel_past_target_shows_arrived_not_negative | 目标日已过：文案「已到达」，没有未完成排期时是「今日任务全部完成」，无负号数字 / NaN | `src/components/__tests__/countdown_panel.test.tsx` |
| countdown_panel_transitions_to_arrived_at_target_moment | 零点前 1.5 秒大字仍是天数；下一次 1 秒 tick 直接「已到达」，不停留在天数 | `src/components/__tests__/countdown_panel.test.tsx` |
| countdown_panel_recomputes_when_target_changes_to_past | 目标从未来改为过去：立刻「已到达」，原天数消失，无 console.error | `src/components/__tests__/countdown_panel.test.tsx` |
| countdown_panel_past_target_hides_day_field_if_design_requires | 已过：隐藏「天」，保留「今日任务全部完成」与「0 周」「0 月」 | `src/components/__tests__/countdown_panel.test.tsx` |
| widget_page_renders_countdown | 悬浮窗渲染高考倒计时大数字、进行中场次，以及拖拽区域和关闭按钮 | `src/pages/__tests__/widget_page.test.tsx` |
| widget_label_skips_main_shell | 窗口 label 为 `widget` 时只渲染 WidgetPage，不挂侧边栏、今日排期和悬浮窗开关 | `src/pages/__tests__/widget_page.test.tsx` |
| session_notifier_fires_prep_then_start_once | 08:55 课前 5 分钟提醒，09:00 开课提醒，09:01 不再弹 | `src/hooks/__tests__/session_notifier.test.tsx` |
| session_notifier_stays_quiet_when_disabled_or_permission_denied | 设置关闭或系统权限拒绝时不调用 sendNotification，也不把错误打到控制台 | `src/hooks/__tests__/session_notifier.test.tsx` |
| export_json_errors_when_user_stats_id_1_row_missing | 删除 user_stats 后导出 Err（点名缺失/损坏）；不 panic、不产出缺字段备份 | `src-tauri/tests/export_import_test.rs` |
| export_after_user_stats_restored_succeeds | 缺行失败后手动 INSERT id=1 再导出 Ok，payload 含 user_stats | `src-tauri/tests/export_import_test.rs` |
| task_detail_progress_ring_reads_task_progress | mock `task_progress.round_units=7` 与 sessions 自算=3 分叉；环与「本轮」显示 7/20 | `src/pages/Tasks/__tests__/task_detail_progress.test.tsx` |
| task_detail_progress_ring_reflects_advance_round | 推进后 mock `round_units=0`；环显示 0/20，不把旧轮 actual_units 卷入 | `src/pages/Tasks/__tests__/task_detail_progress.test.tsx` |
| task_view_toggle_unmounts_list_and_skips_refetch | 点「网格视图」后 `task-list-view` 卸载、同一批任务留在网格里，`taskView` 写入 Zustand；来回切换不追加 `list_tasks` | `src/pages/Tasks/__tests__/task_view_toggle.test.tsx` |
| task_grid_view_lights_four_of_ten_cells | `total_units=10`、`current_round_units=4`：10 个格子，4 个 `bg-orange-500`，其余 `bg-zinc-800`；头部有课本和轮次 | `src/pages/Tasks/__tests__/task_grid_view.test.tsx` |
| task_grid_view_side_task_shows_icon_without_micro_grid | `type=side` 不渲染微观点阵，渲染 `side-task-icon` 和累计完成课数 | `src/pages/Tasks/__tests__/task_grid_view.test.tsx` |
| task_grid_view_caps_cells_at_50 | `total_units=200` 只渲染 50 格，文案标明每格 4 课、已完成 8/200 | `src/pages/Tasks/__tests__/task_grid_view.test.tsx` |
| daily_units_sum_done_sessions_and_ignore_logs | 同日多场 `done` 的 `actual_units` 相加；planned / missed 与 `actual_logs` 不进合计；区间外不计 | `src-tauri/tests/stats_test.rs` |
| accumulation_wall_colors_match_unit_buckets | 7 天单位 0/1/3/4/6/7/12 分别是 zinc-800、orange-900、orange-900、orange-600、orange-600、orange-400、orange-400；title 含日期和完成数；今天 `data-today="true"` 且 `ring-orange-500`；左侧有 Mon/Wed/Fri | `src/components/__tests__/accumulation_wall.test.tsx` |
| accumulation_wall_zero_units_is_zinc_800 | 显式 0 与窗口内缺记录的日期都是 `bg-zinc-800`，title 为「完成 0」；今天边框 `ring-zinc-500`；最近 7 天为 0 时出现「开始第一课」链接 | `src/components/__tests__/accumulation_wall.test.tsx` |
| accumulation_wall_month_labels_when_range_crosses | 2026-10-09 至 2026-11-05 在对应周列上方标「10月」「11月」 | `src/components/__tests__/accumulation_wall.test.tsx` |
| settings_past_exam_date_shows_confirmation_before_write | 本地今天 2026-01-01 选 2025-06-07：确认框含「已过去」「已到达」；确认前不写 store / `timequest.exams`；输入框先显示所选日期 | `src/pages/Settings/__tests__/settings_exam_date.test.tsx` |
| settings_past_exam_date_cancel_does_not_write | 取消后 store 与 localStorage 仍是原日期，输入框恢复原值，确认框关闭，无错误提示 | `src/pages/Settings/__tests__/settings_exam_date.test.tsx` |
| settings_past_exam_date_confirm_writes | 确认后 `upsertExam` 写入 2025-06-07（Zustand + `timequest.exams`）；无 `upsert_exam` command；确认框关闭；输入框保持该日期 | `src/pages/Settings/__tests__/settings_exam_date.test.tsx` |
| settings_future_exam_date_writes_without_confirmation | 选 2026-06-07：不弹确认框，直接写入 store 与 localStorage | `src/pages/Settings/__tests__/settings_exam_date.test.tsx` |
| settings_date_change_does_not_write_on_every_keystroke | **跳过**：已有目标是原生 `type="date"`，`onChange` 只在完整日期时触发，不逐字符写 | `src/pages/Settings/__tests__/settings_exam_date.test.tsx` |
| dashboard_countdown_updates_when_exam_date_changes_in_store | 仪表盘挂着时 `setExams` 从 2026-06-07 改为 2026-07-01：天数立刻更新，旧 interval 清理并新建，无 console.error | `src/pages/Dashboard/__tests__/dashboard_countdown.test.tsx` |
| dashboard_countdown_does_not_use_stale_date_after_remount | `upsertExam` 写成日期 B 后卸载再挂载：显示 B 的天数；卸载时清掉当时的 interval，重新挂载新建一条 | `src/pages/Dashboard/__tests__/dashboard_countdown.test.tsx` |
| daily_motivation_index_is_yyyymmdd_modulo_length | `YYYY-MM-DD` 去横线后对句数取余；同日同一句，次日换一句 | `src/lib/__tests__/motivation.test.ts` |
| resolve_motivation_uses_custom_text_and_treats_blank_as_unset | 非空自定义原文（trim）优先；`null` / 缺省 / 空白回落到当天默认句 | `src/lib/__tests__/motivation.test.ts` |
| dashboard_motivation_uses_default_when_setting_empty | `useAppSetting('motivation_text')` 为 null：标题行右侧渲染 `DEFAULT_MOTIVATIONS` 中的一句，`text-zinc-400` + italic；同日重挂不变，次日更换 | `src/pages/Dashboard/__tests__/dashboard_motivation.test.tsx` |
| dashboard_motivation_renders_custom_text | 设置为「我要上清华」时原文出现在标题行右侧，不渲染默认句 | `src/pages/Dashboard/__tests__/dashboard_motivation.test.tsx` |
| settings_motivation_save_invokes_set_setting | 输入框先显示 `get_setting` 的已存句子；改成新文本点「保存」后 `invoke('set_setting', { key: 'motivation_text', value })` | `src/pages/Settings/__tests__/settings_motivation.test.tsx` |
| settings_motivation_clear_writes_empty_and_shows_default | 「清空」把输入框置空，`set_setting` 的 value 为 `""`，并显示当天默认句 | `src/pages/Settings/__tests__/settings_motivation.test.tsx` |
| exam_date_change_does_not_shift_open_complete_dialog_date | 完成弹窗「剩余改到下次」默认本地今天；改 exam 不覆盖默认值，也不覆盖用户已选日期 | `src/pages/__tests__/exam_date_isolation.test.tsx` |
| exam_date_change_does_not_shift_open_stats_range | 统计页本周/本月区间按本地今天；改 exam 后文案与 stats 查询的 from/to 都不跟考试日 | `src/pages/__tests__/exam_date_isolation.test.tsx` |
| exam_date_change_only_affects_countdown | 仪表盘改 exam 后天数更新；今日排期标题与连击条不变，且不再请求 sessions / user_stats | `src/pages/__tests__/exam_date_isolation.test.tsx` |
| generate_mock_data_marks_every_inserted_row | 湖南高二演示：3 条主线、今天 done+planned、2 条历史成绩全部 `is_mock=1`；不写 `actual_logs`；第二次调用不追加；导出保留 `is_mock` | `src-tauri/tests/mock_data_test.rs` |
| clear_mock_data_removes_only_mock_rows | 有真实任务/场次/成绩/手记时，清除只删 `is_mock=1`（含指向演示场次的流水），XP 与连击不动；没有演示行时清除也不改 XP | `src-tauri/tests/mock_data_test.rs` |
| clear_mock_data_resets_stats_when_no_real_rows | 只有演示数据时清除后三张表为空，`user_stats` 回到 XP 0、连击 0、等级 1 | `src-tauri/tests/mock_data_test.rs` |
| import_missing_is_mock_defaults_to_zero | 旧备份没有 `is_mock` 时导入写成 0，不会被当成演示数据 | `src-tauri/tests/mock_data_test.rs` |
| onboarding_real_start_saves_profile_and_skips_mock | 引导写入年级/地区/目标分并标记完成，不调用 `generate_mock_data`；2026-11 选高二时主考日写成 2028-06-07 | `src/components/__tests__/onboarding.test.tsx` |
| onboarding_loads_hunan_demo_data | 「加载湖南高二演示数据」先存档案，再 `generate_mock_data`，最后写入完成标志 | `src/components/__tests__/onboarding.test.tsx` |
| onboarding_hides_when_already_completed | `onboarding_completed=1` 时不渲染引导 | `src/components/__tests__/onboarding.test.tsx` |
| settings_clear_mock_highlights_and_confirms_before_delete | 有演示数据时「清除所有演示数据」为橙色；取消不调用；确认后调用 `clear_mock_data` 并熄灭高亮 | `src/pages/Settings/__tests__/settings_mock_data.test.tsx` |
| crossed_round_total_only_on_the_crossing_step | 9→10、8→12 为真；未到、已过、持平、`total <= 0` 为假 | `src-tauri/src/gamification.rs` |
| streak_milestone_only_when_value_changes_onto_7_14_30 | 6→7、13→14、29→30 返回该数字；同值、7→8、0→1 返回 None | `src-tauri/src/gamification.rs` |
| complete_flags_task_fully_completed_only_when_current_round_crosses_total | 主线 6/10 不标志；0 单位不标志也不推进连击；再完成 4 课标志通关；超额后再完成不重复 | `src-tauri/tests/sessions_test.rs` |
| complete_does_not_flag_side_task_or_other_round | 副本达到 total 不标志；当前轮是 2 时完成第 1 轮不标志 | `src-tauri/tests/sessions_test.rs` |
| complete_flags_streak_milestone_only_when_streak_newly_hits_7_14_or_30 | 6 的次日完成得到 7 并标志；同日再完成不重复；0 单位停在 6；14 与 30 同样只在跨到时标志；7 的次日变成 8 不标志 | `src-tauri/tests/sessions_test.rs` |
| idempotent_complete_does_not_repeat_celebration_flags | 通关后再完成同一场：XP 0、通关标志与连击里程碑都不再出现，current_streak 仍是 1 | `src-tauri/tests/sessions_test.rs` |
| celebrations_default_on_until_setting_is_explicitly_off | `null` / 缺省 / 空白 / `"1"` 开启；`"0"` 与 `"false"` 关闭 | `src/lib/__tests__/celebration.test.ts` |
| resolve_celebration_picks_task_streak_or_neither | 通关返回 task_complete；7/14/30 返回 streak；两者同时只留通关；currentStreak 为 7 但 milestone 为空不庆祝 | `src/lib/__tests__/celebration.test.ts` |
| celebration_copy_uses_the_book_title_and_the_seven_day_line | 通关文案带书名；7 天文案为「击败了全国 90% 的考生」 | `src/lib/__tests__/celebration.test.ts` |
| celebrate_task_complete_fires_confetti_when_setting_unset | 设置未写入时完成通关：浮层文案、烟花 3 次、和弦 1 次，浮层 `pointer-events-none` | `src/hooks/__tests__/use_celebration.test.tsx` |
| celebrate_streak_milestone_fires_once | 连击 7：一条浮层文案，烟花 1 次 | `src/hooks/__tests__/use_celebration.test.tsx` |
| celebrations_disabled_skips_confetti_sound_and_overlay | `enable_celebrations=0` 时完成仍成功，不放烟花、不建 AudioContext、不出现浮层 | `src/hooks/__tests__/use_celebration.test.tsx` |
| celebration_overlay_fades_after_two_seconds_and_ignores_pointer | 2 秒后 `data-state=fading`，再 400ms 卸掉；全程不接收点击 | `src/hooks/__tests__/use_celebration.test.tsx` |
| settings_celebrations_toggle_writes_enable_celebrations | 未设置时开关为开；关掉写入 `enable_celebrations=0` | `src/pages/Settings/__tests__/settings_celebrations.test.tsx` |
| settings_celebrations_off_value_starts_unchecked_and_writes_one | 已存 `0` 时开关为关；打开写入 `1` | `src/pages/Settings/__tests__/settings_celebrations.test.tsx` |
| knowledge_drawer_selects_catalog_section_and_submits_custom_name | 添加节时列出教材目录；已有节置灰并标「已有」；点选「1.1 集合的概念」后添加考点，`sectionName` 原样传给 `add_custom_knowledge_point`；输入已有节名提示「该节已存在，请直接在内添加考点」；自定义「补充专题」去掉首尾空格后也能提交 | `src/pages/Tasks/__tests__/knowledge_point_drawer.test.tsx` |
| knowledge_drawer_lists_sections_when_textbook_is_renjiao_a | 任务课本是「人教A版」、标题是「数学必修一」时，添加节列出必修第一册的「1.1 集合的概念」，并向 `get_textbook_outline` 请求人教版而不是湘教版 | `src/pages/Tasks/__tests__/knowledge_point_drawer.test.tsx` |
| knowledge_drawer_picks_standard_point_and_disables_taken_tag | 「添加考点」列出该节预设考点；已有的「集合的含义」置灰打勾且点击不 invoke；点「元素与集合的关系」调用 `add_custom_knowledge_point` 后该标签禁用；下方保留自定义输入框 | `src/pages/Tasks/__tests__/knowledge_point_drawer.test.tsx` |
| matches_a_generated_textbook_label_and_a_volume_only_label | `人教版 必修第一册` 与单独的册别都能对上目录；科目不对则没有匹配 | `src/lib/__tests__/sectionCatalog.test.ts` |
| match_textbook_maps_renjiao_a_and_task_title_to_required_volume | 演示任务 `人教A版` + 标题「数学必修一」对上人教版必修第一册，不选湘教版；必修二、选择性必修一各对各的册；只有版本或册次撞车时不猜 | `src/lib/__tests__/sectionCatalog.test.ts` |
| resolve_section_choice_keeps_catalog_titles_and_trims_custom_names | 目录节名去空白后保持原串；已有节是 exists；自定义节名 trim 后作为 custom | `src/lib/__tests__/sectionCatalog.test.ts` |
| outline_points_by_section_trims_names_and_drops_blanks | 节名与考点去空白；重复和空考点丢掉；没有预设考点的节对应空数组 | `src/lib/__tests__/sectionCatalog.test.ts` |
| create_session_rejects_end_before_start | 结束早于开始：入口拒绝，不写库 | `src-tauri/tests/sessions_test.rs` |
| create_session_allows_zero_length_range | 起止相同仍允许（零长时段，完成时记 1 分钟） | `src-tauri/tests/sessions_test.rs` |
| create_session_rejects_unparsable_time | 时间解析不了返回 `InvalidTimeFormat` | `src-tauri/tests/sessions_test.rs` |
| reschedule_rejects_end_before_start | 改期同样校验时段 | `src-tauri/tests/sessions_test.rs` |
| complete_with_inverted_defer_range_is_rejected | 完成弹窗「剩余改到下次」时段倒挂被拒 | `src-tauri/tests/sessions_test.rs` |
| complete_dialog_defer_rejects_inverted_time_range | 前端在提交前就拦下倒挂时段 | `src/components/__tests__/complete_dialog.test.tsx` |
| complete_dialog_uses_task_unit_name_and_shows_section_title | 弹窗用任务自己的单位（「节」/「课」） | `src/components/__tests__/complete_dialog.test.tsx` |
| task_empty_title_shows_error_and_does_not_create | 新建任务标题为空：报错且不调 `create_task` | `src/pages/Tasks/__tests__/task_empty_title.test.tsx` |
| delete_session_removes_planned_session | `planned` 场次可删 | `src-tauri/tests/sessions_test.rs` |
| delete_session_refuses_done_session | `done` 场次不可删 | `src-tauri/tests/sessions_test.rs` |
| delete_session_refuses_session_with_logs | 已有流水的场次不可删 | `src-tauri/tests/sessions_test.rs` |
| delete_session_clears_source_rescheduled_pointer | 删除后被改期指向它的场次 `rescheduled_to` 置空 | `src-tauri/tests/sessions_test.rs` |
| delete_session_reports_missing_session | 删不存在的场次返回 `SessionNotFound` | `src-tauri/tests/sessions_test.rs` |
| today_delete_asks_confirmation_then_calls_delete_session | 今日页删除先确认再调 `delete_session` | `src/pages/Today/__tests__/today_delete_session.test.tsx` |
| today_delete_cancel_keeps_the_session | 取消不删，场次仍在 | `src/pages/Today/__tests__/today_delete_session.test.tsx` |
| today_create_confirms_overlap_before_saving | 与已有排期重叠时先弹确认再写 | `src/pages/Today/__tests__/today_create_guard.test.tsx` |
| calculate_today_remaining_minutes_merges_duplicate_slots | 同一时段重复排期按并集合并，不重复计时长 | `src/lib/__tests__/studyCountdown.test.ts` |
| calculate_today_remaining_minutes_merges_partial_overlap | 部分重叠也合并成一段 | `src/lib/__tests__/studyCountdown.test.ts` |
| calculate_today_remaining_minutes_caps_at_daily_limit | 今日待学时长不超过每日上限 | `src/lib/__tests__/studyCountdown.test.ts` |
| calculate_today_remaining_minutes_respects_custom_daily_limit | 上限读 `daily_limit_minutes` 设置 | `src/lib/__tests__/studyCountdown.test.ts` |
| merge_planned_windows_returns_non_overlapping_windows | 合并后得到不重叠的时段窗口 | `src/lib/__tests__/studyCountdown.test.ts` |
| summarize_today_plan_reports_merged_sessions_and_cap | 汇总同时报合并后的场次数与上限 | `src/lib/__tests__/studyCountdown.test.ts` |
| resolve_remaining_study_reports_merged_sessions | 剩余待学按合并后的场次算 | `src/lib/__tests__/studyCountdown.test.ts` |
| study_remaining_merges_overlapping_sessions_and_explains | 面板合并重叠场次并说明 | `src/components/__tests__/study_remaining.test.tsx` |
| study_remaining_caps_daily_total_and_explains | 面板按上限截断并说明 | `src/components/__tests__/study_remaining.test.tsx` |
| study_remaining_stays_plain_when_no_overlap | 没有重叠时不加解释文案 | `src/components/__tests__/study_remaining.test.tsx` |
| parse_daily_slots_returns_defaults_when_unset | 没设置时用默认三段 | `src/lib/__tests__/studyPlan.test.ts` |
| parse_daily_slots_falls_back_on_broken_payload | 存坏了退回默认三段 | `src/lib/__tests__/studyPlan.test.ts` |
| parse_daily_slots_reads_pairs_and_drops_invalid | 读 `[["HH:MM","HH:MM"]]`，非法段丢掉 | `src/lib/__tests__/studyPlan.test.ts` |
| parse_daily_slots_accepts_object_form | 也认 `{start,end}` 形式 | `src/lib/__tests__/studyPlan.test.ts` |
| serialize_daily_slots_round_trips | 写入格式与读取格式互逆 | `src/lib/__tests__/studyPlan.test.ts` |
| parse_daily_limit_clamps_and_defaults | 上限夹在 60–720 分钟之间 | `src/lib/__tests__/studyPlan.test.ts` |
| daily_slot_minutes_sums_valid_slots | 一天可用分钟数只算合法段 | `src/lib/__tests__/studyPlan.test.ts` |
| daily_plan_setting_loads_saved_slots_and_limit | 设置页读回已存时段与上限 | `src/components/__tests__/daily_plan_setting.test.tsx` |
| daily_plan_setting_saves_preset_slots_and_limit | 预设一键填入并存盘 | `src/components/__tests__/daily_plan_setting.test.tsx` |
| daily_plan_setting_drops_invalid_slot_on_save | 非法段保存时忽略并提示 | `src/components/__tests__/daily_plan_setting.test.tsx` |
| daily_plan_setting_adds_and_removes_slots | 可增删时段 | `src/components/__tests__/daily_plan_setting.test.tsx` |
| generate_week_plan_creates_sessions_across_days | 一键排计划跨天生成场次 | `src-tauri/tests/planner_test.rs` |
| generate_week_plan_skips_occupied_slots | 已被占用的时段跳过 | `src-tauri/tests/planner_test.rs` |
| generate_week_plan_respects_daily_limit | 每日累计不超上限 | `src-tauri/tests/planner_test.rs` |
| generate_week_plan_uses_configured_slots | 用设置页配置的时段排 | `src-tauri/tests/planner_test.rs` |
| generate_week_plan_rejects_archived_task | 归档任务不排 | `src-tauri/tests/planner_test.rs` |
| generate_week_plan_rejects_unknown_task | 任务不存在返回错误 | `src-tauri/tests/planner_test.rs` |
| generate_week_plan_rejects_broken_start_date | 日期格式不对直接报错 | `src-tauri/tests/planner_test.rs` |
| generate_week_plan_is_idempotent_on_second_run | 第二次跑不重复排 | `src-tauri/tests/planner_test.rs` |
| task_detail_week_plan_generates_schedule_and_reports | 详情页一键排计划并回报数量 | `src/pages/Tasks/__tests__/task_detail_week_plan.test.tsx` |
| task_detail_week_plan_reports_skipped_slots | 回报被跳过的格数 | `src/pages/Tasks/__tests__/task_detail_week_plan.test.tsx` |
| task_detail_week_plan_says_when_no_slot_is_free | 没有空档时给出说明 | `src/pages/Tasks/__tests__/task_detail_week_plan.test.tsx` |
| parse_hhmm_reads_valid_and_rejects_invalid | 时间解析 | `src/lib/__tests__/timeField.test.ts` |
| format_hhmm_pads_and_clamps | 时间补零并夹取 | `src/lib/__tests__/timeField.test.ts` |
| add_minutes_to_hhmm_keeps_clock_valid | 加分钟不越界 | `src/lib/__tests__/timeField.test.ts` |
| format_duration_label_reads_in_chinese | 时长中文文案 | `src/lib/__tests__/timeField.test.ts` |
| presets_cover_morning_afternoon_and_evening | 时段快捷预设 | `src/lib/__tests__/timeField.test.ts` |
| hour_and_minute_choices_are_in_school_day_range | 时/分选项落在作息范围内 | `src/lib/__tests__/timeField.test.ts` |
| weekday_label_starts_on_monday | 星期从周一开始 | `src/lib/__tests__/dateField.test.ts` |
| short_date_label_drops_year | 短日期不显示年份 | `src/lib/__tests__/dateField.test.ts` |
| relative_day_label_covers_today_tomorrow_after_tomorrow | 相对日期文案 | `src/lib/__tests__/dateField.test.ts` |
| days_between_counts_calendar_days | 按日历日算天数 | `src/lib/__tests__/dateField.test.ts` |
| add_days_iso_crosses_month_boundary | 加天数跨月 | `src/lib/__tests__/dateField.test.ts` |
| next_monday_never_returns_today | 下个周一不含今天 | `src/lib/__tests__/dateField.test.ts` |
| month_key_and_label_read_in_chinese | 月份中文 | `src/lib/__tests__/dateField.test.ts` |
| month_grid_fills_whole_weeks_from_monday | 月历整周补齐 | `src/lib/__tests__/dateField.test.ts` |
| shift_month_moves_across_year | 翻月跨年 | `src/lib/__tests__/dateField.test.ts` |
| date_field_shows_relative_label_and_opens_shortcuts | 日期框显示相对标签与快捷 | `src/components/__tests__/date_time_fields.test.tsx` |
| date_field_shortcut_picks_tomorrow | 快捷选明天 | `src/components/__tests__/date_time_fields.test.tsx` |
| date_field_grid_picks_a_day_and_marks_today | 日历网格选日、今天高亮 | `src/components/__tests__/date_time_fields.test.tsx` |
| date_field_can_move_to_next_month | 能翻到下个月 | `src/components/__tests__/date_time_fields.test.tsx` |
| time_field_picks_hour_then_minute | 时间框先选时再选分 | `src/components/__tests__/date_time_fields.test.tsx` |
| time_field_exact_input_updates_value | 可直接键入时间 | `src/components/__tests__/date_time_fields.test.tsx` |
| time_range_field_applies_preset_slot_in_one_click | 时段预设一键套用 | `src/components/__tests__/date_time_fields.test.tsx` |
| time_range_field_extends_end_by_duration | 按时长顺延结束时间 | `src/components/__tests__/date_time_fields.test.tsx` |
| glossary_entries_have_unique_ids_and_complete_text | 词条 id 唯一、字段齐全 | `src/lib/__tests__/glossary.test.ts` |
| glossary_xp_formula_matches_gamification_constants | XP 公式与常量一致 | `src/lib/__tests__/glossary.test.ts` |
| glossary_level_formula_matches_level_curve | 等级公式与曲线一致 | `src/lib/__tests__/glossary.test.ts` |
| glossary_daily_limit_matches_settings_bounds | 每日上限口径与设置一致 | `src/lib/__tests__/glossary.test.ts` |
| glossary_covers_the_numbers_students_ask_about | 覆盖学生常问的数字 | `src/lib/__tests__/glossary.test.ts` |
| glossary_hint_opens_the_formula_on_click | 点词条弹出公式说明 | `src/components/__tests__/glossary_hint.test.tsx` |
| glossary_hint_renders_nothing_for_unknown_id | 未知词条不渲染 | `src/components/__tests__/glossary_hint.test.tsx` |
| glossary_hint_closes_on_confirm | 关闭后弹窗消失 | `src/components/__tests__/glossary_hint.test.tsx` |
| glossary_list_shows_every_term_with_its_source | 术语列表带来源说明 | `src/components/__tests__/glossary_hint.test.tsx` |
| mock_exam_picks_the_nearest_future_non_primary_exam | 取最近的非主考目标 | `src/lib/__tests__/mockExam.test.ts` |
| mock_exam_ignores_the_primary_exam | 主考（高考）不算模考 | `src/lib/__tests__/mockExam.test.ts` |
| mock_exam_ignores_past_exams | 过去的模考不倒计时 | `src/lib/__tests__/mockExam.test.ts` |
| mock_exam_marks_today_as_is_today | 今天就是模考日 | `src/lib/__tests__/mockExam.test.ts` |
| mock_exam_returns_null_without_any_exam | 没有模考返回 null | `src/lib/__tests__/mockExam.test.ts` |
| mock_countdown_shows_days_until_next_mock_exam | 面板显示模考倒计时 | `src/components/__tests__/mock_countdown.test.tsx` |
| mock_countdown_hides_when_there_is_no_mock_exam | 没有模考不显示 | `src/components/__tests__/mock_countdown.test.tsx` |
| create_note_with_date_stores_bound_date | 建便签时写 `note_date` | `src-tauri/tests/notes_test.rs` |
| create_note_without_date_leaves_note_date_null | 不绑定日期时留空 | `src-tauri/tests/notes_test.rs` |
| update_note_binds_then_clears_date | 绑定后可解绑 | `src-tauri/tests/notes_test.rs` |
| normalize_note_date_rejects_malformed_values | 非法日期被当成「没绑日期」 | `src-tauri/tests/notes_test.rs` |
| note_card_binds_a_date_from_the_picker | 便签卡片从选择器绑日期 | `src/components/__tests__/note_date_binding.test.tsx` |
| note_card_shows_the_bound_date_and_can_unbind | 卡片显示已绑日期并可解绑 | `src/components/__tests__/note_date_binding.test.tsx` |
| notes_page_creates_a_note_with_the_chosen_date | 便签页新建时带日期 | `src/components/__tests__/note_date_binding.test.tsx` |
| today_page_shows_only_notes_bound_to_that_day | 今日页只显示当天便签 | `src/components/__tests__/note_date_binding.test.tsx` |
| keeps_only_notes_bound_to_that_day | 按日期过滤便签 | `src/lib/__tests__/notes.test.ts` |
| ignores_notes_without_a_bound_date | 没绑日期的不算当天 | `src/lib/__tests__/notes.test.ts` |
| returns_empty_for_empty_date_or_empty_list | 空日期或空列表返回空 | `src/lib/__tests__/notes.test.ts` |
| mistake_reasons_match_the_backend_whitelist | 前端错因集合与后端白名单一致 | `src/lib/__tests__/mistakes.test.ts` |
| normalize_reason_falls_back_to_other | 未知错因归「其他」 | `src/lib/__tests__/mistakes.test.ts` |
| normalize_subject_trims_and_defaults_to_other | 科目去空白、空的归「其他」 | `src/lib/__tests__/mistakes.test.ts` |
| summarize_mistakes_counts_pending_and_mastered | 统计条数字正确 | `src/lib/__tests__/mistakes.test.ts` |
| filter_mistakes_splits_pending_and_mastered | 筛选切分未订正/已订正 | `src/lib/__tests__/mistakes.test.ts` |
| reason_counts_lists_the_most_common_reason_first | 错因统计按次数降序 | `src/lib/__tests__/mistakes.test.ts` |
| frontend_reason_list_matches_backend_whitelist | 跨端护栏：前端 `MISTAKE_REASONS` 必须等于 Rust `REASON_WHITELIST` | `src-tauri/tests/mistakes_test.rs` |
| normalize_reason_maps_unknown_to_other | 后端错因归一 | `src-tauri/tests/mistakes_test.rs` |
| normalize_subject_trims_and_falls_back_to_other | 后端科目归一 | `src-tauri/tests/mistakes_test.rs` |
| create_mistake_stores_normalized_reason_and_subject | 建错题时写归一后的错因与科目 | `src-tauri/tests/mistakes_test.rs` |
| list_mistakes_puts_unmastered_first | 未订正排前面 | `src-tauri/tests/mistakes_test.rs` |
| update_mistake_only_touches_given_fields | 只更新传入字段 | `src-tauri/tests/mistakes_test.rs` |
| delete_mistake_removes_the_row | 删除错题 | `src-tauri/tests/mistakes_test.rs` |
| mistakes_survive_export_import_round_trip | 错题本进出备份 JSON | `src-tauri/tests/mistakes_test.rs` |
| mistakes_page_records_subject_reason_and_correct_note | 错题页录入科目/错因/正确思路 | `src/pages/__tests__/mistakes_page.test.tsx` |
| mistakes_page_refuses_to_save_without_a_title | 标题为空不保存 | `src/pages/__tests__/mistakes_page.test.tsx` |
| mistakes_page_toggles_mastered_state | 标记/取消订正 | `src/pages/__tests__/mistakes_page.test.tsx` |
| mistakes_page_filters_pending_and_mastered | 三个筛选按钮 | `src/pages/__tests__/mistakes_page.test.tsx` |
| mistakes_page_shows_the_empty_state | 空态文案 | `src/pages/__tests__/mistakes_page.test.tsx` |
| full_paper_needs_no_scaling | 六科齐不折算 | `src/lib/__tests__/scoreScaling.test.ts` |
| missing_biology_scales_the_total_to_the_six_subject_scale | 缺考生物按比例折算 | `src/lib/__tests__/scoreScaling.test.ts` |
| several_missing_subjects_scale_by_the_taken_share | 缺多科按已考占比折算 | `src/lib/__tests__/scoreScaling.test.ts` |
| a_single_subject_is_not_scaled | 只记一科不折算 | `src/lib/__tests__/scoreScaling.test.ts` |
| an_empty_paper_has_no_scaled_total | 空记录无折算分 | `src/lib/__tests__/scoreScaling.test.ts` |
| subject_full_marks_match_the_default_targets | 各科满分与默认目标一致 | `src/lib/__tests__/scoreScaling.test.ts` |
| scales a partial paper so the gap to the target stays comparable | 折算后与目标的差值可比 | `src/components/__tests__/score_overview_capsule.test.tsx` |
| does not scale a paper that only has one score | 单科成绩不显示折算 | `src/components/__tests__/score_overview_capsule.test.tsx` |
| catalog_lists_builtin_plugins_not_installed_yet | 内置插件仓库清单非空；新装的应用没有已安装插件 | `src-tauri/tests/plugins_test.rs` |
| install_plugin_writes_package_and_marks_installed | 安装后包落到 `plugins/<id>/plugin.json`；settings 记一条；列表标 installed | `src-tauri/tests/plugins_test.rs` |
| install_plugin_twice_keeps_one_record | 重复下载不重复登记，settings 只占一行 | `src-tauri/tests/plugins_test.rs` |
| install_unknown_plugin_fails_without_touching_state | 仓库里没有的 id 报错；已安装列表与目录都不动 | `src-tauri/tests/plugins_test.rs` |
| uninstall_plugin_removes_files_and_record | 卸载删掉本地目录并取消登记 | `src-tauri/tests/plugins_test.rs` |
| uninstall_plugin_that_is_not_installed_is_ok | 卸载没装过的插件也算成功 | `src-tauri/tests/plugins_test.rs` |
| plugin_options_fall_back_to_defaults_and_can_be_overridden | 选项默认取包里的 default；改后写进 `plugin.<id>.<key>` | `src-tauri/tests/plugins_test.rs` |
| set_unknown_option_is_rejected | 插件没声明的选项写入被拒 | `src-tauri/tests/plugins_test.rs` |
| broken_installed_list_does_not_break_the_toolbox | settings 里是坏 JSON 时按「没装」处理，工具箱照常打开 | `src-tauri/tests/plugins_test.rs` |
| installed_state_survives_a_new_connection | 重开数据库后已安装状态还在 | `src-tauri/tests/plugins_test.rs` |
| toolbox_shows_the_tools_as_an_icon_grid | 工具箱是图标网格：内置工具与插件各占一格，网格里不铺开设置项 | `src/pages/__tests__/toolbox_page.test.tsx` |
| toolbox_opens_the_mistake_book_when_the_icon_is_clicked | 点错题本图标跳到 `/mistakes` | `src/pages/__tests__/toolbox_page.test.tsx` |
| toolbox_opens_the_plugin_page_when_the_plugin_icon_is_clicked | 点插件图标跳到 `/toolbox/plugins/<id>` | `src/pages/__tests__/toolbox_page.test.tsx` |
| toolbox_marks_plugins_that_are_not_installed | 未安装插件格子带「未安装」角标 | `src/pages/__tests__/toolbox_page.test.tsx` |
| toolbox_hides_the_badge_for_installed_plugins | 已安装插件格子不带角标 | `src/pages/__tests__/toolbox_page.test.tsx` |
| plugin_detail_shows_the_plugin_manifest | 详情页显示名称、作者、版本、体积与能力列表 | `src/pages/__tests__/plugin_detail.test.tsx` |
| plugin_detail_downloads_and_installs_the_plugin | 点「下载并安装」调 `install_plugin`；出现「已安装」与「卸载」 | `src/pages/__tests__/plugin_detail.test.tsx` |
| plugin_detail_shows_options_after_install | 装好才渲染选项；改值点保存调 `set_plugin_option` | `src/pages/__tests__/plugin_detail.test.tsx` |
| plugin_detail_uninstalls_the_plugin | 点「卸载」调 `uninstall_plugin` | `src/pages/__tests__/plugin_detail.test.tsx` |
| plugin_detail_shows_not_found_for_an_unknown_plugin | 仓库里没有的 id 显示「插件不存在」，不给下载按钮 | `src/pages/__tests__/plugin_detail.test.tsx` |
| layout_places_the_toolbox_in_the_main_navigation | 主导航有「工具箱」直达 `/toolbox`；没有需要点开的折叠分组 | `src/components/__tests__/layout_toolbox_nav.test.tsx` |
| layout_hides_the_mistake_book_from_the_main_navigation | 侧边栏没有「错题本」项；`/mistakes` 页面本身仍可达 | `src/components/__tests__/layout_toolbox_nav.test.tsx` |
| layout_keeps_a_toolbox_entry_in_the_bottom_bar | 底部导航保留一个工具箱入口 | `src/components/__tests__/layout_toolbox_nav.test.tsx` |
| parses_chapter_and_section_lines | 目录行拆成章与节；节号与标题分开存 | `src-tauri/tests/pdf_outline_test.rs` |
| keeps_section_number_in_front_of_title | 「4.1 几何图形」保留编号与标题 | `src-tauri/tests/pdf_outline_test.rs` |
| ignores_column_headings | 「实验与探究」「小结」等栏目不进任务 | `src-tauri/tests/pdf_outline_test.rs` |
| joins_wrapped_title_lines | 折行的标题接回上一条 | `src-tauri/tests/pdf_outline_test.rs` |
| keeps_chapter_number_with_arabic_digits | 「第 3 单元」保留为章标题 | `src-tauri/tests/pdf_outline_test.rs` |
| extracts_overview_without_toc_guessing_numbers | 标题里的数字不当小节编号 | `src-tauri/tests/pdf_outline_test.rs` |
| extract_outline_rejects_garbage_bytes | 非 PDF 字节报错并点名 PDF | `src-tauri/tests/pdf_outline_test.rs` |
| extract_outline_reports_missing_toc_page | 找不到目录页时说清缺目录页 | `src-tauri/tests/pdf_outline_test.rs` |
| extracts_chapters_and_sections_from_a_real_toc_layout | 真实目录版式 fixture：三章六节，跨页收齐 | `src-tauri/tests/pdf_outline_test.rs` |
| toc_page_number_column_does_not_leak_into_titles | 目录页码列不进标题 | `src-tauri/tests/pdf_outline_test.rs` |
| index_entry_is_not_appended_to_the_previous_section | 索引条目不接到上一条标题后 | `src-tauri/tests/pdf_outline_test.rs` |
| column_headings_are_not_treated_as_sections | 栏目名不当成小节 | `src-tauri/tests/pdf_outline_test.rs` |
| decodes_chinese_through_the_font_tounicode_table | Type0 字体按字体的 `/ToUnicode` 表还原中文 | `src-tauri/tests/pdf_cmap_test.rs` |
| a_cmap_dictionary_header_does_not_stall_the_parser | CMap 头部 `<< ... >>` 的落单 `>` 不让 tokenizer 死循环 | `src-tauri/tests/pdf_cmap_test.rs` |
| collects_sections_from_a_second_toc_page | 目录跨两页时两页都收齐 | `src-tauri/tests/pdf_cmap_test.rs` |
| the_page_number_column_does_not_leak_into_titles | 中文目录里的页码不进标题 | `src-tauri/tests/pdf_cmap_test.rs` |
| builtin_catalog_lists_textbooks_with_dimensions | 内置清单：锁定提交号、https 地址、条数对得上、每本都有学段与科目 | `src-tauri/tests/textbook_source_test.rs` |
| builtin_catalog_keeps_sharded_books | 分片书标了分片数与文件大小 | `src-tauri/tests/textbook_source_test.rs` |
| builtin_catalog_normalizes_stage | 学段归一化；五•四学制并回主学段 | `src-tauri/tests/textbook_source_test.rs` |
| catalog_rejects_incomplete_payload | 缺提交号 / 下载地址 / 仓库名时报错点名 | `src-tauri/tests/textbook_source_test.rs` |
| catalog_rejects_shard_count_mismatch | 分片记录数与分片数对不上时报错 | `src-tauri/tests/textbook_source_test.rs` |
| download_url_for_whole_book_encodes_the_path | 整本书一个地址；中文路径百分号编码、斜杠保留 | `src-tauri/tests/textbook_source_test.rs` |
| download_url_for_sharded_book_lists_parts_in_order | 分片书按序给 `.pdf_merge_folder/<书名>.pdf.N` | `src-tauri/tests/textbook_source_test.rs` |
| download_url_rejects_empty_input | 地址、提交号、路径为空都拒绝 | `src-tauri/tests/textbook_source_test.rs` |
| repo_path_encoding_keeps_slashes_and_safe_characters | 逐段编码：斜杠与安全字符保留 | `src-tauri/tests/textbook_source_test.rs` |
| safe_file_name_drops_illegal_characters | 文件名去掉 Windows 非法字符并截到 120 字 | `src-tauri/tests/textbook_source_test.rs` |
| pdf_outline_becomes_a_textbook_with_numbered_sections | 目录转教材：节名带编号、知识点留空给学生自己补 | `src-tauri/tests/textbook_source_test.rs` |
| outline_without_any_section_is_rejected | 没有小节时拒绝写教材 | `src-tauri/tests/textbook_source_test.rs` |
| textbooks_dir_is_scoped_by_plugin | 教材落到 `textbooks/<插件 id>/` | `src-tauri/tests/textbook_source_test.rs` |
| textbooks_dir_rejects_bad_plugin_id | 插件 id 非法时拒绝拼路径 | `src-tauri/tests/textbook_source_test.rs` |
| blob_requests_use_the_blob_api_and_keep_shard_order | blob 源：地址里只有 sha，按分片顺序 | `src-tauri/tests/textbook_source_test.rs` |
| raw_requests_fall_back_to_the_raw_paths | raw 源：回落到 raw 路径与分片目录 | `src-tauri/tests/textbook_source_test.rs` |
| download_source_parses_plugin_option_values | 下载源选项解析；认不出来的回落到 blob | `src-tauri/tests/textbook_source_test.rs` |
| blob_requests_reject_a_shard_without_sha | 分片缺 sha 时报错 | `src-tauri/tests/textbook_source_test.rs` |
| sharded_book_joins_parts_into_one_pdf | 两片按序接成一个 PDF；进度累计、落在第 2/2 片 | `src-tauri/tests/textbook_download_test.rs` |
| whole_book_downloads_to_a_single_file | 整本书落成 .pdf，不留 .part | `src-tauri/tests/textbook_download_test.rs` |
| failed_download_leaves_no_partial_file | 下载失败不留下 .part 或半截 PDF | `src-tauri/tests/textbook_download_test.rs` |
| download_without_requests_is_rejected | 没有下载地址时拒绝下载 | `src-tauri/tests/textbook_download_test.rs` |
| interrupted_download_resumes_from_where_it_stopped | 传到一半断线：用 `Range` 接着传，拿到完整文件；进度里 attempt 变大 | `src-tauri/tests/textbook_download_test.rs` |
| server_ignoring_range_restarts_the_shard | 服务端无视 `Range` 整本重发：从头重下这一片，不拼出重复字节 | `src-tauri/tests/textbook_download_test.rs` |
| size_mismatch_is_reported_and_nothing_is_left | 收到的字节数与清单对不上时报错并清场 | `src-tauri/tests/textbook_download_test.rs` |
| plan_carries_both_sources | 下载计划带首选源与备用源，顺序跟插件选项一致 | `src-tauri/tests/textbook_download_test.rs` |
| plugin_catalog_lists_declared_resources | 带资源的插件在列表里列出资源；路径不能回退目录 | `src-tauri/tests/plugins_test.rs` |
| install_plugin_unpacks_resources_to_disk | 安装把资源解包到插件目录，内容与内置那份一致 | `src-tauri/tests/plugins_test.rs` |
| plugin_resource_is_readable_before_install | 插件没装也能读内置那份资源 | `src-tauri/tests/plugins_test.rs` |
| plugin_resource_path_traversal_is_rejected | `../`、绝对路径、空路径都拒绝 | `src-tauri/tests/plugins_test.rs` |
| missing_plugin_resource_reports_the_path | 缺资源时报错点名路径 | `src-tauri/tests/plugins_test.rs` |
| reinstall_plugin_removes_stale_resource_files | 重装清掉上一次的残留资源文件 | `src-tauri/tests/plugins_test.rs` |
| plugin_detail_shows_the_textbook_library_for_a_textbook_source | 教材源插件装上后详情页出现「教材库」与教材条目 | `src/pages/__tests__/plugin_detail.test.tsx` |
| plugin_detail_hides_the_textbook_library_for_other_plugins | 普通插件不出现教材库 | `src/pages/__tests__/plugin_detail.test.tsx` |
| plugin_detail_saves_a_select_option_right_away | `select` 选项渲染成下拉，改完直接存 | `src/pages/__tests__/plugin_detail.test.tsx` |
| textbook_plugin_options_carry_user_facing_text | 教材库选项都带中文说明、中文候选名，并标了高级与敏感 | `src-tauri/tests/plugins_test.rs` |
| plugin_option_defaults_are_backward_compatible | 没写新字段的旧插件选项：help 空、不算高级、不敏感 | `src-tauri/tests/plugins_test.rs` |
| plugin_detail_folds_advanced_options_away_by_default | 高级选项默认收在折叠区；全是高级项时不再摆一个空的「设置」标题 | `src/pages/__tests__/plugin_detail.test.tsx` |
| plugin_detail_shows_friendly_choice_names_instead_of_raw_values | 下拉显示「标准通道（推荐）」，不是 blob / raw | `src/pages/__tests__/plugin_detail.test.tsx` |
| plugin_detail_masks_the_token_field_and_explains_it | 令牌用密码框渲染，并带一句给普通用户看的说明 | `src/pages/__tests__/plugin_detail.test.tsx` |
| plugin_detail_keeps_normal_options_flat_without_an_advanced_section | 普通选项平铺显示；没有高级选项时不多一个折叠区 | `src/pages/__tests__/plugin_detail.test.tsx` |
| plugin_library_lists_catalog_books_with_stage_and_subject_filters | 教材库按学段与科目筛选 | `src/components/__tests__/plugin_textbook_library.test.tsx` |
| plugin_library_searches_the_catalog_by_title | 教材库按书名搜索 | `src/components/__tests__/plugin_textbook_library.test.tsx` |
| plugin_library_downloads_a_book_and_parses_its_outline | 下载后调 `import_textbook_pdf` 并显示「已导入 N 章」 | `src/components/__tests__/plugin_textbook_library.test.tsx` |
| plugin_library_reports_a_failed_download | 下载失败只报错误，不假装成功 | `src/components/__tests__/plugin_textbook_library.test.tsx` |
| plugin_library_shows_the_retry_attempt_when_the_download_resumes | 续传时进度条标出「重试第 N 次」 | `src/components/__tests__/plugin_textbook_library.test.tsx` |
| plugin_library_turns_the_parsed_outline_into_a_task | 解析结果直接进向导：勾选已掌握 → 生成任务与排期 | `src/components/__tests__/plugin_textbook_library.test.tsx` |

## 已知实现约束

### 成就目录契约

- **`achievements` 是应用自带种子目录**，随迁移 / bootstrap 写入，**不进导出 JSON、导入也不写回**（有意省略，见 `INTENTIONAL_EXPORT_OMISSIONS`）。
- **导入依赖本机目录存在**：`validate_user_achievement_refs` 比对本机 `SELECT id FROM achievements`，不是 payload。目录被清空时，含任意 `user_achievements` 的导入预校验 `Err` 并整单回滚；空数组则不动目录。由 `import_rejects_user_achievements_when_achievements_catalog_wiped` / `import_with_empty_user_achievements_does_not_touch_catalog` / `export_payload_does_not_include_achievements_catalog` 锁定。
- **恢复**：用户遇到目录缺失错误时应重跑种子迁移或重装应用，而不是指望备份 JSON 带回目录。

### 完成弹窗参数契约

- **字段名**：前端 wire 为 camelCase（`deferRemaining` / `deferDate` / `deferStart` / `deferEnd`），与 Rust `CompleteSessionInput`（`serde rename_all = "camelCase"`）一致；command 层再映射为 `move_remainder` + `RemainderSchedule`。
- **未勾选**：`deferRemaining: false`，且 **`deferDate` / `deferStart` / `deferEnd` 传 `null`**（不带默认今日/19:00–20:00），避免未勾选仍构造 remainder 槽位。由 `complete_dialog_without_defer_does_not_send_defer_fields` 锁定。
- **defer 可见性**：`actualUnits > 0 && actualUnits < planned_units` 才渲染 defer 勾选；满额或 0 单位均隐藏。由 `complete_dialog_full_completion_hides_defer_option` / `complete_dialog_zero_units_disables_defer` 锁定。

### actual_units 输入校验

- **入口**：`validateActualUnits(raw)`，定义在 `src/components/CompleteDialog.tsx`。课数框是 `type="text"` + `inputMode="numeric"`，state 保存原始字符串，避免 `type="number"` 在进校验前把 `"abc"` 清成空串。
- **空串**：无效，提示「请输入课数」，提交按钮禁用。不把 `""` 收成 `0`。显式 `"0"` 仍合法，可提交且不加 XP。
- **非数字**（`"abc"`、单独的 `"-"`）：「请输入数字」。
- **负整数**（`"-3"`）：「不能为负数」。不等后端返回再提示。
- **小数和非纯数字串**（`"3.7"`、`"3.0"`、`"1e10"`）：「请输入整数」。不四舍五入、不截断。
- **纯数字但超出 `Number.isSafeInteger`**（20 个 9）：「数值过大」。
- **合法值**：`/^\d+$/` 且 `Number.isSafeInteger`。按钮在 `!valid` 时禁用；点击时再跑同一函数，非法值不会进入 `onSubmit`。
- **后端兜底**：`CompleteSessionInput.actual_units` 是 `i64`。负数在 `complete_session_impl` 返回 `InvalidActualUnits`。小数和超出 `u64` 的数在 serde 反序列化阶段拒绝，函数体不跑。由 `negative_actual_units_do_not_corrupt_progress` 锁后端负数；前端五条 `complete_dialog_rejects_*` / `complete_dialog_empty_input_treated_as_zero_not_submitted_silently` / `complete_dialog_decimal_input_behavior_documented` 锁弹窗。

### 考试日期设置

- **已有目标的日期框**仍是 `type="date"`，没有 `min`。过去与否用本地日历日：合法的 `YYYY-MM-DD` 字符串 `< format(now, "yyyy-MM-dd")`，不含时刻。今天不弹确认。
- **过去日期先暂存再确认。** 选中后 `pendingDate` 让输入框显示新日期，确认前不调用 `upsertExam`。文案包含「已过去」和「倒计时将显示「已到达」」。取消清掉暂存，输入框回到 store 里的原日期。确认后 `upsertExam` 写入 Zustand，并 `JSON.stringify` 到 `localStorage` 键 `timequest.exams`。不调用 Tauri，不进 SQLite。
- **未来日期（含今天）**选完直接 `upsertExam`，不弹确认。
- **倒计时如何感知：** `CountdownPanel` 订阅同一份 `useUiStore.exams`。确认写入时若面板还挂着，当次渲染按新日期重算并重建 interval。人在设置页时面板已卸载，回到看板的新实例读到已更新的 store。过去日期确认写入后，面板按 `computeCountdown` 显示「已到达」和 `00:00:00`。
- **「添加」一行**仍只更新本地 state，要点「添加」才 `upsertExam`。名称框仍是每敲一字就写。原生日期框的 `onChange` 只在完整日期时触发，因此 `settings_date_change_does_not_write_on_every_keystroke` 跳过。
- 由 `settings_past_exam_date_shows_confirmation_before_write` / `settings_past_exam_date_cancel_does_not_write` / `settings_past_exam_date_confirm_writes` / `settings_future_exam_date_writes_without_confirmation` 锁定。

### 跨页面状态同步

- **考试目标的活数据是 Zustand `useUiStore.exams`。** `loadExams()` 只在 store 创建时读 `timequest.exams`。设置页写入和仪表盘读取都走这份 store；重新挂载不会再读磁盘。
- **路由：** `Layout` 的 `<Outlet />` 在 `/` 与 `/settings` 之间切换时卸载 `Dashboard` 和 `CountdownPanel`。离开时 effect cleanup 调用 `clearInterval`；回来是新实例，读当时的 store。
- **没有事件总线，考试日期不进 React Query。** 只改 `localStorage` 而不调用 `setExams` / `upsertExam`，已经创建的 store 保持原值。
- 由 `dashboard_countdown_updates_when_exam_date_changes_in_store` / `dashboard_countdown_does_not_use_stale_date_after_remount` 锁定。墙钟 interval 不随目标日重建，由 `countdown_panel_updates_days_without_restarting_the_clock` 锁定。
- **考试日期影响面**：exam date 影响倒计时。主窗口是 `CountdownPanel`；桌面悬浮窗 `WidgetPage` 读同一份 `useUiStore.exams`，主窗口改日期后通过 `session-updated` 把 exams 推过去。不影响完成弹窗的改期日期（「剩余改到下次」用打开时的本地今天，用户改过的值留在组件 state），也不影响统计页的周/月范围（`rangeFor(new Date())`）。今日排期仍按 `todayStr()` 请求，连击条仍是 `get_user_stats`。每日激励语按本地今天对默认句取余，不读 exam date。由 `exam_date_change_does_not_shift_open_complete_dialog_date` / `exam_date_change_does_not_shift_open_stats_range` / `exam_date_change_only_affects_countdown` / `widget_page_renders_countdown` 锁定。

### 每日激励语

- **数据**：看板 `DailyMotivation` 读 `useAppSetting('motivation_text')`。非空字符串 trim 后原样展示。`null`、未返回、以及 trim 后为空，用 `dailyMotivation(todayStr())`。
- **设置**：设置页「每日激励语」。输入框标签「自定义激励语」，初值来自同一条 `useAppSetting`。未编辑前跟随查询结果；用户改过之后以输入框为准，避免刷新把草稿盖掉。「保存」调用 `useSetSetting('motivation_text')`，即 `invoke('set_setting', { key: 'motivation_text', value })`。「清空」把输入框置为 `""` 并写入空字符串。输入为空时，框下显示当天默认句。
- **同一天同一句**：下标是 `Number(YYYYMMDD) % DEFAULT_MOTIVATIONS.length`（`2026-01-01` → `20260101`）。不使用 `Math.random()`。刷新页面日期不变则句子不变；本地日期加一天，余数加一，换成下一句。
- **位置与样式**：`Dashboard` 标题行右侧。`text-zinc-400`、`italic`，两侧引号 `-rotate-6` / `rotate-6`。
- 由 `daily_motivation_index_is_yyyymmdd_modulo_length` / `resolve_motivation_uses_custom_text_and_treats_blank_as_unset` / `dashboard_motivation_uses_default_when_setting_empty` / `dashboard_motivation_renders_custom_text` / `settings_motivation_save_invokes_set_setting` / `settings_motivation_clear_writes_empty_and_shows_default` 锁定。

### 倒计时生命周期

- **`CountdownPanel`**：墙钟来自 `useRemainingStudyTime` → `useCurrentTime(1000)`。卸载时清掉这条 interval。换主考日只重算天数，不另开一条钟。由 `countdown_panel_clears_interval_on_unmount` / `countdown_panel_does_not_tick_after_unmount` / `countdown_panel_updates_days_without_restarting_the_clock` 锁定。

### 倒计时边界语义

- **全 0，不返回负数**：锚点毫秒差 `totalMs < 1000` 时（已经过去、正好到达、以及最后不足 1 秒），`days` / `weeks` / `months` / `hours` / `minutes` / `seconds` 和返回的 `totalMs` 都是 0，`isPast` 为 true。正好 1000ms 仍是 `totalMs = 1000`、`days` 按日历、`isPast = false`，`hours` / `minutes` / `seconds` 恒为 0。10 年跨度钳制前是有限负数，不会变成 `Infinity`。由 `compute_countdown_returns_zeros_when_target_in_past` / `compute_countdown_returns_zeros_when_target_equals_now` / `compute_countdown_never_returns_negative_for_large_past_gap` / `compute_countdown_returns_one_second_when_target_one_second_ahead` / `compute_countdown_two_days_ahead_returns_days_without_clock` / `countdown_panel_transitions_to_arrived_at_target_moment` 锁定。
- **「已到达」**：`CountdownPanel` 只看 `c.isPast`。返回结构没有 `totalSeconds`。`days` 是目标日与今天的日历差（两个时间戳各自取本地零点），本地零点前 1 秒仍显示 1 天。目标从未来改成过去时，当次渲染立刻重算。由 `countdown_panel_recomputes_when_target_changes_to_past` 锁定。
- **时分秒位置是今天的排期，不是把总时长每秒减 1**。`calculateTodayRemainingMinutes` 仍是今天 `planned` 场次的时长合计，这个数不随墙钟减少，完成一场后才变少。旁边的倒计时看当前时刻：正处在一场里，显示到该场 `end_time` 还剩多久；还没到下一场，显示「距离{任务}开始还有」；今天没有 `planned`，显示「今日任务全部完成」。由 `calculate_today_remaining_minutes_sums_planned_sessions` / `calculate_today_remaining_minutes_ignores_done` / `resolve_remaining_study_counts_down_the_current_session` / `resolve_remaining_study_counts_down_to_the_next_session` / `countdown_panel_past_target_shows_arrived_not_negative` 锁定。
- **年级和默认高考日**：倒计时日期不在 `user_profile`。空的考试列表会种下 `DEFAULT_EXAM_DATE`（`2027-06-07`）。档案年级已经是高二、主考日却还是这颗种子时，`ExamDateSync` 按 `gaokaoDateForGrade` 写成 `2028-06-07` 并 `upsertExam`。用户另选过的日期不动。由 `exam_date_sync_replaces_default_seed_for_grade_two` / `exam_date_sync_keeps_a_date_the_user_already_chose` 锁定。
- **Invalid Date**：不抛异常。返回全 0 且 `isPast = false`。`CountdownPanel` 无 try/catch，抛错会让面板崩溃；`isPast = false` 与「已到达」分开，乱码显示成「0 天」。由 `compute_countdown_handles_invalid_target_date` 锁定。
- **时区口径（本批不改）**：锚点是 `startOfDay(parseISO(targetDate))`，日期串按本地零点解释。`"2026-06-07"` 在 UTC+8 是本地 2026-06-07 00:00:00，不是 `new Date("2026-06-07")` 的 UTC 午夜（当地 08:00）。字符串里的时刻会被 `startOfDay` 丢掉。改这条会影响已保存目标的剩余天数，需要单独评估，不放进钳制修复里。

### 桌面悬浮窗

- **窗口**：`tauri.conf.json` 的 `widget` 无边框、透明、置顶、不进任务栏，启动时 `visible: false`。`main` 显式标了 label，托盘「显示窗口」仍找 `main`。
- **权限**：`capabilities/default.json` 的 windows 含 `main` 与 `widget`，并允许 `show` / `hide` / `start-dragging`。主窗口另有 `create-webview-window`，悬浮窗被关掉后可以按同一 label 再建。
- **入口**：`readWindowLabel()` 为 `widget` 时只渲染 `WidgetPage`，不挂 `Layout`。`BootSync` 的「窗口置顶」只作用在主窗口，避免把悬浮窗的置顶关掉。
- **页面**：倒计时用 `computeCountdown`（与看板同一口径）。进行中 / 下一场用 `findScrollTargetSession`。拖拽区域是 `data-tauri-drag-region`。关闭按钮调用 `hide()`，不销毁窗口。
- **同步**：两个 Webview 各有一份 QueryClient 和 Zustand。完成 / 改期 / 新建场次后主窗口 `emit("session-updated")`。改考试日期时同一事件带上 `exams`。悬浮窗 `listen` 后 `invalidateQueries({ queryKey: ["sessions"] })`，并 `setExams`。悬浮窗挂载后发 `widget-ready`，主窗口把当前 exams 再推一次。
- **退出**：主窗口真正销毁（不是缩到托盘）时关掉 widget，避免隐藏悬浮窗把进程留住。缩到托盘时悬浮窗可以继续显示。
- 由 `widget_page_renders_countdown` / `widget_label_skips_main_shell` 锁定页面。窗口 show/hide 靠代码路径，测试环境没有原生窗口。

### 系统通知

- **开关**：设置页「系统通知」，默认开。存在 `localStorage` 键 `timequest.notifications`（`"0"` 关闭，缺省或其他值开启），Zustand 字段 `notificationsEnabled`。关掉后主窗口不再调度提醒。
- **调度**：只挂在主窗口（`SessionNotifier`），悬浮窗不挂，避免两扇 Webview 各弹一次。时钟是 `useCurrentTime(60_000)`。今日 `planned` 场次按分钟比较：开始前正好 5 分钟弹「【准备】距离下一场学习还有 5 分钟，准备进入状态。」；到达 `start_time` 那一分钟弹「【开始】该学【任务名】了，冲！」。
- **去重**：同一 `sessionId + prep|start` 写入 `localStorage`（`timequest.sessionNotices`，按本地日重置）。分钟轮询和 Strict Mode 重跑都不会再弹。
- **权限**：`isPermissionGranted` 未通过时请求一次；仍拒绝或插件抛错则直接返回，不 `console.error`。
- 由 `session_notifier_fires_prep_then_start_once` / `session_notifier_stays_quiet_when_disabled_or_permission_denied` 锁定。Vitest mock 了 `sendNotification`，看不到系统弹窗。

### 导出表覆盖（硬编码）

- **`export_json_impl` / `import_json_impl` 表清单是硬编码的**（按固定 key `SELECT`/`INSERT`），不是遍历 `sqlite_master`。新增用户数据表时必须同步更新导出函数、导入清空/插入顺序，以及护栏测试 `export_json_includes_every_user_table` 的预期（含其 `INTENTIONAL_EXPORT_OMISSIONS` 若适用），否则该测试会红灯。
- **目录表 `achievements`**：迁移种子的成就定义，有意不进备份 JSON（随迁移重种子即可）；用户解锁在 `user_achievements`，已导出。护栏用 `INTENTIONAL_EXPORT_OMISSIONS` 排除它，避免与「漏导出用户表」混淆。
- **后续改进**：导出动态化（遍历 `sqlite_master` 生成 payload），减少硬编码漏表风险。

### actual_logs.subject / method（开放字符串）

- **无枚举校验**：应用层与 DB 均不限制 subject/method 取值（与 `tag_type` 的 `CHECK` 不同）。前端下拉只是 UI 约定。
- **统计按原串 `GROUP BY`**：`stats_plan_vs_actual` 用 `COALESCE(subject,'未分类')`；`stats_method_share` 用 `COALESCE(method,'未填')` 且仅 `tag_type='study'`。未知自定义串自成一组，不归「其他」、不丢弃。由 `unknown_subject_stays_in_plan_vs_actual` / `unknown_method_stays_in_method_share` 锁定。
- **空值**：`NULL` subject → `'未分类'`；`NULL` method → `'未填'`。
- **空白不规范化**：不做 `trim`；`'数学'` 与 `'数学 '`（尾随空格）是两个分组。由 `subject_whitespace_is_not_normalized` 锁定。产品若要合并属另一次变更。

本批修复（`negative_actual_units` / `complete_rescheduled_or_missed` / `earlier_date_after_last_done`）引入或固化的约束：

- **`actual_units >= 0`**：由应用层保证（`complete_session_impl` 入口返回 `SessionError::InvalidActualUnits`）。未加 DB `CHECK`（SQLite 改列成本高；权威在应用层）。
- **完成资格**：仅 `status='planned'` 可完成；`done` 幂等返回 Ok(0 XP)；`rescheduled` / `missed` 等返回 `SessionError::InvalidCompleteStatus`。
- **倒序日期完成**：`done_date < last_done_date` 时 XP 照加，`current_streak` / `longest_streak` / `last_done_date` 不倒退（`update_streak_values` 的 `diff < 0` 分支）。日期解析失败时当前语义为重置 `current_streak=1` 并用 `done_date` 覆盖 `last_done_date`。
- **`gamification_sqlx.rs`**：已删除。完成路径的 XP/连击/成就只走 `complete_session_impl` 事务内联 + `gamification.rs` 纯函数，避免与生产路径不一致的死代码被误用。

本批 first_round 用例固化的约束（权威在 `complete_session_impl` 内联判定）：

- **仅 main**：`task_type == "main"` 才进入 first_round。`side` 不解锁，XP 仍按 `actual_units` 发放。
- **合计范围**：`status = 'done'` 的 `sum(actual_units)`，条件是 `task_sessions.round =` 正在完成的这场 `session.round`。查询不读 `tasks.current_round`；只有这场 session 的 round 恰好等于当前轮时，两者才重合。
- **`total_units` 为 NULL 或 ≤ 0**：应用层 `Option::filter(|units| *units > 0)`，不进入 `done >= total`。SQL NULL 由 sqlx 解成 `None`。不依赖 SQLite 的 NULL 比较。
- **写入**：先 `SELECT achievement_id = 'first_round'`，没有行才 `INSERT`。顺序完成因此只有一行。`user_achievements.achievement_id` 是主键，但语句不是 `INSERT OR IGNORE` / `ON CONFLICT`；并发下第二次 `INSERT` 会因主键失败并回滚整笔完成事务。
- **成就检查入口**：成就检查只走完成路径内联逻辑。`gamification.rs` 中的 `check_achievements_after_complete` 已移除，不得接回生产路径。它与内联判定不一致：`total_units <= 0` 时 `if let Some(total)` 且 `done >= total` 仍可能解锁 `first_round`；`balanced` 用 `date('now','localtime','-6 days')`、无上界、不要求 `actual_units > 0`。护栏是 `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D dead_code`（见 `src-tauri/tests/dead_code_guard_test.rs`）。重新引入且无人调用会失败。

### 0 单位完成语义

- **`actual_units = 0` 的完成**：`status` 写为 `'done'`；插入一条 `actual_logs`，`duration_min = 0`，`session_id` 关联本场；`total_xp`、`current_streak`、`last_done_date` 均不更新。由 `completion_with_zero_units_awards_no_xp` 锁定。
- **成就“完成”计数**：只统计 `status='done'` 且 `actual_units > 0` 的 session。`first_round`、`comeback`、`balanced`、`streak_5` 均适用。`comeback` 另需 `self_rating >= 4`，且本场由 `rescheduled` 恢复而来。
- **balanced 窗口**：以本场 `session.date` 为准的闭区间 `[date-6, date]`，共 7 天。窗口内仅 `actual_units > 0` 的 done 计入。回填更早日期的 session 不计入“近 7 日”，这是有意为之。
- **负数 `actual_units`**：`actual_units < 0` 在 `complete_session_impl` 入口拒绝，返回 `SessionError::InvalidActualUnits`。不写 `actual_logs`、不改 `status`、不加 XP、不动连击。

### 导入导出语义

- **格式**：JSON（`version: 1`），非 SQLite 文件拷贝。表键：`tasks` / `task_sessions` / `actual_logs` / `notes` / `user_stats`（单对象）/ `user_achievements` / `app_settings`（`{key, value, updated_at}` 数组，按 key 排序）。`archived` / `pinned` 序列化为整数 **0/1**（非 JSON boolean）。前端默认文件名 `timequest-backup-YYYYMMDD.json`。
- **事务**：`import_json_impl` 在单个 `unchecked_transaction` 内先清空再插入，成功才 `commit`；失败整笔回滚到导入前库内容。清空顺序：`user_achievements` → `actual_logs` → `task_sessions` → `notes` → `tasks` → `app_settings`，再 `UPDATE user_stats` 重置为默认（保留 `id=1` 行，不 `DELETE`）。
- **`app_settings`**：key-value，`key` 主键。`set_setting` 用 `INSERT ... ON CONFLICT(key) DO UPDATE`，重复写入覆盖 `value` 并刷新 `updated_at`，不新增行。不存在的 key：`get_setting` 返回 `None`（前端 `null`）。时间戳与建表默认一致，用 `datetime('now')`（UTC），不跟其它表的 `localtime`。旧备份没有 `app_settings` 键时，导入清空后表为空。激励语默认值在前端 `DEFAULT_MOTIVATIONS`，不预写入这张表。由 `set_setting_then_get_is_idempotent` 锁定读写幂等。
- **`rescheduled_to` 自引用**：导入时先 `INSERT` 各 session 且 `rescheduled_to=NULL`，全部插入后再 `UPDATE` 写回指针（FK 保持 `ON`，不关 `PRAGMA foreign_keys`）。由 `export_import_round_trip_preserves_rows` / `import_failure_rolls_back_to_pre_import_state` / `import_preserves_foreign_key_integrity` 锁定。
- **`user_stats` 单例**：导入必须保证恰好一行 `id=1`。写回用 `INSERT ... ON CONFLICT(id) DO UPDATE`（UPSERT）；payload 缺行时清空阶段的 `UPDATE ... WHERE id=1` 仍依赖已有行。显式 `user_stats.id ≠ 1` **拒绝**（`Err`），缺省 `id`（导出格式）视为 1。由 `import_user_stats_update_is_noop_when_id_1_row_missing` / `import_rejects_user_stats_payload_with_wrong_id` 锁定。
- **`total_xp` / `current_level` 一致性**：理论上应满足 `level_from_total_xp(total_xp) == current_level`。导出/导入**不**对该一致性做校验或修复：导出原样快照；导入原样写入；若数据不一致，视为用户数据状态，不静默改写。未来如需修复，应提供显式「重算等级」操作，而非隐藏在导入导出里。由 `export_keeps_current_level_when_inconsistent_with_total_xp` / `export_does_not_fail_on_level_xp_mismatch` / `import_preserves_inconsistent_level_xp_as_is` 锁定。
- **连击数据损坏**：`user_stats` 的 `current_streak > 0` 且 `last_done_date = NULL` 是数据损坏形态。导入原样保留，不修复；下一次完成时 `current_streak` 重置为 1，`longest_streak` 保留历史值。修复应作为显式操作（如「重算连击」），不隐藏在导入路径。由 `import_positive_streak_with_null_last_done_does_not_reset_on_import` / `import_positive_streak_with_null_last_done_resets_on_next_complete` 锁定。
- **`actual_logs.session_id` 引用**：写入前校验非空 `session_id` 必须出现在 payload `task_sessions`；`NULL`（手动补记）合法。悬空引用返回明确 `Err` 且不改库；commit 前另跑 `PRAGMA foreign_key_check` 兜底。由 `import_rejects_actual_log_with_dangling_session_id` / `import_allows_actual_log_with_null_session_id` 锁定。
- **不校验 session status**：校验只收集 `task_sessions.id`，不读 `status`。log 指向 `status='rescheduled'` 的 session 导入成功，status 与 `rescheduled_to` 原样保留，不改成 `done`。`stats_tag_type_totals` 只读 `actual_logs`，这条流水的分钟会计入 study。由 `import_allows_actual_log_for_rescheduled_session` / `imported_rescheduled_session_log_counts_in_stats` / `export_round_trip_preserves_log_for_rescheduled_session` / `import_does_not_auto_flip_rescheduled_to_done` 锁定。
- **`user_achievements` 导入幂等**：`INSERT OR IGNORE`（主键 `achievement_id`）；payload 内重复 id 静默去重并**保留第一条** `unlocked_at`。每次导入先 `DELETE FROM user_achievements` 再按 payload 写入，故同 payload 连续导入行数不翻倍、内容与 payload 一致。悬空 `achievement_id`（不在目录表 `achievements`）在清空前预校验 `Err` 并回滚——`OR IGNORE` 本会吞掉 FK 失败，故不能只靠 SQLite FK。由 `import_user_achievements_duplicate_ids_are_idempotent` / `import_user_achievements_twice_keeps_single_row_per_id` / `import_user_achievements_payload_with_dangling_reference` 锁定。
- **时间戳**：payload 有 `created_at` / `updated_at` / `unlocked_at` 则保留；缺省 `COALESCE(..., datetime('now','localtime'))`。`app_settings.updated_at` 例外，缺省与列默认相同，用 `datetime('now')`。
- **导入前备份**：Tauri `import_json` 在改库前把 `timequest.db` 复制到同目录 `timequest.bak-YYYYMMDDHHMMSS.db`（`app_data_dir`）。纯 `import_json_impl`（测试路径）不做文件备份。

### 导入与业务语义一致性

- **导入是数据快照**，不校验 `task_sessions.status` 与 `actual_logs` 的业务一致性。校验只要求非空 `session_id` 出现在 payload 的 `task_sessions.id` 里。
- **log 可指向 `rescheduled` session**。导入原样保留：`actual_logs.session_id`、该场 `status='rescheduled'`、`rescheduled_to` 都不改写。应用内完成 / 改期 / 补记产生不了这种组合，只能由备份带入。
- **导入不自动改 `session.status`**。存在指向该场的 log 时，也不会把 `rescheduled` 改成 `done`。消除这种矛盾属于数据修复，不藏在导入路径里。
- **统计层计入这类 log**。`stats_tag_type_totals`、`stats_method_share`、计划 vs 实际的实际分钟都只读 `actual_logs` 自身的 `date` / `tag_type` / `duration_min`，不 JOIN `task_sessions`，不按 `status` 过滤。`imported_rescheduled_session_log_counts_in_stats` 已绿灯（study 合计含这 30 分钟），统计 SQL 未改。
- 由 `import_allows_actual_log_for_rescheduled_session` / `imported_rescheduled_session_log_counts_in_stats` / `export_round_trip_preserves_log_for_rescheduled_session` / `import_does_not_auto_flip_rescheduled_to_done` 锁定。

### 前端统计页空态

- **空数组**：计划 vs 实际、方式占比在 `length === 0` 时显示「暂无…」文案，**不**挂空 Recharts；自评同前。达成率对象 `{ rate: 0, … }` 显示 `0%`（`rate || 0`），不出现 `NaN` / `Infinity`。由 `stats_page_empty_charts_render_without_crash` / `stats_page_empty_does_not_divide_by_zero` 锁定。
- **单条数据**：方式饼图渲染 1 个扇区并附明细列表。由 `stats_page_single_item_charts_render` 锁定。
- **跑法**：`pnpm test`（vitest + jsdom + Testing Library；无单独 `test:frontend` 脚本）。

### 便签语义

- **`color`（选项 B）**：写入前经 `normalize_color` 归一到六色白名单 `yellow`/`orange`/`green`/`blue`/`pink`/`purple`（与前端 `NOTE_COLORS` 一致）；非法值（含导入）变为 `"yellow"`，不拒绝。迁移 `20261104213000_normalize_note_colors.sql` 已清洗历史脏色。前端未知色 fallback 仅作防御。由 `create_note_normalizes_invalid_color_to_default` / `update_note_normalizes_invalid_color_to_default` / `import_normalizes_invalid_color_to_default` 锁定。
- **`updated_at`**：`update_note` 显式 `updated_at=datetime('now','localtime')`（与 schema DEFAULT 同口径）；无字段变化仍刷新（无 diff 短路）。`created_at` 不改。由 `update_note_refreshes_updated_at_on_inplace_edit` / `update_note_does_not_change_updated_at_when_no_field_changed` 锁定。
- **列表排序**：`list_notes` 为 `ORDER BY pinned DESC, updated_at DESC, id DESC`。同秒更新时按 id 倒序保证稳定。由 `list_notes_orders_by_updated_at_desc` / `list_notes_sort_order_is_stable_for_equal_updated_at` / `list_notes_pinned_sort_before_updated_at` 锁定。页面 `notes.map` 全量渲染，不另排、不分页。

### 时长语义

- **完成路径**（`complete_session_impl`）：`duration_min = duration_minutes(start_time, end_time)`（场次 `HH:MM` 差）。`actual_units > 0` 时至少 1 分钟（`.max(1)`）；`actual_units = 0` 时为 0。由 `completion_duration_uses_session_length_with_min_one` 锁定。
- **手动补记**（`create_log` / `compute_duration_min`）：优先 payload `duration_min`（≥0）；否则 `end_at - start_at` 分钟差（≥0）。**允许 0**，无「至少 1 分钟」守卫。前端「快速记录」传 `{date}T{HH:MM}:00`。由 `manual_log_duration_uses_time_diff_and_allows_zero` 锁定。
- **来源区分**：完成流水 `session_id` 非空；手动补记 `session_id` 为空。
- **统计不去重**：`stats_*` 对 `actual_logs` 按日期 / tag / method `SUM(duration_min)`，不按 `session_id` 去重。同一段学习若既完成又补记会计两次——属录入纪律，不是代码 bug。由 `same_duration_two_paths_produce_different_duration_min` 锁定。

### 进度环口径

- **唯一数据源（Rust）**：`task_progress`。过滤条件 `session.round = tasks.current_round` 且 `status='done'`；`round_units` 为本轮合计，`total_units_done` 为全轮合计。推进后旧轮离开环。由 `progress_ring_follows_current_round` 锁定。
- **与 `first_round`**：进度环看 `tasks.current_round`；`first_round` 看完成时当场 `session.round`。口径不同是有意为之。由 `progress_ring_and_first_round_can_disagree` 锁定。
- **前端不得自行对 sessions 求和**。详见下方「进度环唯一数据源」。

### 0 单位 defer 语义

- **选项 A（已落地）**：
  - `actual_units=0` 且 `move_remainder=true` → 返回 `SessionError::ZeroUnitsCannotDefer`（事务前拒绝；不写流水、不 spawn、不改 XP/连击）。
  - `actual_units=0` 且 `move_remainder=false` → 仍允许（如实记录未完成：`done` + `duration_min=0` 流水、不加 XP）。由 `completion_with_zero_units_awards_no_xp` / `complete_session_zero_units_without_defer_still_succeeds` 锁定。
  - `0 < actual_units < planned_units` 且 `move_remainder=true` → 正常部分完成并生成 remainder。由 `partial_completion_spawns_remainder_session` / `complete_session_positive_units_with_defer_still_succeeds` 锁定。
  - 前端：`canDefer = actualUnits > 0 && actualUnits < planned_units`；`actual_units=0` 时隐藏 defer 并提示使用「改期」。由 `complete_dialog_zero_units_disables_defer` / `complete_dialog_defer_reappears_when_units_become_positive` 锁定；后端兜底友好文案由 `complete_dialog_backend_zero_defer_error_shows_friendly_message` 锁定。
- **与「改期」的数据差异**：改期 → 原场 `status='rescheduled'` + `rescheduled_to`、无流水、达成率进 `rescheduled` 分母；禁止 0 单位 defer 后，整场挪时应走改期而非完成弹窗。
- **历史数据**：本机无生产 `timequest.db`（`com.timequest.desktop` appData 不存在），C 段 SQL 未发现可清洗的历史行；**无需迁移**。

### 导出完整性

- **`user_stats` 单例缺失**：`export_json_impl` 对 `WHERE id=1` 用 `query_row`；`QueryReturnedNoRows` 映射为明确 `Err`（含「user_stats 缺失 / 数据损坏」），**不得**静默产出缺 `user_stats` 的 JSON。由 `export_json_errors_when_user_stats_id_1_row_missing` 锁定。
- **恢复后可再导出**：手动插回 `id=1` 后导出 Ok。由 `export_after_user_stats_restored_succeeds` 锁定。
- **无 partial 文件**：`export_json_impl` 纯内存组装字符串；`export_failure_does_not_write_partial_file` 因此 ignored。

### 进度环唯一数据源

- **TaskDetail**：环与「本轮 N/M」文案读 `useTaskProgress` → `invoke('task_progress')` 的 `round_units`；sessions 只用于排期历史，**不再**参与环求和。由 `task_detail_progress_ring_reads_task_progress` / `task_detail_progress_ring_reflects_advance_round` 锁定。
- **TaskCard（列表）**：读 `list_tasks` 内嵌 SQL 的 `actual_units_sum`（与 `task_progress.round_units` 同过滤口径，一次查询无 N+1），不是对 sessions 客户端求和；未另写 `task_list_card_reads_task_progress_not_raw_sessions`。
- **与 `first_round`**：环看 `tasks.current_round`；成就看完成当场 `session.round`——口径差异保持不变。

### 任务页视图

- **模式**：`useUiStore.taskView` 为 `"list" | "grid"`，默认 `"list"`。只放在内存里，不写 `localStorage`。顶部是列表 / 网格两个图标按钮（`aria-label` 为「列表视图」「网格视图」）。
- **列表**：`TaskListView` 承接原来的主线 / 副本分组和卡片，类名与空态文案不变。
- **网格**：`TaskGridView` 接收页面已经拿到的 `tasks`，自己不再调用 `useTasks`。主线按 `total_units` 画微观点阵，点亮数读 `current_round_units`，没有该字段时用 `list_tasks` 的 `actual_units_sum`（当前轮 `sum(actual_units)`）。超过 50 课时时格子数封顶 50，每格代表 `ceil(total/50)` 课，末格不足时文案写明。副本不画点阵，用无限符号图标，旁边是累计完成的课数。卡片 hover 上浮。点亮格统一 `bg-orange-500`，任务色留在卡片左边。
- **请求**：`useTasks(false)` 留在 `Tasks` 页面。切换只换子组件，查询观察者不卸载，所以不会再打 `list_tasks`。由 `task_view_toggle_unmounts_list_and_skips_refetch` / `task_grid_view_lights_four_of_ten_cells` / `task_grid_view_side_task_shows_icon_without_micro_grid` / `task_grid_view_caps_cells_at_50` 锁定。

### 积累墙

- **位置**：看板「今日排期」下方。文案「你的一砖一瓦，正在垒成城堡。」在网格上方。
- **网格**：含今天在内的最近 28 个本地日。周一为一周的第一天，从上到下是 Mon…Sun，从左到右是连续的周。窗口起止不落在周一或周日时，首尾周留空，不补砖。缺记录的日期按 0。
- **星期与月份**：左侧只标 `Mon`、`Wed`、`Fri`，`text-[10px] text-zinc-500`。跨月时，在该月第一次出现的那一列上方标 `M月`。单月不标。
- **今天**：结束日砖块带 `data-today="true"`。当天单位大于 0 用 `ring-1 ring-orange-500`，否则 `ring-1 ring-zinc-500`。
- **上色**：当天 `status='done'` 的 `task_sessions.actual_units` 合计。0 为 `bg-zinc-800`，1–3 为 `bg-orange-900`，4–6 为 `bg-orange-600`，大于 6 为 `bg-orange-400`。`actual_logs` 只有分钟、没有单位，不参与上色，避免和完成单位重复计算。
- **空周引导**：最近 7 个本地日单位都是 0 时，城堡文案后接「今天还是空的，开始第一课吧！」，链接到 `/today`。有完成的一周不显示。
- **悬浮**：砖块 `title` 与悬浮层都是 `YYYY-MM-DD · 完成 N`。
- **查询**：`stats_daily_units(from, to)` 在 SQL 里 `GROUP BY date`。不读考试日期。由 `daily_units_sum_done_sessions_and_ignore_logs` / `accumulation_wall_colors_match_unit_buckets` / `accumulation_wall_zero_units_is_zinc_800` / `accumulation_wall_month_labels_when_range_crosses` 锁定。

本批时间 / 统计 / 轮次用例固化的约束：

- **时间写入**：`create_session_impl` 在 INSERT 前把可解析的 `H:MM` / `HH:MM` 规范化为 `"HH:MM"`（`"9:00"` → `"09:00"`）。迁移 `20261104160000_pad_session_hhmm.sql` 把已有单数字小时同样补零。`find_overlaps` 仍是文本 `<`，两侧都是 `"HH:MM"` 时端点相接不算重叠。改期、部分完成的剩余场次、导入不经过该入口，仍可能写入未补零字符串；库上没有 `HH:MM` 的 `CHECK`。
- **`stats_method_share` 分母**：`date >= from AND date <= to` 且 `tag_type = 'study'`。SQL 返回各 method 的 `SUM(duration_min)`，这些行加总就是分母，不含 sport / game / other。`stats_tag_type_totals` 用同一日期闭区间，按 `tag_type` 分组，不按 tag 互相排除。没有 study 行时不计算百分比。
- **统计日期参数**：各 `stats_*` 在绑定 SQL 前把可解析的 `Y-M-D` 规范为 `"YYYY-MM-DD"`（`"2026-1-1"` → `"2026-01-01"`），与 `normalize_hhmm` 一样是补零而不是拒绝。解析失败的字符串原样参加文本比较。`from > to` 命中 0 行，返回空结果，不对调、不查全表。达成率分母为 0 时 `rate = 0.0`。计划 vs 实际只返回分钟合计，`planned_min = 0` 时不做除法。
- **`first_round` 与推进**：合计条件是 `task_sessions.round =` 正在完成的这场 `session.round`，不读 `tasks.current_round`。`current_round` 从 1 推到 2 之后，再完成 `round = 1` 的场次，这 5（或任意单位）留在第 1 轮，第 2 轮 sum 不变。成就只插入一行，第 2 轮达标不重复解锁。任务详情进度环才是 `session.round === task.current_round`，与这条成就判定不是同一个过滤。
- **`advance_round` 无封顶**：`UPDATE tasks SET current_round = current_round + 1`。不与 `total_rounds` 比较，到顶后仍递增并返回 Ok，不停留、不报错。

### advance_round 过顶（current_round > total_rounds）

- **`advance_round` 无 `total_rounds` 封顶**，`current_round` 可超过 `total_rounds`（由 `advance_round_without_cap_stays_safe` / `progress_ring_on_round_past_total_rounds` 锁定）。
- **`current_round` 无上界**，由应用层语义保证（`advance_round` 允许过顶、导入原样保留）。`tasks` 没有 `CHECK(current_round <= total_rounds)`，故 `import_rejects_current_round_when_it_violates_check_constraint` 跳过。导入侧由 `import_preserves_current_round_above_total_rounds` / `import_over_cap_state_does_not_crash_task_detail` / `export_round_trip_preserves_over_cap_state` 锁定：快照原样写入、再导出不钳制，`task_progress` 按导入后的 `current_round` 过滤。
- **过顶后进度环**：`task_progress` 仍按 `session.round = tasks.current_round` 过滤；该轮尚无 done 时 `round_units = 0`（不报错）。
- **任务详情显示**：前端 `TaskDetail` 文案为「当前第 {current_round} / {total_rounds} 轮」，**原样显示**（如 3/2），不钳制为 2/2、无「已超出」文案。Rust 无 `task_detail_summary`；过顶 UI 行为属前端待办锁定范围。
- **`first_round`**：按完成当场 `session.round` 合计（**不**要求 `session.round == current_round`，也不读 `tasks.current_round`），且全局只解锁一次。过顶后若第 3 轮再达标：已解锁则不重复插入；未解锁则可首次解锁。由 `first_round_can_unlock_on_round_past_total_rounds` 锁定「A 已解锁 → 过顶 round=3 不重解；环仍计入当前轮单位」。

### 统计日期范围语义

前端 `rangeFor`（`src/pages/Stats.tsx`）算好 `from` / `to` 再传给 Rust。Rust 不识别 `"week"` / `"month"`，也不自己加减月份。

- **周**：周一起始的自然周，不是周日起始，也不是滚动 7 天。闭区间的右端是本周周日，不是今天。今天早于周日时，周日仍在范围内，本周计划因此包含这些未来场次。
- **月**：自然月，当月 1 日到月末，不是滚动 30 天。右端是月末，不是今天；当月未结束时，月末之前的未来日期计入。跨年不在 Rust 里做月份加减。前端 `endOfMonth` 用日历的「下月 1 日的前一天」，12 月进入次年 1 月，不会得到 13 月。
- **区间**：一律闭区间 `[from, to]`，SQL 为 `date >= from AND date <= to`。计划、达成率、平均自评过滤 `task_sessions.date`；标签合计、方式占比、计划 vs 实际的实际分钟过滤 `actual_logs.date`（完成时从 `session.date` 抄入）。不使用 `date('now')` 动态窗口。`from > to` 命中 0 行，返回空结果。
- **日期格式**：统一 `"YYYY-MM-DD"`。可解析的未补零输入在绑定前规范化（`"2026-1-1"` → `"2026-01-01"`），不拒绝；解析失败的字符串原样参加文本比较。

统计「本周」与成就 `balanced` 的 `[session.date-6, session.date]` 故意不一致，不把统计周改成 `today-6..today`。统计周是日历上的整周复盘，右端含尚未到来的周日，用来对照这一周的计划。`balanced` 锚在正在完成的那场日期，只看该日往前的 7 个本地日，未来场次不参与成就。`stats_range_matches_balanced_window_for_7_days` 因此跳过。

### 超额完成语义

- **`actual_units > planned_units` 允许**。`complete_session_impl` 不把实际单位封顶为计划单位；`remaining = planned_units - actual_units`，小于等于 0 时不生成剩余场次。
- **XP 按实际单位**。`calc_session_xp` 接收的是 `actual_units`，不是 `min(actual, planned)`。
- **进度环数值不钳制**。`task_progress.round_units` 是当前轮 `SUM(actual_units)`，可以大于 `total_units`。环心和「本轮」文案显示原始分数（如 `25/20`）；弧线 `value` 用 `Math.min` 收到满圈，不显示 `100%+`，也不把文案改成 `20/20`。
- **`first_round` 按 `>=`**。当场 `session.round` 的 `sum(actual_units) >= total_units` 即解锁，超额同样解锁。成就全局只一行，不是每个任务各解锁一次。
- 由 `complete_allows_actual_units_above_planned_and_awards_full_xp` / `progress_ring_allows_current_round_units_above_total` / `task_detail_progress_ring_shows_units_above_total` / `first_round_unlocks_on_exact_and_above_total` 锁定。

### 导入过顶状态

- **`current_round > total_rounds` 原样保留**。导入是数据快照，不做业务校验，也不调用 `advance_round`。再导出不重算、不钳制。
- **`tasks` 表无 `CHECK(current_round <= total_rounds)`**。由应用层语义保证（`advance_round` 允许过顶、导入原样保留）。因此 `import_rejects_current_round_when_it_violates_check_constraint` 跳过。
- **进度环按导入后的 `current_round` 过滤**。该轮没有 done 时 `round_units = 0`，不 panic。
- 由 `import_preserves_current_round_above_total_rounds` / `import_over_cap_state_does_not_crash_task_detail` / `export_round_trip_preserves_over_cap_state` 锁定。

### 便签排序稳定性

- **`list_notes` 为 `ORDER BY pinned DESC, updated_at DESC, id DESC`**。同秒更新时按 id 倒序保证稳定，避免连续编辑后列表顺序跳动。
- 页面按返回数组 `notes.map`，不再排一次。
- 由 `list_notes_sort_order_is_stable_for_equal_updated_at` / `list_notes_pinned_sort_before_updated_at` / `notes_page_pinned_sort_before_updated_at` 锁定。

### Notes 渲染

- **`key` 必须是 `note.id`。** `Notes.tsx` 的 `notes.map` 把 `key={n.id}` 放在 `NoteCard` 上。排序变化时 React 按 id 移动已有节点。
- **卡片是 `src/components/NoteCard.tsx` 的 `export default memo(NoteCard, areEqual)`。** `areEqual` 比较 `id` / `content` / `color` / `pinned`、是否在编辑、编辑文本，以及回调是否仍是同一个引用。`list_notes` 每次给出新对象，置顶还会改顺序；TanStack Query 按数组下标做结构共享，对不上同一张便签，所以不能只浅比较 `note`。
- **回调在 `Notes` 里用 `useCallback`：** `onEditText`、`onStartEdit`、`onCancelEdit`、`onSave`、`onTogglePin`、`onDelete`。没在编辑的卡片收到的 `editText` 是 `""`，输入时不会把整表比失效。
- **无虚拟化、无分页。** `list_notes` 无 `LIMIT`。滚动没有 `onScroll` / `IntersectionObserver`，不重新拉取。120 条在一次提交里全部出现，中间没有分批 `setState`。超过约 500 条再评估虚拟化，并同步改测试与本文档。
- **置顶只让被点的那张重新创建 `<article>`（jsx 计数 ≤ 1）。** `invalidateQueries({ queryKey: ["notes"] })` 仍会让父组件再跑一遍 `notes.map`；其余卡片被 `memo` 跳过。可接受的范围是父组件再渲染一次，加上字段真的变了的那一张。本测试的 mock 不重排，DOM 按下标仍是同一批节点。
- 由 `notes_page_pinned_toggle_rerenders_only_affected_card` / `notes_page_does_not_remount_cards_on_scroll` / `notes_page_render_is_single_pass_with_memo` / `notes_page_renders_all_notes_without_virtualization` 锁定。

### 演示数据与首次引导

- **标记**：`tasks` / `task_sessions` / `exam_records` 有 `is_mock INTEGER NOT NULL DEFAULT 0`。普通创建、补记、导入缺省都是 0。演示插入显式写 1。
- **`generate_mock_data`**：空库时写入 3 条湖南高二主线（数学必修一、物理必修一、英语必修一）、当天 done 与 planned 排期、2 条更早的考试成绩。不写 `actual_logs`，避免没有标记的分钟混进统计。已有 `is_mock=1` 的任务时直接返回，不追加。只有 `user_stats` 仍是初始值（XP/连击/最长连击为 0 且 `last_done_date` 为空）且不存在 `is_mock=0` 的任务、场次、成绩和任何流水时，才把 XP、等级、连击写成演示值。
- **`clear_mock_data`**：先删指向演示场次的 `actual_logs`，再删 `is_mock=1` 的场次和成绩。演示任务若仍被真实场次引用则留下，避免外键把真实场次一起删掉。只有这次确实删掉了演示行，且删完后没有真实行，才把 `user_stats` 重置为 XP 0、等级 1、连击 0。已有真实 XP 时不会被演示写入覆盖，清除时也不改。
- **导出**：三张表的 `is_mock` 进出 JSON。旧备份没有该字段时导入为 0。
- **引导**：`app_settings.onboarding_completed` 不是 `"1"` 时，主窗口盖一层全屏引导。第一步写年级（高一/高二/高三）、地区（34 个省级行政区下拉）、高考目标分到 `user_profile`。年级用 `gaokaoDateForGrade` 推算高考日（6 月 7 日当天仍算今年；次日起已过，再加一年。2026-11：高一 2029-06-07、高二 2028-06-07、高三 2027-06-07）。结束时 `upsertExam` 写入主考日期，真实记录和演示数据都写。日期不进 `user_profile` 表。第二步「开启真实记录（推荐）」只写完成标志；「加载湖南高二演示数据」再调用 `generate_mock_data`。悬浮窗不挂引导。
- **设置页改年级**：新年级推算出的高考日和当前主考日不同时先确认。确认后保存档案并 `upsertExam`，倒计时读同一份 `useUiStore.exams`，当次刷新。取消则不写档案，年级选择回到已保存的值。年级没变，或推算日已经等于主考日，直接保存档案。
- **设置**：数据管理里的「清除所有演示数据」在 `has_mock_data` 为真时用橙色高亮，确认后才调用 `clear_mock_data`。
- 由 `generate_mock_data_marks_every_inserted_row` / `clear_mock_data_removes_only_mock_rows` / `clear_mock_data_resets_stats_when_no_real_rows` / `import_missing_is_mock_defaults_to_zero` / `onboarding_real_start_saves_profile_and_skips_mock` / `onboarding_loads_hunan_demo_data` / `onboarding_hides_when_already_completed` / `settings_clear_mock_highlights_and_confirms_before_delete` 锁定。

### 里程碑庆祝

- **开关**：`app_settings.enable_celebrations`。未写入、空串、`"1"` 都开启。只有 `"0"` 或 `"false"` 关闭。设置页「启用里程碑特效」写入 `"1"` / `"0"`。查询还没返回时按开启处理。
- **通关**：仅主线，且这场 `round` 等于 `tasks.current_round`，`actual_units > 0`，当前轮 `sum(actual_units)` 从小于 `total_units` 跨到大于等于。`total_units` 为 NULL 或 ≤ 0 不庆祝。副本、旧轮、已经达标之后的再完成、0 单位、幂等再完成都不庆祝。
- **连击**：完成后的 `current_streak` 刚变成 7、14 或 30 才庆祝。同日第二场数字不变，不重复。0 单位不改连击，也不庆祝。从 7 进到 8 不庆祝。
- **同时命中**：一场里既通关又踩中连击时，只播通关（大满贯烟花 + 通关文案），不叠第二层浮层。
- **表现**：`canvas-confetti`，颜色是橙色。通关三次不同角度，连击一次。音效用 Web Audio 合成和弦，不引入 howler，也不放 mp3。浮层 `pointer-events-none`，2 秒后淡出，再 400ms 卸掉。系统「减少动态」时不放烟花，音效和浮层仍在（应用开关关掉则三者都没有）。
- **返回字段**：`complete_session` 增加 `isTaskFullyCompleted`、`currentStreak`、`streakMilestone`。改期结果这三项是 false / 0 / null，前端不在改期路径上庆祝。

### 添加节

- **目录**：侧边栏「+ 添加节」按任务的 `subject` + `textbook` 找教材，册次不够时再看任务标题。生成任务存的是 `"版本 册别"`，手建任务可能只存册别。演示数据的 `人教A版` 对上内置 `人教版`，标题「数学必修一」对上「必修第一册」。对上之后用 `get_textbook_outline` 的节名，顺序跟目录，重复和空白丢掉。册次对上多本、版本也对不上时不猜。
- **已有**：这一节已经有考点，或还只是草稿，下拉里置灰并标「已有」。输入完整节名后提示「该节已存在，请直接在内添加考点」。
- **选择**：点选或提交时，命中目录的用目录原串，不改写。输入只是目录节名的一部分时，提交选中高亮的目录节，不会把残缺字符串存成新节。
- **自定义**：目录里没有的名字要显式点「使用「…」」。提交前去掉首尾空格。
- **保存**：`add_custom_knowledge_point` 只 trim，原样写入 `section_name`。返回的行立刻并进 `task-knowledge-points` 缓存，侧边栏不用等下一次全量刷新才出现。

### 添加考点

- **来源**：点某一节的「+ 添加考点」时，用同一份 `get_textbook_outline` 里该节的 `knowledge_points`。节名 trim 后对上；空串和重复丢掉。对不上教材、或这一节没有预设考点时，只留输入框。
- **点选**：预设考点排成标签。点一下就 `add_custom_knowledge_point`，名字原样写入。已经在这一节里的标签置灰、前面打勾、`disabled`，再点不会提交。浮层不关掉，方便连续勾。
- **自定义**：标签下面留输入框，占位「没找到？手动添加自定义考点...」。回车或「添加」提交，成功后收起。

### 排期时段校验

- **后端**：`validate_time_range(start, end)`（`src-tauri/src/commands/sessions.rs`）。起止都必须能解析成 `HH:MM`（小时 0–23、分钟 0–59），否则返回 `SessionError::InvalidTimeFormat`；`end < start` 返回 `SessionError::InvalidTimeRange`。**零长时段（start == end）仍然合法**——完成路径按 `.max(1)` 记 1 分钟。
- **入口**：新建排期、改期、完成弹窗的「剩余改到下次」（remainder）三条路径都过同一函数；校验在写库之前，出错整笔不写。
- **前端**：`src/lib/timeField.ts` 的 `parseHHMM` / `formatHHMM` / `addMinutesToHHMM` 是同一套口径；`TimeRangeField` 在提交前先校验，倒挂时段直接提示、不调 command。
- 由 `create_session_rejects_end_before_start` / `create_session_allows_zero_length_range` / `create_session_rejects_unparsable_time` / `reschedule_rejects_end_before_start` / `complete_with_inverted_defer_range_is_rejected` / `complete_dialog_defer_rejects_inverted_time_range` 锁定。

### 排期删除

- **只能删 `planned`**。`delete_session_impl` 在事务里查 `status`，非 `planned` 返回 `SessionError::SessionNotDeletable`；场次不存在返回 `SessionError::SessionNotFound`。
- **有流水不删**。`actual_logs` 里存在指向该场次的记录时返回 `SessionError::SessionHasLogs`——历史记录不能因为删排期而丢。
- **改期指针先解**：删除前把 `rescheduled_to = 该场次 id` 的那些场次置 `NULL`，避免留下悬空指针。
- **前端**：今日页删除先弹确认框，确认后调 `delete_session`；取消不调 command，场次仍在。
- 由 `delete_session_removes_planned_session` / `delete_session_refuses_done_session` / `delete_session_refuses_session_with_logs` / `delete_session_clears_source_rescheduled_pointer` / `delete_session_reports_missing_session` / `today_delete_asks_confirmation_then_calls_delete_session` / `today_delete_cancel_keeps_the_session` 锁定。

### 单位口径（课 / 节）

- **单位属于任务，不属于界面**：教材导入的任务单位是「节」，手建任务默认「课」。`src/lib/units.ts` 的 `unitNameOf` 读任务的 `unit_name`，空值回落到「课」。
- **界面凡出现数量的地方都用任务的单位说话**：完成弹窗、进度环、排期卡片里的「计划 N」「实际 N」都读同一份单位名，不写死「课」。
- **不改变存储口径**：进度仍然是 `sum(actual_units)`，XP 仍然按 `actual_units` 算，单位名只是展示层的文案。
- 由 `complete_dialog_uses_task_unit_name_and_shows_section_title` 锁定。

### 每日可用时段与上限

- **存 `app_settings`**：键 `daily_slots`（值是 `[["08:00","09:00"], ...]` 的 JSON 串）与 `daily_limit_minutes`（分钟数的字符串）。键名前后端一致：`src/lib/studyPlan.ts` 的 `DAILY_SLOTS_SETTING_KEY` / `DAILY_LIMIT_SETTING_KEY` 与 `src-tauri/src/commands/planner.rs` 的 `DAILY_SLOTS_KEY` / `DAILY_LIMIT_KEY`。
- **默认值**：没设置过 → 早上 / 下午 / 晚上各一小时（08:00–09:00、14:00–15:00、19:00–20:00）；上限默认 480 分钟。**写坏了（不是 JSON、不是数组）也退回默认三段**，不让一次脏数据把计划弄没。
- **上限夹取**：夹在 60–720 分钟之间（`MAX_DAILY_STUDY_MINUTES`）。低于一小时等于没排。
- **非法时段在两端都被丢掉**：读设置时过滤 `end <= start`；保存时前端也过滤并提示「已保存；有 N 段时间不合法，已忽略。」
- **设置页**：`src/components/DailyPlanSetting.tsx`，预设（默认三段 / 上午 / 下午 / 晚上 / 早晚两段）一键填入，可增删段。
- 由 `parse_daily_slots_returns_defaults_when_unset` / `parse_daily_slots_falls_back_on_broken_payload` / `parse_daily_slots_reads_pairs_and_drops_invalid` / `parse_daily_slots_accepts_object_form` / `serialize_daily_slots_round_trips` / `parse_daily_limit_clamps_and_defaults` / `daily_slot_minutes_sums_valid_slots` / `daily_plan_setting_loads_saved_slots_and_limit` / `daily_plan_setting_saves_preset_slots_and_limit` / `daily_plan_setting_drops_invalid_slot_on_save` / `daily_plan_setting_adds_and_removes_slots` 锁定。

### 一键生成未来一周计划

- **命令**：`generate_week_plan`（`src-tauri/src/commands/planner.rs`），入参 `GenerateWeekPlanInput { taskId, startDate?, days? }`，返回 `{ taskId, created, skipped, lastDate }`。`startDate` 空 = 今天；`days` 默认 7，夹在 1–31。
- **只用学生自己设的可用时段排**，不自己发明时间。已被别的排期占用（`status IN ('planned','done')`）的时段跳过；当天累计时长超过每日上限也跳过，两种情况都计入 `skipped`。
- **每场 1 个单位**，`round` 取任务的 `current_round`。
- **整个写入在一个事务里**，中途出错不留半截数据。
- **不排归档任务**（`TaskArchived`）、**任务不存在**返回 `TaskNotFound`、**日期格式不对**直接报错（提示用 `YYYY-MM-DD`）。
- **幂等**：第二次跑会因为时段已被占用而全部跳过，不会重复排。
- 由 `generate_week_plan_creates_sessions_across_days` / `generate_week_plan_skips_occupied_slots` / `generate_week_plan_respects_daily_limit` / `generate_week_plan_uses_configured_slots` / `generate_week_plan_rejects_archived_task` / `generate_week_plan_rejects_unknown_task` / `generate_week_plan_rejects_broken_start_date` / `generate_week_plan_is_idempotent_on_second_run` / `task_detail_week_plan_generates_schedule_and_reports` / `task_detail_week_plan_reports_skipped_slots` / `task_detail_week_plan_says_when_no_slot_is_free` 锁定。

### 今日剩余待学的去重与上限

- **重叠排期先合并**：`mergePlannedWindows` 把当天所有未完成场次的时段求并集（端点相接不算重叠），再按并集算剩余分钟。同一时段被排两次不会把时长算两遍。
- **上限截断**：合并后的分钟数超过 `daily_limit_minutes` 时按上限截断，并在面板上说明「已按每日上限 X 分钟截断」。
- **无重叠不加解释**：没有重叠、也没触顶时保持原来的一句话，不给用户添噪音。
- 由 `calculate_today_remaining_minutes_merges_duplicate_slots` / `calculate_today_remaining_minutes_merges_partial_overlap` / `calculate_today_remaining_minutes_caps_at_daily_limit` / `calculate_today_remaining_minutes_respects_custom_daily_limit` / `merge_planned_windows_returns_non_overlapping_windows` / `summarize_today_plan_reports_merged_sessions_and_cap` / `resolve_remaining_study_reports_merged_sessions` / `study_remaining_merges_overlapping_sessions_and_explains` / `study_remaining_caps_daily_total_and_explains` / `study_remaining_stays_plain_when_no_overlap` 锁定。

### 教材导入跨天铺排

- **每天最多三场**（08:00 / 14:00 / 19:00），生成的排期从今天开始往后铺，不再把十几节课全堆在同一天。铺几天 = `ceil(待排节数 / 3)`，导入确认页直接告诉学生「预计铺到 N 天后」。
- **已掌握的章节不占未来排期位**：它们记在今天的晚间回顾格（`status='done'`、`actual_units=1`、`xp_awarded=0`），直接插入，不走完成路径，因此无 XP、无流水、无连击变更、无成就。
- **排期方式二选一**：导入向导可只建主线任务（不生成排期），也可为未掌握的章节自动生成排期。
- 由 `src-tauri/src/commands/textbook.rs` 的 `SESSION_SLOTS` / `plan_sections` 与 `src/components/TextbookImportWizard.tsx` 锁定。

### 日期时间自绘组件

- **不依赖原生 `type="date"` / `type="time"`**：原生控件在深色主题下不可控且移动端体验差，改为自绘的 `DateField` / `TimeField` / `TimeRangeField`。
- **纯函数在 `src/lib/dateField.ts` / `src/lib/timeField.ts`**：月历网格从周一开始整周补齐；`addDaysISO` / `shiftMonth` 处理跨月跨年；`parseHHMM` / `formatHHMM` / `addMinutesToHHMM` 处理时间。组件只负责渲染。
- **保留键入通道**：`TimeField` 允许直接键入 `HH:MM`，输不出错时回落到上一次合法值。
- **时段快捷**：`TimeRangeField` 一键套用预设时段，并可按时长顺延结束时间。
- 由 `date_field_shows_relative_label_and_opens_shortcuts` / `date_field_shortcut_picks_tomorrow` / `date_field_grid_picks_a_day_and_marks_today` / `date_field_can_move_to_next_month` / `time_field_picks_hour_then_minute` / `time_field_exact_input_updates_value` / `time_range_field_applies_preset_slot_in_one_click` / `time_range_field_extends_end_by_duration` 与 `src/lib/__tests__/dateField.test.ts` / `src/lib/__tests__/timeField.test.ts` 锁定。

### 术语词条与数字来源

- **数据在 `src/lib/glossary.ts`**：每个词条有稳定 `id`、术语名、问句式 `question`（用作提示按钮的无障碍名称）、一句话解释、`formula`（口径）与 `source`（数据来源）。
- **口径必须与实现一致**：XP / 连击 / 等级对 `src-tauri/src/gamification.rs`，达成率对统计 SQL，今日剩余待学对 `src/lib/studyCountdown.ts`。`glossary_xp_formula_matches_gamification_constants` / `glossary_level_formula_matches_level_curve` / `glossary_daily_limit_matches_settings_bounds` 钉住这些数字，改公式时必须同步改词条。
- **展示**：`GlossaryHint` 在界面上就地弹出该词条的公式说明（`role="dialog"`）；`GlossaryList` 列出全部词条与来源。未知 id 渲染空、不报错。
- 由 `glossary_entries_have_unique_ids_and_complete_text` / `glossary_covers_the_numbers_students_ask_about` / `glossary_hint_opens_the_formula_on_click` / `glossary_hint_renders_nothing_for_unknown_id` / `glossary_hint_closes_on_confirm` / `glossary_list_shows_every_term_with_its_source` 锁定。

### 模考倒计时

- **模考 = 除主考（高考）以外的考试目标**。设置页加一条「名称（如模考）+ 日期」即可，`isPrimary` 的那条不算模考。
- **只取今天及以后的最近一个**（`nextMockExam`）：过去的模考不再倒计时；一条都没有时返回 `null`，面板不渲染（不占空白）。
- **今天就是模考日**显示「就是今天」，否则显示「N 天」。高考倒计时动辄几百天，模考才是最近的抓手。
- 由 `mock_exam_picks_the_nearest_future_non_primary_exam` / `mock_exam_ignores_the_primary_exam` / `mock_exam_ignores_past_exams` / `mock_exam_marks_today_as_is_today` / `mock_exam_returns_null_without_any_exam` / `mock_countdown_shows_days_until_next_mock_exam` / `mock_countdown_hides_when_there_is_no_mock_exam` 锁定。

### 便签绑定日期

- **新增列 `notes.note_date`**（迁移 `20261118120000_add_note_date.sql`，可空）。绑定后这张便签会出现在「当天要做的事」里，历史也能按日期追溯。
- **日期格式严格**：`normalize_note_date` 只接受 `YYYY-MM-DD`（10 位、两位分隔符、全数字），其余一律当「没绑日期」，**不报错、不截断**。
- **解绑**：传空值即把 `note_date` 置 `NULL`。列表排序口径不变（仍是 `pinned DESC, updated_at DESC, id DESC`），绑定日期不参与排序。
- **今日页只显示当天便签**：`src/lib/notes.ts` 的过滤只认 `note_date === 当天`，没绑日期的便签不出现（它们仍留在便签页）。`DayNotes` 在没有当天便签时整块不渲染。
- 由 `create_note_with_date_stores_bound_date` / `create_note_without_date_leaves_note_date_null` / `update_note_binds_then_clears_date` / `normalize_note_date_rejects_malformed_values` / `keeps_only_notes_bound_to_that_day` / `ignores_notes_without_a_bound_date` / `returns_empty_for_empty_date_or_empty_list` / `note_card_binds_a_date_from_the_picker` / `note_card_shows_the_bound_date_and_can_unbind` / `notes_page_creates_a_note_with_the_chosen_date` / `today_page_shows_only_notes_bound_to_that_day` 锁定。

### 错题本契约

- **表**：`mistakes`（迁移 `20261118140000_create_mistakes.sql`），字段 `id / subject / title / reason / correct_note / is_mastered / created_at / updated_at`。走 rusqlite 同步连接（与便签同款），不是 sqlx 池。
- **错因是闭合集合**：Rust `REASON_WHITELIST`（概念不清、公式记错、审题失误、计算失误、方法不会、粗心大意、其他）与前端 `src/lib/mistakes.ts` 的 `MISTAKE_REASONS` 必须逐项相等，由跨端护栏 `frontend_reason_list_matches_backend_whitelist` 钉住（Rust 测试直接读 `src/lib/mistakes.ts` 源码比对）。**改一边必须改另一边**。未知 / 空错因归「其他」，不报错。
- **科目是开放字符串**：只 `trim`，空值归「其他」；不做白名单校验，与 `actual_logs.subject` 的开放语义一致。
- **`is_mastered` 用 0/1 而不是 boolean**：Rust 侧是 `Option<i64>`（serde 不能把 bool 反序列化成 i64），前端传 0/1，command 层归一为 `if m != 0 { 1 } else { 0 }`。列的默认值是 0（未订正）。
- **排序**：`ORDER BY is_mastered ASC, created_at DESC, id DESC`——未订正的排前面，同组内按创建时间倒序，最后按 id 倒序保证顺序稳定。
- **导出导入**：`mistakes` 已进 `export_json_impl` / `import_json_impl` 的表清单，与其它用户表一起往返；由 `export_json_includes_every_user_table` 的双向覆盖护栏与 `mistakes_survive_export_import_round_trip` 锁定。
- 由 `normalize_reason_maps_unknown_to_other` / `normalize_subject_trims_and_falls_back_to_other` / `create_mistake_stores_normalized_reason_and_subject` / `list_mistakes_puts_unmastered_first` / `update_mistake_only_touches_given_fields` / `delete_mistake_removes_the_row` / `mistakes_survive_export_import_round_trip` 与前端 `mistake_reasons_match_the_backend_whitelist` / `normalize_reason_falls_back_to_other` / `normalize_subject_trims_and_defaults_to_other` / `summarize_mistakes_counts_pending_and_mastered` / `filter_mistakes_splits_pending_and_mastered` / `reason_counts_lists_the_most_common_reason_first` / `mistakes_page_records_subject_reason_and_correct_note` / `mistakes_page_refuses_to_save_without_a_title` / `mistakes_page_toggles_mastered_state` / `mistakes_page_filters_pending_and_mastered` / `mistakes_page_shows_the_empty_state` 锁定。

### 成绩缺考折算

- **公式**（`src/lib/scoreScaling.ts`）：`折算总分 = 实考总分 × 六科满分(610) ÷ 已考科目满分之和`，四舍五入。也就是把缺考科目按已考科目的得分率补齐，得到与「六科都考了」可比的分数。各科满分：语文 120 / 数学 130 / 英语 120 / 物理、化学、生物各 80，合计 610，与设置页默认目标一致。
- **留空 = 缺考**：录入弹窗文案明确「没考的科目留空——留空就是缺考，总分会按已考科目比例折算」。`null` 就是缺考，不写 0。
- **单科不折算**：只记一科时 `scaledTotalNote` 返回 `null`，界面不显示折算说明（拿一科推六科没有意义）。六科齐全时折算分等于实考总分。空记录没有折算分。
- **胶囊与档案页**：`ScoreOverview` 的第三分支是 `kind: "scaled"`（带 `score / sum / count / missing / gap / tone`），胶囊显示折算分 + 「折算 · 缺考生物」，档案页 `RecordCard` 额外渲染 `data-testid="scaled-total-note"` 说明行与缺考提示行。
- **趋势图口径不变**：`ScoreTrendChart` 仍然只收「六科都有分」的场次计入总分（不折算），避免历史趋势被改写。这与胶囊的折算是两套口径，属有意为之。
- 由 `full_paper_needs_no_scaling` / `missing_biology_scales_the_total_to_the_six_subject_scale` / `several_missing_subjects_scale_by_the_taken_share` / `a_single_subject_is_not_scaled` / `an_empty_paper_has_no_scaled_total` / `subject_full_marks_match_the_default_targets` / `scales a partial paper so the gap to the target stays comparable` / `does not scale a paper that only has one score` 锁定。

### 教材源插件契约

- **插件只带清单，不带教材内容。** `resources/plugins/<id>/catalog.json` 是教材清单快照（路径、学段、科目、版本、年级、大小、分片 sha）。用户挑中哪本才下载哪本；不预置批量抽取的目录数据。
- **清单是静态快照**，版本锁在 `commit` 字段上。安装时随插件解包到 `plugins/<id>/resources/`；插件没装也能读内置的那份。仓库更新后要重新生成快照。
- **下载有两个源**：`blob` 走 GitHub blob 接口（地址里只有 sha，不受中文路径影响，但未认证每小时 60 次）；`raw` 走 `raw.githubusercontent`。两个源写在插件选项 `download_source` 里。
- **这两个选项对普通用户是黑话**：界面上一律不出现 `blob` / `raw` / `GitHub token`。详见下一节「插件选项的文案约定」。
- **blob 源遇到 403 是限额用完**：提示语说「今天的下载次数用完了……换一个下载通道」，不直接甩 `GitHub token` 给学生。
- **下载必须能断点续传**：慢网上几十兆的教材常常传到一半就断线。断了要带 `Range: bytes=<已收>-` 接着传，不从头再来；两个源指向同一个 commit 的同一份文件，字节完全一样，换源续传不会拼出坏文件（下载计划里首选源 + 备用源各存一条地址）。
- **服务端不认 `Range`（回 200）时要从头重下这一片**，不能把整本接在半截后面；每片下完要核对清单里的字节数，对不上就是没下全，要重建这一片。
- **下载失败不留半成品**：临时文件 `.part` 一律删掉，下次重新下。
- **报错要带底层原因**：reqwest 把「连接断了」这类传输层错误统一显示成 `error decoding response body`，不看 `source()` 链就分不清是超时还是被掐断。
- **没开 gzip/brotli/deflate feature**，所以不会自动发 `Accept-Encoding`、也不会自动解压；GitHub blob 接口碰到超大文件会改回 JSON，要按 `content-type` 判。
- **分片书按 `.pdf_merge_folder/<书名>.pdf.N` 顺序拼接**，全部下完才改名，失败不留半成品。教材落到 `appData/textbooks/<插件 id>/`，文件名取书名去非法字符后截到 120 字。
- **PDF 目录解析必须查字体的 `/ToUnicode` 表**：教材正文用 Type0 字体配 `UniGB-UTF16-H` 编码，lopdf 的内置编码解不出中文（它按 UTF-16BE 直解）。自实现的解码器在 `src-tauri/src/pdf_text.rs`，按 `ObjectId` 缓存。解析 CMap 时遇到 `<< ... >>` 头部的落单 `>` 必须跳过，否则 tokenizer 原地打转会把内存吃光。
- **目录只到「章 + 节」**，知识点留空让学生在任务详情里自己补。目录页页码列要剥掉；页码前的 `/` 也要剥，否则小节标题尾巴上会留斜杠。
- **导入后的教材不出现在「从教材导入」的第一步**：那个列表只含内置教材（`list_available_textbooks`）。插件页下载完直接给「勾选已掌握」的入口（`TextbookImportWizard` 的 `preloaded`），不走选书那一步。
- 由 `builtin_catalog_lists_textbooks_with_dimensions` / `sharded_book_joins_parts_into_one_pdf` / `failed_download_leaves_no_partial_file` / `interrupted_download_resumes_from_where_it_stopped` / `server_ignoring_range_restarts_the_shard` / `size_mismatch_is_reported_and_nothing_is_left` / `decodes_chinese_through_the_font_tounicode_table` / `plugin_library_turns_the_parsed_outline_into_a_task` 锁定。

### 插件选项的文案约定

- **插件清单里的选项要面向中学生写**：技术词（`blob`、`raw`、`GitHub token`）不能直接出现在界面上。`PluginOption` 支持四个可选字段：
  - `choice_labels`：`{ 候选值: 显示名 }`。下拉里显示显示名，存进 settings 的仍是候选值，后端取值逻辑不变。
  - `help`：选项下面的一句说明，用大白话讲「什么时候用、要不要动」。
  - `advanced`：收进「高级设置（一般不用改）」折叠区，默认不展开。技术性选项一律标上。
  - `secret`：敏感内容（令牌、口令）用密码框渲染，不在屏幕上明文回显。
- **没写这些字段的老插件照旧能用**：`help` 空、不算高级、不敏感，选项平铺显示。
- **教材库插件的选项全部标 `advanced`**：学生打开插件页先看到的是教材库本身，而不是一排看不懂的技术项；要换通道或填令牌时，才展开「高级设置」。
- **学生视角的下载通道名**：`blob` → 「标准通道（推荐）」，`raw` → 「备用通道（标准通道失败时再试）」。
- **令牌对普通用户是选填的**：文案写「平时不用填」，并说明只有提示下载次数用完时才需要。
- 由 `textbook_plugin_options_carry_user_facing_text` / `plugin_option_defaults_are_backward_compatible` / `plugin_detail_folds_advanced_options_away_by_default` / `plugin_detail_shows_friendly_choice_names_instead_of_raw_values` / `plugin_detail_masks_the_token_field_and_explains_it` / `plugin_detail_keeps_normal_options_flat_without_an_advanced_section` 锁定。

## 待处理技术债

### 考试目标日的时区锚点

- **描述**：`computeCountdown` 用 `startOfDay(parseISO(targetDate))`，日期串按本地零点解释。`"2026-06-07"` 在 UTC+8 是本地 2026-06-07 00:00:00。`new Date("2026-06-07")` 则是 UTC 午夜（当地 08:00）。若历史用户把后一种瞬时写成了目标日，升级后同一天的时钟锚点会差 8 小时；`startOfDay` 会把时刻丢掉，是否因此少一天取决于保存的是纯日期还是带时区的瞬时。
- **不阻塞当前测试批次。** 现有写入路径是日期框的 `ev.target.value`（`YYYY-MM-DD`），不是 `new Date("YYYY-MM-DD")`。倒计时边界语义里的「时区口径（本批不改）」仍然有效。本批没有改 `computeCountdown` 的锚点。
- **历史格式分布（2026-11-05 审计，本机）**：考试日期不在 `timequest.db`，键是 `localStorage` 的 `timequest.exams`。已查 Tauri appData（`com.timequest.desktop` / `com.timequest.app`）、WebView2 Local Storage、工作区数据库、Chrome / Edge 的 Local Storage、Firefox Profiles。落盘记录为 0。
  - 纯日期 `YYYY-MM-DD`：0 条
  - ISO 串（含 `T`）：0 条
  - 其他格式：0 条
  - 空值或损坏值：0 条
- **解析推演（UTC+8，库存中未出现）**：`2026-06-07` 与 `2026-06-07T00:00:00.000Z` 经 `startOfDay` 后都是本地 2026-06-07，天数相同，瞬时差 8 小时被抹掉。`2026-06-07T16:00:00.000Z` 会落到本地 2026-06-08（多算 1 天）；`2026-06-06T15:59:59.000Z` 会落到本地 2026-06-06（少算 1 天）。当前写入路径不产生这两种瞬时。
- **决定：A. 不迁移（2026-11-05 确认）。** 没有可改的历史行，现行写入与缺省种子都是纯日期。同一天的 UTC 午夜在 UTC+8 下经过 `startOfDay` 也与纯日期等价。不写迁移，不改 `computeCountdown` 的锚点，不新增原始值字段。方案 B、C 因此不执行。
