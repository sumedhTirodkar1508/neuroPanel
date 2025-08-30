// src/lib/httpError.ts
export class HttpError extends Error {
  status?: number;
  body?: any;
  constructor(message: string, status?: number, body?: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function fetchJSON<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10000
): Promise<T> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    let body: any = null;
    const text = await res.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!res.ok) {
      throw new HttpError(
        body?.error || `HTTP ${res.status} ${res.statusText}`,
        res.status,
        body
      );
    }
    return body as T;
  } catch (err: any) {
    if (err.name === "AbortError")
      throw new HttpError("Request timed out", 408);
    if (err instanceof HttpError) throw err;
    throw new HttpError(err?.message || "Network error");
  } finally {
    clearTimeout(id);
  }
}
