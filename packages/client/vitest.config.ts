import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/screenShareQuality.test.ts", "**/node_modules/**"],
  },
});
