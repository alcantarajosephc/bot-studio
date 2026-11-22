async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  get: <T>(url: string) => fetch(url).then((r) => handle<T>(r)),
  post: <T>(url: string, body?: unknown) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => handle<T>(r)),
  put: <T>(url: string, body: unknown) =>
    fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => handle<T>(r)),
  patch: <T>(url: string, body: unknown) =>
    fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => handle<T>(r)),
  del: <T>(url: string) => fetch(url, { method: "DELETE" }).then((r) => handle<T>(r)),
  form: <T>(url: string, form: FormData) => fetch(url, { method: "POST", body: form }).then((r) => handle<T>(r)),
};

export function uploadVideos(files: File[]) {
  const form = new FormData();
  for (const f of files) form.append("videos", f, f.name);
  return api.form<{ added: unknown[] }>("/api/videos", form);
}
