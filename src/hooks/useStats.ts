import { useQuery } from "@tanstack/react-query";
import { api } from "../api/tauri";

export function useUserStats() {
  return useQuery({
    queryKey: ["user-stats"],
    queryFn: () => api.getUserStats(),
  });
}

export function useAchievements() {
  return useQuery({
    queryKey: ["achievements"],
    queryFn: () => api.listAchievements(),
  });
}

export function usePlanVsActual(from: string, to: string) {
  return useQuery({
    queryKey: ["stats", "pva", from, to],
    queryFn: () => api.planVsActual(from, to),
  });
}

export function useMethodShare(from: string, to: string) {
  return useQuery({
    queryKey: ["stats", "method", from, to],
    queryFn: () => api.methodShare(from, to),
  });
}

export function useTagTypeTotals(from: string, to: string) {
  return useQuery({
    queryKey: ["stats", "tags", from, to],
    queryFn: () => api.tagTypeTotals(from, to),
  });
}

export function useCompletionRate(from: string, to: string) {
  return useQuery({
    queryKey: ["stats", "rate", from, to],
    queryFn: () => api.completionRate(from, to),
  });
}

export function useAvgRatings(from: string, to: string) {
  return useQuery({
    queryKey: ["stats", "rating", from, to],
    queryFn: () => api.avgRatings(from, to),
  });
}

export function useDailyUnits(from: string, to: string) {
  return useQuery({
    queryKey: ["stats", "daily-units", from, to],
    queryFn: () => api.dailyUnits(from, to),
  });
}
