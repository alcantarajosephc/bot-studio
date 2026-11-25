import type { NextFunction, Request, Response } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostnameOf(hostHeader: string): string {
  return hostHeader.trim().toLowerCase().replace(/:\d+$/, "");
}

/**
 * The server is for this computer only. Two checks keep other websites out:
 * - Host must be localhost/127.0.0.1 (blocks DNS-rebinding pages from reading the API).
 * - Changes (POST/PUT/PATCH/DELETE) coming from a browser must come from a local page
 *   (blocks other sites from quietly submitting forms that upload videos or start runs).
 */
export function localOnly(req: Request, res: Response, next: NextFunction): void {
  if (!LOCAL_HOSTS.has(hostnameOf(req.headers.host ?? ""))) {
    res.status(403).json({ error: "This server only answers to localhost." });
    return;
  }
  const origin = req.headers.origin;
  if (origin !== undefined && req.method !== "GET" && req.method !== "HEAD") {
    let ok = false;
    try {
      ok = LOCAL_HOSTS.has(new URL(origin).hostname.toLowerCase());
    } catch {
      ok = false; // "null" or garbage
    }
    if (!ok) {
      res.status(403).json({ error: "Requests from other websites are not allowed." });
      return;
    }
  }
  next();
}
