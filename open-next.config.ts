import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default {
  ...defineCloudflareConfig(),
  // `npm run build` is the OpenNext build itself (so Cloudflare Workers Builds'
  // default commands work), so OpenNext must call Next directly, not `npm run build`.
  buildCommand: "npx next build",
};
