"""Synthetic qualification of existing SessionRuntime; no production adapter."""
import contextlib, io, json, pathlib, sys
agent, instance = map(pathlib.Path, sys.argv[1:3])
sys.path.insert(0, str(agent.resolve()))
# The Node fixture sends exact UTF-8 JSON, independently of OS code page.
request = json.loads(sys.stdin.buffer.read().decode('utf-8', errors='strict'))
PROFILE = "workflow-qualification"
WS = "stage-result-workspace"
PERMISSIONS = {"memory":False,"obsidian":False,"web":False,"selected_notes":False}
try:
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        from runtime.session_runtime import SessionRuntime
        session = SessionRuntime(instance)
        with session.lock:
            active = session.workspace_catalog(PROFILE)["active_id"]
            binding = {"subjectKind":"PERSONAL","sourceWorkspaceId":WS,
                       "agentWorkspaceId":active,"contextEpoch":"qualification-"+active}
            op = request["op"]
            if op == "binding":
                result = binding
            elif op == "area":
                result = session.workspace_create(PROFILE, request["name"], "", True, PERMISSIONS)
            elif op == "select":
                result = session.workspace_select(PROFILE, request["area"])
            elif op == "seed":
                result = session.composer_draft(PROFILE, text=request["text"], task_context=True)
            elif op == "pending":
                current = session.composer_draft(PROFILE, task_context=True)
                # Exercise the actual pending reservation API in a separate test below
                # only if a valid reservation exists. Never synthesize owner state.
                result = current
            elif op == "composer":
                if binding != request["binding"]:
                    raise ValueError("binding changed")
                data = request["input"]
                current = session.composer_draft(PROFILE, task_context=True)
                if "text" not in data:
                    result = current
                else:
                    if (current["draft_digest"] != data["expected_draft_digest"] or
                        current["pending_submission"] is not None or current["text"] or
                        current["attachments"] or current["knowledge_sources"]):
                        raise ValueError("occupied or changed")
                    result = session.composer_draft(PROFILE, text=data["text"],
                        attachments=data["attachments"], knowledge_sources=data["knowledge_sources"],
                        expected_draft_digest=data["expected_draft_digest"], task_context=True)
            else:
                raise ValueError("unknown synthetic operation")
    print(json.dumps({"ok":True,"result":result}, ensure_ascii=True))
except Exception:
    # No private paths, stack traces, source, or data on a public runner.
    print('{"ok":false,"code":"ORIGINAL_COMPOSER_REFUSED"}')
