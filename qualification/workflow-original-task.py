"""Qualification only. Use the original Core, demo model and Human Review.
All synthetic state stays on the runner; only a fixed status is published.
"""
import contextlib, io, json, pathlib, sys
agent, instance = map(pathlib.Path, sys.argv[1:3])
sys.path.insert(0, str(agent.resolve()))
request = json.load(sys.stdin)
try:
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        from runtime.daily_driver_engine import DailyDriverEngine
        from runtime import personal_agent as core
        instance.mkdir(parents=True, exist_ok=True)
        config_path = instance / "qualification-config.json"
        if not config_path.exists():
            config = json.loads((agent / "config/daily-driver.example.json").read_text(encoding="utf-8"))
            config["instance_root"] = str(instance / "data")
            config_path.write_text(json.dumps(config), encoding="utf-8")
        engine = DailyDriverEngine(config_path)
        profile = engine.config.get("_storage_profile_id", "DEFAULT")
        active = engine.sessions.workspace_catalog(profile)["active_id"]
        if active != "personal":
            raise ValueError("fixture area changed")
        op = request["op"]
        if op == "execute":
            # This qualification fixture explicitly simulates a user's
            # separate submission and Human Review. Product bridge never does so.
            draft = request["draft"]
            empty = engine.sessions.composer_draft(profile, task_context=True)
            if empty["text"] or empty["pending_submission"] is not None:
                raise ValueError("fixture composer occupied")
            saved = engine.sessions.composer_draft(profile, text=draft["text"],
                attachments=draft["attachments"], knowledge_sources=draft["knowledge_sources"],
                expected_draft_digest=empty["draft_digest"], task_context=True)
            reopened = engine.sessions.composer_draft(profile, task_context=True)
            if saved != reopened:
                raise ValueError("fixture draft readback mismatch")
            created = engine.chat(reopened["text"], attachments=reopened["attachments"],
                knowledge_sources=reopened["knowledge_sources"], use_memory=False,
                use_obsidian=False, use_web=False)
            tid = created["task_id"]
            engine.review(tid,"approve")
            result = {"taskId":tid}
        elif op == "run":
            tid = request["taskId"]
            accepted = engine.k01_accepted_result_source(tid)
            task_path = engine.core_root / "tasks" / tid / "task.json"
            task,state = engine.tasks.load_task_state(task_path,check_expiry=False)
            verified = core._verify_state_artifacts(task_path.parent, task, state)
            result_row = verified["result"]
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
            result = engine.task_document_source(request["taskId"],request["snapshotId"],
                request["path"],request["sha256"])
        else:
            raise ValueError("unsupported fixture operation")
    print(json.dumps({"ok":True,"result":result},ensure_ascii=True))
except Exception:
    print('{"ok":false,"code":"ORIGINAL_TASK_FIXTURE_REFUSED"}')
