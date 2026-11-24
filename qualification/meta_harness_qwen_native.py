"""Independent native Qwen Code / llama.cpp qualification. Public synthetic inputs only."""
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from queue import Queue, Empty
import re
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import traceback
from threading import Thread
from time import monotonic, sleep
from urllib.request import Request, urlopen
import zipfile

WIN = os.name == "nt"
QWEN = ("qwen-code-win-x64.zip","81234b13006160d5bd6b9ab2d5a072964d38796c83e23ee3395c626cb141458a") if WIN else ("qwen-code-linux-x64.tar.gz","15d471ca7f08eed7898ec9c3dcf2e66dc8c29b61a943d0daece6cb19f48da3e7")
LLAMA = ("llama-b11827-bin-win-cpu-x64.zip","2740eeac6ed9b727a3a1002f5a42e74defa3c4cbb9a8b42b11356a07f969cb13") if WIN else ("llama-b11827-bin-ubuntu-x64.tar.gz","7c1de2b2a139aa90e28b88d44a75f5966485604f68aa0ccdc2339959bca9b5f6")
MODEL = "Qwen3-0.6B-Q8_0.gguf"
MODEL_SHA = "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031"
ALIAS = "qwen3-0.6b"
STAGE = "START"

def mark(stage):
    global STAGE
    STAGE = stage
    print("NATIVE_STAGE="+stage, flush=True)

def require(condition, code):
    if not condition:
        raise RuntimeError(code)

def download(url, dest, sha, limit):
    h = hashlib.sha256()
    size = 0
    with urlopen(Request(url, headers={"User-Agent":"IWXA-public-native-qualification/1"}),timeout=120) as response, dest.open("wb") as out:
        while chunk := response.read(1024*1024):
            size += len(chunk)
            require(size<=limit,"DOWNLOAD_LIMIT")
            h.update(chunk)
            out.write(chunk)
    require(h.hexdigest()==sha,"SHA256_MISMATCH")

def extract(path, target):
    target.mkdir()
    if path.suffix==".zip":
        with zipfile.ZipFile(path) as z:
            for info in z.infolist():
                resolved=(target/info.filename).resolve()
                require(resolved.is_relative_to(target.resolve()),"ARCHIVE_PATH")
                require((info.external_attr>>16)&0o170000!=0o120000,"ARCHIVE_LINK")
            require(sum(x.file_size for x in z.infolist())<=2_000_000_000,"ARCHIVE_SIZE")
            z.extractall(target)
    else:
        with tarfile.open(path) as t:
            require(sum(x.size for x in t.getmembers())<=2_000_000_000,"ARCHIVE_SIZE")
            t.extractall(target,filter="data")

def find(root, name):
    matches=[x for x in root.rglob(name) if x.is_file()]
    require(len(matches)==1,"BINARY_LAYOUT")
    return matches[0].resolve()

def spawn(args, **kwargs):
    return subprocess.Popen([str(x) for x in args], shell=False,
        **({"creationflags":subprocess.CREATE_NEW_PROCESS_GROUP} if WIN else {"start_new_session":True}), **kwargs)

