import { defineConfig } from "vite";
import logseqPlugin from "vite-plugin-logseq";
import { resolve } from "path";

export default defineConfig({
  plugins: [logseqPlugin()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    target: "es2020",
    minify: "esbuild",
  },
});
