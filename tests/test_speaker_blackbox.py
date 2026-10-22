import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from speakerBlackboxCore import VoiceSegment, fingerprint, similarity, is_tonal, response_timing, validate_config, normalized_frame
from speakerBlackboxRunner import run_cases
from speakerBlackboxControl import PauseRequested
from speakerBlackboxClassifier import classify_scores
from speakerBlackboxAudio import Backend
import array
import tempfile
import wave
import queue
import contextlib
import io


class DetectionTests(unittest.TestCase):
    def test_short_gaps_do_not_move_the_first_reply_timestamp(self):
        segment = VoiceSegment(200, 800, gap_ms=80)
        for n in range(25):
            segment.feed(4 + n * .02, n % 5 != 3)
        self.assertAlmostEqual(segment.start, 4)

    def test_backdates_and_requires_continuity(self):
        segment = VoiceSegment(200, 800)
        segment.feed(1.0, True)
        segment.feed(1.02, False)
        self.assertIsNone(segment.start)
        for n in range(10):
            segment.feed(2 + n * .02, True)
        self.assertAlmostEqual(segment.start, 2)
        self.assertFalse(segment.feed(2.9, False))
        self.assertTrue(segment.feed(3.0, False))

    def test_tone_is_not_voice_and_template_matches_gain(self):
        tone = [int(12000 * math.sin(2 * math.pi * 1000 * n / 16000)) for n in range(320)]
        self.assertTrue(is_tonal(tone, 16000))
        self.assertGreater(similarity(fingerprint(tone), fingerprint([n // 3 for n in tone])), .99)

    def test_timing_preserves_negative_and_missing(self):
        self.assertEqual(response_timing(4.9, 5), {'responseMs': -99.99999999999964, 'overlap': True})
        self.assertEqual(response_timing(None, 5), {'responseMs': None, 'overlap': False})

    def test_defaults_and_invalid_parameters(self):
        config = validate_config({})
        self.assertEqual(config['extraRetries'], 5)
        self.assertEqual(config['replyTimeoutMs'], 15000)
        for invalid in ({'extraRetries': -1}, {'extraRetries': 6}, {'repeatCount': 0}, {'minVoiceMs': float('nan')}, {'sampleRate': 123}):
            with self.assertRaises(ValueError):
                validate_config(invalid)

    def test_template_frequency_scale_is_shared_by_all_rates(self):
        features = []
        for rate in (16000, 32000, 48000):
            tone = [int(12000 * math.sin(2 * math.pi * 1000 * n / rate)) for n in range(rate // 50)]
            features.append(fingerprint(normalized_frame(tone, rate)))
        for feature in features:
            self.assertGreater(similarity(features[0], feature), .99)


class BackendDetectionTests(unittest.TestCase):
    def test_pre_wake_noise_has_a_time_limit_and_does_not_block_playback_forever(self):
        consumed = []
        def frames():
            for frame in self.frames(0, 300, voice_at=(0, 6)):
                consumed.append(frame[0])
                yield frame
        backend = self.backend(frames())
        backend.timestamp = 0
        with contextlib.redirect_stdout(io.StringIO()):
            flags = backend.quiet(800)
        self.assertTrue(any('持续声音' in flag for flag in flags))
        self.assertAlmostEqual(consumed[-1], .8, places=5)

    def test_quiet_environment_keeps_the_requested_pre_wake_interval(self):
        backend = self.backend(self.frames(0, 300))
        backend.timestamp = 0
        with contextlib.redirect_stdout(io.StringIO()):
            flags = backend.quiet(800)
        self.assertEqual(flags, [])

    def backend(self, frames, config=None):
        backend = Backend.__new__(Backend)
        backend.config = validate_config(config or {})
        backend.rate = 16000
        backend.calibration = {}
        backend.threshold = .008
        backend.stopped = False
        backend.pause_requested = False
        backend.classifier = type('Classifier', (), {'classify': lambda _, samples, rate: dict(kind='speech', speech=1, music=0)})()
        class Vad:
            def is_speech(self, raw, rate):
                return True
        backend.vad = Vad()
        iterator = iter(frames)
        backend.next_frame = lambda: next(iterator)
        return backend

    def frames(self, start, total, tone_at=None, voice_at=None):
        for n in range(total):
            timestamp = start + n * .02
            if tone_at and tone_at[0] <= timestamp < tone_at[1]:
                samples = [int(12000 * math.sin(2 * math.pi * 1000 * v / 16000)) for v in range(320)]
            elif voice_at and voice_at[0] <= timestamp < voice_at[1]:
                # deterministic broadband frame, distinct from pure beeps
                import random
                rng = random.Random(n)
                samples = [rng.randint(-10000, 10000) for _ in range(320)]
            else:
                samples = [0] * 320
            raw = array.array('h', samples).tobytes()
            yield timestamp, raw, samples, math.sqrt(sum(v*v for v in samples) / 320) / 32768

    def test_short_matched_chime_is_valid_without_speech_minimum(self):
        tone = [int(12000 * math.sin(2 * math.pi * 1000 * n / 16000)) for n in range(320)]
        backend = self.backend(self.frames(0, 500, tone_at=(.4, .44)))
        backend.templates = [dict(kind='tone', frames=[fingerprint(tone)] * 2)]
        detected, score = backend.wake(0)
        self.assertTrue(detected)
        self.assertGreater(score, .99)

    def test_compatible_wake_accepts_unlisted_speech_but_strict_mode_does_not(self):
        for mode, expected in [('speech_or_template', True), ('template_only', False)]:
            backend = self.backend(self.frames(0, 200, voice_at=(.4, .8)),
                                   {'deviceType': 'xiaomi', 'wakeDetectionMode': mode, 'wakeTimeoutMs': 2000})
            backend.templates = []
            detected, _ = backend.wake(0)
            self.assertEqual(detected, expected)
            if detected:
                self.assertEqual(backend.last_wake_method, 'speech_activity')

    def test_compatible_wake_rejects_beeps_and_transient_noise(self):
        for tone_at, voice_at in [((.4, 1), None), (None, (.4, .42))]:
            backend = self.backend(self.frames(0, 200, tone_at=tone_at, voice_at=voice_at),
                                   {'deviceType': 'baidu', 'wakeTimeoutMs': 2000})
            backend.templates = []
            self.assertFalse(backend.wake(0)[0])

    def test_google_never_uses_generic_speech_as_wake_confirmation(self):
        backend = self.backend(self.frames(0, 200, voice_at=(.4, .8)),
                               {'deviceType': 'google', 'wakeDetectionMode': 'speech_or_template', 'wakeTimeoutMs': 2000})
        backend.templates = []
        self.assertFalse(backend.wake(0)[0])

    def test_guard_and_beeps_do_not_count_as_voice(self):
        backend = self.backend(self.frames(0, 1000, tone_at=(.5, 1.5), voice_at=(0, .2)), {'replyTimeoutMs': 2000})
        result = backend.reply(0)
        self.assertEqual(result['status'], 'reply_timeout')

    def test_speech_crossing_playback_guard_is_not_a_measured_reply(self):
        backend = self.backend(self.frames(0, 400, voice_at=(0, 5)), {'maxReplyMs': 5000})
        result = backend.reply(0)
        self.assertEqual(result['status'], 'needs_review')
        self.assertIsNone(result['responseMs'])
        self.assertTrue(any('起音' in flag for flag in result['flags']))

    def test_unfinished_continuous_speech_has_no_trusted_latency(self):
        backend = self.backend(self.frames(0, 400, voice_at=(1, 7)), {'maxReplyMs': 5000})
        result = backend.reply(0)
        self.assertEqual(result['status'], 'needs_review')
        self.assertIsNone(result['responseMs'])

    def test_known_1240_ms_interval_is_backdated_not_confirmation_time(self):
        backend = self.backend(self.frames(10, 500, voice_at=(11.24, 11.8)))
        result = backend.reply(10)
        self.assertEqual(result['status'], 'success')
        self.assertAlmostEqual(result['responseMs'], 1240, places=6)

    def test_four_second_fragmented_reply_is_not_moved_to_later_loud_speech(self):
        def frames():
            for n, frame in enumerate(self.frames(0, 1000, voice_at=(4, 12))):
                if frame[0] < 10 and n % 5 == 3:
                    yield frame[0], bytes(640), [0] * 320, 0
                else:
                    yield frame
        backend = self.backend(frames())
        result = backend.reply(0)
        self.assertEqual(result['status'], 'success')
        self.assertAlmostEqual(result['responseMs'], 4000, places=5)

    def test_music_and_mixed_sounds_do_not_pass_as_a_spoken_reply(self):
        for kind, expected in [('music', 'music_only'), ('mixed', 'needs_review')]:
            backend = self.backend(self.frames(0, 300, voice_at=(.4, 4)), {'replyTimeoutMs': 2000})
            backend.classifier = type('Classifier', (), {'classify': lambda _, samples, rate: dict(kind=kind, speech=.6, music=.7)})()
            result = backend.reply(0)
            self.assertEqual(result['status'], expected)
            self.assertIsNone(result['responseMs'])

    def test_music_after_speech_is_not_mistaken_for_reply_ending_silence(self):
        for later_kind in ['mixed', 'music']:
            backend = self.backend(self.frames(0, 300, voice_at=(.3, 4)))
            labels = iter(['speech', later_kind] + [later_kind] * 10)
            backend.classifier = type('Classifier', (), {'classify': lambda _, samples, rate: dict(kind=next(labels), speech=.8, music=.8)})()
            result = backend.reply(0)
            self.assertEqual(result['status'], 'needs_review')
            self.assertEqual(result['audioKind'], 'mixed')
            self.assertIsNone(result['responseMs'])

    def test_speech_during_baseline_does_not_block_playback_or_inflate_threshold(self):
        backend = self.backend(self.frames(0, 150, voice_at=(0, 2)))
        backend.input, backend.output = {'deviceId': 'mic'}, {'deviceId': 'out'}
        with contextlib.redirect_stdout(io.StringIO()):
            backend.baseline()
        self.assertEqual(backend.threshold, .008)
        self.assertTrue(backend.calibration['backgroundSoundDetected'])

    def test_ongoing_speech_does_not_delay_test_audio_after_wake_is_confirmed(self):
        backend = self.backend(self.frames(0, 250, voice_at=(.4, 5)), {'deviceType': 'xiaomi'})
        backend.templates = []
        detected, _ = backend.wake(0)
        self.assertTrue(detected)


class SchedulerTests(unittest.TestCase):
    def test_pre_wake_noise_note_is_kept_when_attempt_result_is_saved(self):
        backend = self.FakeBackend(['success'])
        backend.quiet = lambda milliseconds: ['唤醒前持续声音，已按等待上限继续']
        saved = []
        run_cases([dict(id='one')], validate_config({}), backend, saved.append)
        self.assertIn('唤醒前持续声音，已按等待上限继续', saved[0]['flags'])

    def test_pause_replays_current_case_without_spending_timeout_retries(self):
        backend = self.FakeBackend(['paused', 'reply_timeout', 'success'])
        backend.wait_for_resume = lambda: backend.calls.append('resume')
        saved = []
        run_cases([dict(id='one')], validate_config({'extraRetries': 1}), backend, saved.append)
        self.assertEqual([a['status'] for a in saved], ['paused', 'reply_timeout', 'success'])
        self.assertTrue(saved[-1]['caseCompleted'])
        self.assertEqual(backend.calls.count('resume'), 1)

    class FakeBackend:
        def __init__(self, outcomes, stop_at=None):
            self.outcomes = iter(outcomes)
            self.calls = []
            self.stop_at = stop_at
            self.stopped = False

        def quiet(self, milliseconds):
            self.calls.append('quiet')

        def attempt(self, case, number):
            self.calls.append('wake')
            self.stopped = self.stop_at == number
            outcome = next(self.outcomes)
            if outcome == 'error':
                raise OSError('disconnected')
            return dict(status=outcome, wakeDetected=outcome != 'wake_timeout', recording=f'recordings/case_001_attempt_{number:02}_raw.wav')

    def test_six_attempts_keep_all_failures(self):
        backend = self.FakeBackend(['wake_timeout', 'reply_timeout'] * 3)
        saved = []
        run_cases([dict(id='one', name='one.wav')], validate_config({}), backend, saved.append)
        self.assertEqual(len(saved), 6)
        self.assertEqual(backend.calls.count('wake'), 6)
        self.assertTrue(saved[-1]['caseCompleted'])
        self.assertFalse(saved[0]['caseCompleted'])

    def test_error_not_retried_and_abort_saved(self):
        for outcome, expected in [('error', 'error'), ('aborted', 'aborted')]:
            backend = self.FakeBackend([outcome], stop_at=1 if outcome == 'aborted' else None)
            saved = []
            run_cases([dict(id='one')], validate_config({}), backend, saved.append)
            self.assertEqual(len(saved), 1)
            self.assertEqual(saved[0]['status'], expected)

    def test_successful_retry_repeats_and_stops_at_success(self):
        backend = self.FakeBackend(['reply_timeout', 'success'])
        saved = []
        run_cases([dict(id='one')], validate_config({}), backend, saved.append)
        self.assertEqual([a['attempt'] for a in saved], [1, 2])
        self.assertTrue(saved[-1]['caseCompleted'])

    def test_case_recording_lifecycle_spans_retries_and_closes_on_error(self):
        for outcomes in [['reply_timeout', 'success'], ['error']]:
            backend = self.FakeBackend(outcomes)
            opened, closed = [], []
            backend.begin_case = lambda case_id: opened.append(case_id)
            backend.end_case = lambda: closed.append(True)
            saved = []
            run_cases([dict(id='one', text='今天天气怎么样')], validate_config({}), backend, saved.append)
            self.assertEqual(opened, ['001_001'])
            self.assertEqual(closed, [True])
            self.assertEqual(saved[0]['text'], '今天天气怎么样')


class FullRecordingTests(unittest.TestCase):
    def test_music_vocals_and_mixed_audio_are_not_clean_speech(self):
        self.assertEqual(classify_scores(.9, .05)['kind'], 'speech')
        self.assertEqual(classify_scores(.05, .9)['kind'], 'music')
        self.assertEqual(classify_scores(.8, .8)['kind'], 'mixed')
        self.assertEqual(classify_scores(.15, .15)['kind'], 'unknown')

    def test_google_waits_one_second_after_wake_without_matching_a_response(self):
        backend = Backend.__new__(Backend)
        backend.config = validate_config({'deviceType': 'google'})
        backend.current_recording = 'recordings/case_001_001_full.wav'
        backend.current_case_id = '001_001'
        backend.command = {'wakePath': 'wake'}
        backend.stopped = False
        backend.collect = lambda duration: None
        backend.play_info = {}
        now = [10.0]
        played = []
        def play(path):
            played.append((path, now[0]))
            return now[0]
        backend.play = play
        def frame():
            now[0] += .02
            return now[0], bytes(640), [0] * 320, 0
        backend.next_frame = frame
        backend.wake = lambda end: self.fail('Google must not wait for wake response')
        backend.reply = lambda end: dict(status='success', responseMs=1240)
        with contextlib.redirect_stdout(io.StringIO()):
            result = backend.attempt({'path': 'test'}, 1)
        self.assertEqual(result['status'], 'success')
        self.assertAlmostEqual(played[1][1] - played[0][1], 1, places=6)
        self.assertEqual(result['stages']['wakeResponse'], 'skipped')
        self.assertFalse(result['wakeDetected'])

    def test_stage_failure_is_saved_without_marking_following_stages_failed(self):
        for failure in ['wake', 'test', None]:
            backend = Backend.__new__(Backend)
            backend.current_recording = 'recordings/case_001_001_full.wav'
            backend.current_case_id = '001_001'
            backend.stopped = False
            backend.command = {'wakePath': 'wake'}
            backend.collect = lambda duration: None
            backend.last_wake_method = 'template'
            backend.play_info = {}
            def play(path):
                if path == failure:
                    raise OSError('device disconnected')
                return 1
            backend.play = play
            backend.wake = lambda end: (True, .99)
            backend.reply = lambda end: dict(status='success', responseMs=1240)
            with contextlib.redirect_stdout(io.StringIO()):
                result = backend.attempt({'path': 'test', 'text': '中文'}, 1)
            self.assertEqual(result['recording'], backend.current_recording)
            if failure == 'wake':
                self.assertEqual(result['stages'], dict(wakePlayback='failed', wakeResponse='not_run', testPlayback='not_run', reply='not_run'))
            elif failure == 'test':
                self.assertEqual(result['stages'], dict(wakePlayback='success', wakeResponse='success', testPlayback='failed', reply='not_run'))
            else:
                self.assertTrue(all(value == 'success' for value in result['stages'].values()))

    def test_full_case_wav_contains_mic_and_digital_playback_channels(self):
        backend = Backend.__new__(Backend)
        with tempfile.TemporaryDirectory() as folder:
            backend.folder = Path(folder)
            backend.writer = None
            backend.rate = 16000
            backend.failure = None
            backend.last_level_emit = 100
            backend.frames = queue.Queue()
            backend.begin_case('001_001')
            backend.frames.put((1, array.array('h', [100] * 320).tobytes(), '', array.array('h', [200] * 320).tobytes()))
            backend.next_frame()
            backend.end_case()
            with wave.open(str(Path(folder) / 'recordings/case_001_001_full.wav'), 'rb') as audio:
                self.assertEqual(audio.getnchannels(), 2)
                self.assertEqual(audio.getnframes(), 320)
                self.assertEqual(array.array('h', audio.readframes(1)).tolist(), [100, 200])


if __name__ == '__main__':
    unittest.main()
