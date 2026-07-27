# 豆包 V3 TTS 多音色与多语言接入方案

## 1. 目标

为 VoiceAuto 接入豆包 V3 语音合成能力，使测试音频支持豆包可用音色，并且把鉴权信息保留在后端，避免密钥暴露到浏览器。

当前 VoiceAuto 的播放方式是“一条测试文本生成一段音频并播放”，因此首选接入 V3 HTTP 单向流式接口：

```text
https://openspeech.bytedance.com/api/v3/tts/unidirectional
```

暂不建议优先接 WebSocket 双向流式接口。WebSocket 双向流式更适合实时对话场景，而 VoiceAuto 当前测试链路更适合 HTTP 流式合成。

## 2. 当前项目现状

VoiceAuto 已经具备 TTS 播放框架和豆包 TTS 配置雏形。

- `src/services/ttsService.jsx`
  - 当前已支持豆包优先、Web Speech API 回退。
  - 现在会把 `xiaoxiao`、`yunxi` 等前端短值映射为豆包 `voice_type`。
- `src/constants/index.js`
  - 当前只维护 `seed-tts-2.0` Resource ID 下真实验证通过的固定音色。
- `src/components/VoiceConfig.jsx`
  - 当前提供音色、语种、音量、倍速配置。
- `src/utils/audioHelpers.js`
  - 文件音频直接播放，TTS 音频调用 `ttsService.speak()`。
- `src/modules/config/secureConfigStore.js`
  - 当前用于保存敏感配置。
- `src/components/ConfigCenter.jsx`
  - 当前已有豆包 TTS 配置入口。

主要缺口：

```text
已接入后端 V3 代理接口；
已保存真实豆包 V3 speaker ID；
已将鉴权信息保留在后端；
音色列表已按当前 Resource ID 收敛，避免资源不匹配。
```

## 3. 推荐架构

建议使用后端代理接入豆包 V3。

整体链路如下：

```text
VoiceConfig
  -> defaultVoiceConfig
  -> AudioImporter / WakeWordConfig
  -> ttsService.speak()
  -> /api/tts/doubao-v3
  -> 豆包 V3 HTTP API
  -> mp3 Blob
  -> playBlob()
```

不要让浏览器直接请求豆包 V3。当前项目由后端读取配置中心中的 APP ID、Access Token、Secret Key 和 Resource ID，再代理调用豆包接口。

## 4. 接入前准备工作

在火山引擎新版控制台完成以下准备。

### 4.1 登录控制台

打开豆包语音控制台：

```text
https://console.volcengine.com/speech
```

### 4.2 选择项目

新版控制台按项目隔离资源。先确认当前项目是否正确，可以使用默认项目，也可以新建一个专门用于 VoiceAuto 的项目。

### 4.3 开通服务

进入左侧菜单的 `开通管理`，开通需要的语音服务。

普通多音色 TTS 建议开通：

```text
豆包语音合成模型 2.0
```

如果需要接入声音复刻音色，还需要开通：

```text
豆包声音复刻模型 2.0
```

### 4.4 获取认证信息

当前 VoiceAuto 的豆包 V3 后端代理使用以下认证信息：

```text
APP ID
Access Token
Secret Key
```

### 4.5 确认 Resource ID

标准 TTS 2.0 可先使用：

```text
seed-tts-2.0
```

如果接声音复刻 2.0，需要在对应服务页面确认实际 Resource ID，不要直接套用标准 TTS 的值。

注意：音色 ID 必须和 Resource ID 匹配。若豆包返回 `resource ID is mismatched with speaker related resource`，说明当前音色不属于配置中心保存的 Resource ID。

### 4.6 获取音色 ID

进入 `音色库` 或 `音色管理`，为每个需要接入的音色记录：

```text
展示名称
Speaker ID / 音色 ID
语言
性别
适用场景
是否已授权
```

VoiceAuto 中的 V3 `speaker` 字段应使用这里拿到的音色 ID。

### 4.7 确认额度和权限

接入前确认以下信息：

```text
服务是否已开通；
音色是否已授权；
APP ID / Access Token / Secret Key 是否可用；
Resource ID 是否正确；
是否有可用额度；
是否有并发限制；
是否已完成实名认证或企业认证；
是否涉及正式计费。
```

## 5. 配置设计

建议扩展现有 `doubaoTts` 配置，增加 V3 字段，同时保留 V1 字段兼容旧逻辑。

推荐配置结构：

```js
{
  provider: 'doubao',
  apiVersion: 'v3',
  v3Url: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
  apiKeyId: '',       // APP ID
  apiKeySecret: '',   // Access Token
  secretKey: '',
  resourceId: 'seed-tts-2.0',
  defaultVoiceType: 'zh_female_shuangkuaisisi_moon_bigtts',
  uid: 'voiceauto-web',
  sampleRate: 24000,
  enabled: true
}
```

保留旧字段：

