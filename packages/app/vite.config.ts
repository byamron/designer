import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  // Keep Vite's dev logs visible behind Tauri's own banner instead of being
  // wiped each HMR cycle. Matters when running `cargo tauri dev`.
  clearScreen: false,
  resolve: {
    alias: [
      // Order matters: more specific patterns first.
      {
        find: /^@designer\/ui\/styles\/(.*)$/,
        replacement: path.resolve(__dirname, "../ui/styles/$1"),
      },
      {
        find: "@designer/ui",
        replacement: path.resolve(__dirname, "../ui/src/index.ts"),
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  server: {
    // Pinned so Tauri's `devUrl` in tauri.conf.json matches deterministically.
    port: 5174,
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Visual regression suites run via `npm run test:visual` against a
    // separate vitest config (browser mode + Playwright). They depend on
    // browser-only APIs (page, document.fonts) and would error under
    // jsdom. Excluded so the default `npm run test` stays fast.
    exclude: ["src/test/visual/**", "node_modules/**", "dist/**"],
  },
});
