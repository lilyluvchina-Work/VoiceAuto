"""Offline speech/music gating. Unknown/mixed audio never becomes a passed reply."""
import csv
from pathlib import Path


def classify_scores(speech, music):
    if speech >= .35 and music < .20 and speech - music >= .20:
        kind = 'speech'
    elif music >= .35 and speech < .20:
        kind = 'music'
    elif music >= .20 and speech >= .20:
        kind = 'mixed'
    else:
        kind = 'unknown'
    return dict(kind=kind, speech=float(speech), music=float(music))


class SoundClassifier:
    def __init__(self):
        try:
            import numpy as np
            import onnxruntime as ort
            directory = Path(__file__).resolve().parents[1] / '.audio-models' / 'yamnet'
            with (directory / 'yamnet_class_map.csv').open(encoding='utf-8') as source:
                labels = {row['display_name']: int(row['index']) for row in csv.DictReader(source)}
            self.speech_indices = [labels[name] for name in ('Speech', 'Child speech, kid speaking', 'Conversation', 'Narration, monologue', 'Speech synthesizer', 'Whispering')]
            self.music_indices = [labels[name] for name in ('Music', 'Singing', 'Choir', 'Rapping', 'Humming', 'Synthetic singing')]
            options = ort.SessionOptions()
            options.intra_op_num_threads = 2
            options.inter_op_num_threads = 1
            self.session = ort.InferenceSession(str(directory / 'yamnet.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
            self.np = np
            self.input_name = self.session.get_inputs()[0].name
            self.classify([0] * 15360, 16000)  # Warm up before opening hardware streams.
        except Exception as error:
            raise RuntimeError('语音/音乐分类模型不可用，请运行 scripts/installNativeAudio.ps1 安装依赖和模型') from error

    def classify(self, samples, rate):
        data = self.np.asarray(samples, dtype=self.np.float32)[::rate // 16000] / 32768
        if len(data) < 15360:
            data = self.np.pad(data, (0, 15360 - len(data)))
        scores = self.session.run(['output_0'], {self.input_name: data})[0]
        return classify_scores(float(scores[:, self.speech_indices].max()), float(scores[:, self.music_indices].max()))
