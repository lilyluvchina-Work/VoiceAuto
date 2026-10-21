# 2026-09-21 外接音频采集界面发布记录

- 站点：http://10.10.64.202:8888/
- 容器：`voiceauto-web`，镜像：`voiceauto-web:20260921-audio-input`
- 发布目录：`/opt/voiceauto/releases/voiceauto-20260921-audio-input`
- 当前链接：`/opt/voiceauto/current`
- 旧容器保留为：`voiceauto-web-backup-before-audio-input`（已停止）
- 前端资源：`index-nF8RBw2C.js`

更新以原 `voiceauto-web:20260921-speaker-fix` 镜像为基础，仅替换前端资源。保留原网络、固定容器 IP、环境文件、端口及重启策略。数据库健康检查通过，浏览器已验证音频权限提醒和“授权并检测设备”按钮可见。

浏览器点击“开启麦克风权限”实测仍提示当前页面不是安全上下文，录音被禁用。上线界面不等于录音链路已修复。需要可信 HTTPS 入口或本机 localhost 入口后，继续验证外接设备枚举和实际录音。

发布脚本位于新发布目录的 `activate.sh`，包含发布期间自动回滚逻辑。该脚本针对首次发布，不可直接重复运行。后续回滚可利用保留的旧容器和旧发布目录，由运维核对网络占用后执行。
