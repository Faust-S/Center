"""Qualification only. Use the original Core, demo model and Human Review.
All synthetic state stays on the runner; only a fixed status is published.
"""
import contextlib, io, json, pathlib, sys
agent, instance = map(pathlib.Path, sys.argv[1:3])
sys.path.insert(0, str(agent.resolve()))
# The Node fixture sends exact UTF-8 JSON, independently of OS code page.
request = json.loads(sys.stdin.buffer.read().decode('utf-8', errors='strict'))
phase = 'IMPORT'
try:
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        from runtime.daily_driver_engine import DailyDriverEngine
        from runtime import personal_agent as core
        phase = 'CONFIG'
        instance.mkdir(parents=True, exist_ok=True)
        config_path = instance / "qualification-config.json"
        if not config_path.exists():
            config = json.loads((agent / "config/daily-driver.example.json").read_text(encoding="utf-8"))
            config["instance_root"] = str(instance / "data")
            config_path.write_text(json.dumps(config), encoding="utf-8")
        phase = 'ENGINE_INIT'
        engine = DailyDriverEngine(config_path)
        phase = 'AREA'
        profile = engine.config.get("_storage_profile_id", "DEFAULT")
        active = engine.sessions.workspace_catalog(profile)["active_id"]
        if active != "personal":
            raise ValueError("fixture area changed")
        op = request["op"]
        binding = {"subjectKind":"PERSONAL","sourceWorkspaceId":"stage-result-workspace",
                   "agentWorkspaceId":active,"contextEpoch":"qualification-"+active}
        if op == "binding":
            result = binding
        elif op == "composer":
            if request["binding"] != binding:
                raise ValueError("fixture binding changed")
            with engine.sessions.lock:
                if engine.sessions.workspace_catalog(profile)["active_id"] != active:
                    raise ValueError("fixture active area changed")
                data = request["input"]
                phase = "DRAFT_READ"
                current = engine.sessions.composer_draft(profile, task_context=True)
                if "text" not in data:
                    result = current
                else:
                    if (current["draft_digest"] != data["expected_draft_digest"] or
                            current["pending_submission"] is not None or current["text"] or
                            current["attachments"] or current["knowledge_sources"]):
                        raise ValueError("fixture composer occupied or changed")
                    phase = "COMPOSER_WRITE"
                    result = engine.sessions.composer_draft(profile, text=data["text"],
                        attachments=data["attachments"], knowledge_sources=data["knowledge_sources"],
                        expected_draft_digest=current["draft_digest"], task_context=True)
        elif op == "clear" or op == "submit":
            # Explicit synthetic human action, not part of the product bridge.
            # Submit only the original cold-readback composer, never JS plan bytes.
            if request["binding"] != binding:
                raise ValueError("fixture binding changed")
            phase = "DRAFT_READ"
            current = engine.sessions.composer_draft(profile, task_context=True)
            if (current["draft_digest"] != request["expectedDraftDigest"] or
                    not current["text"].strip() or current["pending_submission"] is not None):
                raise ValueError("fixture composer changed")
            if op == "submit":
                phase = "TASK_CHAT"
                created = engine.chat(current["text"], attachments=current["attachments"],
                    knowledge_sources=current["knowledge_sources"], use_memory=False,
                    use_obsidian=False, use_web=False)
                tid = created["task_id"]
                phase = "TASK_REVIEW"
                engine.review(tid, "approve")
            phase = "CLEAR_CHECK"
            latest = engine.sessions.composer_draft(profile, task_context=True)
            if latest["pending_submission"] is not None:
                raise ValueError("fixture pending submission")
            if latest["text"] or latest["attachments"] or latest["knowledge_sources"]:
                if latest["draft_digest"] != current["draft_digest"]:
                    raise ValueError("fixture composer changed after submit")
                phase = "CLEAR_WRITE"
                cleared = engine.sessions.composer_draft(profile, text="", attachments=[],
                    knowledge_sources=[], expected_draft_digest=latest["draft_digest"], task_context=True)
            else:
                # The original owner may already have consumed the exact draft.
                # Never clear a different user's content after a task completes.
                cleared = latest
            if cleared["text"] or cleared["attachments"] or cleared["knowledge_sources"]:
                raise ValueError("fixture composer was not cleared")
            result = {"taskId":tid} if op == "submit" else cleared
        elif op == "execute":
            # This qualification fixture explicitly simulates a user's
            # separate submission and Human Review. Product bridge never does so.
            draft = request["draft"]
            phase = 'DRAFT_READ'
            empty = engine.sessions.composer_draft(profile, task_context=True)
            if empty["text"] or empty["pending_submission"] is not None:
                raise ValueError("fixture composer occupied")
            phase = 'DRAFT_SAVE'
            saved = engine.sessions.composer_draft(profile, text=draft["text"],
                attachments=draft["attachments"], knowledge_sources=draft["knowledge_sources"],
                expected_draft_digest=empty["draft_digest"], task_context=True)
            reopened = engine.sessions.composer_draft(profile, task_context=True)
            if saved != reopened:
                raise ValueError("fixture draft readback mismatch")
            phase = 'TASK_CHAT'
            created = engine.chat(reopened["text"], attachments=reopened["attachments"],
                knowledge_sources=reopened["knowledge_sources"], use_memory=False,
                use_obsidian=False, use_web=False)
            tid = created["task_id"]
            phase = "TASK_REVIEW"
            engine.review(tid,"approve")
            result = {"taskId":tid}
        elif op == "submit_native":
            # Synthetic input-consumption qualification only. Exercise the
            # ORIGINAL durable Task admission used by corporate Agent, in the
            # isolated fixture area. No corporate entitlement/Host bypass.
            from runtime.t3_original_employee_port import OriginalEmployeePort
            signed = request["signed"]
            inputs = request["inputs"]
            keys = ("organizationId", "workspaceId", "executorId",
                    "taskId", "taskRevisionId", "packageSha256")
            original = {key: signed[key] for key in keys}
            submission = OriginalEmployeePort.submission_id(original)
            if (inputs["state"] != "CORPORATE_TASK_TEXT_INPUTS_PREPARED" or
                    inputs["task"] != signed["task"] or
                    inputs["recipientId"] != signed["executorId"] or
                    any(inputs[key] != original[key] for key in keys if key != "executorId") or
                    inputs["executionAuthority"] is not False or
                    inputs["exactInputBindingProven"] is not False):
                raise ValueError("fixture signed input mismatch")
            message = (signed["task"].strip()
                       + "\n\n[IWXA ORIGINAL T3 SIGNED TASK - SOURCE BINDING]\n"
                       + json.dumps(original, sort_keys=True, ensure_ascii=False))
            phase = "NATIVE_SUBMISSION"
            receipt = engine.submit_interactive_task({
                "submission_id": submission, "message": message,
                "workspace_id": active, "conversation_key": "area-" + active,
                "use_memory": False, "use_web": False, "use_obsidian": False,
                "knowledge_sources": [], "artifact_sources": [],
                "attachments": inputs["attachments"],
            }, surface="web")
            job = engine.automation.interactive_submission(submission)
            if (receipt.get("accepted") is not True or
                    job["payload"].get("task_id") != receipt["task_id"] or
                    job["payload"].get("attachments") != inputs["attachments"] or
                    job["payload"].get("message") != message or
                    job["payload"].get("workspace_id") != active):
                raise ValueError("fixture durable job mismatch")
            result = {"taskId": receipt["task_id"], "submissionId": submission,
                      "message": message, "jobId": job["job_id"], "state": job["state"]}
        elif op == "run_native":
            phase = "NATIVE_SCHEDULER"
            submission = request["submissionId"]
            job = engine.automation.interactive_submission(submission)
            if job["state"] != "SCHEDULED":
                raise ValueError("fixture native job state")
            tid = job["payload"]["task_id"]
            scheduled = engine.automation_run_due(limit=1)
            completed = engine.automation.interactive_submission(submission)
            if (scheduled["claimed"] != 1 or scheduled["results"][0]["status"] != "SUCCEEDED" or
                    completed["state"] != "COMPLETED" or completed["payload"] != job["payload"]):
                raise ValueError("fixture native scheduler incomplete")
            phase = "TASK_REVIEW"
            engine.review(tid, "approve")
            result = {"taskId": tid, "state": completed["state"]}
        elif op == "run":
            tid = request["taskId"]
            phase = "ACCEPTED_READ"
            accepted = engine.k01_accepted_result_source(tid)
            task_path = engine.core_root / "tasks" / tid / "task.json"
            task,state = engine.tasks.load_task_state(task_path,check_expiry=False)
            phase = "ARTIFACT_VERIFY"
            verified = core._verify_state_artifacts(task_path.parent, task, state)
            result_row = verified["result"]
            phase = "SNAPSHOT_MATCH"
            snapshots = engine.context_snapshots(tid,100)["snapshots"]
            matched = [s for s in snapshots if
                s["projection_digest"] == result_row["context_projection_digest"] and
                s["bundle_digest"] == result_row["run_bundle_digest"]]
            if len(matched) != 1 or core.contract_digest_path(task_path) != result_row["task_digest"]:
                raise ValueError("accepted run binding mismatch")
            if engine.k01_accepted_result_source(tid) != accepted:
                raise ValueError("accepted owner changed")
            result = {"task":task,"result":result_row,"snapshot":matched[0],"acceptedSource":accepted}
        elif op == "document":
            phase = "DOCUMENT_READ"
            result = engine.task_document_source(request["taskId"],request["snapshotId"],
                request["path"],request["sha256"])
        else:
            raise ValueError("unsupported fixture operation")
    print(json.dumps({"ok":True,"result":result},ensure_ascii=True))
except Exception as exc:
    # Fixed allowlist only; never echo exception text, paths, or native data.
    allowed = {
        "composer_draft_revision_invalid", "composer_draft_link_forbidden",
        "composer_draft_oversized", "composer_draft_storage_invalid", "composer_draft_unreadable",
        "composer_draft_changed", "composer_draft_invalid", "composer_attachments_invalid",
        "composer_attachment_invalid", "composer_attachment_filename_invalid",
        "composer_attachment_duplicate", "composer_attachment_encoding_invalid",
        "composer_attachment_content_out_of_bounds", "fixture composer occupied or changed",
        "interactive_submission_id_conflict",
        "fixture composer changed after submit", "fixture pending submission",
        "fixture composer was not cleared"
    }
    message = str(exc)
    diagnostic = message.upper().replace(" ","_") if message in allowed else (
        type(exc).__name__.upper() if type(exc).__name__ in ("ValueError","TypeError","OSError","PermissionError","KeyError","RuntimeError") else "OTHER")
    print(json.dumps({"ok":False,"code":"ORIGINAL_TASK_FIXTURE_REFUSED","phase":phase,"diagnostic":diagnostic}))
