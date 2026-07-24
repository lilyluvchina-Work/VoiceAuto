export async function createUserAccount(input, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl('/api/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      success: false,
      message: body?.message || '新增账号失败',
    };
  }
  return body;
}
