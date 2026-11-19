import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PluginKnowledgeLibrary } from "../components/PluginKnowledgeLibrary";
import { PluginTextbookLibrary } from "../components/PluginTextbookLibrary";
import {
  usePluginMutations,
  usePluginOptionMutation,
  usePluginOptions,
  usePlugins,
} from "../hooks/usePlugins";
import type { PluginInfo, PluginOption } from "../types";

/** 工具箱网格里的图标：包里有就用图标，没有就拿名字首字顶替。 */
function toolIcon(icon: string, name: string): string {
  const trimmed = icon.trim();
  if (trimmed) return trimmed;
  return name.trim().slice(0, 1) || "🧰";
}

/** 插件是不是教材源：自带一份教材清单的那种。 */
function isTextbookSource(plugin: PluginInfo): boolean {
  return (plugin.resources ?? []).some(
    (resource) => resource.kind === "textbook_catalog",
  );
}

/** 插件是不是知识图谱源：自带知识点节点与先修关系的那种。 */
function isKnowledgeGraph(plugin: PluginInfo): boolean {
  return (plugin.resources ?? []).some(
    (resource) => resource.kind === "knowledge_graph",
  );
}

/** 一个插件选项：输入控件 + 下面一行说明。 */
function OptionField({
  option,
  inputId,
  value,
  stored,
  saving,
  onChange,
  onSave,
}: {
  option: PluginOption;
  inputId: string;
  value: string;
  stored: string;
  saving: boolean;
  onChange: (next: string) => void;
  onSave: (next: string) => void;
}) {
  const help = option.help?.trim();

  if (option.kind === "bool") {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <input
            id={inputId}
            type="checkbox"
            checked={value === "true"}
            onChange={(event) => {
              const next = event.target.checked ? "true" : "false";
              onChange(next);
              onSave(next);
            }}
          />
          <label htmlFor={inputId} className="text-sm text-ink-muted">
            {option.label}
          </label>
        </div>
        {help ? <p className="text-xs text-ink-muted/80">{help}</p> : null}
      </div>
    );
  }

  // 下拉选项：改完直接存，没有单独的保存按钮。
  if (option.kind === "select" && (option.choices?.length ?? 0) > 0) {
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={inputId} className="w-44 text-sm text-ink-muted">
            {option.label}
          </label>
          <select
            id={inputId}
            className="rounded-lg border border-white/10 bg-surface-3 px-2 py-1.5 text-sm"
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              onSave(event.target.value);
            }}
          >
            {option.choices?.map((choice) => (
              <option key={choice} value={choice}>
                {option.choice_labels?.[choice]?.trim() || choice}
              </option>
            ))}
          </select>
        </div>
        {help ? <p className="text-xs text-ink-muted/80">{help}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="w-44 text-sm text-ink-muted">
          {option.label}
        </label>
        <input
          id={inputId}
          type={option.kind === "number" ? "number" : option.secret ? "password" : "text"}
          className="w-32 rounded-lg border border-white/10 bg-surface-3 px-3 py-1.5 text-sm"
          placeholder={option.secret ? "粘贴到这里" : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink disabled:opacity-40"
          disabled={value === stored || saving}
          onClick={() => onSave(value)}
        >
          保存
        </button>
      </div>
      {help ? <p className="text-xs text-ink-muted/80">{help}</p> : null}
    </div>
  );
}

