import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Designer's packages/ui/styles/tokens.css does `@import "@radix-ui/colors/sand.css"` etc.
// The CSS file lives outside the showcase, so Vite's default CSS resolver
// can't find showcase/node_modules. Aliasing @radix-ui/colors directly to
// the installed copy makes Vite resolve it regardless of which file imports.
const showcaseUrl = new URL(".", import.meta.url);
const radixColorsPath = fileURLToPath(
  new URL("./node_modules/@radix-ui/colors", showcaseUrl),
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@mini": fileURLToPath(new URL("../../packages/ui/styles", import.meta.url)),
      "@radix-ui/colors": radixColorsPath,
    },
  },
});
