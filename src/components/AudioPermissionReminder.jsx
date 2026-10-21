import React, { useState } from 'react';

export default function AudioPermissionReminder() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <section aria-label="外接音频采集提醒" className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-blue-100">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">Speaker 使用外接设备本地采集</p>
          <p className="mt-1 text-gray-300">请连接外接麦克风、声卡或采集卡，启动本机桥接服务，在语音控制中检测设备并试录。录音由本地程序完成，无需浏览器麦克风权限；测试音频播放仍需允许网站声音。</p>
        </div>
        <button type="button" onClick={() => setVisible(false)} className="shrink-0 rounded-lg border border-gray-600 px-4 py-2 hover:bg-white/10">知道了</button>
      </div>
    </section>
  );
}
