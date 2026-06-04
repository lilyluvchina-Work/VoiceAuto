# 自主监测实施方案

## 1. 总体目标

将当前语音自助交互测试工具从“固定时间驱动流程”升级为“自主监测驱动流程”。

当前流程：

```text
固定时间唤醒 Speaker
→ 固定等待一段时间
→ 固定时间播放测试音频
→ 等待 Speaker 响应
→ 进入下一条测试用例
```

目标流程：

```text
自主监测 Speaker 是否唤醒成功
→ 自主监测测试音频是否播放成功
→ 检测 Speaker 响应内容是否播放成功
→ 生成结构化测试结果和失败原因
```

实施内容分为三大部分：

```text
第一部分：自主监测 Speaker 是否唤醒成功
第二部分：自主监测测试音频是否播放成功
第三部分：检测 Speaker 响应内容是否播放成功
```

## 2. 当前实现状态（2026-06-04）

当前工具已实现三阶段自主监测闭环：

```text
第一阶段：播放唤醒词后，通过 ADB logcat 监听 WakeupSuccess 判断 Speaker 是否唤醒成功。
第二阶段：测试音频播放时，通过 ADB ASR 标识判断 Speaker 是否识别到输入。
第三阶段：测试音频播放完成后，立即启动响应检测窗口；通过麦克风确认 Speaker 是否实际发声，并通过 ADB VAD/TTS 日志获取 Speaker 播放的回复内容。
```

已落地的关键行为：

| 能力 | 当前实现 |
|---|---|
| 唤醒后播放测试音频 | 开启自主唤醒后，检测到 Speaker 唤醒成功即播放测试音频，不再使用固定 `wakeAfterDelay` |
| 用例间隔 | 开启任一自主监测后，下一条用例直接进入下一次唤醒流程，不再等待固定 `wakeIntervalDelay` |
| ADB 重启 | 连续唤醒失败达到阈值后触发 ADB 重启，重启恢复后等待 2 分钟再重试当前用例 |
| ASR 成功判断 | 通过 `asr_status=partial/final/unidentified` 标识判断，不以文本相似度作为 ASR 成败依据 |
| 响应内容 | `speaker_response_text` 来自 ADB `tts_status` 日志，表示 Speaker 实际播放回复内容 |
| 麦克风转写 | `response_asr_text` 仅表示外部麦克风采集音频后的辅助转写，不等同于 Speaker 播放文本 |
| 测试过程记录 | 合并展示测试用例、唤醒日志、输入 ASR 日志、响应日志，并在入库时去重 |

---

# 第一部分：自主监测 Speaker 是否唤醒成功

## 1. 目标

让工具能够自动判断 Speaker 是否已被成功唤醒，而不是依赖固定等待时间。

核心流程：

```text
播放唤醒音频
→ 监测唤醒音频是否播放完成
→ 从 ADB 日志检测 WakeupSuccess
→ 判断 Speaker 是否唤醒成功
→ 如果连续 3 次唤醒失败，通过 ADB 重启 Speaker
```

---

## 2. 实施流程

### 2.1 播放唤醒音频

```text
1. 加载固定唤醒音频文件。
2. 通过本地播放器播放唤醒音频。
3. 监听播放开始事件。
4. 监听播放完成事件。
5. 监听播放异常事件。
6. 播放完成后，开始检测 WakeupSuccess。
```

成功规则：

```text
唤醒音频播放成功 =
播放器开始播放
+ 播放器正常结束播放
+ 实际播放时长正常
+ 播放过程中没有错误
```

---

### 2.2 从 ADB 日志检测 WakeupSuccess

```text
1. 启动 ADB logcat 实时监听。
2. 解析 WakeupSuccess 相关日志。
3. 设置唤醒检测超时时间，例如 3s ~ 5s。
4. 如果在超时时间内检测到 WakeupSuccess，则标记唤醒成功。
5. 如果在超时时间内没有检测到 WakeupSuccess，则标记本次唤醒失败。
```

ADB logcat 命令示例：

```bash
adb -s <device_id> logcat -v threadtime
```

可能的关键词：

```text
WakeupSuccess
WAKEUP_SUCCESS
wakeup success
onCedarWakeup
GlobalControl: onCedarWakeup
```

