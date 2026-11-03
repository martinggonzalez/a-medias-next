import { defineConfig } from "@playwright/test";
import demoConfig from "./playwright.config";

export default defineConfig({
  ...demoConfig,
  testDir: "./tests/e2e-api",
  webServer: {
    command: "npm run build && npm run start -- --hostname 127.0.0.1 --port 3100",
    env: { NEXT_PUBLIC_DEMO_MODE: "false", NEXT_PUBLIC_API_URL: "https://spring.example.test" },
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 240_000
  }
});
