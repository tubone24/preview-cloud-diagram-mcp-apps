import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// UI（MCP App テンプレート）を単一HTMLにバンドルする。
// MCP Apps のデフォルトCSPは外部読み込みを禁止するため、
// JS/CSS/アイコンSVGをすべて1ファイルにインライン化する必要がある。
export default defineConfig({
  root: "src/ui",
  plugins: [viteSingleFile()],
  build: {
    outDir: "../../public",
    emptyOutDir: true,
    rollupOptions: {
      input: "src/ui/index.html",
    },
  },
});
