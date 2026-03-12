import { useState, useCallback, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useApi } from "./useApi";
import type { ProfileWithWallets } from "../lib/types";

export function useProfile() {
  const { authenticated } = usePrivy();
  const { request } = useApi();
  const [profile, setProfile] = useState<ProfileWithWallets | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await request<ProfileWithWallets>("/profile");
      setProfile(p);
      return p;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch profile";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    if (authenticated) {
      fetchProfile();
    } else {
      setProfile(null);
    }
  }, [authenticated, fetchProfile]);

  return { profile, loading, error, fetchProfile, setProfile };
}