/** 已安装插件的可配置项。没改过的显示包里的默认值，改完点保存写进本地设置。 */
function PluginOptions({
  pluginId,
  options,
}: {
  pluginId: string;
  options: PluginOption[];
}) {
  const { data: values = [] } = usePluginOptions(pluginId);
  const save = usePluginOptionMutation();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (options.length === 0) return null;

  // 普通选项平铺显示；高级选项收进折叠区，默认不展开。
  const normal = options.filter((option) => !option.advanced);
  const advanced = options.filter((option) => option.advanced);

  const renderOption = (option: PluginOption) => {
    const stored =
      values.find((value) => value.key === option.key)?.value ?? option.default;
    const value = drafts[option.key] ?? stored;
    return (
      <OptionField
        key={option.key}
        option={option}
        inputId={`plugin-${pluginId}-${option.key}`}
        value={value}
        stored={stored}
        saving={save.isPending}
        onChange={(next) =>
          setDrafts((drafts) => ({ ...drafts, [option.key]: next }))
        }
        onSave={(next) => save.mutate({ pluginId, key: option.key, value: next })}
      />
    );
  };

  return (
    <div className="mt-4 space-y-2 border-t border-white/5 pt-4">
      {normal.length > 0 ? (
        <>
          <h3 className="text-sm text-ink">设置</h3>
          <div className="space-y-3">{normal.map(renderOption)}</div>
        </>
      ) : null}
      {advanced.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm text-ink-muted transition hover:text-ink">
            高级设置（一般不用改）
          </summary>
          <div className="mt-3 space-y-3">{advanced.map(renderOption)}</div>
        </details>
      ) : null}
    </div>
  );
}

export function PluginDetail() {
  const { pluginId = "" } = useParams();
  const navigate = useNavigate();
  const { data: plugins = [], isLoading } = usePlugins();
  const { install, uninstall } = usePluginMutations();
  const [error, setError] = useState("");

  const plugin = plugins.find((item) => item.id === pluginId);
  const installing = install.isPending && install.variables === pluginId;
  const uninstalling = uninstall.isPending && uninstall.variables === pluginId;

  const onInstall = async () => {
    setError("");
    try {
      await install.mutateAsync(pluginId);
    } catch (e) {
      setError(`下载失败：${String(e)}`);
    }
  };

  const onUninstall = async () => {
    setError("");
    try {
      await uninstall.mutateAsync(pluginId);
    } catch (e) {
      setError(`卸载失败：${String(e)}`);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-ink-muted">加载中…</p>;
  }

  if (!plugin) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="font-display text-2xl">插件不存在</h1>
        <p className="text-sm text-ink-muted">
          插件仓库里没有 {pluginId}，可能已经被移除。
        </p>
        <button
          type="button"
          onClick={() => navigate("/toolbox")}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-ink-muted transition hover:text-ink"
        >
          回到工具箱
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <button
        type="button"
        onClick={() => navigate("/toolbox")}
        className="text-sm text-ink-muted transition hover:text-ink"
      >
        ← 工具箱
      </button>

      <div className="flex flex-wrap items-start gap-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-surface-3 text-4xl leading-none">
          {toolIcon(plugin.icon, plugin.name)}
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl">{plugin.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">{plugin.summary}</p>
          <p className="mt-1 text-xs text-ink-muted">
            {plugin.author} · v{plugin.version} · {plugin.size_kb} KB
          </p>
        </div>
        <div className="ml-auto shrink-0">
          {plugin.installed ? (
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                已安装
              </span>
              <button
                type="button"
                disabled={uninstalling}
                onClick={onUninstall}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink disabled:opacity-50"
              >
                {uninstalling ? "卸载中…" : "卸载"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={installing}
              onClick={onInstall}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              {installing ? "下载中…" : "下载并安装"}
            </button>
          )}
        </div>
      </div>

      {error ? <p className="text-xs text-red-300">{error}</p> : null}

      {plugin.capabilities.length > 0 ? (
        <section>
          <h2 className="font-display text-base">装上之后</h2>
          <ul className="mt-2 space-y-1 text-sm text-ink-muted">
            {plugin.capabilities.map((capability) => (
              <li key={capability}>
                <span aria-hidden="true" className="mr-1">
                  ·
                </span>
                {capability}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {plugin.installed ? (
        <PluginOptions pluginId={plugin.id} options={plugin.options} />
      ) : null}

      {plugin.installed && isTextbookSource(plugin) ? (
        <PluginTextbookLibrary pluginId={plugin.id} />
      ) : null}

      {plugin.installed && isKnowledgeGraph(plugin) ? (
        <PluginKnowledgeLibrary pluginId={plugin.id} />
      ) : null}
    </div>
  );
}