/**
 * 打开后端签发的临时下载链接。
 *
 * 后端返回的是相对 `/api/v1/...` 的签名路径；开发环境 API 基址是
 * `http://127.0.0.1:3000/api/v1`，生产是同源 `/api/v1`。
 * 这里去掉 `/api/v1` 得到 origin 再拼接，保证两端都能打开。
 */
export function openSignedApiPath(path: string) {
  const base = import.meta.env.VITE_SERVICE_BASE_URL || '/api/v1';
  const origin = base.replace(/\/api\/v1\/?$/, '');
  window.open(`${origin}${path}`, '_blank');
}
