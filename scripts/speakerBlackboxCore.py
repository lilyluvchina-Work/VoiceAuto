"""Pure signal/measurement primitives; no device imports, deterministic tests."""
import cmath
import math

DEFAULTS = dict(wakeTimeoutMs=5000, replyTimeoutMs=15000, extraRetries=5,
                retrySilenceMs=2000, minVoiceMs=200, silenceMs=800,
                maxReplyMs=60000, repeatCount=1, sampleRate=16000,
                noiseMultiplier=4, minimumRms=.008, templateThreshold=.82,
                tailGuardMs=300, trimTrailingSilence=False, inputCompensationMs=0,
                outputCompensationMs=0, baselineMs=1500)


def validate_config(value):
    config = {**DEFAULTS, **value}
    config.setdefault('wakeDetectionMode', 'speech_or_template' if config.get('deviceType') in ('xiaomi', 'baidu') else 'template_only')
    config.setdefault('wakeMinVoiceMs', 80)
    if config['wakeDetectionMode'] not in ('speech_or_template', 'template_only'):
        raise ValueError('无效唤醒判定模式')
    bounds = dict(wakeTimeoutMs=(100, 120000), replyTimeoutMs=(100, 120000),
                  extraRetries=(0, 5), retrySilenceMs=(0, 60000), minVoiceMs=(40, 3000), wakeMinVoiceMs=(40, 1000),
                  silenceMs=(100, 10000), maxReplyMs=(1000, 300000), repeatCount=(1, 100),
                  noiseMultiplier=(1.5, 20), minimumRms=(.0001, .5), templateThreshold=(.5, 1),
                  tailGuardMs=(0, 3000), inputCompensationMs=(-2000, 2000),
                  outputCompensationMs=(-2000, 2000), baselineMs=(500, 10000))
    for key, (low, high) in bounds.items():
        v = config[key]
        if isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) or not low <= v <= high:
            raise ValueError('无效检测参数: ' + key)
    for key in ('extraRetries', 'repeatCount'):
        if int(config[key]) != config[key]:
            raise ValueError('参数必须为整数: ' + key)
        config[key] = int(config[key])
    if config['sampleRate'] not in (16000, 32000, 48000):
        raise ValueError('采样率必须为 16000、32000 或 48000')
    if config['maxReplyMs'] < config['minVoiceMs']:
        raise ValueError('最长回复时间不能小于最短语音长度')
    return config


class VoiceSegment:
    def __init__(self, minimum_ms=200, silence_ms=800, gap_ms=0):
        self.minimum = minimum_ms / 1000
        self.silence = silence_ms / 1000
        self.candidate = self.start = self.last = None
        self.gap = gap_ms / 1000
        self.voiced = 0

    def feed(self, timestamp, voice, frame_seconds=.02):
        if voice:
            if self.candidate is None:
                self.candidate = timestamp
                self.voiced = 0
            self.voiced += frame_seconds
            self.last = timestamp + frame_seconds
            if self.start is None and self.voiced >= self.minimum - 1e-8:
                self.start = self.candidate
        elif self.start is None and (self.last is None or timestamp - self.last >= self.gap - 1e-8):
            self.candidate = None
            self.voiced = 0
        return self.start is not None and timestamp - self.last >= self.silence - 1e-8


def response_timing(start, playback_end):
    value = None if start is None else (start - playback_end) * 1000
    return dict(responseMs=value, overlap=value is not None and value < 0)


def rms(samples):
    return math.sqrt(sum(n * n for n in samples) / max(1, len(samples))) / 32768


def _fft(samples):
    size = 1
    while size * 2 <= len(samples):
        size *= 2
    data = [complex(samples[i] * (.5 - .5 * math.cos(2 * math.pi * i / (size - 1)))) for i in range(size)]
    j = 0
    for i in range(1, size):
        bit = size >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j ^= bit
        if i < j:
            data[i], data[j] = data[j], data[i]
    width = 2
    while width <= size:
        root = cmath.exp(-2j * math.pi / width)
        for base in range(0, size, width):
            factor = 1
            for offset in range(width // 2):
                a = data[base + offset]
                b = factor * data[base + offset + width // 2]
                data[base + offset], data[base + offset + width // 2] = a + b, a - b
                factor *= root
        width *= 2
    return [abs(v) ** 2 for v in data[:size // 2]]


def fingerprint(samples):
    spectrum = _fft(samples)
    bands = [sum(spectrum[1 + i * (len(spectrum) - 1) // 24:1 + (i + 1) * (len(spectrum) - 1) // 24]) for i in range(24)]
    norm = math.sqrt(sum(v * v for v in bands)) or 1
    return [v / norm for v in bands]


def normalized_frame(samples, sample_rate):
    # All template frames use a common 16 kHz frequency scale, independent
    # of the device sample rate. Supported rates are exact multiples.
    return samples[::sample_rate // 16000]


def similarity(a, b):
    return sum(x * y for x, y in zip(a, b))


def is_tonal(samples, sample_rate):
    spectrum = _fft(samples)
    # A single narrow-band peak and its Hann-window neighbours account for
    # almost all energy in a beep; WebRTC VAD alone also accepts some beeps.
    total = sum(spectrum[1:])
    if not total:
        return False
    peak = max(range(1, len(spectrum)), key=spectrum.__getitem__)
    concentration = sum(spectrum[max(1, peak - 1):peak + 2]) / total
    return concentration > .92


class TemplateMatcher:
    """Sliding sequence of normalized spectral frames, tolerant to gain."""
    def __init__(self, templates, threshold=.82):
        self.templates = templates
        self.threshold = threshold
        self.history = []
        self.maximum = max((len(t) for t in templates), default=1)

    def feed(self, samples):
        self.history.append(fingerprint(samples))
        self.history = self.history[-self.maximum:]
        best = 0
        for template in self.templates:
            if template and len(self.history) >= len(template):
                score = sum(similarity(a, b) for a, b in zip(self.history[-len(template):], template)) / len(template)
                best = max(best, score)
        return best >= self.threshold, best
