# 测试音频存储与重生成方案

## 1. 背景

当前工具需要支持将合成出来的测试音频保存起来，并允许用户后续进行播放、删除和重新生成。测试音频属于业务可管理资源，但其本体是媒体文件，因此需要同时考虑数据库性能、文件管理、生成失败回滚和后续扩展能力。

## 2. 目标

- 支持生成测试音频并播放。
- 支持用户手动保存单条或全部测试音频。
- 当前实现中，生成测试音频不自动保存；只有点击“保存音频”或“全部保存音频”后才导出文件。
- 支持查询测试音频列表和详情。
- 支持播放或下载测试音频。
- 支持删除测试音频。
- 支持按原参数或新参数重新生成测试音频。
- 保存合成文本、音色、语速、音量、格式等生成参数，方便追溯和重生成。
- 生成失败时不影响已有可用音频。

## 2.1 当前实现说明

当前前端交互采用“生成临时音频 + 手动导出”的方式：

1. 用户点击“生成测试音频”。
2. 前端调用 `/api/tts/doubao-v3`，后端代理豆包 TTS 并返回音频流。
3. 浏览器将音频流转为临时 `Blob URL`，用于当前页面播放。
4. 系统不自动写入 `storage/test-audios/`，也不自动创建 `test_audio` 持久化记录。
5. 用户点击单条“保存音频”时，浏览器将当前临时音频导出为文件。
6. 用户点击“全部保存音频”时，系统按功能目录批量导出：
   - Chrome / Edge：使用目录选择能力，直接在用户选择的目录下按功能目录创建子文件夹。
   - Firefox / Safari：使用标准下载能力，导出一个按功能目录组织的 `.zip` 文件。

临时音频只在当前页面会话内有效。刷新页面后，`Blob URL` 会失效，系统不会继续展示为已生成音频，用户需要重新生成。

## 3. 推荐方案

服务端持久化能力推荐采用“数据库存元数据 + 存储层保存音频文件”的方案。

说明：当前用户交互默认不自动保存生成音频；以下方案作为后续需要服务端统一管理音频资产时的持久化设计保留。

数据库负责保存：

- 音频名称
- 合成文本
- 音色、语速、音调、音量等参数
- 音频格式、采样率、时长、文件大小
- 文件路径或访问地址
- 当前状态
- 错误信息
- 创建时间、更新时间、删除时间

存储层负责保存：

- 实际生成的 mp3、wav 等音频文件

在当前工具早期阶段，可以先将音频文件保存到本地目录，例如：

```text
storage/test-audios/
```

后续如果系统需要多人使用、服务端部署或音频量变大，可以平滑迁移到对象存储，例如 MinIO、阿里云 OSS、腾讯云 COS 或 AWS S3。

## 4. 不推荐直接将音频二进制存入数据库

除非测试音频数量很少、文件很小，并且明确希望通过一个数据库完成完整备份，否则不建议将音频二进制直接存入数据库字段。

直接使用 BLOB 存储音频的主要问题：

- 数据库体积增长快。
- 备份和恢复成本变高。
- 列表查询容易受到大字段影响。
- 音频播放、缓存和下载不如文件存储自然。
- 后续迁移对象存储成本更高。

因此默认方案应将音频文件放在文件系统或对象存储中，数据库只保存引用和业务元数据。

## 5. 数据库设计

建议新增测试音频主表：`test_audio`。

