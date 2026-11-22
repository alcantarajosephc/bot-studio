import path from "node:path";
import type { Timeline } from "../../../shared/types.ts";
import { ROOT } from "../../config.ts";

let bundlePromise: Promise<string> | null = null;

/** Bundle the Remotion composition once per server run. */
function getBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = import("@remotion/bundler").then(({ bundle }) =>
      bundle({ entryPoint: path.join(ROOT, "editor-remotion", "index.ts") }),
    );
    bundlePromise.catch(() => (bundlePromise = null));
  }
  return bundlePromise;
}

export async function renderTimeline(timeline: Timeline, outFile: string, onProgress?: (p: number) => void): Promise<void> {
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await getBundle();
  const inputProps = { timeline };
  const composition = await selectComposition({ serveUrl, id: "Edit", inputProps });
  let last = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outFile,
    inputProps,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 100);
      if (pct !== last) {
        last = pct;
        onProgress?.(progress);
      }
    },
  });
}