---

### 2.3 连续 3 次唤醒失败后重启 Speaker

```text
1. 每次没有检测到 WakeupSuccess 时，wake_fail_count + 1。
2. 如果 wake_fail_count < 3，则重新播放唤醒音频。
3. 如果 wake_fail_count = 3，则触发 ADB 重启。
4. 重启后等待 Speaker 恢复。
5. 恢复成功后，重新执行当前测试用例。
6. 如果恢复失败，则标记环境异常。
```

ADB 重启命令示例：

```bash
adb -s <device_id> reboot
adb wait-for-device
adb -s <device_id> shell getprop sys.boot_completed
```

---

## 3. 前置准备

| 项目 | 说明 |
|---|---|
| Speaker 测试设备 | 设备必须支持 ADB 连接 |
| ADB device_id | 用于指定日志监听和重启的设备 |
| 唤醒音频文件 | 固定唤醒词音频 |
| WakeupSuccess 日志样例 | 用于配置解析规则 |
| ADB 工具 | 测试电脑必须安装 ADB |
| Speaker 恢复检测方式 | `sys.boot_completed`、进程检测或唤醒探测 |
| 唤醒失败阈值 | 建议连续失败 3 次后重启 |
| 单条用例重启上限 | 建议 1 次 |
| 单轮测试重启上限 | 建议 3 次 |

---

## 4. 关键字段

| 字段 | 说明 |
|---|---|
| wake_audio_file | 唤醒音频文件 |
| wake_audio_play_status | 唤醒音频播放状态 |
| wake_audio_play_start_time | 唤醒音频播放开始时间 |
| wake_audio_play_end_time | 唤醒音频播放结束时间 |
| speaker_wake_status | Speaker 是否唤醒成功 |
| wake_event_time | WakeupSuccess 事件时间 |
| wake_fail_count | 连续唤醒失败次数 |
| adb_reboot_triggered | 是否触发 ADB 重启 |
| adb_reboot_result | ADB 重启结果 |
| fail_stage | 失败阶段 |
| fail_reason | 失败原因 |

---

## 5. 异常处理

| 异常 | 处理方式 |
|---|---|
| 唤醒音频播放失败 | 重新加载音频并重试 |
| 未检测到 WakeupSuccess | 增加 wake_fail_count |
| 连续 3 次唤醒失败 | 通过 ADB 重启 Speaker |
| ADB 重启失败 | 标记为环境失败 |
| Speaker 重启后无法恢复 | 停止当前任务或标记为 env_failed |
| ADB logcat 断开 | 重新连接 ADB logcat |

---

## 6. 验收标准

```text
1. 工具可以播放唤醒音频，并监测播放完成。
2. 工具可以从 ADB 日志检测 WakeupSuccess。
3. 工具可以自动判断唤醒成功或失败。
4. 工具可以在连续 3 次唤醒失败后通过 ADB 重启 Speaker。
5. 工具可以在重启恢复后重新执行当前测试用例。
6. 唤醒失败可以记录清晰的失败原因。
```

---

# 第二部分：自主监测测试音频是否播放成功

## 1. 目标

让工具能够自动判断电脑端测试音频是否播放成功，并进一步确认 Speaker 是否真正识别到了测试音频。

本部分包含两层判断：

```text
第一层：电脑端测试音频是否播放成功
第二层：Speaker 是否通过 ADB ASR 日志识别到测试音频
```

---

## 2. 实施流程

### 2.1 Speaker 唤醒成功后播放测试音频

```text
1. Speaker 唤醒成功后，立即进入测试音频播放。
2. 加载当前测试用例对应的测试音频。
3. 播放测试音频。
4. 监听播放开始事件。
5. 监听播放完成事件。
6. 监听播放异常事件。
7. 播放期间启动 ADB ASR 检测。
```

成功规则：

```text
测试音频播放成功 =
播放器开始播放
+ 播放器正常结束播放
+ 实际播放时长与预期时长基本一致
+ 播放过程中没有错误
```

---

### 2.2 从 ADB 日志获取 Speaker 实际 ASR 输入

