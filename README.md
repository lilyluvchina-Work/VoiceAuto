# VoiceAuto - 语音自动化测试平台

基于 React 的语音助手自动化测试平台，支持豆包 TTS 与 Web Speech 双通道。

## 文档定位

- 目标读者：首次接触项目的开发与测试同学。
- 内容范围：快速启动、功能总览、使用流程、技术栈与目录概览。

## 功能特性

- 🔔 **唤醒词管理**：自定义唤醒词、唤醒后延迟，固定节奏重新唤醒时可配置唤醒间延迟
- 🎵 **音频用例管理**：支持文本导入、文件导入、手动输入生成，并支持按功能模块归类
- 🎛️ **音频配置**：多种音色、语种、方言、音量、倍速调节
- ▶️ **播放控制台**：开始/暂停/停止、进度显示、测试报告
- ✨ **播放高亮**：测试执行时，当前播放用例在列表中实时高亮
- 📊 **测试报告**：自动生成测试报告，支持复制和导出
- 🧩 **结构化报告**：测试报告支持 JSON / CSV 导出，便于外部系统对接
- 🧾 **测试过程记录**：测试报告独立为左侧菜单页面，测试中持续刷新
- 🗂️ **Langfuse 日志**：支持 UAT/TEST/PROD 多环境拉取、解析与导出
- 🤖 **自动联动**：测试完成后自动回填 Langfuse 时间范围并自动获取日志
- 📦 **生产代理示例**：提供 Nginx 反向代理配置样例，便于生产部署

## 使用说明

详细步骤见[产品使用指南](docs/product/product-use-guide.md)和[设备测试流程与恢复说明](docs/product/device-test-workflows.md)。

1. 从左侧“测试用例管理”导入用例，选择语言、音色并生成测试音频；“测试音频”支持文件、文本与手动导入。
2. 在“语音控制”选择 Speaker 或 AI玩具，检查设备连接，配置并试听唤醒词。
3. 选择模块、循环次数、日志环境及通知开关，开始测试。Space 暂停/继续，Esc 停止。
4. AI玩具使用持续 USB 串口会话：唤醒后确认收音，完播并再次收音后进入下一条。中断后重唤醒，重试耗尽后提供一次重启兜底，启动日志确认后再唤醒。
5. Speaker 连续对话等待播报结束；监听超时重新唤醒并重试当前用例，连续 5 次唤醒失败进入有上限的重启恢复。
6. 在测试过程记录、Langfuse 日志及总结报告查看结果。需要钉钉通知时配置机器人并开启页面“发送钉钉群消息”。

日志来源由设备类型确定：Speaker 使用 ADB，AI玩具使用 USB串口。低频设置按需展开，AI玩具不显示无效的 Speaker 参数。唤醒间延迟仅在固定节奏重新唤醒时显示并生效。

桥接默认地址为 `http://127.0.0.1:17321`。更新 `scripts/adbBridge.cjs` 及其依赖后需要重启桥接进程；旧进程可能返回新接口 `not found`。

## 技术栈

- **前端框架**：React 18
- **样式**：Tailwind CSS
- **语音合成**：豆包 TTS / Web Speech API
- **状态管理**：React Context
- **打包工具**：Vite

## 浏览器兼容性

- Chrome 90+
- Firefox 88+
- Edge 90+
- Safari 14+

## 项目结构

```
VoiceAuto/
├── index.html              # HTML 入口
├── package.json            # 依赖配置
├── vite.config.js          # Vite 配置
├── tailwind.config.js      # Tailwind 配置
├── src/
│   ├── main.jsx            # React 入口
│   ├── App.jsx              # 主应用组件
│   ├── index.css            # 全局样式
│   ├── components/
│   │   ├── VoiceConfig.jsx       # 音频配置
│   │   ├── AudioImporter.jsx      # 音频导入
│   │   ├── AudioList.jsx         # 音频列表
│   │   ├── PlaybackConsole.jsx   # 播放控制台
│   │   └── TestReport.jsx        # 测试报告
│   ├── stores/
│   │   └── testStore.js     # 状态管理
│   ├── services/
│   │   └── ttsService.js    # TTS 服务
│   └── utils/
│       └── audioUtils.js    # 音频工具函数
└── public/
    └── assets/              # 静态资源
```

## License

MIT