```sql
CREATE TABLE test_audio (
    id BIGINT PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    text_content TEXT NOT NULL,
    voice_code VARCHAR(64),
    language VARCHAR(32),
    speed DECIMAL(4, 2),
    pitch DECIMAL(4, 2),
    volume DECIMAL(4, 2),
    audio_format VARCHAR(16),
    sample_rate INT,
    duration_ms INT,
    file_url VARCHAR(512),
    file_path VARCHAR(512),
    file_size BIGINT,
    file_hash VARCHAR(128),
    status VARCHAR(32) NOT NULL,
    error_message TEXT,
    generation_params JSON,
    created_by BIGINT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    deleted_at DATETIME
);
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `id` | 测试音频唯一 ID |
| `name` | 测试音频名称 |
| `text_content` | 合成文本 |
| `voice_code` | 音色或发音人编码 |
| `language` | 语言，例如 `zh-CN` |
| `speed` | 语速 |
| `pitch` | 音调 |
| `volume` | 音量 |
| `audio_format` | 音频格式，例如 `mp3`、`wav` |
| `sample_rate` | 采样率 |
| `duration_ms` | 音频时长，单位毫秒 |
| `file_url` | 播放或下载地址 |
| `file_path` | 内部存储路径 |
| `file_size` | 文件大小 |
| `file_hash` | 文件哈希，用于校验或去重 |
| `status` | 状态：`generating`、`success`、`failed`、`deleted` |
| `error_message` | 生成失败原因 |
| `generation_params` | 完整生成参数快照 |
| `created_by` | 创建人 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |
| `deleted_at` | 删除时间 |

如果需要保留每一次重生成历史，建议增加生成记录表：`test_audio_generation_record`。

```sql
CREATE TABLE test_audio_generation_record (
    id BIGINT PRIMARY KEY,
    test_audio_id BIGINT NOT NULL,
    old_file_path VARCHAR(512),
    new_file_path VARCHAR(512),
    params JSON,
    status VARCHAR(32) NOT NULL,
    error_message TEXT,
    created_at DATETIME NOT NULL
);
```

## 6. 接口设计

### 6.1 生成测试音频

当前前端默认生成临时音频，不调用本接口自动持久化。服务端持久化场景可使用以下接口。

```http
POST /api/test-audios
```

请求示例：

```json
{
  "name": "欢迎语测试",
  "textContent": "您好，请问有什么可以帮您？",
  "voiceCode": "xiaoxiao",
  "language": "zh-CN",
  "speed": 1.0,
  "pitch": 1.0,
  "volume": 1.0,
  "audioFormat": "mp3"
}
```

处理逻辑：

1. 创建测试音频记录，状态为 `generating`。
2. 调用 TTS 合成服务。
3. 将音频文件保存到存储层。
4. 计算文件大小、时长和哈希。
5. 更新数据库记录为 `success`。
6. 返回音频 ID 和播放地址。

### 6.1.1 当前临时生成接口

```http
POST /api/tts/doubao-v3
```

请求示例：

```json
{
  "text": "您好，请问有什么可以帮您？",
  "voiceType": "zh_female_vv_uranus_bigtts",
  "lang": "zh-CN",
  "rate": 1.0,
  "volume": 100
}
```

处理逻辑：

1. 校验登录态。
2. 读取豆包 TTS 配置。
3. 调用豆包 V3 TTS。
4. 返回音频流给浏览器。
5. 浏览器生成临时 `Blob URL`，用于播放和手动保存。

该接口不写数据库、不保存物理音频文件。

### 6.2 查询测试音频列表

```http
GET /api/test-audios
```

默认只返回未删除数据，即 `deleted_at IS NULL` 且 `status != 'deleted'`。

### 6.3 查询测试音频详情

```http
GET /api/test-audios/{id}
```

返回音频详情、生成参数、状态和播放地址。

### 6.4 播放测试音频

```http
GET /api/test-audios/{id}/play
```

可以直接返回音频流，也可以重定向到 `file_url`。

### 6.5 删除测试音频

```http
DELETE /api/test-audios/{id}
```

处理逻辑：

1. 校验测试音频是否存在。
2. 如果音频已被业务流程引用，需要阻止删除或提示用户。
3. 将记录状态更新为 `deleted`。
4. 写入 `deleted_at`。
5. 删除物理文件，或交给异步任务清理。

建议默认采用软删除，避免误删后无法追溯。

### 6.6 重新生成测试音频

```http
POST /api/test-audios/{id}/regenerate
```

按原参数重新生成：

```json
{
  "mode": "use_original_params"
}
```

按新参数重新生成：

```json
{
  "mode": "override_params",
  "textContent": "新的测试文本",
  "voiceCode": "xiaoyi",
  "speed": 1.1
}
```

处理逻辑：

1. 读取原测试音频记录。
2. 合并原参数或新参数。
3. 调用 TTS 服务生成新音频。
4. 新音频保存成功后，再替换数据库中的文件路径、播放地址、时长、大小和哈希。
5. 记录重生成历史。
6. 如果新音频生成失败，保留原音频不变，并记录错误信息。

## 7. 状态流转

```text
generating -> success
generating -> failed
success -> generating -> success
success -> generating -> failed
success -> deleted
failed -> generating
failed -> deleted
```

关键原则：

- 生成中状态用于前端展示等待或轮询。
- 重生成失败时不能覆盖原有可用音频。
- 删除后默认不在列表中展示。

## 8. 文件存储策略

服务端持久化文件建议命名规则：

```text
storage/test-audios/{yyyy}/{MM}/{dd}/{audioId}_{timestamp}.{format}
```

示例：

```text
storage/test-audios/2026/07/29/10001_1785321000000.mp3
```

这样可以避免单目录文件过多，也方便按日期排查问题。

当前手动导出文件策略：

- 单条保存：默认文件名取用例标题或测试文本，非法文件名字符会替换为 `_`。
- 全部保存：按功能目录分组。
- Chrome / Edge：写入用户选择的目录，例如：

```text
选择的目录/
  音乐控制/
    播放音乐.mp3
  家居控制/
    打开客厅灯.mp3
