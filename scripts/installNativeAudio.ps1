$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
python -m venv (Join-Path $projectRoot '.audio-python')
if ($LASTEXITCODE -ne 0) { throw 'Unable to create audio Python environment' }
& (Join-Path $projectRoot '.audio-python\Scripts\python.exe') -m pip install -r (Join-Path $PSScriptRoot 'native-audio-requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Unable to install native audio dependencies' }
& (Join-Path $projectRoot '.audio-python\Scripts\python.exe') (Join-Path $PSScriptRoot 'installBlackboxModel.py')
if ($LASTEXITCODE -ne 0) { throw 'Unable to download blackbox speech/music model' }
