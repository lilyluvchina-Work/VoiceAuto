const { BOOT_START, BOOT_READY } = require('./aiToyReboot.cjs');
const { randomUUID } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');

const SERVICE_CONNECTION_FAILURE = /无法连接服务|WebSocket handshake failed|Failed to connect to Cedar WebSocket|SSL receive failed|mbedtls_ssl_fetch_input/i;

// One serial subscription spans wakeup, input, playback and the next listening event.
function createAiToySessionManager({ openPort, closePort, withPortLock, leaseMs = 300000 }) {
  const sessions = new Map();
  const activePorts = new Set();
  const openings = new Map();

  function get(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('AI玩具监听会话已关闭，请重新开始测试');
    clearTimeout(session.timer);
    session.timer = setTimeout(() => { void close(sessionId, true); }, leaseMs);
    session.timer.unref?.();
    return session;
  }

  function read(sessionId) {
    const session = get(sessionId);
    return { ...session.state, sessionId, testing: session.testing,
      logPath: session.port.serialLogPath || '', logError: session.port.serialLogError || '',
      sampleLines: [...session.lines] };
  }

  function arm(sessionId, { mode, expectsVoiceResponse = true } = {}) {
    const session = get(sessionId);
    if (!['wake', 'turn'].includes(mode)) throw new Error('Invalid AI toy session mode');
    if (session.state.error) throw new Error(session.state.error);
    if (mode === 'turn' && !session.state.ready) {
      throw new Error('AI玩具尚未开始收音，不能播放测试音频');
    }
    // The runner may retry a timed-out wake before the first listening event.
    // An active input/response turn must still never be interrupted by re-waking.
    if (mode === 'wake' && session.armed && !session.state.interrupted && session.state.phase !== 'waking' && session.state.phase !== 'standby') {
      throw new Error('AI玩具会话未中断，不能重复唤醒');
    }
    if (mode === 'wake' && session.state.rebootPending) {
      throw new Error('AI玩具尚未完成重启');
    }
    if (mode === 'wake' && session.state.interrupted && !session.state.wakeable) {
      throw new Error('AI玩具尚未回到待唤醒状态');
    }
    session.armed = true;
    session.expectsVoiceResponse = expectsVoiceResponse;
    session.state = { phase: mode === 'wake' ? 'waking' : 'input', ready: false,
      interrupted: false, inputDetected: false, actualAsrText: '', firstAudioDetected: false,
      playbackDone: false, listeningDetected: false };
    return read(sessionId);
  }

  function handleLine(session, line) {
    if (!line.trim() || session.closed) return;
    session.lines.push(line);
    if (session.lines.length > 30) session.lines.shift();
    const state = session.state;
    state.lastEventTime = Date.now();
    if (state.rebootPending && BOOT_READY.test(line)) {
      Object.assign(state, { rebootPending: false, bootCompleted: true, bootMatchedLine: line,
        wakeable: true, phase: 'interrupted' });
      return;
    }
    // A generic hardware warning or elapsed timer is not evidence of a lost session.
    const idle = /Application:.*New State:\s*idle\b/i.test(line);
    const serviceConnectionFailure = SERVICE_CONNECTION_FAILURE.test(line);
    if (idle && session.armed && state.phase !== 'waking' && (!state.firstAudioDetected || state.playbackDone)
      && !state.interrupted && !state.rebootPending && !state.error) {
      Object.assign(state, { phase: 'standby', ready: false, wakeable: true, standbyDetected: true,
        standbyLine: line, standbyTime: Date.now(), listeningDetected: false });
      return;
    }
    if (/WS response timeout \(no_tts_start\)/i.test(line) && session.armed && state.phase !== 'waking'
      && !state.firstAudioDetected && !state.interrupted && !state.rebootPending) {
      // No reply yet: keep watching for standby until the runner's turn deadline.
      state.noVoiceTimeout = true;
      return;
    }
    if (BOOT_START.test(line) || idle || /WS response timeout \(no_tts_start\)/i.test(line) || serviceConnectionFailure) {
      Object.assign(state, { phase: 'interrupted', ready: false, interrupted: true,
        rebootPending: state.rebootPending || BOOT_START.test(line),
        wakeable: idle && !state.rebootPending,
        interruptionReason: idle && state.interruptionReason ? state.interruptionReason : line,
        listeningDetected: false });
      return;
    }
    if (state.interrupted) return;
    const input = line.match(/Cedar: Input Text:\s*(.*)$/i);
    if (input && session.armed && state.phase !== 'waking') {
      Object.assign(state, { phase: 'response', ready: false, inputDetected: true,
        actualAsrText: input[1], asrMatchedLine: line });
    }
    if (line.includes('Audio latency first_downlink_audio')) {
      Object.assign(state, { phase: 'speaking', ready: false, firstAudioDetected: true,
        playbackDone: false, listeningDetected: false });
    }
    if (line.includes('TTS playback done')) {
      Object.assign(state, { playbackDone: true, playbackDoneLine: line });
    }
    if (line.includes('Cedar: Start listening')) {
      // A listening event from before playback completion must never release a turn.
      const ready = state.phase === 'waking' || state.playbackDone
        || (state.inputDetected && !state.firstAudioDetected);
      if (ready) Object.assign(state, { phase: 'listening', ready: true, standbyDetected: false, wakeable: false,
        listeningDetected: true, listeningLine: line, listeningTime: Date.now() });
    }
  }

  function confirmToolTurn(sessionId) {
    const session = get(sessionId);
    const state = session.state;
    if (session.expectsVoiceResponse || !session.armed) throw new Error('只有无需语音回复的用例可以确认工具完成');
    if (state.error || state.interrupted || state.rebootPending) throw new Error(state.error || '设备已中断，不能确认工具完成');
    if (!state.inputDetected) throw new Error('尚未检测到本轮输入');
    state.toolCalled = true;
    // Tool evidence determines the result, never device readiness. Wait for an
    // actual standby/listening event before allowing another audio.
    return read(sessionId);
  }

  async function close(sessionId, force = false) {
    const session = sessions.get(sessionId);
    if (!session) return;
    if (session.monitoring && !force) {
      const serialLog = Buffer.concat(session.rawChunks).toString('utf8');
      session.rawChunks = [];
      session.testing = false;
      session.armed = false;
      return { serialLog, logPath: session.port.serialLogPath || '', logError: session.port.serialLogError || '' };
    }
    if (session.closing) return session.closing;
    session.closed = true;
    clearTimeout(session.timer);
    session.closing = (async () => {
      try {
        await closePort(session.port);
        return { serialLog: Buffer.concat(session.rawChunks).toString('utf8'),
          logPath: session.port.serialLogPath || '', logError: session.port.serialLogError || '' };
      }
      finally {
        sessions.delete(sessionId);
        activePorts.delete(session.key);
        session.release();
      }
    })();
    return session.closing;
  }

  async function open(options) {
    const key = String(options.serialPort || '').trim().toLowerCase();
    if (!key) throw new Error('AI玩具需要选择串口');
    if (openings.has(key)) await openings.get(key);
    const existing = [...sessions.entries()].find(([, session]) => session.key === key);
    if (existing && existing[1].monitoring && !existing[1].testing) {
      if (existing[1].state.error || existing[1].baudrate !== (Number(options.baudrate) || 115200)) await close(existing[0], true);
      else {
        existing[1].testing = !options.monitoring;
        existing[1].armed = false;
        existing[1].state = { phase: 'unknown', ready: false, interrupted: false,
          rebootPending: existing[1].state.rebootPending, bootCompleted: existing[1].state.bootCompleted };
        return { sessionId: existing[0], logPath: existing[1].port.serialLogPath || '' };
      }
    }
    if (activePorts.has(key)) throw new Error('AI玩具串口正在测试，请先停止现有测试');
    activePorts.add(key);
    const opening = new Promise((resolve, reject) => {
      void withPortLock(key, async () => {
        let port;
        try {
          port = await openPort(options);
          let release;
          const lifetime = new Promise(done => { release = done; });
          const sessionId = randomUUID();
          const session = { key, port, release, baudrate: Number(options.baudrate) || 115200,
            monitoring: Boolean(options.monitoring), testing: !options.monitoring,
            rawChunks: [], lines: [], state: { phase: 'unknown', ready: false,
            interrupted: false }, armed: false, expectsVoiceResponse: true };
          const decoder = new StringDecoder('utf8');
          let buffered = '';
          port.on('data', chunk => {
            if (session.testing) session.rawChunks.push(Buffer.from(chunk));
            buffered += decoder.write(chunk);
            const lines = buffered.split(/\r?\n/);
            buffered = (lines.pop() || '').slice(-65536);
            lines.forEach(line => handleLine(session, line));
          });
          port.on('error', error => { session.state.error = error.message; session.state.ready = false; });
          port.on('close', () => {
            if (!session.closed) { session.state.error = 'AI玩具串口已断开'; session.state.ready = false; }
          });
          sessions.set(sessionId, session);
          get(sessionId);
          resolve({ sessionId, logPath: port.serialLogPath || '' }); // Listener and disk writer are attached.
          await lifetime;
        } catch (error) {
          if (port) await closePort(port);
          activePorts.delete(key);
          reject(error);
        }
      }).catch(reject);
    });
    openings.set(key, opening);
    try { return await opening; }
    finally { openings.delete(key); }
  }

  async function monitor(options) {
    const key = String(options.serialPort || '').trim().toLowerCase();
    if (openings.has(key)) await openings.get(key);
    const existing = [...sessions.entries()].find(([, session]) => session.key === key);
    if (existing) {
      existing[1].monitoring = true;
      if (existing[1].testing || (!existing[1].state.error && existing[1].baudrate === (Number(options.baudrate) || 115200))) return read(existing[0]);
      await close(existing[0], true);
    }
    const { sessionId } = await open({ ...options, monitoring: true });
    return read(sessionId);
  }

  async function disconnect(serialPort) {
    const key = String(serialPort || '').trim().toLowerCase();
    if (openings.has(key)) await openings.get(key).catch(() => {});
    const existing = [...sessions.entries()].find(([, session]) => session.key === key);
    if (existing) return close(existing[0], true);
  }

  return { open, read, arm, confirmToolTurn, close, monitor, disconnect };
}

module.exports = { createAiToySessionManager };