```text
1. 测试音频播放前启动 ADB logcat 实时监听。
2. 通过 ASR_STATUS 标识判断 ASR 识别生命周期。
3. 命中 asr_status=partial 表示 ASR 开始或进行中。
4. 命中 asr_status=final 表示 ASR 结束，本次输入识别成功。
5. 命中 asr_status=unidentified 表示 ASR 失败，本次输入识别失败。
6. 在监听窗口中尽量提取 actual_asr_text，用于展示和诊断。
7. 将 actual_asr_text 与测试用例中的 human_audio_text 进行相似度对比，但相似度不再决定 ASR 成败。
```

ASR 标识定义：

```text
ASR_STATUS = "asr_status"
ASR_STATUS_PARTIAL = "partial"
ASR_STATUS_FINAL = "final"
ASR_STATUS_UNIDENTIFIED = "unidentified"
```

成功规则：

```text
Speaker 成功识别测试音频 =
ADB 日志中检测到 asr_status=partial
+ ADB 日志中检测到 asr_status=final
+ 未检测到 asr_status=unidentified
```

诊断规则：

```text
actual_asr_text 非空时，计算 actual_asr_text 与 human_audio_text 的相似度。
asr_similarity_threshold 默认 0.8，仅用于标记 matched / not_matched，不用于判定 ASR 是否成功。
```

---

### 2.3 输出测试音频播放和识别结果

| 结果 | 说明 |
|---|---|
| 播放成功且 ASR 标识闭环成功 | 输入链路通过 |
| 播放成功但 ASR 未检测到 final | Speaker 未完成输入识别 |
| 播放成功但 ASR 命中 unidentified | Speaker 输入识别失败 |
| 播放成功但 ASR 文本不匹配 | 仅记录为诊断信息 |
| 播放失败 | 电脑端测试音频播放失败 |

---

## 3. 前置准备

| 项目 | 说明 |
|---|---|
| 测试用例文件 | 包含用例 ID、标题、Human 文本和目标 Agent |
| 测试音频文件 | 每条测试用例应有对应音频文件 |
| 音频映射关系 | `case_id ↔ test_audio_file` |
| Human 音频文本 | 用于与 ADB ASR 文本对比 |
| ADB ASR 日志样例 | 用于提取 actual_asr_text |
| ASR 解析规则 | 正则或关键词规则 |
| 播放器事件监听 | playing / ended / error |
| ASR 相似度算法 | 文本相似度、编辑距离或语义相似度 |
| 目标 Agent 字段 | 从导入的测试计划用例详情中获取 |

---

## 4. 关键字段

| 字段 | 说明 |
|---|---|
| case_id | 测试用例 ID |
| case_title | 测试用例标题 |
| human_audio_text | 测试音频文本 |
| target_agent | 目标 Agent |
| test_audio_file | 测试音频文件 |
| test_audio_play_status | 测试音频播放状态 |
| test_audio_play_start_time | 测试音频播放开始时间 |
| test_audio_play_end_time | 测试音频播放结束时间 |
| test_audio_actual_duration | 实际播放时长 |
| test_audio_expected_duration | 预期播放时长 |
| actual_asr_text | 从 ADB 日志识别到的实际文本 |
| asr_match_result | ASR 文本是否匹配 Human 文本 |
| asr_similarity | 相似度分数 |
| asr_status | ADB ASR 标识状态 |
| asr_start_matched_keyword | ASR 开始标识命中规则 |
| asr_end_matched_keyword | ASR 结束标识命中规则 |
| asr_failure_matched_keyword | ASR 失败标识命中规则 |
| asr_fail_reason | ASR 失败原因 |

---

## 5. 异常处理

| 异常 | 处理方式 |
|---|---|
| 测试音频文件不存在 | 标记当前用例失败，失败阶段：TEST_AUDIO_FILE |
| 测试音频播放失败 | 重新加载音频并重试 |
| 播放器异常 | 重新初始化播放器 |
| 播放成功但没有找到 ADB ASR final 标识 | 失败阶段：ADB_ASR |
| ADB ASR 命中 unidentified 标识 | 失败阶段：ADB_ASR |
| ADB ASR 与 Human 文本不匹配 | 不作为失败阶段，仅记录诊断 |
| ADB 日志延迟 | 增加短轮询或等待窗口 |
| 存在多条 ASR 日志 | 按时间窗口和文本相似度选择最佳匹配 |

