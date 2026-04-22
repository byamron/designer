import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
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
    port: 5174,
    strictPort: false,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
