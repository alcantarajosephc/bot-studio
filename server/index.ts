import fs from "node:fs";
import path from "node:path";
import { paths, ROOT } from "./config.ts";
import { APP_NAME } from "../shared/brand.ts";

const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { createBotSystem } = await import("./system.ts");
const { createApp } = await import("./app.ts");

const port = Number(process.env.BOTS_PORT ?? 4747);
const sys = createBotSystem({ watchInbox: true });
const app = createApp(sys);

const server = app.listen(port, "127.0.0.1", () => {
  sys.editor.mediaBase = `http://127.0.0.1:${port}`;
  const ui = fs.existsSync(path.join(ROOT, "dist")) && !process.env.npm_lifecycle_event?.startsWith("dev") ? `http://localhost:${port}` : "http://localhost:5173";
  console.log(`\n  ${APP_NAME} server on http://127.0.0.1:${port}`);
  console.log(`  Open the app: ${ui}`);
  console.log(`  Drop videos into: ${paths.inbox} (or drag them onto the canvas)\n`);
  void checkTools();
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  Port ${port} is already in use. ${APP_NAME} may already be running: open http://localhost:${port}.`);
    console.error(`  To use another port: set BOTS_PORT (e.g. in .env) and restart.\n`);
  } else {
    console.error(`\n  Could not start the server: ${err.message}\n`);
  }
  process.exit(1);
});

/** Warn early, in plain words, when a required tool is missing. */
async function checkTools(): Promise<void> {
  const { run } = await import("./media/ffmpeg.ts");
  for (const tool of ["ffmpeg", "ffprobe"]) {
    try {
      await run(tool, ["-version"]);
    } catch {
      console.warn(`  ! ${tool} was not found. Covers, captions and the editor need it. Install it (Windows: winget install Gyan.FFmpeg) and restart.`);
    }
  }
}