---

## 6. 验收标准

```text
1. 工具可以为每条用例播放对应测试音频。
2. 工具可以监测测试音频播放开始、完成和失败。
3. 工具可以从 ADB 日志获取 ASR_STATUS 标识和 actual_asr_text。
4. 工具可以将 actual_asr_text 与 human_audio_text 对齐。
5. 工具可以通过 ASR_STATUS 判断 Speaker 是否真正识别测试输入。
6. 工具可以区分播放失败和识别失败。
7. 工具可以输出输入链路测试结果。
```

---

# 第三部分：检测 Speaker 响应内容是否播放成功

## 1. 目标

自动检测 Speaker 是否真正播放了响应内容，并获取 Speaker 实际播放的回复文本。

核心逻辑：

```text
测试音频播放完成
→ Speaker 返回响应
→ 立即进入 speaker_response_window
→ 外部麦克风采集 Speaker 响应音频，确认是否实际发声
→ ADB 日志通过 VAD_STATUS 检测响应开始和结束
→ ADB 日志通过 TTS_STATUS 获取 Speaker 播放文本
→ 保存响应音频文件
→ 对响应音频执行麦克风 ASR，作为辅助转写
→ 输出 Speaker 响应检测结果
```

---

## 2. 实施流程

### 2.1 进入 Speaker 响应检测窗口

```text
1. 测试音频播放完成后，进入 speaker_response_window。
2. 通过外部麦克风开始监听。
3. 只有 speaker_response_window 内采集到的音频才作为 Speaker 响应。
4. 电脑端播放测试音频期间采集到的声音，不能作为 Speaker 响应。
```

窗口规则：

| 窗口 | 说明 | 是否作为 Speaker 响应 |
|---|---|---|
| wake_input_window | 电脑播放唤醒音频 | 否 |
| test_input_window | 电脑播放测试音频 | 否 |
| speaker_response_window | 测试音频播放完成后 | 是 |
| response_silence_window | 响应结束后的静音确认窗口 | 用于确认响应结束 |

---

### 2.2 通过外部麦克风采集 Speaker 响应音频

```text
1. 选择外部麦克风设备。
2. 获取麦克风权限。
3. 检测音频能量是否超过噪声阈值。
4. 检测到有效音频后标记 Speaker 响应开始。
5. 开始录制响应音频。
6. 持续检测音频能量。
7. 确认稳定静音 800ms ~ 1500ms。
8. 保存 response_audio_file。
```

成功规则：

```text
Speaker 响应音频采集成功 =
检测到有效音频
+ 音频出现在 speaker_response_window 内
+ 音频时长大于最小时长
+ 稳定静音确认响应结束
```

---

### 2.3 通过 ADB VAD/TTS 日志检测 Speaker 响应

```text
1. 测试音频播放完成后，启动 ADB logcat 响应监听。
2. 检测 vad_status=start，标记 Speaker 响应播放开始。
3. 检测 vad_status=stop，标记 Speaker 响应播放结束。
4. 检测 tts_status，提取 speaker_response_text。
5. 输出响应检测结果。
```

响应相关标识定义：

```text
VAD_STATUS = "vad_status"
TTS_STATUS = "tts_status"

VAD_STATUS_START = "start"
VAD_STATUS_STOP = "stop"
```

成功规则：

```text
响应内容播放成功 =
采集到 Speaker 响应音频
+ ADB 日志中检测到 vad_status=start
+ ADB 日志中检测到 vad_status=stop
+ ADB 日志中从 tts_status 提取到 speaker_response_text
```

---

### 2.4 对响应音频执行麦克风 ASR（辅助）

当前实现会对麦克风采集到的响应音频尝试执行浏览器端 ASR，用于辅助排查：

```text
1. 浏览器通过 Web Speech Recognition 对麦克风采集到的响应音频进行转写。
2. 获取 response_asr_text。
3. response_asr_text 用于辅助确认麦克风确实采集到 Speaker 响应。
4. response_asr_text 不等同于 Speaker 实际播放文本。
```

字段含义区分：

| 字段 | 含义 |
|---|---|
| speaker_response_text | 从 ADB `tts_status` 日志提取的 Speaker 实际播放回复内容 |
| response_asr_text | 外部麦克风采集音频后的辅助 ASR 转写 |