```js
{
  url: 'https://openspeech.bytedance.com/api/v1/tts',
  appId: '',
  accessToken: '',
  cluster: 'volcano_tts'
}
```

涉及文件：

```text
src/modules/config/secureConfigStore.js
src/components/ConfigCenter.jsx
server/configRepository.js
tests/defaultSensitiveConfig.test.mjs
```

## 6. 音色与语言设计

### 6.1 音色列表

当前音色配置类似：

```js
{ value: 'xiaoxiao', label: '晓晓（女声）' }
```

建议改为直接保存豆包真实音色 ID：

```js
{
  value: 'zh_female_shuangkuaisisi_moon_bigtts',
  voiceType: 'zh_female_shuangkuaisisi_moon_bigtts',
  label: '爽快思思（中文女声）',
  lang: 'zh-CN',
  gender: 'female',
  provider: 'doubao-v3'
}
```

当前 `seed-tts-2.0` 已验证可播放音色：

```text
VV（中文女声） -> zh_female_vv_uranus_bigtts
小何 2.0（中文女声） -> zh_female_xiaohe_uranus_bigtts
柔美月声（中文女声） -> zh_female_roumei_moon_bigtts
湾湾小荷（中文女声） -> zh_female_wanwanxiaohe_moon_bigtts
清新女声 2.0（中文女声） -> zh_female_qingxinnvsheng_uranus_bigtts
清爽京声（中文男声） -> zh_male_qingshuangjingshen_moon_bigtts
云舟 2.0（中文男声） -> zh_male_m191_uranus_bigtts
小天 2.0（中文男声） -> zh_male_taocheng_uranus_bigtts
刘飞 2.0（中文男声） -> zh_male_liufei_uranus_bigtts
Vivi 2.0（多语种兼容） -> zh_female_vv_uranus_bigtts
```

注意：`mars`、`emo_v2_mars`、部分 `moon` 音色在当前配置下可能不属于 `seed-tts-2.0`，不要直接加入可用列表。新增音色前必须先用当前 Resource ID 真实请求验证。

### 6.2 语言列表

建议扩展语言列表：

```js
export const LANG_OPTIONS = [
  { value: 'zh-CN', label: '中文（普通话）' },
  { value: 'zh-HK', label: '粤语' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'multi', label: '多语言' }
];
```

### 6.3 多语言规则

豆包 V3 的多语言能力主要取决于所选音色，而不是单纯依赖前端 `lang` 字段。

推荐规则：

```text
音色语言与选择语言一致：正常播放；
音色语言为 multi：正常播放；
音色语言与选择语言不一致：允许播放，但给出提示；
豆包返回语言不支持错误：自动回退 Web Speech。
```

提示示例：

```text
当前音色主要适用于中文，英文测试可能效果不稳定。
当前音色主要适用于英文，中文测试可能效果不稳定。
```

## 7. 前端改造方案

### 7.1 修改 `src/constants/index.js`

改造内容：

```text
扩展 VOICE_OPTIONS；
为每个音色增加 voiceType、lang、provider 字段；
扩展 LANG_OPTIONS；
保留必要的旧音色映射兼容逻辑。
```

### 7.2 修改 `src/components/VoiceConfig.jsx`

音色变化时保存完整配置：

```js
dispatch(actions.setVoiceConfig({
  voice: selected.value,
  voiceType: selected.voiceType || selected.value,
  voiceName: selected.label,
  lang: selected.lang || defaultVoiceConfig.lang,
  provider: selected.provider || 'doubao-v3'
}));
```

可选优化：

```text
只展示当前 Resource ID 下验证通过的音色；
音色下拉平铺展示，不再按中文、英文、多语言分组；
如需混用其他资源音色，需改造为每个音色绑定独立 resourceId。
```

### 7.3 修改 `src/services/ttsService.jsx`

新增 V3 配置解析：

```js
{
  apiVersion,
  v3Url,
  apiKeyId,
  apiKeySecret,
  secretKey,
  resourceId,
  defaultVoiceType,
  uid,
  sampleRate
}
```

音色解析优先级：

```js
buildDoubaoVoiceType(config) {
  return (
    config.voiceType
    || config.voice
    || config.voiceName
    || this.doubaoConfig.defaultVoiceType
  );
}
```

新增 V3 播放方法：

```js
async speakWithDoubaoV3(text, config = {}) {
  const voiceType = this.buildDoubaoVoiceType(config);

  const response = await fetch('/api/tts/doubao-v3', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      voiceType,
      lang: config.lang,
      rate: config.rate,
      volume: config.volume
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `豆包 V3 TTS 请求失败：${response.status}`);
  }

  const blob = await response.blob();
  await this.playBlob(blob, config);
}
```

调用优先级：

```js
if (this.provider === 'doubao' && this.doubaoConfig.apiVersion === 'v3') {
  await this.speakWithDoubaoV3(text, config);
  return;
}
```