def stop(p):
    if p is None:
        return
    if WIN:
        if p.poll() is None:
            subprocess.run(["taskkill","/PID",str(p.pid),"/T","/F"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=20)
    else:
        try: os.killpg(p.pid,signal.SIGKILL)
        except ProcessLookupError: pass
    if p.poll() is None:
        p.kill()
    p.wait(timeout=20)

class Client:
    def __init__(self, args, env, cwd, stderr):
        self.p=spawn(args,env=env,cwd=cwd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=stderr)
        self.q=Queue(maxsize=1024)
        self.seq=0
        self.events=[]
        self.reader=Thread(target=self.read,daemon=True)
        self.reader.start()
    def read(self):
        try:
            for line in self.p.stdout:
                self.q.put(line,timeout=10)
        finally:
            try: self.q.put(None,timeout=1)
            except Exception: pass
    def send(self, message):
        self.p.stdin.write((json.dumps(message,ensure_ascii=False)+"\n").encode())
        self.p.stdin.flush()
    def call(self, method, params, timeout=180):
        self.seq+=1
        i=self.seq
        self.send({"jsonrpc":"2.0","id":i,"method":method,"params":params})
        deadline=monotonic()+timeout
        while monotonic()<deadline:
            try: raw=self.q.get(timeout=max(.1,deadline-monotonic()))
            except Empty: raise RuntimeError("ACP_TIMEOUT")
            require(raw is not None,"ACP_EOF")
            require(len(raw)<=8_000_000,"ACP_LINE_LIMIT")
            m=json.loads(raw)
            if "method" in m:
                if "id" in m:
                    # No tool authority in this independent test.
                    if m["method"]=="session/request_permission":
                        self.send({"jsonrpc":"2.0","id":m["id"],"result":{"outcome":{"outcome":"cancelled"}}})
                    else:
                        self.send({"jsonrpc":"2.0","id":m["id"],"error":{"code":-32601,"message":"Not granted"}})
                elif m["method"]=="session/update":
                    self.events.append(m["params"])
            elif m.get("id")==i:
                require("error" not in m,"ACP_REMOTE_ERROR")
                return m["result"]
        raise RuntimeError("ACP_TIMEOUT")
    def close(self):
        stop(self.p)

class DiagnosticProxy(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,port):
        self.model_port=port
        self.posts=0
        super().__init__(("127.0.0.1",0),DiagnosticHandler)

class DiagnosticHandler(BaseHTTPRequestHandler):
    protocol_version="HTTP/1.0"
    def log_message(self,*args): pass
    def do_GET(self): self.forward()
    def do_POST(self): self.forward()
    def forward(self):
        if (self.command,self.path) not in {("GET","/v1/models"),("POST","/v1/chat/completions")}:
            print("NATIVE_API_UNEXPECTED_ROUTE=1",flush=True)
            self.send_error(404);return
        n=int(self.headers.get("Content-Length","0"))
        if n<0 or n>8_000_000:
            self.send_error(413);return
        raw=self.rfile.read(n)
        if self.command=="POST":
            self.server.posts+=1
            data=json.loads(raw)
            print("NATIVE_API_REQUEST="+json.dumps({"number":self.server.posts,"model_match":data.get("model")==ALIAS,
                "stream":data.get("stream",False),"bytes":n,"max_tokens":data.get("max_tokens")}),flush=True)
        upstream=http.client.HTTPConnection("127.0.0.1",self.server.model_port,timeout=150)
        started=monotonic()
        try:
            upstream.request(self.command,self.path,body=raw if n else None,headers={"Content-Type":"application/json"})
            result=upstream.getresponse()
            print("NATIVE_API_STATUS="+str(result.status),flush=True)
            self.send_response(result.status)
            self.send_header("Content-Type",result.getheader("Content-Type","application/json"))
            self.send_header("Connection","close");self.end_headers()
            total=0
            while chunk:=result.read1(16384):
                self.wfile.write(chunk);self.wfile.flush();total+=len(chunk)
            print("NATIVE_API_COMPLETE="+json.dumps({"bytes":total,"ms":int((monotonic()-started)*1000)}),flush=True)
        except (OSError,http.client.HTTPException) as exc:
            print("NATIVE_API_ERROR="+type(exc).__name__,flush=True)
        finally: upstream.close()

def direct_smoke(port):
    before=metric(port)
    body={"model":ALIAS,"messages":[{"role":"user","content":"Say hello. /no_think"}],
          "max_tokens":16,"stream":False,"chat_template_kwargs":{"enable_thinking":False}}
    req=Request("http://127.0.0.1:"+str(port)+"/v1/chat/completions",
                data=json.dumps(body).encode(),headers={"Content-Type":"application/json"})
    with urlopen(req,timeout=90) as response:
        result=json.loads(response.read())
    require(bool(result.get("choices")),"DIRECT_API_NO_CHOICES")
    count=metric(port)-before
    require(count>0,"DIRECT_API_NO_INFERENCE")
    print("NATIVE_DIRECT_GENERATED_TOKENS="+str(int(count)),flush=True)

def metric(port):
    with urlopen("http://127.0.0.1:"+str(port)+"/metrics",timeout=10) as r:
        raw=r.read().decode()
    found=re.findall(r"(?m)^llamacpp:tokens_predicted_total(?:\{[^\n]*\})?\s+([0-9.eE+-]+)\s*$",raw)
    require(bool(found),"INFERENCE_METRIC_MISSING")
    return sum(float(x) for x in found)

def prompt(client,sid,text):
    client.events.clear()
    try:
        turn=client.call("session/prompt",{"sessionId":sid,"prompt":[{"type":"text","text":text}]},timeout=240)
    finally:
        kinds={}
        for event in client.events:
            kind=event.get("update",{}).get("sessionUpdate","unknown")
            if isinstance(kind,str) and re.fullmatch(r"[a-zA-Z0-9_]+",kind):
                kinds[kind]=kinds.get(kind,0)+1
        print("NATIVE_ACP_UPDATES="+json.dumps(kinds),flush=True)
    chunks=[u["update"]["content"].get("text","") for u in client.events
            if u.get("sessionId")==sid and u.get("update",{}).get("sessionUpdate")=="agent_message_chunk"
            and u["update"].get("content",{}).get("type")=="text"]
    require(turn.get("stopReason")=="end_turn","PROMPT_STOP_"+str(turn.get("stopReason")))
    require(bool("".join(chunks).strip()),"PROMPT_EMPTY")
    return "".join(chunks),len(chunks)

def run(root):
    mark("PINNED_QWEN_DOWNLOAD")
    download("https://github.com/QwenLM/qwen-code/releases/download/v0.28.4/"+QWEN[0],root/QWEN[0],QWEN[1],250_000_000)
    extract(root/QWEN[0],root/"qwen")
    mark("PINNED_LLAMA_DOWNLOAD")
    download("https://github.com/ggml-org/llama.cpp/releases/download/b11827/"+LLAMA[0],root/LLAMA[0],LLAMA[1],300_000_000)
    extract(root/LLAMA[0],root/"llama")
    mark("PINNED_MODEL_DOWNLOAD")
    download("https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/"+MODEL,root/MODEL,MODEL_SHA,900_000_000)
    node=find(root/"qwen","node.exe" if WIN else "node")
    entry=find(root/"qwen","cli-entry.js")
    server=find(root/"llama","llama-server.exe" if WIN else "llama-server")
    home=root/"home";home.mkdir()
    cwd=root/"workspace";cwd.mkdir()
    tmp=root/"tmp";tmp.mkdir()
    env={k:os.environ[k] for k in ("PATH","SYSTEMROOT","WINDIR","COMSPEC","PATHEXT","LANG","LC_ALL") if k in os.environ}
    env.update({"HOME":str(home),"USERPROFILE":str(home),"APPDATA":str(home),"LOCALAPPDATA":str(home),
        "XDG_CONFIG_HOME":str(home),"XDG_DATA_HOME":str(home),"XDG_CACHE_HOME":str(home),
        "TMPDIR":str(tmp),"TEMP":str(tmp),"TMP":str(tmp),"CI":"true","NO_PROXY":"127.0.0.1,localhost",
        "QWEN_USAGE_STATISTICS_ENABLED":"false","QWEN_TELEMETRY_ENABLED":"false",
        "QWEN_CODE_LAUNCHER_PATH":str(find(root/"qwen","qwen.cmd" if WIN else "qwen"))})
    with socket.socket() as sock:
        sock.bind(("127.0.0.1",0));port=sock.getsockname()[1]
    proxy=DiagnosticProxy(port)
    base="http://127.0.0.1:"+str(proxy.server_port)+"/v1"
    env.update({"OPENAI_API_KEY":"public-local-test","IWXA_LOCAL_API_KEY":"public-local-test","OPENAI_BASE_URL":base,"OPENAI_MODEL":ALIAS})
    settings={"modelProviders":{"openai":[{"id":ALIAS,"baseUrl":base,"envKey":"IWXA_LOCAL_API_KEY",
        "name":"Qwen3 local qualification","wireApi":"chat-completions","capabilities":{"reasoning":{"profile":"qwen-chat-template"}},
        "generationConfig":{"contextWindowSize":32768,"timeout":120000,"streamIdleTimeoutMs":120000,"maxRetries":0,"samplingParams":{"temperature":0.1,"max_tokens":128},
        "extra_body":{"chat_template_kwargs":{"enable_thinking":False}}}}]},
        "security":{"auth":{"selectedType":"openai"}},"model":{"name":ALIAS},"privacy":{"usageStatisticsEnabled":False}}
    (home/".qwen").mkdir()
    (home/".qwen"/"settings.json").write_text(json.dumps(settings),encoding="utf-8")
    args=[node,entry,"--acp","--approval-mode","plan","--model",ALIAS]
    llama=None; c=None; proxy_thread=None
    with (root/"llama.log").open("wb") as log,(root/"qwen.log").open("wb") as err:
        try:
            mark("NATIVE_VERSION")
            v=subprocess.run([str(node),str(entry),"--version"],env=env,cwd=cwd,capture_output=True,timeout=60)
            require(v.returncode==0 and b"0.28.4" in v.stdout+v.stderr,"QWEN_VERSION")
            mark("REAL_MODEL_START")
            llama=spawn([server,"-m",root/MODEL,"--host","127.0.0.1","--port",str(port),"--alias",ALIAS,
                 "--ctx-size","32768","--parallel","1","--jinja","--n-predict","128","--threads","4","--metrics"],
                stdout=log,stderr=log,cwd=server.parent,env=env)
            deadline=monotonic()+180
            while monotonic()<deadline:
                require(llama.poll() is None,"LLAMA_EXIT")
                try:
                    with urlopen("http://127.0.0.1:"+str(port)+"/health",timeout=2) as response:
                        if json.loads(response.read()).get("status")=="ok": break
                except Exception: sleep(1)
            else: raise RuntimeError("LLAMA_NOT_READY")
            mark("DIRECT_API")
            direct_smoke(port)
            before=metric(port)
            proxy_thread=Thread(target=proxy.serve_forever,daemon=True);proxy_thread.start()
            mark("ACP_INITIALIZE")
            c=Client(args,env,cwd,err)
            init=c.call("initialize",{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"iwxa-public-qualification","version":"1"}},timeout=120)
            require(init.get("protocolVersion")==1,"ACP_VERSION")
            caps=init.get("agentCapabilities",{})
            print("NATIVE_CAPS="+json.dumps({"loadSession":caps.get("loadSession",False),"promptCapabilities":caps.get("promptCapabilities",{})}),flush=True)
            mark("ACP_SESSION")
            session=c.call("session/new",{"cwd":str(cwd),"mcpServers":[]})
            sid=session["sessionId"]
            require(isinstance(sid,str) and bool(sid),"SESSION_ID")
            mark("REAL_INFERENCE_FIRST")
            answer,n=prompt(c,sid,"Reply with a short greeting. Do not use tools or write files. /no_think")
            after=metric(port)
            require(after>before,"NO_REAL_INFERENCE_FIRST")
            print("NATIVE_FIRST_CHUNKS="+str(n),flush=True)
            print("NATIVE_FIRST_GENERATED_TOKENS="+str(int(after-before)),flush=True)
            c.close();c=None
            mark("ACP_RESTART")
            c=Client(args,env,cwd,err)
            c.call("initialize",{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"iwxa-public-qualification","version":"1"}},timeout=120)
            require(caps.get("loadSession") is True,"NATIVE_LOAD_SESSION_NOT_ADVERTISED")
            c.call("session/load",{"sessionId":sid,"cwd":str(cwd),"mcpServers":[]})
            mark("REAL_INFERENCE_RESTORED")
            answer2,n2=prompt(c,sid,"Reply with one short farewell. Do not use tools or write files. /no_think")
            last=metric(port)
            require(last>after,"NO_REAL_INFERENCE_RESTORED")
            print("NATIVE_RESTORED_CHUNKS="+str(n2),flush=True)
            print("NATIVE_RESTORED_GENERATED_TOKENS="+str(int(last-after)),flush=True)
            mark("ACP_FINAL_CLOSE")
            c.close();c=None
            mark("WORKSPACE_VERIFY")
            require(not any(cwd.iterdir()),"UNEXPECTED_WORKSPACE_WRITE")
            mark("PASS")
        finally:
            if c: c.close()
            if proxy_thread: proxy.shutdown()
            proxy.server_close()
            print("NATIVE_API_POSTS="+str(proxy.posts),flush=True)
            stop(llama)

if __name__=="__main__":
    try:
        with tempfile.TemporaryDirectory(prefix="iwxa-public-qwen-") as temp:
            run(Path(temp).resolve())
    except Exception as exc:
        print("NATIVE_FAILURE_STAGE="+STAGE,flush=True)
        print("NATIVE_FAILURE_TYPE="+type(exc).__name__,flush=True)
        print("NATIVE_FAILURE_TRACE="+json.dumps([{"file":Path(f.filename).name,"line":f.lineno,"function":f.name} for f in traceback.extract_tb(exc.__traceback__)]),flush=True)
        if isinstance(exc,OSError):
            print("NATIVE_FAILURE_ERRNO="+str(exc.errno),flush=True)
        if type(exc) is RuntimeError and re.fullmatch(r"[A-Z0-9_]+",str(exc)):
            print("NATIVE_FAILURE_CODE="+str(exc),flush=True)
        sys.exit(1)
