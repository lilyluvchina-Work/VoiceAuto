import React, { useRef, useState } from 'react';
import { restartBridge } from '../services/bridgeService.js';

export default function BridgeRestartButton({ bridgeUrl, disabled = false, onRestartingChange, onRestarted }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  async function restart() {
    if (disabled || inFlight.current) return;
    inFlight.current = true; setBusy(true); setFailed(false); setMessage('正在连接桥接…');
    onRestartingChange?.(true);
    try {
      await restartBridge(bridgeUrl, { onStatus: setMessage });
      setMessage('桥接已重启，正在刷新设备…');
      await onRestarted?.();
      setMessage('桥接已重启');
    } catch (error) { setFailed(true); setMessage(error.message); }
    finally { inFlight.current = false; setBusy(false); onRestartingChange?.(false); }
  }
  return <div className="flex flex-wrap items-center gap-3 text-sm">
    <button type="button" onClick={restart} disabled={disabled || busy}
      className="rounded-lg border border-gray-600 px-4 py-2 text-sm hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40">{busy ? '重启中…' : '重启桥接'}</button>
    {message && <span role={failed ? 'alert' : 'status'} className={failed ? 'text-red-300' : 'text-blue-200'}>{message}</span>}
  </div>;
}
