/** 知行 · HTTP 客户端：统一 JSON、错误信息、超时与上传 */

export class ApiError extends Error {
  status: number;
  payload: any;

  constructor(message: string, status: number, payload?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

const TIMEOUT = 20000;

async function request<T>(method: string, path: string, body?: unknown, opts: { timeout?: number; signal?: AbortSignal } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? TIMEOUT);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    const res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data: any = null;
    if (text) {
      try { data = JSON.parse(text); } catch (_) { data = { ok: false, error: text.slice(0, 300) }; }
    }
    if (!res.ok || (data && data.ok === false)) {
      // 会话过期 / 未登录：任何数据请求都不再尝试，直接回登录页
      if (res.status === 401 && typeof location !== 'undefined' && !location.pathname.endsWith('/login.html')) {
        location.replace('/login.html');
      }
      const message = (data && (data.error || data.message)) || `请求失败（${res.status}）`;
      throw new ApiError(message, res.status, data);
    }
    return data as T;
  } catch (err: any) {
    if (err instanceof ApiError) throw err;
    if (err && err.name === 'AbortError') throw new ApiError('请求超时了，检查一下服务是不是还在运行。', 0);
    throw new ApiError(`连不上本地服务：${err && err.message ? err.message : err}`, 0);
  } finally {
    clearTimeout(timer);
  }
}

export const http = {
  get: <T>(path: string, opts?: { timeout?: number; signal?: AbortSignal }) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: { timeout?: number }) => request<T>('POST', path, body ?? {}, opts),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** 读文件为 dataURL（附件 / 图片上传用） */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

/** 下载一个后端返回的文件，保留中文文件名 */
export async function downloadFile(path: string, fallbackName = '导出'): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) {
    let message = `导出失败（${res.status}）`;
    try { const data = await res.json(); if (data && data.error) message = data.error; } catch (_) { /* 忽略 */ }
    throw new ApiError(message, res.status);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  let filename = fallbackName;
  const star = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  if (star) { try { filename = decodeURIComponent(star[1]); } catch (_) { filename = star[1]; } }
  else if (plain) filename = plain[1];
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return filename;
}