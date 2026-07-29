async function parseJsonResponse(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok || body.success === false) {
    throw new Error(body.message || `请求失败：${response.status}`);
  }
  return body;
}

export async function createStoredTestAudio(input) {
  const response = await fetch('/api/test-audios', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  return parseJsonResponse(response);
}

export async function listStoredTestAudios() {
  const response = await fetch('/api/test-audios', {
    method: 'GET',
    credentials: 'include',
  });
  return parseJsonResponse(response);
}

export async function deleteStoredTestAudio(id) {
  const response = await fetch(`/api/test-audios/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  return parseJsonResponse(response);
}

export async function regenerateStoredTestAudio(id, input = {}) {
  const response = await fetch(`/api/test-audios/${encodeURIComponent(id)}/regenerate`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  return parseJsonResponse(response);
}

export async function fetchStoredTestAudioBlob(audioUrl) {
  const response = await fetch(audioUrl, {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    let message = `音频下载失败：${response.status}`;
    const text = await response.text().catch(() => '');
    try {
      const body = text ? JSON.parse(text) : null;
      message = body?.message || message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }
  return response.blob();
}

export async function synthesizeTestAudioBlob(input = {}) {
  const response = await fetch('/api/tts/doubao-v3', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: input.textContent || input.text,
      voiceType: input.voiceCode || input.voiceType,
      lang: input.language || input.lang,
      rate: input.speed ?? input.rate,
      volume: input.volume,
    }),
  });
  if (!response.ok) {
    let message = `音频生成失败：${response.status}`;
    const text = await response.text().catch(() => '');
    try {
      const body = text ? JSON.parse(text) : null;
      message = body?.message || message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }
  return response.blob();
}
