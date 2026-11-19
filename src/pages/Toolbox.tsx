import { useNavigate } from "react-router-dom";
import { usePlugins } from "../hooks/usePlugins";
import type { PluginInfo } from "../types";

/** 内置工具：不装插件也能用，图标点进去就是那个工具。 */
const BUILTIN_TOOLS = [
  {
    id: "mistakes",
    name: "错题本",
    icon: "📕",
    description: "按知识点整理你的薄弱点，订正完打个勾。",
    to: "/mistakes",
  },
];

/** 工具图标：包里有图标就用图标，没有就拿名字首字顶替。 */
function toolIcon(icon: string, name: string): string {
  const trimmed = icon.trim();
  if (trimmed) return trimmed;
  return name.trim().slice(0, 1) || "🧰";
}

/** 网格里的一格。 */
function ToolTile({
  icon,
  name,
  badge,
  onClick,
  testId,
}: {
  icon: string;
  name: string;
  badge?: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="group flex flex-col items-center gap-2 rounded-2xl border border-white/5 bg-surface-2/80 px-3 py-4 transition hover:border-accent/40 hover:bg-surface-3"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-3 text-3xl leading-none transition group-hover:bg-accent/10">
        {icon}
      </span>
      <span className="text-center text-sm leading-tight text-ink">{name}</span>
      {badge ? (
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-ink-muted">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export function Toolbox() {
  const navigate = useNavigate();
  const { data: plugins = [], isLoading, isError } = usePlugins();

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-display text-2xl">工具箱</h1>
        <p className="mt-1 text-sm text-ink-muted">
          点一个图标进到那个工具。插件装上后离线可用。
        </p>
      </div>

      <section>
        <h2 className="font-display text-lg">我的工具</h2>
        <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {BUILTIN_TOOLS.map((tool) => (
            <ToolTile
              key={tool.id}
              testId={`tool-tile-${tool.id}`}
              icon={tool.icon}
              name={tool.name}
              onClick={() => navigate(tool.to)}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg">插件</h2>
        <p className="mt-1 text-sm text-ink-muted">
          从 TimeQuest 插件仓库下载。点图标看详情并安装。
        </p>
        {isLoading ? (
          <p className="mt-3 text-sm text-ink-muted">加载中…</p>
        ) : isError ? (
          <p className="mt-3 text-sm text-ink-muted">插件列表加载失败，稍后再试。</p>
        ) : plugins.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">插件仓库暂时是空的。</p>
        ) : (
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {plugins.map((plugin) => (
              <PluginTile
                key={plugin.id}
                plugin={plugin}
                onOpen={() => navigate(`/toolbox/plugins/${plugin.id}`)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** 仓库里的一个插件格子。 */
function PluginTile({
  plugin,
  onOpen,
}: {
  plugin: PluginInfo;
  onOpen: () => void;
}) {
  return (
    <ToolTile
      testId={`plugin-tile-${plugin.id}`}
      icon={toolIcon(plugin.icon, plugin.name)}
      name={plugin.name}
      badge={plugin.installed ? undefined : "未安装"}
      onClick={onOpen}
    />
  );
}