---

## 3. 前置准备

| 项目 | 说明 |
|---|---|
| 外部麦克风 | 用于采集 Speaker 响应音频 |
| 麦克风设备选择 | 能够选择正确输入设备 |
| 麦克风权限 | 浏览器 / 系统权限 |
| 安静测试环境 | 降低背景噪声 |
| VAD 能力 | 检测响应开始和结束 |
| 响应音频保存路径 | 保存 response_audio_file |
| ADB VAD 日志 | 需要输出 `vad_status=start/stop` |
| ADB TTS 日志 | 需要输出 `tts_status`，并包含可提取的播放文本 |
| 响应音频 ASR 能力 | 可选；当前使用浏览器 Web Speech Recognition 作为辅助转写 |
| 音量阈值配置 | 区分噪声和有效响应 |
| 静音确认时长 | 建议 800ms ~ 1500ms |

---

## 4. 关键字段

| 字段 | 说明 |
|---|---|
| response_detect_start_time | Speaker 响应检测开始时间 |
| response_detect_end_time | Speaker 响应检测结束时间 |
| response_audio_detected | 是否检测到 Speaker 响应音频 |
| response_audio_file | 响应音频文件 |
| response_audio_start_time | 响应音频开始时间 |
| response_audio_end_time | 响应音频结束时间 |
| response_audio_duration | 响应音频时长 |
| response_asr_status | 麦克风响应音频辅助 ASR 状态 |
| response_asr_text | 麦克风响应音频辅助 ASR 转写文本 |
| speaker_response_text | 从 ADB `tts_status` 提取的 Speaker 实际播放回复内容 |
| response_tts_status | ADB 响应日志检测状态 |
| response_vad_started | 是否检测到 `vad_status=start` |
| response_vad_ended | 是否检测到 `vad_status=stop` |
| speaker_output_status | Speaker 是否实际发声 |
| response_fail_reason | 响应失败原因 |

---

## 5. 异常处理

| 异常 | 处理方式 |
|---|---|
| 未检测到 Speaker 响应音频 | 失败阶段：SPEAKER_OUTPUT |
| 检测到音频但时长过短 | 标记为疑似噪声或无效响应 |
| 响应音频录制失败 | 失败阶段：RESPONSE_AUDIO_RECORD |
| 未检测到 VAD 开始或结束 | 失败阶段：SPEAKER_OUTPUT |
| 未从 TTS_STATUS 提取到 Speaker 播放文本 | 失败阶段：SPEAKER_OUTPUT |
| 响应音频 ASR 失败 | 记录为辅助转写失败，不单独判定 Speaker 响应失败 |
| 响应 ASR 文本为空 | 记录为辅助转写为空，不单独判定 Speaker 响应失败 |
| 误采集到电脑声音 | 按窗口规则过滤，不作为响应 |
| 背景噪声过高 | 提高阈值或标记环境异常 |
| 下一条用例在响应结束前开始 | 必须等待 VAD 静音确认 |

---

## 6. 验收标准

```text
1. 工具可以选择外部麦克风。
2. 电脑端测试音频播放不会被误判为 Speaker 响应。
3. 工具可以检测 Speaker 响应音频开始。
4. 工具可以检测 Speaker 响应音频结束。
5. 工具可以保存 response_audio_file。
6. 工具可以监听 ADB `vad_status=start/stop`。
7. 工具可以监听 ADB `tts_status` 并输出 speaker_response_text。
8. 工具可以对响应音频执行辅助 ASR，并输出 response_asr_text。
9. 工具可以判断响应内容是否播放成功。
10. 工具可以将响应失败归因到具体阶段。
```

---

# 三个部分之间的总体流程

```text
第一部分：自主监测 Speaker 是否唤醒成功
  ↓
唤醒成功后，进入第二部分

第二部分：自主监测测试音频是否播放成功
  ↓
测试音频播放成功且 ADB ASR 匹配后，进入第三部分

第三部分：检测响应内容是否播放成功
  ↓
采集 Speaker 响应音频
  ↓
监听 ADB VAD/TTS 日志
  ↓
提取 Speaker 实际播放回复内容
  ↓
生成最终测试用例结果
```

