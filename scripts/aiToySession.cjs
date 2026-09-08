const { BOOT_START, BOOT_READY } = require('./aiToyReboot.cjs');
const { randomUUID } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');

// One serial subscription spans wakeup, input, playback and the next listening event.
function createAiToySessionManager({ openPort, closePort, withPortLock, leaseMs = 300000 }) {
  const sessions = new Map();
  const activePorts = new Set();

  function get(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error('AI玩具监听会话已关闭，请重新开始测试');
    clearTimeout(session.timer);
    session.timer = setTimeout(() => { void close(sessionId); }, leaseMs);
    session.timer.unref?.();
    return session;
  }

  function read(sessionId) {
    const session = get(sessionId);
    return { ...session.state, sampleLines: [...session.lines] };
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
    if (mode === 'wake' && session.armed && !session.state.interrupted && session.state.phase !== 'waking') {
      throw new Error('AI玩具会话未中断，不能重复唤醒');
    }
    if (mode === 'wake' && session.state.rebootPending) {
      throw new Error('AI玩具尚未完成重启');
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
      Object.assign(state, { rebootPending: false, bootCompleted: true, bootMatchedLine: line });
      return;
    }
    // A generic hardware warning or elapsed timer is not evidence of a lost session.
    const idle = /Application:.*New State:\s*idle\b/i.test(line);
    if (BOOT_START.test(line) || idle || /WS response timeout \(no_tts_start\)/i.test(line)) {
      Object.assign(state, { phase: 'interrupted', ready: false, interrupted: true,
        rebootPending: state.rebootPending || BOOT_START.test(line),
        wakeable: idle && !state.rebootPending,
        interruptionReason: line, listeningDetected: false });
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
        || (!session.expectsVoiceResponse && state.inputDetected && !state.firstAudioDetected);
      if (ready) Object.assign(state, { phase: 'listening', ready: true,
        listeningDetected: true, listeningLine: line, listeningTime: Date.now() });
    }
  }

  async function close(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;
    if (session.closing) return session.closing;
    session.closed = true;
    clearTimeout(session.timer);
    session.closing = (async () => {
      try {
        await closePort(session.port);
        return { serialLog: Buffer.concat(session.rawChunks).toString('utf8') };
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
    if (activePorts.has(key)) throw new Error('AI玩具串口正在测试，请先停止现有测试');
    activePorts.add(key);
    return new Promise((resolve, reject) => {
      void withPortLock(key, async () => {
        let port;
        try {
          port = await openPort(options);
          let release;
          const lifetime = new Promise(done => { release = done; });
          const sessionId = randomUUID();
          const session = { key, port, release, rawChunks: [], lines: [], state: { phase: 'unknown', ready: false,
            interrupted: false }, armed: false, expectsVoiceResponse: true };
          const decoder = new StringDecoder('utf8');
          let buffered = '';
          port.on('data', chunk => {
            session.rawChunks.push(Buffer.from(chunk));
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
          resolve({ sessionId }); // Return only after the serial listener is attached.
          await lifetime;
        } catch (error) {
          if (port) await closePort(port);
          activePorts.delete(key);
          reject(error);
        }
      }).catch(reject);
    });
  }

  return { open, read, arm, close };
}

module.exports = { createAiToySessionManager };
