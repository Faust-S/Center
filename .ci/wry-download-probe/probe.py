import argparse
import pathlib
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import urlopen

PAYLOAD = b'native-download-probe\n'
HTML = b'''<!doctype html><html lang="en"><meta charset="utf-8"><title>Download probe</title>
<a id="link" href="/download">Download file</a>
<script>document.getElementById('link').addEventListener('click',e=>window.ipc.postMessage('DOM '+Number(e.isTrusted)+' '+Number(navigator.userActivation.isActive)));</script></html>'''


def server(events):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def do_GET(self):
            if self.path == '/a':
                content, kind = HTML, 'text/html; charset=utf-8'
            elif self.path == '/download':
                events.append('HTTP_DOWNLOAD')
                content, kind = PAYLOAD, 'application/octet-stream'
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type',kind)
            self.send_header('Content-Length',str(len(content)))
            self.send_header('Cache-Control','no-store')
            if self.path == '/download':
                self.send_header('Content-Disposition','attachment; filename="probe.txt"')
            self.end_headers()
            self.wfile.write(content)
    return ThreadingHTTPServer(('127.0.0.1',0),Handler)


def classify(trace, events, saved):
    if trace.count('ARMED') != 1: return 'ARM_NOT_OBSERVED'
    before, after = trace[:trace.index('ARMED')], trace[trace.index('ARMED')+1:]
    if 'REQUEST_BLOCKED' not in before: return 'FIRST_REQUEST_NOT_OBSERVED'
    if not any(x.startswith('DOM ') for x in after): return 'SECOND_DOM_CLICK_NOT_OBSERVED'
    if events.count('HTTP_DOWNLOAD') != 2: return 'HTTP_COUNT_NOT_TWO'
    if 'REQUEST_ALLOWED' not in after: return 'SECOND_NATIVE_REQUEST_NOT_OBSERVED'
    if 'FINISH_SAVED' not in after or not saved: return 'SAVE_NOT_PROVED'
    return 'PASS'


def run(exe, mode):
    events=[]
    with tempfile.TemporaryDirectory(prefix='download-probe-',ignore_cleanup_errors=True) as name, server(events) as http:
        root=pathlib.Path(name)
        t=threading.Thread(target=http.serve_forever,daemon=True);t.start()
        proc=subprocess.Popen([str(exe),f'http://127.0.0.1:{http.server_port}/a',name])
        try:
            driver=pathlib.Path(__file__).with_name('driver.ps1')
            result=subprocess.run(['powershell.exe','-NoProfile','-STA','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(driver),'-ProcessId',str(proc.pid),'-Trace',str(root/'native.log'),'-Mode',mode],capture_output=True,text=True,timeout=160)
            print(result.stdout.strip(),flush=True)
            print('DRIVER_EXIT',result.returncode,flush=True)
            trace=(root/'native.log').read_text().splitlines() if (root/'native.log').exists() else []
            saved=(root/'saved.txt').is_file() and (root/'saved.txt').read_bytes()==PAYLOAD
            print('NATIVE',trace,'HTTP',events,'EXACT_BYTES',saved,flush=True)
            verdict=classify(trace,events,saved)
            if result.returncode != 0 and verdict == 'PASS': verdict='DRIVER_FAILED'
            print(mode.upper(),verdict,flush=True)
            return verdict
        finally:
            if proc.poll() is None: proc.terminate()
            proc.wait(timeout=10)
            http.shutdown();t.join(timeout=5)


def selftest():
    events=[]
    with server(events) as http:
        t=threading.Thread(target=http.serve_forever,daemon=True);t.start()
        try:
            base=f'http://127.0.0.1:{http.server_port}'
            assert b'Download file' in urlopen(base+'/a').read()
            for _ in range(2):
                with urlopen(base+'/download') as res:
                    assert res.headers['Content-Disposition']=='attachment; filename="probe.txt"'
                    assert res.read()==PAYLOAD
            assert events==['HTTP_DOWNLOAD']*2
        finally: http.shutdown();t.join(timeout=5)
    full=['READY','DOM 1 1','REQUEST_BLOCKED','FINISH_CANCELLED_OR_FAILED','ARMED','DOM 1 1','REQUEST_ALLOWED','FINISH_SAVED']
    assert classify(full,events,True)=='PASS'
    assert classify(full,events[:1],True)=='HTTP_COUNT_NOT_TWO'
    assert classify(full[:-1],events,True)=='SAVE_NOT_PROVED'
    assert classify(full,events,False)=='SAVE_NOT_PROVED'
    assert classify([x for x in full if x!='REQUEST_ALLOWED'],events,True)=='SECOND_NATIVE_REQUEST_NOT_OBSERVED'
    assert classify(full[:5]+full[6:],events,True)=='SECOND_DOM_CLICK_NOT_OBSERVED'
    assert classify([x for x in full if x!='REQUEST_BLOCKED'],events,True)=='FIRST_REQUEST_NOT_OBSERVED'
    assert classify([x for x in full if x!='ARMED'],events,True)=='ARM_NOT_OBSERVED'
    print('FIXTURE_AND_CLASSIFICATION_SELFTEST_PASS')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--selftest',action='store_true');p.add_argument('--exe',type=pathlib.Path);args=p.parse_args()
    selftest()
    if not args.selftest:
        if args.exe is None: p.error('--exe is required')
        failures=[]
        for mode in ('invoke','keyboard','mixed'):
            try: run(args.exe.resolve(),mode)
            except Exception as exc:
                print(mode.upper(),'INFRASTRUCTURE_ERROR',type(exc).__name__,flush=True)
                failures.append(mode)
        print('NATIVE_DIAGNOSTIC_NOT_PRODUCT_QUALIFICATION',flush=True)
        if failures: raise SystemExit(1)