继续保留现有 Web Speech 回退逻辑。

## 8. 后端改造方案

### 8.1 新增接口

在 `server/app.js` 增加：

```text
POST /api/tts/doubao-v3
```

前端请求体：

```js
{
  text: string,
  voiceType: string,
  lang?: string,
  rate?: number,
  volume?: number
}
```

后端响应：

```text
Content-Type: audio/mpeg
```

### 8.2 调用豆包 V3

当前后端请求头：

```js
{
  'X-Api-App-Id': apiKeyId,
  'X-Api-Access-Key': apiKeySecret,
  'X-Api-Resource-Id': resourceId,
  'X-Api-Request-Id': requestId,
  'Content-Type': 'application/json',
  'Connection': 'keep-alive'
}
```

请求体：

```js
{
  user: {
    uid
  },
  req_params: {
    text,
    speaker: voiceType,
    audio_params: {
      format: 'mp3',
      sample_rate: sampleRate
    },
    speed_ratio: Math.max(0.5, Math.min(2, rate || 1)),
    volume_ratio: Math.max(0.1, Math.min(2, (volume || 100) / 100))
  }
}
```

### 8.3 流式响应处理

后端需要处理 V3 返回的流式响应：

```text
读取响应流；
解析每段 JSON 或流式数据；
提取 base64 音频片段；
将 base64 解码为 Buffer；
拼接所有 Buffer；
返回最终 mp3。
```

建议记录这些响应头，方便排障：

```text
X-Tt-Logid
X-Api-Status-Code
X-Api-Message
```

不要打印 APP ID、Access Token、Secret Key。

## 9. 错误处理

需要明确处理以下异常：

```text
APP ID 或 Access Token 未配置；
APP ID 不是数字型语音应用 ID；
Resource ID 未配置；
voiceType 未配置；
文本为空；
音色未授权；
音色和 Resource ID 不匹配；
额度不足；
语言不支持；
豆包服务超时；
流式响应格式异常；
未返回任何音频片段。
```

前端策略：

```text
豆包 V3 失败；
记录 warning；
自动回退 Web Speech；
不中断整轮测试。
```

后端错误响应建议：

```js
{
  success: false,
  message: '豆包 V3 TTS 请求失败',
  logId: '如果响应头中存在 X-Tt-Logid，则返回该值'
}
```

## 10. 测试方案

### 10.1 单元测试

建议覆盖：

```text
VoiceConfig 保存 voiceType；
豆包配置能保存 APP ID、Access Token、Secret Key、Resource ID、API Version；
V3 请求参数能正确限制 speed_ratio 和 volume_ratio；
APP ID 或 Access Token 缺失时返回明确错误；
音色和 Resource ID 不匹配时返回明确错误；
没有音频片段时返回明确错误；
豆包失败后能回退 Web Speech。
```

### 10.2 手动测试用例

中文测试：

```text
打开客厅的灯
今天天气怎么样，请用简短的话告诉我。
```

多语言兼容测试：

```text
请播放 Taylor Swift 的音乐。
Turn on 客厅灯.
```

### 10.3 验收标准

```text
中文音色可以正常播放中文文本；
当前 `seed-tts-2.0` 保留音色全部可以正常生成音频；
切换音色后无需刷新页面即可生效；
音量和倍速仍然生效；
豆包失败后测试流程不中断；
后端日志能看到 X-Tt-Logid；
APP ID、Access Token、Secret Key 不出现在浏览器请求、控制台日志或前端构建产物中。
```

## 11. 实施顺序

推荐按以下顺序实施：

```text
1. 增加 V3 配置字段，保持 V1 兼容；
2. 新增后端 /api/tts/doubao-v3 接口；
3. 新增前端 speakWithDoubaoV3；
4. 按 Resource ID 验证并收敛 VOICE_OPTIONS；
5. 修改 VoiceConfig 保存 voiceType；
6. 增加测试；
7. 使用当前保留音色完成端到端验证；
8. 如需扩展其他资源音色，先增加“音色绑定 resourceId”的能力。
```

## 12. VoiceAuto 推荐配置示例

```text
Provider: doubao
API Version: v3
API URL: https://openspeech.bytedance.com/api/v3/tts/unidirectional
APP ID: 在配置中心保存
Access Token: 在配置中心保存
Secret Key: 在配置中心保存
Resource ID: seed-tts-2.0
Default Voice Type: 以控制台实际音色 ID 为准
UID: voiceauto-web
Sample Rate: 24000
```

## 13. 参考地址

豆包语音新版控制台：

```text
https://console.volcengine.com/speech
```

V3 HTTP 单向流式接口：

```text
https://openspeech.bytedance.com/api/v3/tts/unidirectional
```

V3 API 列表：

```text
https://www.volcengine.com/docs/6561/2228192?lang=zh
```

新版控制台说明：

```text
https://www.volcengine.com/docs/6561/1167802?lang=zh
```
