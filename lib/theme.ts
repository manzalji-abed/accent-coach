import type { ThemePref } from "./types";

/** Same key as lib/store.ts; the boot script below can't import it. */
const KEY = "accent-coach:v1";

/** Runs in <head> before first paint so the chosen theme never flashes. */
export const THEME_BOOT_SCRIPT = `try{var t=JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})||"{}").profile.theme;if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

/** Set or clear data-theme on <html>. System omits the attribute. */
export function applyTheme(theme: ThemePref, root: HTMLElement = document.documentElement) {
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
}
