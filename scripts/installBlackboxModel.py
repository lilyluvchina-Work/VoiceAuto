"""Download the pinned, Apache-2.0 YAMNet ONNX conversion for offline inference."""
from pathlib import Path
from urllib.request import urlopen
import shutil
import sys
import zipfile
import io

REVISION = 'f25b741c2f0bdc6d7e6db24b5fddda23347dbafd'
DESTINATION = Path(__file__).resolve().parents[1] / '.audio-models' / 'yamnet'


def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for name in ('yamnet.onnx', 'yamnet_class_map.csv', 'LICENSE', 'README.md'):
        target = DESTINATION / name
        temporary = target.with_suffix(target.suffix + '.download')
        with urlopen(f'https://huggingface.co/audiomagic/yamnet-onnx/resolve/{REVISION}/{name}', timeout=60) as source, temporary.open('wb') as output:
            shutil.copyfileobj(source, output)
        temporary.replace(target)
        print(name, target.stat().st_size, flush=True)
    # Early CPython 3.11 alphas advertise cp311 but cannot load current cp311 wheels.
    # Keep the original environment intact and add a stable portable interpreter.
    if sys.platform == 'win32' and sys.version_info.releaselevel != 'final' and sys.version_info[:2] == (3, 11):
        runtime = DESTINATION.parents[1] / '.audio-python' / 'runtime311'
        runtime.mkdir(parents=True, exist_ok=True)
        with urlopen('https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip', timeout=60) as source:
            with zipfile.ZipFile(io.BytesIO(source.read())) as archive:
                for name in archive.namelist():
                    if not (runtime / name).resolve().is_relative_to(runtime.resolve()):
                        raise ValueError('Invalid portable runtime archive path')
                archive.extractall(runtime)
        (runtime / 'python311._pth').write_text('python311.zip\n.\n../Lib/site-packages\n../../scripts\nimport site\n', encoding='ascii')
        print('Stable portable Python installed in project audio environment', flush=True)


if __name__ == '__main__':
    main()
