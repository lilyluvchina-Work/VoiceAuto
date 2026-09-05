# AI Toy Device Extension Design

> 历史设计/实施计划：后续实现已演进为持续会话和启动确认后的恢复。当前操作与限制以[设备测试流程说明](../../product/device-test-workflows.md)为准，本文代码示例和待办状态保留用于追溯。

## Goal

Merge the logic from `E:\hey_cedar_test` into VoiceAuto as a first-class device extension named `AI玩具`, while keeping the existing `Speaker` behavior available. VoiceAuto must support both ADB logcat and USB serial log ingestion for device events.

## Source Logic Extracted From `E:\hey_cedar_test`

The external runner is a continuous-dialogue acoustic tester. Its useful production logic is the device event protocol and recovery policy, not the macOS-only `say` and `afplay` playback implementation.

AI玩具 event protocol:

- Wake accepted: `VOICE WAKE WORD HIT ACCEPTED`
- Listening state: `Cedar: Start listening`
- Input text: `Cedar: Input Text: <text>`
- First downlink audio: `Audio latency first_downlink_audio`
- TTS playback completed: `TTS playback done`
- Idle failure: `Application: ║ New State: idle` or `Application: New State: idle`
- TTS timeout failure: `WS response timeout (no_tts_start)`
- Reboot failure: `Rebooting.`, `Guru Meditation`, `task_wdt`, or `I2C transaction timeout`

AI玩具 conversation policy:

- A dialogue starts with one wake word.
- Later turns in the same dialogue reuse the active session and do not wake again.
- Each turn succeeds only after ASR input, first audio, playback complete, and return-to-listening events happen in order.
- If the device enters idle, TTS times out, reboots, or the log reader fails, the current turn fails and the runner should wake again before retrying that same turn.
- The runner must not skip the failed question when recovering.

## Architecture

Add a device-profile layer and a log-source layer.

Device profile layer:

- `Speaker` remains the default profile.
- `AI玩具` adds the Cedar serial/log patterns listed above.
- Profiles expose labels, default keywords, ASR extraction patterns, response markers, failure markers, and default timeouts.
- Existing code that says `Speaker` for internal field names can remain for compatibility, but UI labels and runtime status should derive from the selected profile.

Log source layer:

- `adb` source uses the current `scripts/adbBridge.cjs` ADB logcat implementation.
- `serial` source adds a Node USB serial reader using the `serialport` package.
- The browser calls the same bridge API for both sources. Request payloads include `logSource`, `deviceType`, and either `deviceId` for ADB or `serialPort` plus `baudrate` for serial.
- Bridge responses keep the existing response shape so `src/services/adbWakeService.js`, reports, and tests remain mostly stable.

## Data Flow

1. User selects device type `Speaker` or `AI玩具` in the playback console.
2. User selects log source `ADB logcat` or `USB串口`.
3. VoiceAuto resolves a device profile from `testOptions.device`.
4. `useTestRunner` builds the existing multi-turn queue.
5. For the first turn of each dialogue, the runner plays the wake word and asks the bridge to detect the profile wake marker.
6. For reused turns, the runner skips wake playback and continues directly to test audio.
7. After test audio starts, the runner detects input and response events using the selected profile and selected log source.
8. On AI玩具 failure markers, the current result records the failure, sets the next attempt to require wakeup, and retries the same queue item within configured retry limits.
9. Existing process logs, reports, Langfuse response confirmation, and DingTalk notifications continue to consume normalized results.

## UI Requirements

- Add a device selector with options `Speaker` and `AI玩具`.
- Add a log source selector with options `ADB logcat` and `USB串口`.
- For ADB, keep the current device list and health check behavior.
- For serial, show port, baudrate, and serial health status.
- Replace user-facing hard-coded `Speaker` labels in the playback console with the selected device label where it describes the target device.
- Keep historical report fields such as `speakerWakeStatus` for compatibility, but add display labels so AI玩具 reports read naturally.

## Backend Requirements

- Extend `scripts/adbBridge.cjs` rather than replacing it.
- Add profile-aware keyword resolution.
- Add serial port listing and health endpoints.
- Add serial-backed detection for wake, ASR/input, response, and failure events.
- Serial detection should mirror the external Python reader: read lines, decode as UTF-8 with replacement behavior, match event regexes, keep sample lines, and close the reader at timeout or success.
- If `serialport` is missing, serial endpoints return a clear JSON error explaining that USB串口 mode requires the dependency.

## Testing Requirements

- Tests must prove the AI玩具 profile contains the extracted patterns and failure markers.
- Tests must prove `buildMultiTurnQueue` can model repeated AI玩具 dialogue turns without repeated wake.
- Tests must prove a failed AI玩具 turn can be retried at the same cursor with wake required.
- Tests must prove service payloads include `deviceType`, `logSource`, `serialPort`, and `baudrate` when configured.
- Tests must prove the UI source includes `AI玩具` and `USB串口` configuration controls.

## Non-Goals

- Do not port the external Python runner wholesale.
- Do not make macOS `say` or `afplay` required in VoiceAuto.
- Do not remove existing Speaker report fields.
- Do not require real hardware in automated tests.
