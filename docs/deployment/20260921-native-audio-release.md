# 2026-09-21 原生外接音频采集发布

- 地址：`http://10.10.64.202:8888/`
- 当前镜像：`voiceauto-web:20260921-native-audio`
- 当前发布目录：`/opt/voiceauto/releases/voiceauto-20260921-native-audio`
- 前端入口资源：`index-CEIbaZvO.js`
- 保留的上一版本容器：`voiceauto-web-backup-before-native-audio`
- 发布数据库健康检查通过；原有环境、网络及端口沿用。

采集已从浏览器麦克风改为本机桥接 + Python sounddevice/PortAudio。用户电脑已安装 `.audio-python` 隔离环境，重启本地桥接后运行原生采集接口。当前 HTTP 页面无需浏览器麦克风权限，实际设备由操作系统提供。

浏览器验证：服务器页面列出两个输入（AIMIC-M4 与 Realtek），已选择 AIMIC-M4。点击“试录 5 秒”后成功生成 960044 字节的 48 kHz 双声道 PCM WAV，网页出现回放控件。本地目录为 `logs/speaker-audio/`。

本次试录峰值约 0.1%，没有达到声音检测阈值；这验证了设备打开、录制、文件保存和网页回传，不表示已经确认收到了 Speaker 播报。需要 Speaker 播放时再验证实际声音及设备输入音量。未在现场启动完整测试用例序列。

检查通过：原生输入选择与 WAV 回传、取消后释放、互斥采集、未知会话校验、已有 Speaker 播报结束保护测试，以及生产构建。
