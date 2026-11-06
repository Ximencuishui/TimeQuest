import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/tauri";
import type { UserProfile } from "../types";

export function useUserProfile() {
  return useQuery({
    queryKey: ["userProfile"],
    queryFn: () => api.getUserProfile(),
  });
}

export function useUpdateUserProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile: UserProfile) => api.updateUserProfile(profile),
    onSuccess: (saved) => {
      qc.setQueryData(["userProfile"], saved);
    },
  });
}
