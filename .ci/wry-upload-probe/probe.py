"""Public fixture; no Agent code, credentials, profiles, or private paths."""
import argparse
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import tempfile
import threading
from urllib.request import Request, urlopen

PAYLOAD = b'native-download-probe\n'
UPLOAD = b'native-file-picker-proof\n'
NAME = 'iwxa-upload.txt'
MODES = ('strict', 'anchored', 'keyboard')
HTML = b'''<!doctype html><html lang="en"><meta charset="utf-8"><title>File picker probe</title>
<a id="link" href="/download">Download file</a>
<form id="form" method="post" enctype="multipart/form-data" action="/upload">
<label for="fixture-upload">Qualification upload</label>
<input id="fixture-upload" name="file" type="file">
<button id="fixture-upload-submit" type="submit">Submit qualification file</button></form>
<script>
const report=x=>window.ipc.postMessage(x);
const input=document.getElementById('fixture-upload');
const activation=e=>Number(e.isTrusted)+' '+Number(navigator.userActivation.isActive);
document.getElementById('link').addEventListener('click',e=>report('DOM '+activation(e)));
input.addEventListener('click',e=>report('PICKER '+activation(e)));
input.addEventListener('change',()=>report(input.files.length===1 && input.files[0].name==='iwxa-upload.txt' && input.files[0].size===25?'FILE_SELECTED':'FILE_WRONG'));
document.getElementById('form').addEventListener('submit',()=>report('UPLOAD_SUBMIT'));
</script></html>'''


def valid_upload(content_type, body):
    if not content_type.startswith('multipart/form-data;') or not 0 < len(body) <= 65536:
        return False
    try:
        msg = BytesParser(policy=policy.default).parsebytes(
            b'Content-Type: ' + content_type.encode('ascii') + b'\r\nMIME-Version: 1.0\r\n\r\n' + body)
        if not msg.is_multipart() or msg.defects:
            return False
        parts = list(msg.iter_parts())
        return (len(parts) == 1 and not parts[0].defects
                and parts[0].get_content_disposition() == 'form-data'
                and parts[0].get_param('name', header='content-disposition') == 'file'
                and parts[0].get_filename() == NAME
                and parts[0].get_payload(decode=True) == UPLOAD)
    except (ValueError, TypeError, UnicodeError):
        return False


def server(events):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass

        def answer(self, body, kind, attachment=False):
            self.send_response(200)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            if attachment:
                self.send_header('Content-Disposition', 'attachment; filename="probe.txt"')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == '/a':
                self.answer(HTML, 'text/html; charset=utf-8')
            elif self.path == '/download':
                events.append('HTTP_DOWNLOAD')
                self.answer(PAYLOAD, 'application/octet-stream', True)
            else:
                self.send_error(404)

        def do_POST(self):
            try:
                n = int(self.headers.get('Content-Length', '0'))
                good = self.path == '/upload' and 0 < n <= 65536 and valid_upload(
                    self.headers.get('Content-Type', ''), self.rfile.read(n))
            except (ValueError, OSError):
                good = False
            events.append('UPLOAD_EXACT' if good else 'UPLOAD_REJECTED')
            if good:
                self.answer(b'<title>Upload proof</title><h1>Upload accepted</h1>', 'text/html; charset=utf-8')
            else:
                self.send_error(400)

    return ThreadingHTTPServer(('127.0.0.1', 0), Handler)


def classify(trace, events, saved, driver_ok):
    if (trace.count('REQUEST_BLOCKED'), trace.count('REQUEST_ALLOWED'), trace.count('FINISH_SAVED'),
            events.count('HTTP_DOWNLOAD'), saved) != (2, 1, 1, 3, True):
        return 'DOWNLOAD_PRECONDITION_NOT_PROVED'
    if not any(x.startswith('PICKER ') for x in trace):
        return 'PICKER_DOM_NOT_OBSERVED'
    if trace.count('FILE_SELECTED') != 1 or 'FILE_WRONG' in trace:
        return 'FILE_SELECTION_NOT_PROVED'
    if trace.count('UPLOAD_SUBMIT') != 1:
        return 'FORM_SUBMISSION_NOT_PROVED'
    if events != ['HTTP_DOWNLOAD'] * 3 + ['UPLOAD_EXACT']:
        return 'EXACT_HTTP_UPLOAD_NOT_PROVED'
    return 'PASS' if driver_ok else 'GUI_READBACK_NOT_PROVED'


