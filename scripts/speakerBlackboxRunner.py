"""Retry policy independent of hardware. Every attempt is checkpointed."""
from speakerBlackboxControl import PauseRequested


def run_cases(cases, config, backend, save):
    for repeat in range(1, config['repeatCount'] + 1):
        for index, case in enumerate(cases, 1):
            if backend.stopped:
                return
            case_id = f"{index:03}_{repeat:03}"
            try:
                if hasattr(backend, 'begin_case'):
                    backend.begin_case(case_id)
                _run_case(case, case_id, repeat, config, backend, save)
            finally:
                if hasattr(backend, 'end_case'):
                    backend.end_case()
            if backend.stopped or getattr(backend, 'case_error', False):
                return


def _run_case(case, case_id, repeat, config, backend, save):
    backend.case_error = False
    number, retries = 1, 0
    while retries <= config['extraRetries']:
        if backend.stopped:
            return
        result = dict(caseId=case_id, sourceId=case.get('sourceId', case.get('id')), name=case.get('name', ''),
                      text=case.get('text', case.get('name', '')),
                      language=case.get('language', config.get('language', 'zh')),
                      repeat=repeat, attempt=number, wakeDetected=False, responseMs=None,
                      overlap=False, flags=[], caseCompleted=False)
        if getattr(backend, 'current_recording', None):
            result['recording'] = backend.current_recording
        result['stages'] = {key: 'not_run' for key in ('wakePlayback', 'wakeResponse', 'testPlayback', 'reply')}
        try:
            backend.current_case_id = case_id
            if hasattr(backend, 'checkpoint'):
                backend.checkpoint(result)
            pre_wake_flags = backend.quiet(config['retrySilenceMs'] if number > 1 else config['silenceMs']) or []
            if backend.stopped:
                result['status'] = 'aborted'
                save(result)
                return
            result.update(backend.attempt(case, number))
            result['flags'] = pre_wake_flags + result.get('flags', [])
        except PauseRequested:
            result.update(status='paused', responseMs=None, flags=['用户暂停，继续时重新执行当前用例'])
        except Exception as error:
            result.update(status='aborted' if backend.stopped else 'error', error=str(error))
            if getattr(backend, 'current_recording', None):
                result['recording'] = backend.current_recording
        status = result['status']
        result['caseCompleted'] = status in ('success', 'music_only', 'needs_review') or (status in ('wake_timeout', 'reply_timeout') and retries == config['extraRetries'])
        save(result)
        if status == 'paused':
            backend.wait_for_resume()
            number += 1
            continue
        if status in ('error', 'aborted', 'interrupted'):
            backend.case_error = True
            return
        if result['caseCompleted']:
            break
        number += 1
        retries += 1
