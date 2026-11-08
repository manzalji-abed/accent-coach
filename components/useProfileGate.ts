"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAppState } from "@/lib/store";

/** Sends first-time visitors to onboarding. Returns null until state is loaded. */
export function useProfileGate() {
  const app = useAppState();
  const router = useRouter();
  useEffect(() => {
    if (app && !app.profile) router.replace("/onboarding");
  }, [app, router]);
  return app?.profile ? app : null;
}