def run(exe, mode):
    events = []
    with tempfile.TemporaryDirectory(prefix='native-upload-probe-', ignore_cleanup_errors=True) as directory, server(events) as http:
        root = Path(directory)
        fixture = root / NAME
        fixture.write_bytes(UPLOAD)
        t = threading.Thread(target=http.serve_forever, daemon=True)
        t.start()
        proc = subprocess.Popen([str(exe), f'http://127.0.0.1:{http.server_port}/a', directory])
        try:
            try:
                result = subprocess.run(['powershell.exe', '-NoProfile', '-STA', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                                         '-File', str(Path(__file__).with_name('driver.ps1')), '-ProcessId', str(proc.pid),
                                         '-Trace', str(root/'native.log'), '-Fixture', str(fixture), '-Mode', mode],
                                        capture_output=True, text=True, timeout=240)
                print(result.stdout.strip(), flush=True)
                driver_exit = result.returncode
            except subprocess.TimeoutExpired as exc:
                print((exc.stdout or b'').decode(errors='replace') if isinstance(exc.stdout, bytes) else (exc.stdout or ''), flush=True)
                print('DRIVER_TIMEOUT', flush=True)
                driver_exit = 124
            trace = (root/'native.log').read_text().splitlines() if (root/'native.log').exists() else []
            saved = (root/'saved.txt').is_file() and (root/'saved.txt').read_bytes() == PAYLOAD
            print('TRACE', trace, 'HTTP', events, 'EXACT_DOWNLOAD', saved, 'DRIVER_EXIT', driver_exit, flush=True)
            verdict = classify(trace, events, saved, driver_exit == 0)
            print(mode.upper(), verdict, flush=True)
            return verdict
        finally:
            if proc.poll() is None:
                proc.terminate()
            proc.wait(timeout=10)
            http.shutdown()
            t.join(timeout=5)


def selftest():
    assert len(UPLOAD) == 25
    boundary = 'public-probe-boundary'
    kind = 'multipart/form-data; boundary=' + boundary
    body = (b'--public-probe-boundary\r\nContent-Disposition: form-data; name="file"; filename="iwxa-upload.txt"\r\n'
            b'Content-Type: text/plain\r\n\r\n' + UPLOAD + b'\r\n--public-probe-boundary--\r\n')
    assert valid_upload(kind, body)
    for changed in (body.replace(UPLOAD, b'wrong'), body.replace(b'iwxa-upload.txt', b'other.txt'),
                    body.replace(b'name="file"', b'name="other"'), b'not multipart'):
        assert not valid_upload(kind, changed)
    events = []
    with server(events) as http:
        t = threading.Thread(target=http.serve_forever, daemon=True)
        t.start()
        try:
            base = f'http://127.0.0.1:{http.server_port}'
            with urlopen(base+'/a') as res:
                assert b'type="file"' in res.read()
            for _ in range(3):
                with urlopen(base+'/download') as res:
                    assert res.read() == PAYLOAD
            with urlopen(Request(base+'/upload', data=body, headers={'Content-Type':kind})) as res:
                assert b'Upload accepted' in res.read()
        finally:
            http.shutdown()
            t.join(timeout=5)
    trace = ['REQUEST_BLOCKED','ARMED','REQUEST_ALLOWED','FINISH_SAVED','REQUEST_BLOCKED','PICKER 1 1','FILE_SELECTED','UPLOAD_SUBMIT']
    assert classify(trace, events, True, True) == 'PASS'
    for marker, expected in [('FINISH_SAVED','DOWNLOAD_PRECONDITION_NOT_PROVED'),('PICKER 1 1','PICKER_DOM_NOT_OBSERVED'),
                             ('FILE_SELECTED','FILE_SELECTION_NOT_PROVED'),('UPLOAD_SUBMIT','FORM_SUBMISSION_NOT_PROVED')]:
        assert classify([x for x in trace if x != marker], events, True, True) == expected
    assert classify(trace, events[:-1], True, True) == 'EXACT_HTTP_UPLOAD_NOT_PROVED'
    assert classify(trace, events+['UPLOAD_EXACT'], True, True) == 'EXACT_HTTP_UPLOAD_NOT_PROVED'
    assert classify(trace, events, False, True) == 'DOWNLOAD_PRECONDITION_NOT_PROVED'
    assert classify(trace, events, True, False) == 'GUI_READBACK_NOT_PROVED'
    print('UPLOAD_FIXTURE_AND_EVIDENCE_SELFTEST_PASS')


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--selftest', action='store_true')
    p.add_argument('--exe', type=Path)
    args = p.parse_args()
    selftest()
    if not args.selftest:
        if args.exe is None:
            p.error('--exe is required')
        errors = []
        for mode in MODES:
            try:
                run(args.exe.resolve(), mode)
            except Exception as exc:
                print(mode.upper(), 'INFRASTRUCTURE_ERROR', type(exc).__name__, flush=True)
                errors.append(mode)
        print('NATIVE_DIAGNOSTIC_NOT_PRODUCT_QUALIFICATION', flush=True)
        if errors:
            raise SystemExit(1)
