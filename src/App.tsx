import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Tasks } from "./pages/Tasks";
import { TaskDetail } from "./pages/TaskDetail";
import { Today } from "./pages/Today";
import { Stats } from "./pages/Stats";
import { Notes } from "./pages/Notes";
import { Settings } from "./pages/Settings";
import { api } from "./api/tauri";
import { useUiStore } from "./store/ui";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function BootSync() {
  const closeToTray = useUiStore((s) => s.closeToTray);
  const alwaysOnTop = useUiStore((s) => s.alwaysOnTop);

  useEffect(() => {
    if (!isTauri()) return;
    void api.setCloseToTray(closeToTray).catch(() => undefined);
    // getCurrentWindow() throws synchronously when __TAURI_INTERNALS__ is missing.
    // Promise.catch cannot see that throw.
    try {
      void getCurrentWindow()
        .setAlwaysOnTop(alwaysOnTop)
        .catch((error: unknown) => {
          console.warn("setAlwaysOnTop failed", error);
        });
    } catch (error) {
      console.warn("setAlwaysOnTop failed", error);
    }
  }, [closeToTray, alwaysOnTop]);

  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <BootSync />
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="tasks/:id" element={<TaskDetail />} />
            <Route path="today" element={<Today />} />
            <Route path="stats" element={<Stats />} />
            <Route path="notes" element={<Notes />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
