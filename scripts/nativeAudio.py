"""Native system audio input. JSON commands on stdin, JSON events on stdout."""
import array
import hashlib
import json
import math
import os
import sys
import threading
import time
import wave

import sounddevice as sd


def emit(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


def inputs():
    hosts = sd.query_hostapis()
    devices = sd.query_devices()
    result = []
    for index, device in enumerate(devices):
        if device['max_input_channels'] < 1:
            continue
        host = hosts[device['hostapi']]['name']
        # WASAPI lists real Windows endpoints without MME/DirectSound duplicates.
        if sys.platform == 'win32' and host != 'Windows WASAPI':
            continue
        identity = host + ':' + device['name']
        result.append(dict(deviceId='native:' + hashlib.sha256(identity.encode()).hexdigest()[:24],
                           label=device['name'], hostApi=host, index=index,
                           channels=device['max_input_channels'], sampleRate=int(device['default_samplerate']),
                           default=index == hosts[device['hostapi']]['default_input_device']))
    return result


def bounded(config, key, default, low, high):
    return min(high, max(low, float(config.get(key, default))))


def record(config):
    devices = inputs()
    selected = next((d for d in devices if d['deviceId'] == config.get('deviceId')), None)
    if not selected:
        raise ValueError('未找到所选本地音频输入设备，请检测设备并重新选择')
    rate = selected['sampleRate']
    # Capture all channels so line-in on either stereo channel is retained.
    channels = min(2, selected['channels'])
    max_ms = bounded(config, 'maxRecordMs', 120000, 500, 240000)
    start_timeout = bounded(config, 'replyStartTimeoutMs', 20000, 500, max_ms)
    silence_ms = bounded(config, 'silenceMs', 2000, 300, max_ms)
    protect_ms = bounded(config, 'minProtectMs', 10000, 0, max_ms)
    threshold = bounded(config, 'noiseThreshold', 0.02, 0.0001, 1)
    minimum = bounded(config, 'minDurationMs', 500, 0, max_ms)
    stop = threading.Event()
    threading.Thread(target=lambda: (sys.stdin.readline(), stop.set()), daemon=True).start()
    started = int(time.time() * 1000)
    frames = 0
    first_voice = None
    last_voice = 0
    peak = 0
    reason = 'maximum_duration'
    next_status = 0
    path = config['outputPath']
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with sd.RawInputStream(device=selected['index'], samplerate=rate, channels=channels,
                           dtype='int16', blocksize=max(1, rate // 20)) as stream:
        with wave.open(path, 'wb') as audio:
            audio.setnchannels(channels)
            audio.setsampwidth(2)
            audio.setframerate(rate)
            emit(dict(event='ready', startedAt=started, inputDeviceId=selected['deviceId'],
                      inputDeviceLabel=selected['label'], sampleRate=rate, channels=channels))
            while frames * 1000 / rate < max_ms:
                raw, overflow = stream.read(max(1, rate // 20))
                if overflow:
                    raise RuntimeError('外接音频采集溢出，录音可能缺失，请关闭占用设备的程序后重试')
                data = bytes(raw)
                audio.writeframesraw(data)
                samples = array.array('h', data)
                level = math.sqrt(sum(v * v for v in samples) / max(1, len(samples))) / 32768
                peak = max(peak, level)
                elapsed = frames * 1000 / rate
                frames += len(samples) // channels
                if level >= threshold:
                    if first_voice is None:
                        first_voice = elapsed
                    last_voice = elapsed
                if elapsed >= next_status:
                    emit(dict(event='level', rms=level, peakRms=peak, durationMs=elapsed))
                    next_status = elapsed + 250
                if stop.is_set():
                    reason = 'stopped'
                    break
                if not config.get('preview'):
                    if first_voice is None and elapsed >= start_timeout:
                        reason = 'no_audio'
                        break
                    if first_voice is not None and elapsed - first_voice >= protect_ms and elapsed - last_voice >= silence_ms:
                        reason = 'silence'
                        break
    duration = frames * 1000 / rate
    detected = first_voice is not None
    passed = detected and last_voice - first_voice + 50 >= minimum
    emit(dict(event='result', success=passed, inputDeviceId=selected['deviceId'],
              inputDeviceLabel=selected['label'], sampleRate=rate, channels=channels,
              startedAt=started, endedAt=int(time.time() * 1000), durationMs=duration,
              audioDetected=detected, peakRms=peak, finishReason=reason,
              message='' if passed else '未采集到足够的声音，请检查外接设备输入通道、接线和音量'))


if __name__ == '__main__':
    try:
        command = json.loads(sys.stdin.readline())
        if command.get('action') == 'devices':
            emit(dict(event='devices', devices=inputs()))
        else:
            record(command)
    except Exception as error:
        emit(dict(event='error', message=str(error)))
        sys.exit(1)
