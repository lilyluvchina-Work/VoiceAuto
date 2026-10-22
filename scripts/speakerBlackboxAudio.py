"""Native full-duplex capture. PortAudio ADC/DAC timestamps share one clock.

This backend deliberately declares playback_guard_no_aec: it never treats
the computer's own playback or its calibrated reverberation as a reply.
"""
import array
import hashlib
import json
import os
import queue
import statistics
import sys
import threading
import time
import wave
from pathlib import Path

from speakerBlackboxCore import (TemplateMatcher, VoiceSegment, fingerprint, is_tonal, normalized_frame,
                                rms, response_timing, validate_config)
from speakerBlackboxRunner import run_cases
from speakerBlackboxControl import PauseRequested


def emit(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


def devices(sd):
    hosts = sd.query_hostapis()
    result = []
    for index, device in enumerate(sd.query_devices()):
        host = hosts[device['hostapi']]['name']
        if sys.platform == 'win32' and host != 'Windows WASAPI':
            continue
        for kind in ('input', 'output'):
            channels = device['max_' + kind + '_channels']
            if channels:
                identity = f"{host}:{kind}:{device['name']}"
                result.append(dict(deviceId='blackbox:' + hashlib.sha256(identity.encode()).hexdigest()[:24],
                                   label=device['name'], kind=kind, index=index, hostApi=host,
                                   channels=channels, sampleRate=int(device['default_samplerate']),
                                   default=index == hosts[device['hostapi']]['default_' + kind + '_device']))
    return result


def load_wav(path, target_rate, trim=False):
    with wave.open(str(path), 'rb') as reader:
        if reader.getsampwidth() != 2 or reader.getnchannels() != 1 or reader.getcomptype() != 'NONE':
            raise ValueError('音频必须为单声道 16-bit PCM WAV，请在界面重新导入')
        rate = reader.getframerate()
        data = array.array('h', reader.readframes(reader.getnframes()))
    if not data:
        raise ValueError('音频为空或损坏')
    if rate != target_rate:
        size = int(len(data) * target_rate / rate)
        converted = array.array('h')
        for n in range(size):
            pos = n * rate / target_rate
            left = min(len(data) - 1, int(pos))
            right = min(len(data) - 1, left + 1)
            converted.append(int(data[left] + (data[right] - data[left]) * (pos - left)))
        data = converted
    original_length = len(data)
    if trim:
        while len(data) > 1 and abs(data[-1]) < 100:
            data.pop()
    if max(abs(n) for n in data) < 100:
        raise ValueError('音频只有静音')
    return data.tobytes(), dict(trimmedSamples=original_length - len(data), actualSamples=len(data), sampleRate=target_rate)


class Backend:
    def __init__(self, sd, vad, command):
        self.sd, self.vad, self.command = sd, vad, command
        self.config = validate_config(command['config'])
        self.rate = self.config['sampleRate']
        self.block = self.rate // 50
        self.folder = Path(command['folder'])
        self.frames = queue.Queue(maxsize=500)
        self.play_data = b''
        self.play_offset = 0
        self.play_end = None
        self.play_info = {}
        self.stopped = False
        self.pause_requested = False
        self.recording_suspended = False
        from speakerBlackboxClassifier import SoundClassifier
        self.classifier = SoundClassifier()
        self.writer = None
        self.current_recording = None
        self.last_level_emit = 0
        self.timestamp = 0
        self.threshold = self.config['minimumRms']
        self.failure = None
        self.calibration = command.get('calibration') or {}
        self.templates = command.get('templates', [])
        self.current_case_id = ''
        available = devices(sd)
        self.input = next((d for d in available if d['kind'] == 'input' and d['deviceId'] == self.config.get('inputDeviceId')), None)
        self.output = next((d for d in available if d['kind'] == 'output' and d['deviceId'] == self.config.get('outputDeviceId')), None)
        if not self.input or not self.output:
            raise ValueError('所选输入/输出设备不存在，请重新检测设备')
        self.output_channels = min(2, self.output['channels'])

    def callback(self, indata, outdata, count, timing, status):
        output = bytes(len(outdata))
        reference = bytes(count * 2)
        if self.play_offset < len(self.play_data):
            part = self.play_data[self.play_offset:self.play_offset + count * 2]
            reference = part + bytes(count * 2 - len(part))
            self.play_offset += len(part)
            if self.output_channels == 2:
                stereo = bytearray(len(part) * 2)
                for n in range(0, len(part), 2):
                    stereo[n * 2:n * 2 + 4] = part[n:n + 2] * 2
                output = bytes(stereo) + bytes(len(outdata) - len(stereo))
            else:
                output = part + bytes(len(outdata) - len(part))
            if self.play_offset >= len(self.play_data):
                self.play_end = timing.outputBufferDacTime + len(part) / 2 / self.rate + self.config['outputCompensationMs'] / 1000
        outdata[:] = output
        try:
            self.frames.put_nowait((timing.inputBufferAdcTime + self.config['inputCompensationMs'] / 1000, bytes(indata), str(status), reference))
        except queue.Full:
            self.failure = '采集处理队列溢出，计时和录音无效'

    def open(self):
        settings = self.sd.WasapiSettings(auto_convert=True) if sys.platform == 'win32' else None
        self.stream = self.sd.RawStream(device=(self.input['index'], self.output['index']),
                                        samplerate=self.rate, blocksize=self.block,
                                        channels=(1, self.output_channels), dtype='int16', callback=self.callback,
                                        extra_settings=settings)
        self.stream.start()
        emit(dict(event='ready', input=self.input, output=self.output, sampleRate=self.rate,
                  frameMs=20, measurementMode='playback_guard_no_aec',
                  timing='PortAudio inputBufferAdcTime / outputBufferDacTime + sample offsets',
                  latency=list(self.stream.latency)))

    def close_recording(self):
        if self.writer:
            self.writer.close()
            self.writer = None

    def close(self):
        self.close_recording()
        if hasattr(self, 'stream'):
            self.stream.stop()
            self.stream.close()

    def begin_case(self, case_id):
        self.current_case_id = case_id
        self.start_recording(f'case_{case_id}_full.wav', channels=2)

    def end_case(self):
        self.close_recording()

    def checkpoint(self, result):
        emit({**result, 'event': 'attempt_started'})

    def start_recording(self, name, channels=1):
        self.close_recording()
        self.current_recording = 'recordings/' + name
        path = self.folder / self.current_recording
        path.parent.mkdir(parents=True, exist_ok=True)
        self.writer = wave.open(str(path), 'wb')
        self.writer.setnchannels(channels)
        self.writer.setsampwidth(2)
        self.writer.setframerate(self.rate)

    def wait_for_resume(self):
        self.play_offset = len(self.play_data)
        self.recording_suspended = True
        emit(dict(event='control', status='paused'))
        try:
            while self.pause_requested and not self.stopped:
                self.next_frame(ignore_pause=True)
        finally:
            self.recording_suspended = False
        if not self.stopped:
            emit(dict(event='control', status='running'))

    def next_frame(self, ignore_pause=False):
        if getattr(self, 'pause_requested', False) and not ignore_pause:
            raise PauseRequested()
        if self.failure:
            raise RuntimeError(self.failure)
        try:
            timestamp, raw, status, reference = self.frames.get(timeout=3)
        except queue.Empty:
            raise RuntimeError('音频设备未提供数据，可能已断开')
        if self.writer and not getattr(self, 'recording_suspended', False):
            # writeframes updates WAV length on every frame; the file is playable
            # even if the process dies before wave.close().
            if self.writer.getnchannels() == 2:
                mic, playback = array.array('h', raw), array.array('h', reference)
                stereo = array.array('h', [0]) * (len(mic) * 2)
                stereo[0::2], stereo[1::2] = mic, playback
                self.writer.writeframes(stereo.tobytes())
            else:
                self.writer.writeframes(raw)
            self.writer._file.flush()
        self.timestamp = timestamp
        samples = array.array('h', raw)
        level = rms(samples)
        if status:
            raise RuntimeError('音频缓冲异常: ' + status)
        if timestamp - self.last_level_emit >= .2:
            emit(dict(event='level', rms=level, clipping=any(abs(v) >= 32760 for v in samples), recording=bool(self.writer) and not getattr(self, 'recording_suspended', False)))
            self.last_level_emit = timestamp
        return timestamp, raw, samples, level

    def collect(self, duration):
        first = None
        result = []
        while not self.stopped:
            frame = self.next_frame()
            if first is None:
                first = frame[0]
            result.append(frame)
            if frame[0] - first >= duration:
                break
        return result

    def baseline(self):
        emit(dict(event='phase', phase='采集环境底噪'))
        while not self.stopped:
            try:
                frames = self.collect(self.config['baselineMs'] / 1000)
                break
            except PauseRequested:
                self.wait_for_resume()
        if self.stopped:
            return
        samples = [value for frame in frames for value in frame[2]]
        sound = self.classifier.classify(samples, self.rate)
        levels = sorted(frame[3] for frame in frames)
        noise = levels[int((len(levels) - 1) * .2)] if levels else 0
        background = noise > self.config['minimumRms'] * 2 or (noise > .003 and sound['kind'] in ('speech', 'music', 'mixed'))
        self.threshold = self.config['minimumRms'] if background else max(self.config['minimumRms'], min(noise * self.config['noiseMultiplier'], self.config['minimumRms'] * 2))
        self.calibration.update(noiseRms=noise, effectiveThreshold=self.threshold,
                                backgroundSoundDetected=background, backgroundSoundKind=sound['kind'],
                                clipping=any(any(abs(v) >= 32760 for v in f[2]) for f in frames),
                                sampleRate=self.rate, frameMs=20, calibratedAt=time.time(),
                                inputDeviceId=self.input['deviceId'], outputDeviceId=self.output['deviceId'])

    def play(self, path):
        data, info = load_wav(path, self.rate, self.config['trimTrailingSilence'])
        self.play_info = info
        self.play_end = None
        self.play_data, self.play_offset = data, 0
        leakage = []
        while not self.stopped:
            frame = self.next_frame()
            leakage.append(frame[3])
            if self.play_end is not None and frame[0] >= self.play_end:
                break
        self.calibration['playbackLeakagePeakRms'] = max(leakage, default=0)
        self.calibration['alignmentCheck'] = 'ADC/DAC timestamps available; acoustic offset requires manual known-interval validation'
        self.calibration['tailGuardMs'] = max(self.config['tailGuardMs'], self.calibration.get('tailGuardMs', 0))
        return self.play_end

    def guard_end(self, end):
        return end + max(self.config['tailGuardMs'], self.calibration.get('tailGuardMs', 0)) / 1000

    def quiet(self, milliseconds):
        # The wake word can interrupt device playback. Never require an indefinitely
        # quiet room before playing it; speech/music validation happens after waking.
        duration = milliseconds / 1000
        if duration <= 0:
            return []
        emit(dict(event='phase', phase=f'唤醒前固定间隔（{duration:g} 秒）', caseId=getattr(self, 'current_case_id', '')))
        first = None
        heard_sound = False
        while not self.stopped:
            timestamp, raw, samples, level = self.next_frame()
            if first is None:
                first = timestamp
            if level > self.threshold:
                heard_sound = True
            if timestamp - first >= duration - 1e-8:
                return ['唤醒前检测到持续声音，不影响播放，请复核录音'] if heard_sound else []
        return []

    def wake(self, end):
        compatible = (self.config.get('wakeDetectionMode') == 'speech_or_template'
                      and self.config.get('deviceType') in ('xiaomi', 'baidu')
                      and self.config.get('templateKind', 'speech') == 'speech')
        self.last_wake_method = None
        speech_matcher = TemplateMatcher([t['frames'] for t in self.templates if t.get('kind') == 'speech'], self.config['templateThreshold'])
        tone_matcher = TemplateMatcher([t['frames'] for t in self.templates if t.get('kind') == 'tone'], self.config['templateThreshold'])
        voice = VoiceSegment(self.config.get('wakeMinVoiceMs', 80) if compatible else 60, self.config['silenceMs'])
        matched = False
        matched_at = None
        score = 0
        last_loud = end
        deadline = end + self.config['wakeTimeoutMs'] / 1000
        classification_frames = []
        speech_classified = False
        speech_matched = False
        while not self.stopped:
            timestamp, raw, samples, level = self.next_frame()
            if timestamp < self.guard_end(end):
                continue
            normalized = normalized_frame(samples, self.rate)
            speech_found, speech_score = speech_matcher.feed(normalized)
            tone_found, tone_score = tone_matcher.feed(normalized)
            score = max(score, speech_score, tone_score)
            speech = self.vad.is_speech(raw, self.rate) and not is_tonal(samples, self.rate)
            voice.feed(timestamp, level >= self.threshold and speech)
            classification_frames.extend(samples)
            if len(classification_frames) >= int(self.rate * .96):
                speech_classified = self.classifier.classify(classification_frames, self.rate)['kind'] == 'speech'
                classification_frames.clear()
            speech_matched = speech_matched or speech_found
            # Beeps have no minimum speech-duration requirement. Speech samples
            # also require VAD-confirmed speech; tone templates cannot bypass it.
            if level >= self.threshold:
                last_loud = timestamp + .02
                if tone_found:
                    self.last_wake_method = 'template_match'
                    matched = True
            if speech_classified and voice.start is not None and (speech_matched or compatible) and not matched:
                self.last_wake_method = 'template_match' if speech_matched else 'speech_activity'
                matched = True
            if matched and matched_at is None:
                matched_at = timestamp
            if matched and timestamp - matched_at >= self.config['silenceMs'] / 1000 - 1e-8:
                return True, score
            if not matched and timestamp >= deadline:
                return False, score
            if timestamp >= deadline + self.config['maxReplyMs'] / 1000:
                raise RuntimeError('唤醒回应持续发声未结束，请检查音箱/环境')
        return False, score

    def reply(self, end):
        voice = VoiceSegment(self.config['minVoiceMs'], self.config['silenceMs'], gap_ms=80)
        deadline = end + self.config['replyTimeoutMs'] / 1000
        limit = end + self.config['maxReplyMs'] / 1000
        flags = ['无 AEC：播放及残响窗口内的重叠回复不可测']
        pending = []
        kinds = set()
        classification = None
        guard_voice_last = None
        onset_obscured = False
        def process():
            nonlocal classification
            samples = [value for frame in pending for value in frame[2]]
            classification = self.classifier.classify(samples, self.rate)
            audible = any(frame[3] >= self.threshold for frame in pending)
            if audible:
                kinds.add(classification['kind'])
            ended = False
            frames = pending[:]
            pending.clear()
            for timestamp, raw, values, level in frames:
                active = (classification['kind'] == 'speech' and level >= self.threshold
                          and self.vad.is_speech(raw, self.rate) and not is_tonal(values, self.rate))
                if voice.start is None and timestamp > deadline and (voice.candidate is None or voice.candidate > deadline):
                    active = False
                if voice.start is not None and level >= self.threshold and not active:
                    # Non-speech audio is not silence. Music must not terminate a reply.
                    voice.last = timestamp + .02
                ended = voice.feed(timestamp, active)
                if ended:
                    return True
            return ended

        def result(status):
            if status == 'success' and (kinds & {'mixed', 'music'} or onset_obscured):
                status = 'needs_review'
            if onset_obscured:
                flags.append('保护窗口前后持续有人声，回复起音无法区分，不纳入响应时间统计')
            return dict(status=status, flags=flags, replyStart=voice.start if status == 'success' else None,
                        audioKind='speech' if status == 'success' else 'mixed' if 'mixed' in kinds or {'music', 'speech'} <= kinds else 'music' if kinds == {'music'} else 'unknown',
                        classification=classification, **response_timing(voice.start if status == 'success' else None, end))
        while not self.stopped:
            timestamp, raw, samples, level = self.next_frame()
            if timestamp < self.guard_end(end):
                if level >= self.threshold and self.vad.is_speech(raw, self.rate) and not is_tonal(samples, self.rate):
                    guard_voice_last = timestamp
                continue
            # A segment already present inside the playback guard has no observed
            # reply onset. Never report the guard boundary as a response time.
            if not pending and classification is None and guard_voice_last is not None:
                onset_obscured = timestamp - guard_voice_last <= .08 + 1e-8 and level >= self.threshold
            pending.append((timestamp, raw, samples, level))
            if len(pending) < 48:
                continue
            ended = process()
            if voice.start is not None and kinds & {'mixed', 'music'}:
                flags.append('检测到音乐或混合声音，需复核，不纳入语音响应时间统计')
                return result('needs_review')
            if voice.start is not None and ended:
                return result('success')
            # Allow a candidate which started before the timeout to finish its
            # minimum-duration confirmation; it is not extra response latency.
            if voice.start is None and timestamp >= deadline and (voice.candidate is None or voice.candidate > deadline):
                return result('music_only' if kinds == {'music'} else 'needs_review' if kinds & {'mixed', 'unknown'} else 'reply_timeout')
            if timestamp >= limit:
                if voice.start is not None:
                    flags.append('录音达到时限，未确认回复结束，不纳入响应时间统计')
                    return result('needs_review')
                return result('music_only' if kinds == {'music'} else 'needs_review' if kinds else 'reply_timeout')
        return dict(status='aborted', flags=flags, responseMs=None)

    def attempt(self, case, number):
        result = dict(recording=self.current_recording, flags=[], startedAt=time.time(),
                      stages={key: 'not_run' for key in ('wakePlayback', 'wakeResponse', 'testPlayback', 'reply')})
        stage = None
        def checkpoint():
            emit(dict(event='attempt_started', caseId=self.current_case_id, sourceId=case.get('sourceId', case.get('id')),
                      name=case.get('name', ''), text=case.get('text', case.get('name', '')),
                      language=case.get('language'), attempt=number, **result))
        # Checkpoint before playing, so an unexpected exit leaves an identifiable
        # partial attempt and valid raw WAV, not an orphan recording.
        checkpoint()
        def enter(key):
            nonlocal stage
            stage = key
            result['stages'][key] = 'interrupted'
            checkpoint()
        try:
            self.collect(.2)
            if self.stopped:
                return {**result, 'status': 'aborted'}
            emit(dict(event='phase', phase='播放唤醒词', caseId=self.current_case_id, attempt=number))
            enter('wakePlayback')
            wake_end = self.play(self.command['wakePath'])
            if self.stopped:
                return {**result, 'status': 'aborted'}
            result['stages']['wakePlayback'] = 'success'
            if getattr(self, 'config', {}).get('deviceType') == 'google':
                emit(dict(event='phase', phase='Google 唤醒后等待 1 秒'))
                while not self.stopped:
                    if self.next_frame()[0] >= wake_end + 1 - 1e-8:
                        break
                self.last_wake_method = 'fixed_delay'
                result.update(wakeDetected=False, wakePlaybackEnd=wake_end, wakeDetectionMethod='fixed_delay')
                result['stages']['wakeResponse'] = 'skipped'
                result['flags'].append('Google：唤醒词播放后固定等待 1 秒，跳过唤醒应答检测')
                if self.stopped:
                    return {**result, 'status': 'aborted'}
            else:
                emit(dict(event='phase', phase='匹配唤醒回应'))
                enter('wakeResponse')
                detected, score = self.wake(wake_end)
                result.update(wakeDetected=detected, wakeScore=score, wakePlaybackEnd=wake_end,
                              wakeDetectionMethod=self.last_wake_method)
                result['stages']['wakeResponse'] = 'success' if detected else 'interrupted' if self.stopped else 'failed'
                if not detected or self.stopped:
                    return {**result, 'status': 'aborted' if self.stopped else 'wake_timeout'}
            emit(dict(event='phase', phase='播放测试音频'))
            enter('testPlayback')
            end = self.play(case['path'])
            result.update(playbackEnd=end, playback=self.play_info)
            if self.stopped:
                return {**result, 'status': 'aborted'}
            result['stages']['testPlayback'] = 'success'
            emit(dict(event='phase', phase='监听语音回复'))
            enter('reply')
            reply_result = self.reply(end)
            reply_result['flags'] = result.get('flags', []) + reply_result.get('flags', [])
            result.update(reply_result)
            if getattr(self, 'pause_requested', False):
                raise PauseRequested()
            result['stages']['reply'] = 'success' if result['status'] == 'success' else 'interrupted' if self.stopped else 'needs_review' if result['status'] == 'needs_review' else 'failed'
            if self.last_wake_method == 'speech_activity':
                result['flags'] = result.get('flags', []) + ['兼容唤醒：有效语音检出，未要求匹配预设应答；附近讲话可能干扰']
            result['endedAt'] = time.time()
            return result
        except PauseRequested:
            result.update(status='paused', responseMs=None, flags=result.get('flags', []) + ['用户暂停，继续时重新执行当前用例'])
            return result
        except Exception as error:
            if stage:
                result['stages'][stage] = 'interrupted' if self.stopped else 'failed'
            return {**result, 'status': 'aborted' if self.stopped else 'error', 'error': str(error)}

    def calibrate(self):
        self.start_recording('calibration_raw.wav')
        self.baseline()
        if self.stopped:
            return
        emit(dict(event='phase', phase='播放唤醒词并检查泄漏；随后采集实际唤醒回应'))
        end = self.play(self.command['wakePath'])
        if self.stopped:
            return
        frames = []
        segment_start = last_active = None
        first_after_playback = None
        while not self.stopped:
            frame = self.next_frame()
            timestamp, raw, samples, level = frame
            if first_after_playback is None:
                first_after_playback = timestamp
            if timestamp < self.guard_end(end):
                continue
            if level >= self.threshold:
                if segment_start is None:
                    segment_start = timestamp
                last_active = timestamp
            if segment_start is not None:
                frames.append(frame)
            if last_active is not None and timestamp - last_active >= self.config['silenceMs'] / 1000:
                break
            if timestamp >= end + self.config['wakeTimeoutMs'] / 1000:
                break
        self.close_recording()
        if not frames or last_active is None:
            raise ValueError('未采集到唤醒回应，请调整音量/残响保护，或导入人工裁剪的回应样本')
        active_frames = [f for f in frames if f[0] <= last_active]
        # Limit template length: very long unrelated speech is unsafe calibration.
        if len(active_frames) > 250:
            raise ValueError('回应样本超过 5 秒，请导入裁剪后的样本')
        kind = self.config.get('templateKind', 'speech')
        template = dict(kind=kind, name='实际唤醒回应', frames=[fingerprint(normalized_frame(f[2], self.rate)) for f in active_frames])
        sample_path = self.folder / 'recordings' / 'wake_sample.wav'
        with wave.open(str(sample_path), 'wb') as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(self.rate)
            audio.writeframes(b''.join(f[1] for f in active_frames))
        self.calibration.update(wakeResponseStart=segment_start, wakeResponseEnd=last_active,
                                recording='recordings/calibration_raw.wav', sampleRecording='recordings/wake_sample.wav',
                                reverbCheck='manual_review_required', timingValidation='pending_real_device_known_interval')
        emit(dict(event='calibration', calibration=self.calibration, templates=[template]))


def main():
    # Windows redirected stdin otherwise uses the system GBK code page.
    sys.stdin.reconfigure(encoding='utf-8')
    command = json.loads(sys.stdin.readline())
    if command['action'] == 'template':
        raw, info = load_wav(command['path'], 16000)
        values = array.array('h', raw)
        chunks = [values[n:n + 320] for n in range(0, len(values) - 319, 320)]
        active = [n for n, frame in enumerate(chunks) if rms(frame) >= .003]
        if not active or active[-1] - active[0] >= 250:
            raise ValueError('样本须有有效声音且长度不超过 5 秒')
        emit(dict(event='template', template=dict(name=command.get('name', '导入回应样本'),
                  kind=command.get('kind', 'speech'), frames=[fingerprint(f) for f in chunks[active[0]:active[-1] + 1]])))
        return
    import sounddevice as sd
    if command['action'] == 'devices':
        emit(dict(event='devices', devices=devices(sd)))
        return
    try:
        import webrtcvad
    except ImportError:
        raise RuntimeError('缺少 WebRTC VAD，请重新运行 scripts/installNativeAudio.ps1 安装音频依赖')
    backend = Backend(sd, webrtcvad.Vad(2), command)

    def listen():
        for line in sys.stdin:
            command = line.strip()
            if command == 'pause':
                backend.pause_requested = True
                backend.play_offset = len(backend.play_data)
            elif command == 'resume':
                backend.pause_requested = False
            elif command == 'stop':
                break
        backend.stopped = True  # EOF also means the bridge died.
        backend.play_offset = len(backend.play_data)

    threading.Thread(target=listen, daemon=True).start()
    try:
        backend.open()
        if command['action'] == 'calibrate':
            backend.calibrate()
        else:
            if not backend.templates and backend.config.get('deviceType') != 'google':
                raise ValueError('请先校准或导入实际唤醒回应样本')
            backend.baseline()
            emit(dict(event='calibration', calibration=backend.calibration, templates=backend.templates))
            run_cases(command['cases'], backend.config, backend, lambda result: emit(dict(event='attempt', **result)))
        emit(dict(event='done', status='aborted' if backend.stopped else 'completed'))
    finally:
        backend.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit(dict(event='error', message=str(error)))
        sys.exit(1)