```

- Firefox / Safari：下载 `.zip`，压缩包内部保持同样目录结构。

## 9. 异常处理

需要重点处理以下异常：

- TTS 服务调用失败。
- TTS 服务超时。
- 文件保存失败。
- 文件保存成功但数据库更新失败。
- 数据库成功但文件不存在。
- 删除时文件已不存在。
- 重生成过程中用户重复点击。

建议对生成和重生成操作增加幂等或锁机制，避免同一条音频被并发重生成。

## 10. 前端交互建议

测试音频列表建议展示：

- 名称
- 合成文本摘要
- 音色
- 时长
- 格式
- 状态
- 创建时间
- 操作按钮：播放、重新生成、删除
- 操作按钮：生成测试音频、播放、保存音频、重新生成、删除
- 顶部批量操作：全部生成测试音频、全部保存音频

生成弹窗建议包含：

- 音频名称
- 合成文本
- 音色选择
- 语速
- 音调
- 音量
- 音频格式
- 生成按钮

重生成时建议提供：

- 使用原参数重新生成
- 修改参数后重新生成

保存交互：

- 单条“保存音频”只保存当前用例的已生成临时音频。
- “全部保存音频”只保存当前页面状态中仍有效的已生成音频。
- 当没有可保存音频时，保存按钮置灰。
- 刷新页面后临时音频失效，需要重新生成。

## 11. 开发拆分

建议按以下顺序实现：

1. 新增数据库表 `test_audio`。
2. 可选新增 `test_audio_generation_record`。
3. 封装音频存储服务。
4. 封装 TTS 合成服务。
5. 实现生成测试音频接口。
6. 实现列表、详情和播放接口。
7. 实现删除接口。
8. 实现重新生成接口。
9. 增加前端管理页面。
10. 增加失败提示、加载状态和防重复提交。
11. 增加定时清理任务，清理软删除文件或孤儿文件。

## 12. 结论

结合当前工具的需求，当前交互采用：

```text
生成测试音频时只保留浏览器临时音频；用户手动保存时再导出文件。
```

如果后续需要多人共享、审计、服务端统一管理或跨会话复用音频，推荐升级为：

```text
数据库保存测试音频元数据和生成参数，音频文件保存到文件系统或对象存储。
```

该持久化方案兼顾实现成本、性能、可维护性和后续扩展能力。服务端存储可以先使用本地文件系统，等系统部署规模扩大后，再迁移到对象存储。