完整流程：

```text
播放唤醒音频
→ 检测 WakeupSuccess
→ 连续 3 次唤醒失败后通过 ADB 重启 Speaker
→ 唤醒成功后播放测试音频
→ 监测测试音频播放完成
→ 从 ADB 日志获取实际 ASR 输入
→ 通过 ASR_STATUS 判断输入识别是否完成
→ 通过外部麦克风采集 Speaker 响应音频
→ 通过 ADB VAD_STATUS 判断响应开始和结束
→ 通过 ADB TTS_STATUS 提取 Speaker 实际播放文本
→ 判断响应是否播放成功
→ 输出测试用例结果
```

---

# 测试过程记录

当前测试过程记录页面已合并展示测试用例和自主监测过程日志。

## 1. 展示内容

| 链路 | 展示内容 |
|---|---|
| 用例结果 | 用例 ID、目标文本、成功状态、失败阶段、失败原因 |
| 唤醒链路 | 唤醒音频播放、WakeupSuccess 检测、ADB 重启和恢复等待 |
| 输入链路 | 测试音频播放、ASR_STATUS 开始/结束/失败标识、actual_asr_text |
| 响应链路 | 麦克风响应音频检测、VAD_STATUS 开始/结束、TTS_STATUS 播放文本 |

## 2. 文本字段区分

| 字段 | 展示名称 | 来源 |
|---|---|---|
| targetText / humanAudioText | 测试音频文本 | 测试用例 |
| actualAsrText | 获取到的 ASR 文本 | ADB ASR_STATUS 识别输入 |
| responseAsrText | 麦克风转写响应文本 | 外部麦克风采集后浏览器 ASR 辅助转写 |
| speakerResponseText | Speaker 播放响应文本 | ADB TTS_STATUS 日志 |

## 3. 日志去重

过程日志写入全局状态时会生成内容指纹并去重。去重时忽略 `id`、`time`、`raw`、`sampleLines` 等易变化字段，保留不同用例、不同阶段、不同文本内容的日志。

---

# 建议排期

| 模块 | 建议周期 | 优先级 |
|---|---:|---|
| 第一部分：自主监测 Speaker 唤醒成功 | 2 ~ 3 天 | 最高 |
| 第二部分：自主监测测试音频播放成功 | 2 ~ 3 天 | 最高 |
| 第三部分：检测响应内容播放成功 | 3 ~ 5 天 | 最高 |
| 报告字段和失败归因整合 | 1 ~ 2 天 | 高 |
| 联调和稳定性验证 | 2 ~ 3 天 | 高 |

---

# 最小发布范围

## V1：输入链路闭环

包含：

```text
第一部分 + 第二部分
```

能力：

```text
可以检测唤醒成功
+ 可以在 3 次唤醒失败后通过 ADB 重启 Speaker
+ 可以检测测试音频播放成功
+ 可以获取 Speaker 实际 ASR 输入
+ 可以对比 Human 文本与 ASR 文本
```

此阶段输出链路字段应标记为：

```text
speaker_output_status = unverified
response_asr_status = unverified
speaker_response_text = unverified
```

---

## V2：完整主链路闭环

包含：

```text
第一部分 + 第二部分 + 第三部分
```

能力：

```text
可以检测唤醒成功
+ 可以检测测试音频播放成功
+ 可以检测 Speaker 响应内容播放成功
+ 可以采集响应音频
+ 可以通过 ADB TTS_STATUS 获取 Speaker 实际播放回复文本
+ 可以通过麦克风 ASR 辅助转写响应音频
+ 可以生成完整结果
```

---

# 最终结论

实施方案应围绕三部分展开：

```text
第一部分：自主监测 Speaker 是否唤醒成功
第二部分：自主监测测试音频是否播放成功
第三部分：检测 Speaker 响应内容是否播放成功
```

核心技术拆分为：

```text
第一部分使用 ADB WakeupSuccess。
第二部分使用本地播放器事件 + ADB ASR_STATUS。
第三部分使用外部麦克风采集 + ADB VAD_STATUS + ADB TTS_STATUS。
```

该结构可以保持开发边界清晰，使每个部分都能独立测试，并支持分阶段交付。
