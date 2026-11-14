export async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch (cause) {
    if (cause?.name === 'AbortError') throw cause;
    throw new Error('Нет связи с сервером. Проверьте подключение и попробуйте снова.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Ошибка сервера (${response.status}).`);
    error.status = response.status;
    error.code = body.code;
    throw error;
  }
  return body;
}
export const post = (url, data) => api(url, { method: 'POST', body: JSON.stringify(data) });
export const patch = (url, data) => api(url, { method: 'PATCH', body: JSON.stringify(data) });
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
export function downloadFile(name, content, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function inviteLink(schoolId = '') {
  return `${window.location.origin}${window.location.pathname}${schoolId ? `?from=${encodeURIComponent(schoolId)}` : ''}#/join`;
}
export function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—';
}
export const number = (value) => new Intl.NumberFormat('ru-RU').format(value || 0);
