"use client";
import { useEffect } from "react";
import { themeOf, useAppState } from "@/lib/store";
import { applyTheme } from "@/lib/theme";

/** Keeps <html data-theme> in sync with the stored choice (the boot script handles first paint). */
export function ThemeApplier() {
  const app = useAppState();
  const theme = app ? themeOf(app.profile) : null;
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);
  return null;
}
