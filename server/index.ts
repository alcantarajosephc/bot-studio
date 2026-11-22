import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.ts";
import { APP_NAME } from "../shared/brand.ts";

const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { createBotSystem } = await import("./system.ts");
const { createApp } = await import("./app.ts");

const port = Number(process.env.BOTS_PORT ?? 4747);
const sys = createBotSystem({ watchInbox: true });
const app = createApp(sys);

app.listen(port, "127.0.0.1", () => {
  sys.editor.mediaBase = `http://127.0.0.1:${port}`;
  const ui = fs.existsSync(path.join(ROOT, "dist")) && !process.env.npm_lifecycle_event?.startsWith("dev") ? `http://localhost:${port}` : "http://localhost:5173";
  console.log(`\n  ${APP_NAME} server on http://127.0.0.1:${port}`);
  console.log(`  Open the app: ${ui}`);
  console.log(`  Drop videos into: ${path.join(ROOT, "data", "inbox")} (or drag them onto the canvas)\n`);
});
