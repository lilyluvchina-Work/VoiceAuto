# 钉钉群消息通知说明

更新日期：2026-09-05；按 `src/services/dingTalkService.js`、公共测试 Hook 及 AI玩具 Runner 的实际调用维护。

## 启用条件

1. 在配置中心“钉钉机器人配置”设置 Webhook/Access Token，需要签名时设置 Secret，并启用机器人。
2. 在“语音控制”开启“发送钉钉群消息”。关闭时跳过发送。
3. 默认同源代理路径为 `/dingtalk-robot`；开发/生产服务需提供对应代理。

当前凭据读取配置中心的安全配置，不使用旧版文档中的 `VITE_DINGTALK_*` 作为发送配置入口。示例和日志不要包含真实凭据。

## 公共节点

| 事件 | 触发场景 |
| --- | --- |
| `TEST_STARTED` | 开始运行测试 |
| `TEST_PAUSED` | 暂停 |
| `TEST_RESET` | 重置 |
| `TEST_INTERRUPTED` | 用户停止或任务异常终止 |
| `TEST_COMPLETED` | 队列完成，携带执行和成功/失败数量 |
| `SPEAKER_LISTENER_HEALTH_CHECK` / `SPEAKER_LISTENER_HEALTH_FAILED` | 监听自检结果；历史事件名保留，详情标识所选设备 |
| `LANGFUSE_FETCH_SUCCEEDED` / `LANGFUSE_FETCH_FAILED` | 日志拉取结果 |

继续/恢复按钮目前没有单独的 `TEST_RESUMED` 通知。开始、暂停、停止由公共 Hook 处理，AI玩具不重复发送同一生命周期事件。

## AI玩具新增节点

| 事件 | 等级 | 触发依据 |
| --- | --- | --- |
| `AI_TOY_WAKE_SUCCESS` | SUCCESS | 唤醒后已确认开始收音 |
| `AI_TOY_TURN_RESULT` | INFO | 每条用例完成，详情注明通过/失败 |
| `AI_TOY_INTERRUPTED` | ERROR | 明确会话中断，记录失败原因和已有重试次数 |
| `AI_TOY_REBOOT_STARTED` | INFO | 兜底重启或检测到设备自行重启，开始等待启动 |
| `AI_TOY_REBOOT_SUCCESS` | SUCCESS | 启动完成已经确认，准备连接/重新唤醒；不表示本次用例已通过 |
| `AI_TOY_REBOOT_FAILED` | ERROR | 重启或启动等待失败 |

正常每条用例会发结果；中断分支发送中断消息而非再发一条相同的用例结果。消息包含设备、串口、当前用例 ID、批次 ID及相应详情。恢复后的新串口在恢复成功消息中说明。

## Speaker 恢复节点

| 事件 | 等级 | 触发场景 |
| --- | --- | --- |
| `SPEAKER_RECOVERY_REWAKE` | ERROR | 完播未确认/超时，重新唤醒并重试当前用例 |
| `WAKE_CONSECUTIVE_FAILED` | ERROR | 连续 5 次唤醒失败，准备重启或触及上限 |
| `SPEAKER_REBOOT_SUCCESS` | SUCCESS | 后端确认启动完成；当前还会等待 120 秒再唤醒 |
| `SPEAKER_REBOOT_FAILED` | ERROR | 重启失败或未确认启动完成 |
| `TEST_AUDIO_PLAY_FAILED` | ERROR | Speaker 测试音频播放失败 |

`STT_FAILED`、`SPEAKER_RESPONSE_NOT_DETECTED` 虽保留模板，当前 Speaker 主流程不单独发送这两类消息，相关失败仍写入报告。

## 消息内容与结果口径

公共字段：标题、等级、设备类型、测试环境、批次 ID、触发节点、发生时间及非空事件详情。缺失值使用 `/`。当前正文不会自动附加所有服务/APP版本；只有显式请求 `includeModelInfo` 时附加模型信息，不能把旧版“完整环境信息必带”的设计当作现状。

用例结果为 INFO，具体是否通过看详情；TEST_COMPLETED 表示流程执行结束，不代表所有尝试均成功。恢复前的失败尝试保留，汇总数可能大于去重后的用例数。

AI玩具事件以异步方式发送，发送失败或抛错记录 `ai_toy.notification.failed`，不拖慢收音、播放或恢复。公共发送服务捕获请求错误并返回失败结果。当前未实现持久消息队列、自动重发或统一限频，不能保证断网后的补发及网络到达顺序。

## 验证与排查

- 先查页面开关，再查机器人配置是否启用及是否具备 Webhook/Token。
- 查同源代理响应与钉钉 `errcode/errmsg`，不要在反馈中粘贴完整 Token/签名 URL。
- `tests/aiToyDingTalkMessages.test.mjs` 覆盖模板与设备标识；`tests/aiToyContinuousRunner.test.mjs` 覆盖关键事件、关闭开关及发送异常；`tests/dingTalkAsrTtsSuppression.test.mjs` 覆盖旧通知抑制规则。
- 上述测试不实发群消息，实际送达仍需在已配置的群里试跑验证。

设备控制和恢复规则见[设备测试流程说明](../product/device-test-workflows.md)。
