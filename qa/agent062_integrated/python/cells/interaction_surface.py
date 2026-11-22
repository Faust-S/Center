from __future__ import annotations

from dataclasses import dataclass
from contextlib import nullcontext
import datetime
import hashlib
import json
import re
import threading
import time
from typing import Any, Callable

from runtime import personal_agent as core

CONTRACT_ID = "PA.CONTRACT.INTERACTION_SURFACE"
CONTRACT_VERSION = "1.0.0"
CONTRACT_REF = f"{CONTRACT_ID}@{CONTRACT_VERSION}"
_ALLOWED_LOCALES = {"ru", "en"}
_ALLOWED_SURFACES = {"builtin_web", "external_web", "telegram", "api"}


@dataclass
class InteractionSurfaceError(RuntimeError):
    code: str
    message: str
    http_status: int = 400

    def __str__(self) -> str:
        return f"{self.code}:{self.message}"

    def public_error(self) -> dict[str, Any]:
        return {
            "kind": "InteractionError",
            "backend_contract_version": CONTRACT_VERSION,
            "error": {"code": self.code, "message": self.message},
        }


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _digest(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _bounded_limit(value: Any, default: int = 100, maximum: int = 200) -> int:
    try:
        n = int(value if value is not None else default)
    except (TypeError, ValueError) as exc:
        raise InteractionSurfaceError("INVALID_COMMAND", "invalid_limit") from exc
    if n < 1 or n > maximum:
        raise InteractionSurfaceError("INVALID_COMMAND", "invalid_limit")
    return n


class InteractionSurfaceCell:
    """Thin public UI/controller boundary. Canonical state remains in owner Cells."""

    contract_ref = CONTRACT_REF

    _QUERY_NAMES = {
        "snapshot", "status", "online_accounts", "context_snapshot_status", "k01_accepted_result_source", "k01_accepted_result_sources", "task_t3_result_projection", "corporate_t3_status", "corporate_t3_task", "corporate_t3_agent_readback", "corporate_t3_company_result_readback", "corporate_t3_signed_export_readback", "corporate_t3_accepted_projection", "corporate_t3_atlas_publication", "existing_local_ollama", "n8n_local_status", "n8n_workflow_options", "n8n_workflow_request_status", "k03_discovery_status", "k03_discovery_preview", "k03_discovery_select", "k03_host_preview", "k03_host_select", "tasks", "task", "atlas_work_preview", "obsidian_note_preview", "task_document_source", "task_saved_document", "providers", "obsidian_write_settings", "knowledge_workspaces", "knowledge_search", "knowledge_source",
        "memory", "memory_proposals", "memory_history", "provider_recovery", "tool_catalog", "tool_plans", "tool_approvals", "tool_repair_cases",
        "tool_read_receipts", "tool_execution_receipts", "tool_execution_receipt", "tool_recovery_file_observation", "goals", "goal_status", "work_boards", "work_board_status", "work_board_context",
        "automation_jobs", "interactive_submission_status", "session_catalog", "session_status", "session_search", "session_options", "quick_chat_history", "quick_chat_status", "task_skills", "operational_skills", "operational_skill_curator", "notifications", "recovery_view", "ui_preferences", "iwxa_exchange_preview", "iwxa_exchange_inspect", "t2_domain_file_preview", "t2_domain_file_result",
    }

    _COMMAND_NAMES = {
        "online_account_remove", "online_account_verify", "online_account_register", "online_google_account_register", "online_telegram_bot_register", "corporate_t3_connect", "corporate_t3_disconnect", "corporate_t3_select", "corporate_t3_invite", "corporate_t3_receive", "corporate_t3_select_task", "corporate_t3_submit", "corporate_t3_prepare", "corporate_t3_recover_prepared", "corporate_t3_preview", "corporate_t3_export", "corporate_t3_atlas_publish", "corporate_t3_atlas_save", "submit_task", "obsidian_write_configure", "n8n_workflow_request_begin", "n8n_workflow_draft", "local_document_file_draft", "local_office_pdf_ocr_draft", "obsidian_note_draft", "retry_task", "review_task", "memory_propose", "memory_propose_from_knowledge", "memory_review", "provider_switch", "tool_read",
        "tool_prepare", "tool_approve", "tool_execute", "tool_recover_interrupted", "tool_reconcile", "tool_reprepare",
        "goal_create", "goal_proof", "work_board_create", "work_board_claim", "work_board_run_worker",
        "work_board_submit_human", "work_board_verify", "work_board_recover_worker", "work_board_retry_blocked", "automation_create", "automation_pause", "automation_resume", "automation_cancel", "automation_update_task_prompt", "automation_rebind_recovery",
        "quick_chat_submit", "quick_chat_to_task_draft", "k03_selection_to_task_draft", "t2_domain_file_choose", "atlas_file_choose", "t2_domain_attach_to_task", "session_bind", "session_select", "session_rename", "conversation_group_create", "conversation_group_rename", "conversation_group_delete", "conversation_group_pin", "conversation_group_assign", "session_options_save", "tool_read_attach_to_draft", "session_steer", "session_pause", "session_resume", "session_recycle", "session_clear", "ui_preferences_update", "iwxa_exchange_export", "iwxa_exchange_import",
    }

    _TARGET_REQUIRED = {
        "corporate_t3_connect", "corporate_t3_disconnect", "corporate_t3_select", "corporate_t3_invite", "corporate_t3_receive", "corporate_t3_select_task", "corporate_t3_submit", "corporate_t3_prepare", "corporate_t3_recover_prepared", "corporate_t3_preview", "corporate_t3_export", "corporate_t3_atlas_publish", "corporate_t3_atlas_save",
        "online_account_remove", "online_account_verify", "obsidian_write_configure", "n8n_workflow_request_begin", "n8n_workflow_draft", "local_document_file_draft", "local_office_pdf_ocr_draft", "obsidian_note_draft", "retry_task", "review_task", "memory_review", "provider_switch", "tool_read", "tool_prepare", "tool_approve",
        "tool_execute", "tool_recover_interrupted", "tool_reconcile", "tool_reprepare", "goal_proof", "work_board_create", "work_board_claim",
        "work_board_run_worker", "work_board_submit_human", "work_board_verify", "work_board_recover_worker", "work_board_retry_blocked", "automation_pause", "automation_resume", "automation_cancel", "automation_update_task_prompt", "automation_rebind_recovery", "ui_preferences_update", "iwxa_exchange_export", "iwxa_exchange_import",
    }

    _TARGET_KIND = {
        **{name: "corporate_t3" for name in ("corporate_t3_connect", "corporate_t3_disconnect", "corporate_t3_select", "corporate_t3_invite", "corporate_t3_receive", "corporate_t3_select_task", "corporate_t3_submit", "corporate_t3_prepare", "corporate_t3_recover_prepared", "corporate_t3_preview", "corporate_t3_export", "corporate_t3_atlas_publish", "corporate_t3_atlas_save",)},
        "online_account_remove":"provider", "online_account_verify":"provider", "obsidian_write_configure":"provider", "n8n_workflow_request_begin":"provider", "n8n_workflow_draft":"provider", "local_document_file_draft":"task", "obsidian_note_draft":"task", "retry_task":"task", "review_task":"task", "memory_review":"memory_proposal",
        "provider_switch":"provider", "tool_read":"tool", "tool_prepare":"action_candidate",
        "tool_approve":"tool_plan", "tool_execute":"tool_plan", "tool_recover_interrupted":"tool_plan",
        "tool_reconcile":"reconciliation_case", "tool_reprepare":"reconciliation_case",
        "goal_proof":"goal", "work_board_create":"goal", "work_board_claim":"work_board", "work_board_run_worker":"work_board", "work_board_submit_human":"work_board",
        "work_board_verify":"work_board", "work_board_recover_worker":"work_board", "work_board_retry_blocked":"work_board", "automation_pause":"automation_job", "automation_resume":"automation_job", "automation_cancel":"automation_job", "automation_update_task_prompt":"automation_job", "automation_rebind_recovery":"automation_job", "ui_preferences_update":"ui_preferences", "iwxa_exchange_export":"task", "iwxa_exchange_import":"workspace",
    }
    _TARGET_INPUT_ID = {
        "online_account_remove":"account_id", "online_account_verify":"account_id", "obsidian_write_configure":"provider_id", "n8n_workflow_draft":"provider_id", "local_document_file_draft":"source_task_id", "obsidian_note_draft":"source_task_id", "retry_task":"task_id", "review_task":"task_id", "memory_review":"proposal_id",
        "provider_switch":"provider_id", "tool_read":"tool_id", "tool_prepare":"candidate_id",
        "tool_approve":"plan_id", "tool_execute":"plan_id", "tool_recover_interrupted":"plan_id",
        "tool_reconcile":"case_id", "tool_reprepare":"case_id",
        "goal_proof":"goal_id", "work_board_create":"goal_id", "work_board_claim":"board_id", "work_board_run_worker":"board_id", "work_board_submit_human":"board_id",
        "work_board_verify":"board_id", "work_board_recover_worker":"board_id", "work_board_retry_blocked":"board_id", "automation_pause":"job_id", "automation_resume":"job_id", "automation_cancel":"job_id", "automation_update_task_prompt":"job_id", "automation_rebind_recovery":"job_id",
    }

    # Local/read queries remain available offline. Commands that may depend on providers,
    # change authority/state, or create external effects are never queued/replayed here.
    _OFFLINE_DENIED = _COMMAND_NAMES
    # These Windows chooser commands only return a path. They neither grant
    # authority nor mutate the Core, and must not scan all owner revisions
    # before showing a modal dialog.
    _NATIVE_PATH_PICKERS = frozenset({
        "local_file_folder_choose", "program_install_folder_choose",
        "obsidian_vault_choose", "local_model_choose_file",
        "local_ai_native_gguf_choose", "local_ai_basic_gguf_choose",
        "t2_domain_file_choose", "atlas_file_choose",
    })

    def __init__(self, backend: Any):
        self.backend = backend
        # Read-only observations can share a short-lived revision.
        # Targeted commands always recompute it from authoritative owners.
        self._read_revision_lock = threading.RLock()
        self._read_revision_observation: tuple[float, str] | None = None

    def _validate_common(self, request: dict[str, Any]) -> tuple[str, str]:
        if not isinstance(request, dict):
            raise InteractionSurfaceError("INVALID_COMMAND", "request_object_required")
        version = str(request.get("contract_version") or "")
        if version != CONTRACT_VERSION:
            raise InteractionSurfaceError("UNSUPPORTED_CONTRACT_VERSION", "interaction_contract_version_not_supported", 409)
        try:
            core.validate("interaction-surface-v1.schema.json", request)
        except Exception as exc:
            raise InteractionSurfaceError("INVALID_COMMAND", "interaction_request_schema_invalid") from exc
        locale = str(request.get("locale") or "").lower()
        if locale not in _ALLOWED_LOCALES:
            raise InteractionSurfaceError("INVALID_COMMAND", "unsupported_locale")
        surface = str(request.get("surface") or "builtin_web")
        if surface == "web":
            surface = "builtin_web"
        if surface not in _ALLOWED_SURFACES:
            raise InteractionSurfaceError("INVALID_COMMAND", "unsupported_surface")
        return locale, surface

    def _revision_material(self) -> dict[str, Any]:
        # No UI/session presentation cache participates. Only public owner-Cell projections and
        # provider/tool state are hashed. This is intentionally conservative for stale command rejection.
        return {
            "tasks": self.backend.task_list(200),
            "goals": self.backend.goal_list(200),
            "boards": self.backend.work_board_list(200),
            "automations": self.backend.automation_jobs(200),
            "tool_plans": self.backend.tool_plans(200),
            "tool_approvals": self.backend.tool_approvals(200),
            "tool_repairs": self.backend.tool_repair_cases(200),
            "tool_receipts": self.backend.tool_execution_receipts(200),
            "memory_integrity": self.backend.memory.integrity(),
            "providers": self.backend.registry.public_snapshot(),
        }

    def revision(self) -> str:
        return "sha256:" + _digest(self._revision_material())

    def _read_revision(self, *, max_age_seconds=0.75, force=False) -> str:
        # Observation snapshots never confer write authority. The complete
        # canonical digest remains freshly calculated for targeted commands.
        with self._read_revision_lock:
            now=time.monotonic()
            cached=self._read_revision_observation
            if not force and cached is not None and now-cached[0]<max_age_seconds:
                return cached[1]
            current=self.revision()
            self._read_revision_observation=(time.monotonic(),current)
            return current

    def _envelope(self, *, kind: str, locale: str, surface: str, data: Any,
                  source_refs: list[dict[str, Any]] | None = None,
                  observation_max_age=0.75, force_revision=False, cached_ack=False) -> dict[str, Any]:
        # Queued ACKs and lightweight chat observations confer no mutation
        # authority; do not walk every historical Task to acknowledge them.
        lightweight=(kind=="CommandAck" and cached_ack
                     or kind=="InteractionSnapshot" and observation_max_age<0)
        if lightweight:
            with self._read_revision_lock:
                cached=self._read_revision_observation
                token=cached[1] if cached is not None else ""
        else:
            token=(self._read_revision(max_age_seconds=observation_max_age,
                                      force=force_revision)
                   if kind=="InteractionSnapshot" else self.revision())
        return {
            "kind": kind,
            "backend_contract_version": CONTRACT_VERSION,
            "backend_contract_ref": CONTRACT_REF,
            "snapshot_revision": token,
            "locale": locale,
            "surface": surface,
            "source_refs": list(source_refs or []),
            "data": data,
        }

    @staticmethod
    def _approval_plan_id(approval: dict[str, Any]) -> str:
        return str(((approval.get("plan_ref") or {}).get("ref_id") or approval.get("plan_id") or ""))

    @staticmethod
    def _repair_open(case: dict[str, Any]) -> bool:
        contract_state=str(case.get("contract_state") or "")
        state=str(case.get("state") or "")
        if contract_state in {"RESOLVED_APPLIED","RESOLVED_NOT_APPLIED"}:
            return False
        if state.startswith("RESOLVED_") or state=="RETRY_ALLOWED":
            return False
        return True

    @classmethod
    def _active_approved_plan_ids(cls, plans: list[dict[str, Any]], approvals: list[dict[str, Any]]) -> set[str]:
        plan_digest={str(p.get("plan_id") or ""): str(p.get("plan_digest") or "") for p in plans}
        out=set()
        for approval in approvals:
            if approval.get("decision")!="approve" or approval.get("active") is False:
                continue
            pid=cls._approval_plan_id(approval)
            if not pid or pid not in plan_digest:
                continue
            pref=approval.get("plan_ref") or {}
            if pref.get("digest_sha256") and plan_digest[pid] and str(pref.get("digest_sha256"))!=plan_digest[pid]:
                continue
            out.add(pid)
        return out

    @classmethod
    def _plans_needing_review(cls, plans: list[dict[str, Any]], approvals: list[dict[str, Any]], execution_by_plan: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        approved=cls._active_approved_plan_ids(plans,approvals)
        rejected={cls._approval_plan_id(a) for a in approvals if str(a.get("state") or "").upper()=="REJECTED" or str(a.get("decision") or "").lower()=="reject"}
        now=datetime.datetime.now(datetime.timezone.utc)
        out=[]
        for plan in plans:
            pid=str(plan.get("plan_id") or "")
            if not pid or pid in approved or pid in rejected:
                continue
            if execution_by_plan is not None and (execution_by_plan.get(pid) or {}).get("state") != "NOT_STARTED":
                continue
            try:
                if core.parse_dt(plan.get("expires_at")) < now:
                    continue
            except Exception:
                continue
            out.append(plan)
        return out

    def _snapshot_data(self) -> dict[str, Any]:
        repairs = self.backend.tool_repair_cases(100).get("cases", [])
        plan_projection = self.backend.tool_plans(100)
        plans = plan_projection.get("plans", [])
        approvals = self.backend.tool_approvals(100).get("approvals", [])
        plans_needing_review = self._plans_needing_review(plans, approvals, plan_projection.get("execution_by_plan"))
        tasks = self.backend.task_list(100)
        hosted_activity_fn=getattr(self.backend,"hosted_reference_activity",None)
        hosted_runs=(hosted_activity_fn(100).get("runs",[]) if callable(hosted_activity_fn) else [])
        memory_proposals_fn=getattr(self.backend,"memory_proposals",None)
        memory_proposals=(memory_proposals_fn(100).get("proposals",[]) if callable(memory_proposals_fn) else [])
        work_board_list_fn=getattr(self.backend,"work_board_list",None)
        work_boards=(work_board_list_fn(100).get("boards",[]) if callable(work_board_list_fn) else [])
        goal_list_fn=getattr(self.backend,"goal_list",None)
        goals=(goal_list_fn(100).get("goals",[]) if callable(goal_list_fn) else [])
        attention = {
            "tasks_needing_review": sum(1 for x in tasks if x.get("status") in {"result_imported", "awaiting_revision"}),
            "plans_needing_review": len(plans_needing_review),
            "reconciliation_required": sum(1 for x in repairs if self._repair_open(x)),
            "agent_reviews_needing_review": sum(1 for x in hosted_runs if x.get("state")=="AWAITING_HUMAN_VERIFICATION"),
            "memory_proposals_needing_review": sum(1 for x in memory_proposals if not x.get("decision")),
            "work_board_verifications_needing_review": sum(int((x.get("counts") or {}).get("VERIFY") or 0) for x in work_boards),
            "goal_criteria_needing_review": sum(int(x.get("human_review_pending") or 0) for x in goals),
        }
        return {
            "core": self.backend.status(),
            "tasks": self.backend.ui_tasks(100),
            "providers": self.backend.ui_providers(),
            "knowledge": self.backend.knowledge_workspaces(include_file_count=False),
            "memory": self.backend.memory_list(100, include_inactive=True),
            "attention": attention,
            "recovery": {"cases": repairs},
            "features": {
                "task_commands": True,
                "review_commands": True,
                "provider_switch": True,
                "knowledge_workspace": True,
                "memory_read": True,
                "memory_mutation_via_review": True,
                "synthetic_command_targets": False,
                "offline_consequential_replay": False,
            },
        }

    def query(self, request: dict[str, Any]) -> dict[str, Any]:
        locale, surface = self._validate_common(request)
        name = str(request.get("query") or "")
        if name not in self._QUERY_NAMES:
            raise InteractionSurfaceError("INVALID_COMMAND", "unknown_query")
        params = request.get("params") or {}
        if not isinstance(params, dict):
            raise InteractionSurfaceError("INVALID_COMMAND", "query_params_object_required")
        refs: list[dict[str, Any]] = []
        if name == "snapshot":
            data = self._snapshot_data()
        elif name == "status":
            data = self.backend.status()
        elif name == "online_accounts":
            if params:
                raise InteractionSurfaceError("INVALID_COMMAND", "online_accounts_params_forbidden")
            data = self.backend.online_accounts_snapshot()
        elif name == "existing_local_ollama":
            if params:
                raise InteractionSurfaceError("INVALID_COMMAND", "ollama_discovery_params_forbidden")
            data = self.backend.existing_local_ollama()
        elif name == "n8n_local_status":
            if params:
                raise InteractionSurfaceError("INVALID_COMMAND","n8n_health_query_params_forbidden")
            data = self.backend.n8n_local_status()
        elif name == "n8n_workflow_options":
            if params:
                raise InteractionSurfaceError("INVALID_COMMAND","n8n_options_query_params_forbidden")
            data = self.backend.n8n_workflow_options()
        elif name == "n8n_workflow_request_status":
            if set(params) != {"request_id"}:
                raise InteractionSurfaceError("INVALID_COMMAND","n8n_request_status_input_invalid")
            data = self.backend.n8n_workflow_request_status(params["request_id"])
            if data.get("task_id"):
                refs.append({"kind": "task", "id": data["task_id"]})
        elif name in {"k03_discovery_status", "k03_discovery_preview", "k03_discovery_select", "k03_host_preview", "k03_host_select"}:
            # Explicit, read-only in-process K03 consumer. No Task, Store,
            # model execution or source scan is performed on Agent startup.
            from runtime import k03_discovery_host as k03
            if surface != "builtin_web":
                raise InteractionSurfaceError("INVALID_COMMAND", "k03_builtin_surface_required")
            if name == "k03_discovery_status":
                if params:
                    raise InteractionSurfaceError("INVALID_COMMAND", "k03_status_params_forbidden")
                data = k03.source_status()
            elif name == "k03_host_preview":
                if (set(params)!={"request","sources"}
                        or type(params.get("request")) is not dict
                        or type(params.get("sources")) is not list):
                    raise InteractionSurfaceError("INVALID_COMMAND","k03_host_preview_input_invalid")
                try:
                    data=k03.discover_host(params["request"],params["sources"])
                except (k03.K03HostHold,ValueError,OSError,UnicodeError):
                    raise InteractionSurfaceError("INVALID_COMMAND","k03_host_input_or_source_unavailable") from None
            elif name == "k03_host_select":
                required={"discovery","hypothesis_id","selection_ref","request","sources"}
                if (set(params)!=required or type(params.get("discovery")) is not dict
                        or type(params.get("request")) is not dict
                        or type(params.get("sources")) is not list
                        or not all(type(params.get(k)) is str for k in ("hypothesis_id","selection_ref"))):
                    raise InteractionSurfaceError("INVALID_COMMAND","k03_host_selection_input_invalid")
                try:
                    data=k03.select_host(
                        params["discovery"],params["hypothesis_id"],
                        params["selection_ref"],request=params["request"],
                        sources=params["sources"])
                except (k03.K03HostHold,ValueError,OSError,UnicodeError):
                    raise InteractionSurfaceError("INVALID_COMMAND","k03_host_source_changed") from None
            elif name == "k03_discovery_preview":
                if (set(params) != {"source_kind", "source_value"}
                        or any(type(params.get(key)) is not str for key in params)):
                    raise InteractionSurfaceError("INVALID_COMMAND", "k03_preview_input_invalid")
                try:
                    data = k03.discover(params["source_kind"], params["source_value"])
                except (k03.K03HostHold, ValueError, OSError) as exc:
                    raise InteractionSurfaceError("INVALID_COMMAND", str(exc)) from exc
            else:
                required = {"source_kind", "source_value", "hypothesis_id",
                            "selection_ref", "source_revision"}
                if set(params) != required or any(type(params.get(key)) is not str for key in required):
                    raise InteractionSurfaceError("INVALID_COMMAND", "k03_selection_input_invalid")
                try:
                    data = k03.select(params["source_kind"], params["source_value"],
                        params["hypothesis_id"], params["selection_ref"],
                        params["source_revision"])
                except (k03.K03HostHold, ValueError, OSError) as exc:
                    raise InteractionSurfaceError("INVALID_COMMAND", str(exc)) from exc
        elif name == "t2_domain_file_preview":
            if (surface!="builtin_web" or set(params)!={"path","offset"}
                    or type(params.get("path")) is not str
                    or type(params.get("offset")) is not int):
                raise InteractionSurfaceError("INVALID_COMMAND","t2_domain_preview_input_invalid")
            data=self.backend.t2_domain_file_preview(params["path"],params["offset"])
        elif name == "t2_domain_file_result":
            required={"path","package_sha256","workspace_id","object_id","revision"}
            if (surface!="builtin_web" or set(params)!=required
                    or any(type(params.get(k)) is not str for k in required-{"revision"})
                    or type(params.get("revision")) is not int):
                raise InteractionSurfaceError("INVALID_COMMAND","t2_domain_result_input_invalid")
            data=self.backend.t2_domain_file_result(**params)
        elif name == "ui_preferences":
            if params:
                raise InteractionSurfaceError("INVALID_COMMAND","ui_preferences_query_params_not_supported")
            data=self.backend.ui_preferences()
        elif name == "iwxa_exchange_preview":
            if (surface != "builtin_web" or set(params) != {"task_id", "workspace_id"}
                    or any(type(params.get(k)) is not str for k in ("task_id", "workspace_id"))):
                raise InteractionSurfaceError("INVALID_COMMAND", "iwxa_exchange_preview_invalid")
            data = self.backend.iwxa_exchange_preview(params["task_id"], params["workspace_id"])
            refs.append({"kind": "task", "id": params["task_id"]})
        elif name == "iwxa_exchange_inspect":
            if (surface != "builtin_web" or set(params) != {"path"}
                    or type(params.get("path")) is not str or not 1 <= len(params["path"]) <= 2048):
                raise InteractionSurfaceError("INVALID_COMMAND", "iwxa_exchange_inspect_invalid")
            data = self.backend.iwxa_exchange_inspect(params["path"])
        elif name in {"corporate_t3_status", "corporate_t3_task", "corporate_t3_agent_readback", "corporate_t3_company_result_readback", "corporate_t3_signed_export_readback", "corporate_t3_accepted_projection",
                     "corporate_t3_atlas_publication"}:
            if surface != "builtin_web" or self.backend.ui_preferences().get("t3_enabled") is not True:
                raise InteractionSurfaceError("INVALID_COMMAND", "t3_employee_desktop_mode_required", 409)
            # Atlas publication uses the existing installed Agent Result
            # owner, not the legacy T3 file-export consumer. Do not
            # initialize or require an unrelated bridge for this read.
            port = (self.backend.corporate_t3
                    if name != "corporate_t3_atlas_publication" else None)
            if name == "corporate_t3_status":
                if params: raise InteractionSurfaceError("INVALID_COMMAND", "t3_employee_status_params_invalid")
                data = port.status()
            elif name == "corporate_t3_task":
                if params: raise InteractionSurfaceError("INVALID_COMMAND", "t3_employee_task_params_invalid")
                data = port.task()
            elif name == "corporate_t3_agent_readback":
                if params: raise InteractionSurfaceError("INVALID_COMMAND", "t3_employee_readback_params_invalid")
                data = port.recover_agent_task(self.backend)
            elif name == "corporate_t3_company_result_readback":
                if (set(params) != {"task_id"} or
                        type(params.get("task_id")) is not str or
                        re.fullmatch(r"TASK-[A-Za-z0-9_-]+",
                                     params["task_id"]) is None):
                    raise InteractionSurfaceError(
                        "INVALID_COMMAND", "t3_company_result_readback_invalid")
                data = port.readback_company_result(
                    self.backend, params["task_id"])
            elif name == "corporate_t3_atlas_publication":
                if set(params) != {"workRef"} or type(params.get("workRef")) is not dict:
                    raise InteractionSurfaceError("INVALID_COMMAND",
                                                  "t3_atlas_publication_work_ref_invalid")
                original = self.backend.original_t3_result_owner
                request = {
                    "workRef": params["workRef"],
                    # Recovery is read-only, and never grants authority to
                    # reissue an unknown original signed Kernel write.
                    "context": original.currentContextForRecovery(),
                    "recipientId": "iwxa.atlas",
                    "purpose": "atlas.result.publish",
                }
                data = original.recoverPublicationForWork(request)
                if data.get("status") == "NOT_PUBLISHED_CONFIRMED":
                    # Show only the EXACT original Core Human-accepted text,
                    # not a potentially stale Task UI summary. If unavailable
                    # do not issue an incomplete disclosure consent.
                    selected = original.previewAcceptedForAtlas(request)
                    if (selected.get("operationId") != data.get("operationId")
                            or selected.get("recipientId") != "iwxa.atlas"
                            or selected.get("workRef") != params["workRef"]):
                        raise InteractionSurfaceError(
                            "INVALID_COMMAND", "t3_atlas_selected_preview_changed", 409)
                    data = {**data, **selected}
            elif name == "corporate_t3_signed_export_readback":
                if (set(params) != {"task_id", "path"} or
                        type(params.get("task_id")) is not str or
                        re.fullmatch(r"TASK-[A-Za-z0-9_-]+", params["task_id"]) is None or
                        type(params.get("path")) is not str or
                        not 1 <= len(params["path"]) <= 2048):
                    raise InteractionSurfaceError("INVALID_COMMAND",
                                                  "t3_employee_export_readback_invalid")
                data = port.read_signed_export(self.backend, params["task_id"], params["path"])
            else:
                if (set(params) != {"task_id"} or
                        type(params.get("task_id")) is not str or
                        re.fullmatch(r"TASK-[A-Za-z0-9_-]+", params["task_id"]) is None):
                    raise InteractionSurfaceError("INVALID_COMMAND", "t3_employee_projection_invalid")
                data = port.company_projection(self.backend, params["task_id"])
        elif name == "tasks":
            data = {"tasks": self.backend.ui_tasks(_bounded_limit(params.get("limit"), 25))}
        elif name == "task":
            task_id = str(params.get("task_id") or "")
            data = self.backend.task_detail(task_id)
            refs.append({"kind": "task", "id": task_id})
        elif name == "task_t3_result_projection":
            if (surface != "builtin_web"
                    or set(params) != {"task_id", "selection"}
                    or type(params.get("task_id")) is not str
                    or re.fullmatch(r"TASK-[A-Za-z0-9_-]+", params["task_id"]) is None
                    or type(params.get("selection")) is not dict):
                raise InteractionSurfaceError(
                    "INVALID_COMMAND", "t3_result_selection_params_invalid")
            if self.backend.ui_preferences().get("t3_enabled") is not True:
                raise InteractionSurfaceError(
                    "INVALID_COMMAND", "t3_result_mode_disabled", 409)
            data = self.backend.task_t3_result_projection(
                params["task_id"], params["selection"])
            refs.append({"kind": "task", "id": params["task_id"]})
        elif name == "k01_accepted_result_sources":
            tids=params.get("task_ids")
            if (surface!="builtin_web" or set(params)!={"task_ids"}
                    or type(tids) is not list or len(tids)!=2
                    or any(type(tid) is not str or
                           re.fullmatch(r"TASK-[A-Za-z0-9_-]+",tid) is None
                           for tid in tids) or tids[0]==tids[1]):
                raise InteractionSurfaceError("INVALID_COMMAND","k01_result_pair_query_invalid")
            data=self.backend.k01_accepted_result_sources(tids)
            refs.extend({"kind":"task","id":tid} for tid in tids)
        elif name == "k01_accepted_result_source":
            if (surface != "builtin_web" or set(params)!={"task_id"}
                    or type(params.get("task_id")) is not str
                    or re.fullmatch(r"TASK-[A-Za-z0-9_-]+",params["task_id"]) is None):
                raise InteractionSurfaceError("INVALID_COMMAND","k01_result_source_query_invalid")
            data=self.backend.k01_accepted_result_source(params["task_id"])
            refs.append({"kind":"task","id":params["task_id"]})
        elif name == "context_snapshot_status":
            # Explicit native Task readback only. The existing Core owner
            # verifies pinned memory, knowledge, bundles and source identities;
            # this query does not update the Task, ContextCell or Human Review.
            if (surface != "builtin_web" or set(params) != {"task_id", "snapshot_id"}
                    or type(params.get("task_id")) is not str
                    or type(params.get("snapshot_id")) is not str
                    or re.fullmatch(r"TASK-[A-Za-z0-9_-]+", params["task_id"]) is None
                    or re.fullmatch(r"CSN-[A-Za-z0-9_-]+", params["snapshot_id"]) is None):
                raise InteractionSurfaceError("INVALID_COMMAND", "context_status_query_invalid")
            task_id, snapshot_id = params["task_id"], params["snapshot_id"]
            # The Session owner gates the active work area exactly as it does
            # for immutable document-source readback. A snapshot ID alone
            # must not authorize crossing into another project.
            try:
                self.backend._document_source_work_area(task_id)
            except ValueError as exc:
                # Query (unlike command) bypasses _map_backend_error.
                # Project switches remain a bounded public conflict and must
                # stop before opening any ContextCell evidence.
                reason = str(exc)
                if reason not in {"document_source_work_area_changed",
                                  "document_source_work_area_ambiguous"}:
                    reason = "context_status_work_area_unavailable"
                raise InteractionSurfaceError("INVALID_COMMAND", reason, 409) from exc
            # A snapshot supplied by another Task must not be read through the
            # current Task's review panel. Match the same bounded saved history
            # that task_detail exposes, before any provider read is requested.
            saved = self.backend.context_snapshots(task_id, 20)["snapshots"]
            if not any(row.get("snapshot_id") == snapshot_id for row in saved):
                raise InteractionSurfaceError("INVALID_COMMAND", "context_status_task_binding_mismatch")
            data = self.backend.context_snapshot_status(snapshot_id)
            refs.append({"kind": "task", "id": task_id})
        elif name == "obsidian_note_preview":
            if (set(params)!={"vault_path","note_path"}
                    or any(type(params.get(k)) is not str for k in ("vault_path","note_path"))):
                raise InteractionSurfaceError("INVALID_COMMAND","obsidian_note_preview_input_invalid")
            data=self.backend.obsidian_note_preview(params["vault_path"],params["note_path"])
        elif name == "atlas_work_preview":
            # No owner read unless the user explicitly opens a selected Atlas file.
            if (set(params)-{"file_path","query","project_id"}
                    or type(params.get("file_path")) is not str
                    or (params.get("query") is not None and type(params["query"]) is not str)
                    or (params.get("project_id") is not None
                        and type(params["project_id"]) is not str)):
                raise InteractionSurfaceError("INVALID_COMMAND","atlas_work_preview_input_invalid")
            data=self.backend.atlas_work_preview(
                params["file_path"],params.get("query") or "",params.get("project_id"))
        elif name == "task_saved_document":
            task_id = str(params.get("task_id") or "")
            receipt_id = str(params.get("receipt_id") or "")
            data = self.backend.task_saved_document(task_id, receipt_id)
            refs.append({"kind": "task", "id": task_id})
        elif name == "task_document_source":
            task_id = str(params.get("task_id") or "")
            snapshot_id = str(params.get("snapshot_id") or "")
            path = str(params.get("path") or "")
            expected_sha256 = str(params.get("expected_sha256") or "")
            data = self.backend.task_document_source(task_id, snapshot_id, path, expected_sha256)
            refs.append({"kind": "task", "id": task_id})
        elif name == "providers":
            data = {"providers": self.backend.ui_providers()}
        elif name == "obsidian_write_settings":
            if params:
                raise InteractionSurfaceError("INVALID_COMMAND","obsidian_write_settings_params_not_supported")
            data = self.backend.obsidian_write_settings()
        elif name == "knowledge_workspaces":
            data = {"workspaces": self.backend.knowledge_workspaces(include_file_count=bool(params.get("include_file_count", False)))}
        elif name == "knowledge_search":
            query = str(params.get("query") or "").strip()
            if not query:
                raise InteractionSurfaceError("INVALID_COMMAND", "knowledge_query_required")
            data = self.backend.knowledge_search(query, _bounded_limit(params.get("limit"), 10))
        elif name == "knowledge_source":
            path = str(params.get("path") or "")
            expected_sha256 = str(params.get("expected_sha256") or "")
            if not path or not expected_sha256:
                raise InteractionSurfaceError("INVALID_COMMAND", "knowledge_source_identity_required")
            data = self.backend.knowledge_read(path, expected_sha256,
                                               params.get("provider_id"),
                                               params.get("binding_digest"))
            refs.append({"kind": "knowledge_source", "id": path[:160]})
        elif name == "memory":
            data = self.backend.memory_list(_bounded_limit(params.get("limit"), 100), include_inactive=bool(params.get("include_inactive", True)))
        elif name == "memory_proposals":
            data = self.backend.memory_proposals(_bounded_limit(params.get("limit"), 100))
        elif name == "memory_history":
            memory_id = str(params.get("memory_id") or "")
            if not memory_id:
                raise InteractionSurfaceError("INVALID_COMMAND", "memory_id_required")
            data = self.backend.memory_history(memory_id)
            refs.append({"kind": "memory", "id": memory_id})
        elif name == "provider_recovery":
            provider_id = str(params.get("provider_id") or "")
            if not provider_id:
                raise InteractionSurfaceError("INVALID_COMMAND", "provider_id_required")
            data = self._provider_recovery(provider_id)
            refs.append({"kind": "provider", "id": provider_id})
        elif name == "tool_catalog":
            data = self.backend.tool_catalog()
        elif name == "tool_plans":
            if "task_id" in params:
                if set(params)!={"task_id"}:
                    raise InteractionSurfaceError("INVALID_COMMAND", "tool_plans_task_scope_invalid")
                task_id=str(params.get("task_id") or "")
                data=self.backend.task_tool_plans(task_id)
                refs.append({"kind":"task","id":task_id})
            else:
                data = self.backend.tool_plans(_bounded_limit(params.get("limit"), 100))
        elif name == "tool_read_receipts":
            data = self.backend.tool_read_receipts(_bounded_limit(params.get("limit"), 100))
        elif name == "tool_approvals":
            data = self.backend.tool_approvals(_bounded_limit(params.get("limit"), 100))
        elif name == "tool_repair_cases":
            data = self.backend.tool_repair_cases(_bounded_limit(params.get("limit"), 100))
        elif name == "tool_execution_receipt":
            receipt_id = str(params.get("receipt_id") or "")
            data = self.backend.tool_execution_receipt(receipt_id)
            refs.append({"kind": "execution_receipt", "id": receipt_id})
        elif name == "tool_recovery_file_observation":
            case_id = str(params.get("case_id") or "")
            data = self.backend.tool_recovery_file_observation(case_id)
            refs.append({"kind": "reconciliation_case", "id": case_id})
        elif name == "tool_execution_receipts":
            data = self.backend.tool_execution_receipts(_bounded_limit(params.get("limit"), 50))
        elif name == "goals":
            data = self.backend.goal_list(_bounded_limit(params.get("limit"), 100))
        elif name == "goal_status":
            goal_id = str(params.get("goal_id") or "")
            data = self.backend.goal_status(goal_id)
            refs.append({"kind": "goal", "id": goal_id})
        elif name == "work_boards":
            data = self.backend.work_board_list(_bounded_limit(params.get("limit"), 100))
        elif name == "work_board_status":
            board_id = str(params.get("board_id") or "")
            data = self.backend.work_board_status(board_id)
            refs.append({"kind": "work_board", "id": board_id})
        elif name == "work_board_context":
            # The full predecessor content is returned only by an explicit
            # per-step read, never by global WorkBoard or Task listings.
            if (set(params)!={"board_id","ticket_id"}
                    or type(params.get("board_id")) is not str
                    or type(params.get("ticket_id")) is not str
                    or re.fullmatch(r"BOARD-[A-Za-z0-9_-]+",params["board_id"]) is None
                    or re.fullmatch(r"TKT-[A-Za-z0-9_-]+",params["ticket_id"]) is None):
                raise InteractionSurfaceError("INVALID_COMMAND","work_board_context_query_invalid")
            data=self.backend.work_board_context(params["board_id"],params["ticket_id"])
            refs.append({"kind":"work_board","id":params["board_id"]})
        elif name == "automation_jobs":
            if set(params)-{"limit","job_id"}:
                raise InteractionSurfaceError("INVALID_QUERY", "automation_jobs_query_params_invalid")
            data = self.backend.automation_jobs(
                _bounded_limit(params.get("limit"),100),job_id=params.get("job_id"))
        elif name == "task_skills":
            if params:
                raise InteractionSurfaceError("INVALID_COMMAND", "task_skill_query_params_not_supported")
            data = self.backend.task_skill_catalog()
            refs.append({"kind": "task_skill_catalog", "id": "canonical"})
        elif name == "operational_skills":
            data = self.backend.operational_skills_status()
            refs.append({"kind": "operational_skills", "id": "current"})
        elif name == "operational_skill_curator":
            data = self.backend.operational_skill_curator()
            refs.append({"kind": "operational_skill_curator", "id": "current"})
        elif name == "interactive_submission_status":
            if set(params)!={'submission_id'}:
                raise InteractionSurfaceError("INVALID_COMMAND","interactive_submission_query_invalid")
            data=self.backend.interactive_submission_status(params['submission_id'])
        elif name == "quick_chat_history":
            if set(params)-{"conversation_key","query","limit"} or type(params.get("conversation_key")) is not str:
                raise InteractionSurfaceError("INVALID_COMMAND","chat_history_query_invalid")
            data=self.backend.quick_chat_history(params["conversation_key"],
                str(params.get("query") or ""),_bounded_limit(params.get("limit"),80,200))
        elif name == "quick_chat_status":
            if set(params)!={"conversation_key","submission_id"} or not all(
                type(params.get(k)) is str for k in ("conversation_key","submission_id")):
                raise InteractionSurfaceError("INVALID_COMMAND","chat_status_query_invalid")
            data=self.backend.quick_chat_status(params["conversation_key"],params["submission_id"])
        elif name == "session_options":
            if set(params)!={"conversation_key"} or type(params.get("conversation_key")) is not str:
                raise InteractionSurfaceError("INVALID_COMMAND","conversation_options_query_invalid")
            data=self.backend.session_options(params["conversation_key"])
        elif name == "session_catalog":
            if set(params)-{"limit","fast"} or (params.get("fast",False) not in (True,False)):
                raise InteractionSurfaceError("INVALID_COMMAND","session_catalog_params_invalid")
            data=self.backend.session_catalog(_bounded_limit(params.get("limit"),50,100),
                fast=params.get("fast") is True)
        elif name == "session_status":
            conversation_key = str(params.get("conversation_key") or "")
            session_surface = str(params.get("session_surface") or "web")
            if not conversation_key:
                raise InteractionSurfaceError("INVALID_COMMAND", "conversation_key_required")
            data = self.backend.session_status(session_surface, conversation_key)
        elif name == "session_search":
            conversation_key = str(params.get("conversation_key") or "")
            session_surface = str(params.get("session_surface") or "web")
            query = str(params.get("query") or "")
            if not conversation_key:
                raise InteractionSurfaceError("INVALID_COMMAND", "conversation_key_required")
            data = self.backend.session_search(session_surface, conversation_key, query, _bounded_limit(params.get("limit"), 20))
        elif name == "notifications":
            data = {"intents": self.notification_intents()}
        elif name == "recovery_view":
            data = self.recovery_view()
        else:  # defensive; name is already validated.
            raise InteractionSurfaceError("INVALID_COMMAND", "unknown_query")
        return self._envelope(kind="InteractionSnapshot", locale=locale, surface=surface,
                              data=data, source_refs=refs,force_revision=(name=="status"),
                              observation_max_age=(-1 if name in {"quick_chat_history","quick_chat_status","ui_preferences",
                                                   "k03_discovery_status","k03_discovery_preview",
                                                   "k03_discovery_select","k03_host_preview",
                                                   "k03_host_select"} or
                                                  (name=="session_catalog" and params.get("fast") is True)
                                                  else 30 if name in {"interactive_submission_status",
                                                  "session_catalog","session_status","session_search"} else 0.75))

    def _validate_target(self, command: str, target: Any) -> dict[str, Any] | None:
        if command not in self._TARGET_REQUIRED and target is None:
            return None
        if not isinstance(target, dict):
            raise InteractionSurfaceError("INVALID_COMMAND", "command_target_required")
        target_id = str(target.get("id") or "")
        if not target_id:
            raise InteractionSurfaceError("INVALID_COMMAND", "command_target_id_required")
        expected_kind=self._TARGET_KIND.get(command)
        if expected_kind and str(target.get("kind") or "") != expected_kind:
            raise InteractionSurfaceError("INVALID_COMMAND", "command_target_kind_mismatch")
        if bool(target.get("synthetic")):
            raise InteractionSurfaceError("SYNTHETIC_TARGET_DENIED", "synthetic_target_is_not_canonical", 409)
        # A prefix guard catches common QA/mock references even if a buggy client omits synthetic=true.
        if re.match(r"^(SYNTHETIC|SYN|QA|MOCK)[-_:]", target_id, re.IGNORECASE):
            raise InteractionSurfaceError("SYNTHETIC_TARGET_DENIED", "synthetic_target_is_not_canonical", 409)
        return target

    def _validate_target_input_binding(self, command: str, target: dict[str, Any] | None, inp: dict[str, Any]) -> None:
        if target is None:
            return
        field=self._TARGET_INPUT_ID.get(command)
        if not field:
            return
        supplied=inp.get(field)
        if supplied is None or str(supplied)=="":
            return
        if str(supplied) != str(target["id"]):
            raise InteractionSurfaceError("INVALID_COMMAND", "command_target_input_mismatch")

    def _require_revision(self, command: str, request: dict[str, Any]) -> None:
        if command not in self._TARGET_REQUIRED:
            return
        if command=="ui_preferences_update":
            # Appearance and navigation are validated local presentation hints:
            # they cannot grant authority or mutate Task/Graph/Tool state.
            # Unrelated background work must not invalidate their save or
            # force a complete global revision scan.
            return
        supplied = str(request.get("snapshot_revision") or "")
        if not supplied:
            raise InteractionSurfaceError("STALE_ETAG_OR_REVISION", "snapshot_revision_required", 409)
        current = self.revision()
        if supplied != current:
            raise InteractionSurfaceError("STALE_ETAG_OR_REVISION", "snapshot_revision_changed", 409)

    @staticmethod
    def _input(request: dict[str, Any]) -> dict[str, Any]:
        value = request.get("input") or {}
        if not isinstance(value, dict):
            raise InteractionSurfaceError("INVALID_COMMAND", "command_input_object_required")
        return value

    def command(self, request: dict[str, Any]) -> dict[str, Any]:
        locale, surface = self._validate_common(request)
        command = str(request.get("command") or "")
        if command not in self._COMMAND_NAMES:
            raise InteractionSurfaceError("INVALID_COMMAND", "unknown_command")
        target = self._validate_target(command, request.get("target"))
        if bool(request.get("offline")) and command in self._OFFLINE_DENIED:
            raise InteractionSurfaceError("OFFLINE_COMMAND_DENIED", "offline_command_not_queued", 409)
        inp = self._input(request)
        self._validate_target_input_binding(command, target, inp)
        lock = getattr(self.backend, "_mutation_lock", None)
        # Model-running paths validate/admit under the owner's lock but perform
        # inference outside it. Holding this outer lock for the full HTTP
        # request would defeat that distinction.
        model_running=(command in {"retry_task","work_board_run_worker",
                                   "iwxa_basic_model_try"}
                       or command=="submit_task" and inp.get("background") is not True
                       or command=="review_task" and (inp.get("action") or inp.get("decision"))=="revise")
        # Native path selection does not mutate state or grant permission.
        # Reading every owner revision before opening Windows Shell can block
        # a modal chooser behind unrelated work. Its target/input were already
        # validated; permission-changing follow-up commands retain full gates.
        native_path_picker = command in self._NATIVE_PATH_PICKERS
        try:
            if native_path_picker:
                return self._execute_command(command, inp, target, locale, surface, request)
            if lock is None:
                self._require_revision(command, request)
                return self._execute_command(command, inp, target, locale, surface, request)
            if model_running or command in {"iwxa_exchange_export","corporate_t3_submit","corporate_t3_prepare","corporate_t3_export",
                                            "corporate_t3_atlas_publish","corporate_t3_atlas_save","k03_selection_to_task_draft",
                                            "graph_model_choice_prepare"}:
                # Release global mutation lock before lengthy export I/O.
                # The adapter verifies exact Task/State/Result revisions.
                with lock:
                    self._require_revision(command, request)
                return self._execute_command(command, inp, target, locale, surface, request)
            with lock:
                self._require_revision(command, request)
                return self._execute_command(command, inp, target, locale, surface, request)
        except InteractionSurfaceError:
            raise
        except Exception as exc:
            raise self._map_backend_error(exc) from exc

    @staticmethod
    def _map_backend_error(exc: Exception) -> InteractionSurfaceError:
        from providers.model_provider_port import ModelProviderPortError
        from runtime.explorer_local_ai import ExplorerLocalAIError
        from runtime.iwxa_basic_gguf import BasicGGUFError

        # Fixed local-GGUF recovery reasons only; never publish arbitrary
        # provider text, file paths or exception details to a desktop surface.
        if isinstance(exc, BasicGGUFError) and str(exc) in {
                "basic_model_not_ready", "basic_runtime_model_pin_changed"}:
            return InteractionSurfaceError("INVALID_COMMAND", str(exc), 409)
        # ModelProviderPort retains a bounded provider_error_code, but its
        # string representation may include arbitrary backend details.
        # Publish ONLY these finite native transport outcomes so a person and
        # private Windows acceptance can distinguish a stalled calculation
        # from an invalid CLI process or an incomplete answer.
        basic_transport_codes = {
            "basic_runtime_generation_failed", "basic_runtime_output_invalid",
            "basic_runtime_output_frame_invalid",
            "basic_runtime_output_reasoning_invalid",
            "basic_runtime_output_reasoning_unfinished",
            "basic_runtime_output_empty",
            "basic_runtime_native_memory_unavailable",
            "basic_runtime_native_dependency_unavailable",
            "basic_runtime_native_instruction_unsupported",
            "basic_runtime_native_crash",
            "basic_runtime_native_cli_argument_invalid",
            "basic_runtime_native_cli_input_unavailable",
            "basic_runtime_native_model_load_failed",
            "basic_runtime_native_cli_exit_1",
            "basic_runtime_native_cli_exit_2",
            "basic_runtime_timeout", "basic_runtime_busy",
            "basic_runtime_reasoning_effort_invalid",
            "basic_runtime_start_failed", "basic_runtime_token_limit_invalid",
            "basic_runtime_executable_changed", "basic_runtime_prompt_required",
        }
        native_reason = (str(exc) if isinstance(exc, BasicGGUFError)
            else exc.provider_error_code if isinstance(exc, ModelProviderPortError)
                 and exc.provider_error_type == "BasicGGUFError" else None)
        if native_reason in basic_transport_codes:
            return InteractionSurfaceError(
                "INVALID_COMMAND", native_reason,
                409 if native_reason == "basic_runtime_busy" else 400)

        area_recovery_codes = {
            "work_area_local_model_required", "work_area_local_sources_forbidden",
            "work_area_source_not_permitted", "work_area_stale_catalog",
            "work_area_name_invalid", "work_area_purpose_invalid",
            "work_area_storage_readback_failed", "work_area_unknown",
            "automation_source_work_area_mismatch","automation_work_area_changed",
            "automation_work_area_binding_missing","automation_work_area_conversation_mismatch",
            "automation_work_area_source_forbidden","automation_work_area_local_model_required",
            "automation_occurrence_work_area_changed",
            "interactive_submission_work_area_changed",
            "interactive_submission_work_area_conversation_mismatch",
        }
        if isinstance(exc, ValueError) and str(exc) == "t3_external_execution_disabled":
            # A known mode restriction is a definite rejection, not an
            # unknown execution outcome or permission to change the mode.
            return InteractionSurfaceError("AUTHORITY_REQUIRED", "t3_external_execution_disabled", 409)
        if isinstance(exc, ValueError) and str(exc) in {
                "composer_draft_changed", "composer_pending_workspace_invalid",
                "composer_migrated_draft_missing", "composer_workspace_invalid"}:
            return InteractionSurfaceError("INVALID_COMMAND", str(exc), 409)
        if isinstance(exc, ValueError) and str(exc) in area_recovery_codes:
            return InteractionSurfaceError("INVALID_COMMAND", str(exc), 400)
        if isinstance(exc, ValueError) and str(exc) in {"ui_preferences_view_area_changed", "ui_preferences_view_invalid", "ui_preferences_language_invalid", "ui_preferences_theme_invalid", "ui_preferences_t3_invalid"}:
            return InteractionSurfaceError("INVALID_COMMAND", str(exc), 409 if str(exc) == "ui_preferences_view_area_changed" else 400)
        local_recovery_codes = {
            "ollama_protocol_incompatible", "ollama_version_unsupported",
            "ollama_binding_save_failed", "ollama_runtime_not_selected",
            "ollama_inventory_invalid", "ollama_model_catalog_changed",
            "ollama_private_endpoint_invalid",
            "ollama_selected_model_identity_mismatch",
            "ollama_selected_model_not_present",
            "ollama_not_running",
        }
        local_code = str(exc) if isinstance(exc, ExplorerLocalAIError) else ""
        if isinstance(exc, ModelProviderPortError) and exc.provider_error_type == "ExplorerLocalAIError":
            local_code = exc.provider_error_code or ""
        if local_code == "ollama_internal_error":
            return InteractionSurfaceError("INVALID_COMMAND", local_code, 500)
        if local_code in local_recovery_codes:
            # Public recovery exposes only a fixed reason, never provider payloads.
            return InteractionSurfaceError("INVALID_COMMAND", local_code, 400)
        if isinstance(exc, ExplorerLocalAIError):
            return InteractionSurfaceError("INVALID_COMMAND", "ollama_internal_error", 500)
        # Fixed recovery reason only; never expose arbitrary exception text.
        if isinstance(exc, ValueError) and str(exc) in {
                "local_document_update_source_changed", "document_editor_changed",
                "document_source_work_area_changed", "document_source_work_area_ambiguous"}:
            return InteractionSurfaceError("INVALID_COMMAND", str(exc), 409)
        # Recovery is a readback-only check followed by an existing durable
        # WorkBoard state transition. Expose only fixed non-sensitive reasons.
        work_recovery_reasons={
            "work_ticket_saved_result_requires_recovery",
            "work_ticket_saved_result_unavailable",
            "work_ticket_worker_recovery_ambiguous",
            "work_ticket_worker_recovery_binding_mismatch",
            "work_ticket_worker_recovery_context_changed",
            "work_ticket_worker_recovery_receipt_invalid",
            "work_ticket_worker_recovery_ref_invalid",
            "work_ticket_worker_recovery_claim_invalid",
            "work_ticket_worker_already_running",
            "work_ticket_dependency_worker_result_missing",
            "work_ticket_dependency_context_budget_exceeded",
            "work_ticket_dependency_verification_mismatch",
            "work_ticket_dependency_not_accepted",
            "work_ticket_worker_binding_mismatch",
            "worker_output_integrity_failure",
        }
        if isinstance(exc,ValueError) and str(exc) in work_recovery_reasons:
            return InteractionSurfaceError("INVALID_COMMAND",str(exc),409)
        # Only fixed, non-sensitive document recovery reasons are public.
        # Arbitrary user paths and provider exception payloads remain hidden.
        document_reasons = {
            "local_document_draft_source_human_acceptance_required",
            "local_document_draft_selected_documents_required",
            "local_document_draft_ollama_only",
            "local_document_destination_not_connected",
            "local_document_destination_not_writable",
            "local_document_destination_parent_not_directory",
            "local_document_update_has_no_changes",
            "local_document_update_expected_digest_required",
            "local_document_draft_text_file_required",
            "local_document_draft_output_out_of_bounds",
            "document_editor_source_not_accepted",
            "document_editor_storage_invalid", "document_editor_save_readback_failed",
            "document_editor_draft_invalid",
        }
        if isinstance(exc, ValueError) and str(exc) in document_reasons:
            return InteractionSurfaceError("INVALID_COMMAND", str(exc), 400)
        obsidian_reasons = {
            "obsidian_write_vault_not_selected", "obsidian_write_vault_unavailable",
            "obsidian_write_vault_not_recognized", "obsidian_write_folder_unavailable",
            "obsidian_write_explicit_confirmation_required",
            "obsidian_write_settings_invalid", "obsidian_write_folder_invalid",
            "obsidian_write_folder_required",
            "obsidian_write_disabled_folders_must_be_empty",
            "obsidian_draft_source_human_acceptance_required",
            "obsidian_draft_revision_changed_or_unavailable",
            "obsidian_draft_destination_not_writable",
            "obsidian_vault_change_requires_activation",
            "obsidian_action_work_area_changed",
        }
        if str(exc) in obsidian_reasons:
            return InteractionSurfaceError("INVALID_COMMAND", str(exc), 409)
        n8n_reasons = {
            "n8n_draft_confirmation_required", "n8n_draft_message_invalid",
            "n8n_draft_selection_invalid", "n8n_draft_workspace_changed",
            "n8n_draft_local_only_forbidden", "n8n_draft_provider_not_selected",
            "n8n_draft_target_not_approved", "n8n_draft_local_endpoint_policy_required",
            "n8n_draft_existing_task_incomplete", "n8n_draft_provider_not_configured",
            "n8n_draft_request_id_invalid", "n8n_draft_request_conflict",
        }
        if isinstance(exc, ValueError) and str(exc) in n8n_reasons:
            return InteractionSurfaceError("INVALID_COMMAND", str(exc), 409)
        if isinstance(exc, ValueError) and str(exc) == "online_account_active_disconnect_first":
            # Keep the original account selected and its credentials intact.
            # This fixed conflict tells the person to disconnect before removal.
            return InteractionSurfaceError("INVALID_COMMAND", "online_account_active_disconnect_first", 409)
        if isinstance(exc, ValueError) and str(exc) == "n8n_local_health_not_verified":
            return InteractionSurfaceError("INVALID_COMMAND", "n8n_local_health_not_verified", 409)
        if isinstance(exc, ValueError) and str(exc) == "session_paused_resume_required":
            return InteractionSurfaceError("AUTHORITY_REQUIRED", "session_paused_resume_required", 409)
        code = str(getattr(exc, "code", "") or "")
        authority_codes = {
            "AUTHORITY_REQUIRED", "REBIND_NOT_AUTHORIZED", "ADMISSION_REQUIRED",
            "APPROVAL_REQUIRED", "APPROVAL_REJECTED", "APPROVAL_EXPIRED",
            "APPROVAL_REVOKED", "APPROVAL_BINDING_MISMATCH", "RECONCILIATION_REQUIRED",
        }
        if code in authority_codes:
            return InteractionSurfaceError("AUTHORITY_REQUIRED", code.lower(), 409)
        # Corporate T3 failures are fixed, bounded owner/adapter codes only.
        # Never expose original filesystem paths, private signer details or stacks.
        from runtime.t3_original_employee_port import CorporateT3Error
        if isinstance(exc, CorporateT3Error):
            reason = str(exc)
            allowed = {
                "T3_ORIGINAL_OWNER_NOT_INSTALLED", "T3_ORIGINAL_OWNER_NOT_AVAILABLE",
                "T3_EMPLOYEE_NOT_CONNECTED", "T3_EXPLICIT_ORGANIZATION_REQUIRED",
                "T3_ORGANIZATION_MEMBERSHIP_REQUIRED", "T3_ORGANIZATION_AUTHORITY_NOT_ACTIVE",
                "T3_ORIGINAL_TASK_REQUIRED", "T3_ORIGINAL_SIGNED_TASK_READBACK_FAILED",
                "T3_VERIFIED_TASK_BINDING_REQUIRED", "T3_CORPORATE_WORK_AREA_REQUIRED",
                "T3_CORPORATE_AREA_MUST_ISOLATE_PERSONAL_SOURCES",
                "T3_AGENT_RESULT_FOREIGN_TASK", "T3_AGENT_TASK_OBJECTIVE_CHANGED",
                "T3_AGENT_TASK_BINDING_CHANGED", "T3_AGENT_TASK_READBACK_INVALID",
                "T3_ACCEPTED_RESULT_READBACK_REQUIRED", "T3_OUTCOME_UNKNOWN_RECONCILE_FIRST",
                "T3_ORIGINAL_OWNER_READ_UNAVAILABLE",
                "T3_EMPLOYEE_EXPORT_GRANT_NOT_ACTIVE",
            }
            return InteractionSurfaceError("INVALID_COMMAND",
                reason if reason in allowed else "t3_original_owner_refused", 409)
        # The public contract intentionally does not leak provider/tool exception payloads.
        detail = code.lower() if code else type(exc).__name__.lower()
        return InteractionSurfaceError("INVALID_COMMAND", detail[:120], 400)

    def _execute_command(self, command: str, inp: dict[str, Any], target: dict[str, Any] | None, locale: str, surface: str, request: dict[str, Any]) -> dict[str, Any]:
        if command not in self._TARGET_REQUIRED:
            # New-object commands are still evaluated against a revision when a client supplies one,
            # but they are allowed without it to support first interaction after startup.
            supplied = str(request.get("snapshot_revision") or "")
            if command!="quick_chat_submit" and command not in self._NATIVE_PATH_PICKERS and supplied and supplied != self.revision():
                raise InteractionSurfaceError("STALE_ETAG_OR_REVISION", "snapshot_revision_changed", 409)
        result: Any
        if command == "atlas_file_choose":
            if (surface!="builtin_web" or inp):
                raise InteractionSurfaceError("INVALID_COMMAND","atlas_file_choose_input_invalid")
            result=self.backend.atlas_file_choose()
        elif command == "t2_domain_file_choose":
            if (surface!="builtin_web" or inp):
                raise InteractionSurfaceError("INVALID_COMMAND","t2_domain_file_choose_input_invalid")
            result=self.backend.t2_domain_file_choose()
        elif command == "t2_domain_attach_to_task":
            required={"path","package_sha256","workspace_id","object_id","revision",
                      "expected_workspace_id","expected_draft_digest"}
            if (surface!="builtin_web" or set(inp)!=required
                    or any(type(inp.get(k)) is not str for k in required-{"revision"})
                    or type(inp.get("revision")) is not int):
                raise InteractionSurfaceError("INVALID_COMMAND","t2_domain_attach_input_invalid")
            result=self.backend.t2_domain_attach_to_task(**inp)
        elif command == "quick_chat_submit":
            required={"conversation_key","submission_id","message","local_model","skill_id"}
            extra={"options","knowledge_sources","attachments"}
            if (surface!="builtin_web" or not required.issubset(inp) or set(inp)-required-extra
                    or not all(type(inp.get(k)) is str for k in ("conversation_key","submission_id","message"))
                    or (inp.get("local_model") is not None and type(inp.get("local_model")) is not dict)
                    or (inp.get("skill_id") is not None and type(inp.get("skill_id")) is not str)
                    or (inp.get("options") is not None and type(inp["options"]) is not dict)
                    or (inp.get("knowledge_sources") is not None and type(inp["knowledge_sources"]) is not list)
                    or (inp.get("attachments") is not None and type(inp["attachments"]) is not list)):
                raise InteractionSurfaceError("INVALID_COMMAND","chat_submit_input_invalid")
            result=self.backend.quick_chat_submit(inp["conversation_key"],
                inp["submission_id"],inp["message"],inp["local_model"],inp["skill_id"],
                inp.get("options"),inp.get("knowledge_sources"),inp.get("attachments"))
        elif command == "k03_selection_to_task_draft":
            required={"selection","discovery","workspace_id","expected_draft_digest","confirmed"}
            optional={"expected_result","acceptance_criteria","replace_existing","host_request","host_sources"}
            if (surface!="builtin_web" or not required.issubset(inp)
                    or set(inp)-required-optional or inp["confirmed"] is not True
                    or type(inp["selection"]) is not dict
                    or type(inp["discovery"]) is not dict
                    or type(inp["workspace_id"]) is not str
                    or type(inp["expected_draft_digest"]) is not str
                    or (inp.get("expected_result") is not None
                        and type(inp["expected_result"]) is not str)
                    or (inp.get("acceptance_criteria") is not None
                        and type(inp["acceptance_criteria"]) is not list)
                    or type(inp.get("replace_existing",False)) is not bool
                    or (inp["discovery"].get("schema")=="IWXA_K03_HOST_DISCOVERY/0.2.0"
                        and (type(inp.get("host_request")) is not dict
                             or type(inp.get("host_sources")) is not list))
                    or (inp["discovery"].get("schema")!="IWXA_K03_HOST_DISCOVERY/0.2.0"
                        and ("host_request" in inp or "host_sources" in inp))):
                raise InteractionSurfaceError("INVALID_COMMAND",
                                              "k03_draft_input_invalid")
            result=self.backend.k03_selection_to_task_draft(
                inp["selection"],inp["discovery"],inp["workspace_id"],
                inp["expected_draft_digest"],
                expected_result=inp.get("expected_result") or "",
                acceptance_criteria=inp.get("acceptance_criteria"),
                replace_existing=inp.get("replace_existing",False),
                host_request=inp.get("host_request"),
                host_sources=inp.get("host_sources"))
        elif command == "quick_chat_to_task_draft":
            if (surface!="builtin_web" or set(inp)!={"conversation_key","message_id","expected_draft_digest","confirmed"}
                    or inp.get("confirmed") is not True
                    or not all(type(inp.get(k)) is str for k in ("conversation_key","message_id","expected_draft_digest"))):
                raise InteractionSurfaceError("INVALID_COMMAND","chat_task_transfer_invalid")
            result=self.backend.quick_chat_to_task_draft(
                inp["conversation_key"],inp["message_id"],inp["expected_draft_digest"])
        elif command == "n8n_workflow_request_begin":
            if (target["id"] != "N8N_WORKFLOW_V1" or set(inp) != {"request_id", "confirmed"}
                    or inp["confirmed"] is not True):
                raise InteractionSurfaceError("INVALID_COMMAND", "n8n_draft_input_invalid")
            result = self.backend.n8n_workflow_request_begin(inp["request_id"])
        elif command == "n8n_workflow_draft":
            if (not isinstance(target, dict) or target["id"] != "N8N_WORKFLOW_V1"
                    or set(inp) not in (
                        {"provider_id", "workflow_target", "message", "workspace_id", "confirmed"},
                        {"provider_id", "workflow_target", "message", "workspace_id", "confirmed", "request_id"})
                    or inp["provider_id"] != target["id"]
                    or inp["confirmed"] is not True):
                raise InteractionSurfaceError("INVALID_COMMAND", "n8n_draft_input_invalid")
            result = self.backend.n8n_workflow_draft(
                inp["workflow_target"], inp["message"], inp["workspace_id"],
                confirmed=True, request_id=inp.get("request_id"))
        elif command == "obsidian_write_configure":
            if (surface != "builtin_web" or target["id"] != "OBSIDIAN_V1"
                    or set(inp) != {"provider_id","enabled","folders","confirmed"}
                    or inp["provider_id"] != target["id"]
                    or type(inp["enabled"]) is not bool
                    or type(inp["folders"]) is not list
                    or type(inp["confirmed"]) is not bool
                    or inp["enabled"] and inp["confirmed"] is not True):
                raise InteractionSurfaceError("INVALID_COMMAND","obsidian_write_configure_input_invalid")
            result=self.backend.configure_obsidian_write(
                inp["enabled"],inp["folders"],confirmed=inp["confirmed"])
        elif command == "obsidian_note_draft":
            allowed = {"source_task_id", "path", "text", "mode", "confirmed", "expected_sha256"}
            if (surface != "builtin_web" or set(inp) - allowed
                    or inp.get("source_task_id") != target["id"]
                    or inp.get("confirmed") is not True
                    or type(inp.get("path")) is not str
                    or type(inp.get("text")) is not str
                    or inp.get("mode") not in {"create", "replace"}):
                raise InteractionSurfaceError("INVALID_COMMAND", "obsidian_draft_input_invalid")
            if ((inp["mode"] == "create" and inp.get("expected_sha256") is not None)
                    or (inp["mode"] == "replace" and (
                        type(inp.get("expected_sha256")) is not str
                        or re.fullmatch(r"[0-9a-f]{64}", inp["expected_sha256"]) is None))):
                raise InteractionSurfaceError("INVALID_COMMAND", "obsidian_draft_revision_invalid")
            result = self.backend.obsidian_note_draft(
                target["id"], inp["path"], inp["text"],
                mode=inp["mode"], expected_sha256=inp.get("expected_sha256"),
                confirmed=True)
        elif command == "local_document_file_draft":
            # An accepted Task is the only eligible source. Staging a write
            # candidate never grants execution authority or changes a file.
            allowed = {"source_task_id", "path", "text", "mode", "confirmed", "expected_sha256"}
            if (set(inp) - allowed
                    or inp.get("source_task_id") != target["id"]
                    or inp.get("confirmed") is not True
                    or not isinstance(inp.get("path"), str)
                    or not isinstance(inp.get("text"), str)
                    or inp.get("mode") not in {"create", "replace"}):
                raise InteractionSurfaceError("INVALID_COMMAND", "local_document_draft_input_invalid")
            if (inp["mode"] == "create" and "expected_sha256" in inp
                    or inp["mode"] == "replace" and (
                        not isinstance(inp.get("expected_sha256"), str)
                        or not re.fullmatch(r"[0-9a-f]{64}", inp["expected_sha256"]))):
                raise InteractionSurfaceError("INVALID_COMMAND", "local_document_draft_expected_version_invalid")
            result = self.backend.local_document_file_draft(
                target["id"], inp["path"], text=inp["text"],
                mode=inp["mode"], confirmed=True,
                expected_sha256=inp.get("expected_sha256"),
            )
        elif command == "local_office_pdf_ocr_draft":
            # A file selected in the active Workspace is a first-class Task
            # source; a separately reviewed source Task is still supported.
            # Neither variant executes OCR or grants approval here.
            task_mode=target["kind"]=="task"
            file_mode=target["kind"]=="workspace"
            expected=({"source_task_id", "source_path", "path",
                       "expected_sha256", "confirmed"} if task_mode else
                      {"source_task_id", "workspace_id", "source_path",
                       "path", "expected_sha256", "confirmed"})
            if (surface!="builtin_web" or not (task_mode or file_mode)
                    or set(inp)!=expected or inp.get("confirmed") is not True
                    or any(type(inp.get(k)) is not str
                           for k in ("source_path", "path", "expected_sha256"))
                    or not re.fullmatch(r"[a-f0-9]{64}", inp["expected_sha256"])
                    or task_mode and (
                        type(inp.get("source_task_id")) is not str
                        or inp["source_task_id"]!=target["id"])
                    or file_mode and (
                        inp.get("source_task_id") is not None
                        or type(inp.get("workspace_id")) is not str
                        or inp["workspace_id"]!=target["id"])):
                raise InteractionSurfaceError("INVALID_COMMAND",
                                              "office_pdf_ocr_draft_input_invalid")
            result=self.backend.local_office_pdf_ocr_draft(
                inp["source_task_id"],inp["source_path"],inp["path"],
                expected_sha256=inp["expected_sha256"],confirmed=True,
                **({"workspace_id":target["id"]} if file_mode else {}))
        elif command == "ui_preferences_update":
            # Only the authenticated built-in desktop may update its own
            # presentation hints. External surfaces cannot change this view.
            if (surface!="builtin_web" or not isinstance(target, dict)
                    or str(target.get("kind") or "")!="ui_preferences"
                    or str(target.get("id") or "")!="desktop"
                    or not set(inp) or set(inp)-{"language","theme","view","t3_enabled"}):
                raise InteractionSurfaceError("INVALID_COMMAND","ui_preferences_update_input_invalid")
            if "t3_enabled" in inp and type(inp["t3_enabled"]) is not bool:
                raise InteractionSurfaceError("INVALID_COMMAND","ui_preferences_t3_invalid")
            result=self.backend.update_ui_preferences(inp.get("language"),inp.get("theme"),
                                                     inp.get("view"),inp.get("t3_enabled"))
        elif command.startswith("corporate_t3_"):
            if surface != "builtin_web" or self.backend.ui_preferences().get("t3_enabled") is not True:
                raise InteractionSurfaceError("INVALID_COMMAND", "t3_employee_desktop_mode_required", 409)
            op = command.removeprefix("corporate_t3_")
            shapes = {
                "connect": {"root"}, "disconnect": set(), "select": {"context"},
                "invite": {"path"}, "receive": {"path"}, "select_task": {"taskId"},
                "submit": set(), "prepare": {"task_id"},
                "recover_prepared": {"task_id"}, "preview": set(),
                "export": {"path", "previewDigest", "confirmed"},
                "atlas_publish": {"workRef", "confirmed", "selectedSummarySha256"},
                "atlas_save": {"workRef", "path", "confirmed"},
            }
            if op not in shapes or set(inp) != shapes[op]:
                raise InteractionSurfaceError("INVALID_COMMAND", "t3_employee_command_input_invalid")
            port = (self.backend.corporate_t3
                    if op not in {"atlas_publish", "atlas_save"} else None)
            if op in {"connect", "invite", "receive", "export"}:
                field = "root" if op == "connect" else "path"
                if type(inp[field]) is not str or not 1 <= len(inp[field]) <= 2048:
                    raise InteractionSurfaceError("INVALID_COMMAND", "t3_employee_path_invalid")
            if op == "select" and inp["context"] not in ("PERSONAL", "ORGANIZATION"):
                raise InteractionSurfaceError("INVALID_COMMAND", "t3_employee_context_invalid")
            if op == "select_task" and (type(inp["taskId"]) is not str or
                re.fullmatch(r"task:[A-Za-z0-9:-]+", inp["taskId"]) is None):
                raise InteractionSurfaceError("INVALID_COMMAND", "t3_employee_task_invalid")
            if op == "recover_prepared" and (
                    type(inp["task_id"]) is not str or
                    re.fullmatch(r"TASK-[A-Za-z0-9_-]+", inp["task_id"]) is None):
                raise InteractionSurfaceError("INVALID_COMMAND",
                                              "t3_employee_recovery_task_invalid")
            if op == "prepare" and (type(inp["task_id"]) is not str or
                re.fullmatch(r"TASK-[A-Za-z0-9_-]+", inp["task_id"]) is None):
                raise InteractionSurfaceError("INVALID_COMMAND", "t3_employee_selection_invalid")
            if op == "export" and (type(inp["previewDigest"]) is not str or
                re.fullmatch(r"[0-9a-f]{64}", inp["previewDigest"]) is None or
                inp["confirmed"] is not True):
                raise InteractionSurfaceError("INVALID_COMMAND", "t3_employee_consent_invalid")
            if op == "atlas_publish":
                if (inp["confirmed"] is not True or
                        type(inp["workRef"]) is not dict or
                        type(inp["selectedSummarySha256"]) is not str or
                        re.fullmatch(r"[a-f0-9]{64}", inp["selectedSummarySha256"]) is None):
                    raise InteractionSurfaceError("INVALID_COMMAND",
                                                  "t3_atlas_publish_consent_invalid")
                # The trusted Core creates identity, scope and signed Task
                # context. A UI cannot supply the original T3 context or
                # a selected Kernel Object/Exchange receipt.
                original = self.backend.original_t3_result_owner
                # The original installed employee worker accepts a separate
                # Atlas disclosure only while THIS human-confirmed Core
                # command is in flight. It is not a signed grant and cannot
                # be retained or replayed after a lost native ACK.
                scoped = getattr(getattr(self.backend, "corporate_t3", None),
                                 "original_atlas_disclosure", None)
                gate = (scoped(inp["workRef"], inp["selectedSummarySha256"])
                        if callable(scoped) else nullcontext())
                with gate:
                    result = original.publishAcceptedForWork({
                        "workRef": inp["workRef"],
                        "context": original.currentContext(),
                        "recipientId": "iwxa.atlas",
                        "purpose": "atlas.result.publish",
                    })
            elif op == "atlas_save":
                if (inp["confirmed"] is not True or
                        type(inp["workRef"]) is not dict or
                        type(inp["path"]) is not str or
                        not 1 <= len(inp["path"]) <= 2048 or
                        not inp["path"].lower().endswith(".iwxa")):
                    raise InteractionSurfaceError(
                        "INVALID_COMMAND", "t3_atlas_signed_archive_save_invalid")
                # The native original publisher and the installed Agent Core
                # independently prove this previously committed signed
                # transfer. The browser chooses only an output path, never
                # a signer, Task/Result, archive byte or Kernel ObjectRef.
                original = self.backend.original_t3_result_owner
                result = original.saveSignedAtlasArchiveForWork({
                    "workRef": inp["workRef"],
                    "context": original.currentContextForRecovery(),
                    "recipientId": "iwxa.atlas",
                    "purpose": "atlas.result.publish",
                    "path": inp["path"],
                })
            elif op == "submit":
                result = port.submit(self.backend)
            elif op == "prepare":
                result = port.prepare_company(self.backend, inp["task_id"])
            elif op == "recover_prepared":
                result = port.recover_prepared(self.backend, inp["task_id"])
            else:
                original_name = {"invite": "import_invite", "receive": "receive_task"}.get(op, op)
                result = port.call(original_name, inp,
                    consequential=op in {"connect", "invite", "receive", "export", "select", "select_task"})
                # Selecting the company ONLY selects its original signed
                # T2 Workspace. No local Agent WorkArea on entry.
                if op == "select" and inp["context"] == "ORGANIZATION":
                    port.activate_company_area(self.backend)
                # Returning to PERSONAL restores the existing personal area.
                if (op == "select" and inp["context"] == "PERSONAL") or op == "disconnect":
                    self.backend.workspace_select("personal")
        elif command == "online_account_remove":
            ids=inp.get("expected_provider_ids")
            if (surface!="builtin_web" or target is None
                    or set(inp)!={"account_id","expected_provider_ids","confirmed"}
                    or inp.get("confirmed") is not True
                    or type(inp.get("account_id")) is not str
                    or inp["account_id"]!=target["id"]
                    or type(ids) is not list or not 1<=len(ids)<=3
                    or any(type(pid) is not str for pid in ids)
                    or ids!=sorted(set(ids))):
                raise InteractionSurfaceError("INVALID_COMMAND","online_account_remove_input_invalid")
            result=self.backend.online_account_remove(inp["account_id"],ids)
        elif command == "online_account_verify":
            if (surface!="builtin_web" or target is None or
                    set(inp)!={"account_id","expected_binding_digest","confirmed"}
                    or inp.get("confirmed") is not True
                    or type(inp.get("account_id")) is not str
                    or inp["account_id"]!=target["id"]
                    or type(inp.get("expected_binding_digest")) is not str
                    or re.fullmatch(r"[0-9a-f]{64}",inp["expected_binding_digest"]) is None):
                raise InteractionSurfaceError("INVALID_COMMAND","online_account_verify_input_invalid")
            result=self.backend.online_account_verify(
                inp["account_id"],inp["expected_binding_digest"])
        elif command == "online_account_register":
            required = {"provider_id", "vendor", "service", "account_label",
                        "username_env", "app_password_env", "confirmed"}
            optional = {"collection_url", "imap_host", "smtp_host",
                        "smtp_port", "smtp_security"}
            if (surface != "builtin_web" or inp.get("confirmed") is not True
                    or not required.issubset(inp) or set(inp) - required - optional):
                raise InteractionSurfaceError("INVALID_COMMAND", "online_account_register_input_invalid")
            from runtime.online_services_accounts import OnlineAccountError
            try:
                result = self.backend.online_account_register(
                    {k:v for k,v in inp.items() if k != "confirmed"})
            except OnlineAccountError as exc:
                raise InteractionSurfaceError("INVALID_COMMAND", str(exc)[:120], 400) from None
        elif command == "online_google_account_register":
            if (surface != "builtin_web" or set(inp) != {
                    "account_id", "account_label", "env_prefix", "confirmed"}
                    or inp.get("confirmed") is not True):
                raise InteractionSurfaceError(
                    "INVALID_COMMAND", "online_google_account_register_input_invalid")
            from runtime.online_services_accounts import OnlineAccountError
            try:
                result = self.backend.online_google_account_register({
                    k:v for k,v in inp.items() if k != "confirmed"})
            except OnlineAccountError as exc:
                raise InteractionSurfaceError("INVALID_COMMAND", str(exc)[:120], 400) from None
        elif command == "online_telegram_bot_register":
            if (surface != "builtin_web" or set(inp) != {
                    "provider_id", "account_label", "bot_token_env",
                    "allowed_user_ids_env", "test_environment", "confirmed"}
                    or inp.get("confirmed") is not True):
                raise InteractionSurfaceError(
                    "INVALID_COMMAND", "online_telegram_bot_register_input_invalid")
            from runtime.online_services_accounts import OnlineAccountError
            try:
                result = self.backend.online_telegram_bot_register({
                    k:v for k,v in inp.items() if k != "confirmed"})
            except OnlineAccountError as exc:
                raise InteractionSurfaceError("INVALID_COMMAND", str(exc)[:120], 400) from None
        elif command == "submit_task" and inp.get("background") is True:
            if surface!="builtin_web":
                raise InteractionSurfaceError("INVALID_COMMAND","interactive_background_surface_invalid")
            result=self.backend.submit_interactive_task(
                {k:v for k,v in inp.items() if k!='background'},surface="web")
        elif command == "submit_task":
            result = self.backend.chat(
                str(inp.get("message") or ""),
                skill_id=inp.get("skill_id"),
                use_memory=bool(inp.get("use_memory", True)),
                use_obsidian=bool(inp.get("use_knowledge", inp.get("use_obsidian", False))),
                use_web=bool(inp.get("use_web", False)),
                attachments=inp.get("attachments") or [],
                local_only_documents=inp.get("local_only_documents", False),
                knowledge_sources=inp.get("knowledge_sources") or [],
                artifact_sources=inp.get("artifact_sources") or [],
                atlas_work=inp.get("atlas_work"),
                surface=("telegram" if surface == "telegram" else "web"),
                conversation_key=inp.get("conversation_key"),
                workspace_id=inp.get("workspace_id"),
                local_model=inp.get("local_model"),
            )
        elif command == "retry_task":
            result = self.backend.retry_model(str(target["id"]))
        elif command == "iwxa_exchange_export":
            revision_fields = {"expected_task_sha256", "expected_state_sha256",
                               "expected_result_sha256", "expected_file_set_sha256"}
            if (surface != "builtin_web" or set(inp) != {"task_id", "workspace_id", "path", *revision_fields}
                    or type(inp.get("task_id")) is not str or inp["task_id"] != target["id"]
                    or type(inp.get("workspace_id")) is not str or not inp["workspace_id"]
                    or type(inp.get("path")) is not str or not 1 <= len(inp["path"]) <= 2048
                    or any(type(inp.get(field)) is not str
                           or re.fullmatch(r"[0-9a-f]{64}", inp[field]) is None
                           for field in revision_fields)):
                raise InteractionSurfaceError("INVALID_COMMAND", "iwxa_exchange_export_invalid")
            result = self.backend.iwxa_exchange_export(
                inp["task_id"], inp["workspace_id"], inp["path"],
                expected_task_sha256=inp["expected_task_sha256"],
                expected_state_sha256=inp["expected_state_sha256"],
                expected_result_sha256=inp["expected_result_sha256"],
                expected_file_set_sha256=inp["expected_file_set_sha256"])
        elif command == "iwxa_exchange_import":
            if (surface != "builtin_web" or set(inp) != {"workspace_id", "path", "expected_file_sha256"}
                    or type(inp.get("workspace_id")) is not str or inp["workspace_id"] != target["id"]
                    or type(inp.get("path")) is not str or not 1 <= len(inp["path"]) <= 2048
                    or type(inp.get("expected_file_sha256")) is not str
                    or re.fullmatch(r"[0-9a-f]{64}", inp["expected_file_sha256"]) is None):
                raise InteractionSurfaceError("INVALID_COMMAND", "iwxa_exchange_import_invalid")
            result = self.backend.iwxa_exchange_import(
                inp["path"], inp["workspace_id"], expected_file_sha256=inp["expected_file_sha256"])
        elif command == "review_task":
            action = str(inp.get("action") or inp.get("decision") or "")
            mapping = {"accept": "approve", "approve": "approve", "revise": "revise", "reject": "reject"}
            if action not in mapping:
                raise InteractionSurfaceError("INVALID_COMMAND", "invalid_review_action")
            result = self.backend.review(str(target["id"]), mapping[action], str(inp.get("instruction") or inp.get("notes") or ""), inp.get("accept_action_candidates") or [])
        elif command == "memory_propose":
            operation = str(inp.get("operation") or "CREATE").upper()
            if operation not in {"CREATE","CORRECT","FORGET"}:
                raise InteractionSurfaceError("INVALID_COMMAND", "invalid_memory_operation")
            result = self.backend.memory_propose(
                operation,
                target_memory_id=inp.get("target_memory_id"),
                memory_type=inp.get("memory_type"),
                content=inp.get("content"),
                classification=inp.get("classification"),
                tags=inp.get("tags") or [],
                source_task_id=inp.get("source_task_id"),
            )
        elif command == "memory_propose_from_knowledge":
            result = self.backend.memory_propose_from_knowledge(
                str(inp.get("path") or ""),
                str(inp.get("expected_sha256") or ""),
                memory_content=str(inp.get("content") or ""),
                memory_type=str(inp.get("memory_type") or "note"),
                classification=str(inp.get("classification") or "personal"),
                tags=inp.get("tags") or [],
                expected_provider_id=inp.get("provider_id"),
                expected_binding_digest=inp.get("binding_digest"),
            )
        elif command == "memory_review":
            decision = str(inp.get("decision") or "").upper()
            mapping = {"ADMIT": "APPROVE", "APPROVE": "APPROVE", "IGNORE": "REJECT", "REJECT": "REJECT"}
            if decision not in mapping:
                raise InteractionSurfaceError("INVALID_COMMAND", "invalid_memory_review_decision")
            result = self.backend.memory_review(str(target["id"]), mapping[decision])
        elif command == "provider_switch":
            provider_id = str(target["id"])
            if set(inp) != {"slot_id", "provider_id"} or inp["provider_id"] != provider_id:
                raise InteractionSurfaceError("INVALID_COMMAND", "provider_switch_input_invalid")
            result = self.backend.switch_provider(
                str(inp["slot_id"]), provider_id, reason="interaction_surface", return_full=True)
        elif command == "tool_read":
            result = self.backend.tool_read(str(target["id"]), inp.get("arguments") or {})
        elif command == "tool_read_attach_to_draft":
            dialogue_fields={"destination","conversation_key","receipt_id",
                             "data","expected_draft_digest","confirmed"}
            task_fields=dialogue_fields-{"conversation_key"}
            if (surface!="builtin_web" or inp.get("confirmed") is not True
                    or (inp.get("destination")=="dialogue" and set(inp)!=dialogue_fields)
                    or (inp.get("destination")=="task" and set(inp)!=task_fields)
                    or inp.get("destination") not in ("task","dialogue")
                    or type(inp.get("receipt_id")) is not str
                    or type(inp.get("expected_draft_digest")) is not str
                    or (inp.get("destination")=="dialogue"
                        and type(inp.get("conversation_key")) is not str)):
                raise InteractionSurfaceError("INVALID_COMMAND","tool_draft_import_input_invalid")
            result=self.backend.tool_read_attach_to_draft(
                inp["destination"],inp["receipt_id"],inp["data"],
                inp["expected_draft_digest"],inp.get("conversation_key"))
        elif command == "tool_prepare":
            result = self.backend.tool_prepare(str(inp.get("task_id") or ""), str(target["id"]), inp.get("ttl_minutes"))
        elif command == "tool_approve":
            result = self.backend.tool_approve(str(target["id"]), str(inp.get("decision") or ""), inp.get("ttl_minutes"))
        elif command == "tool_execute":
            result = self.backend.tool_execute(str(target["id"]), str(inp.get("approval_id") or ""))
        elif command == "tool_recover_interrupted":
            result = self.backend.tool_recover_interrupted(str(target["id"]))
        elif command == "tool_reconcile":
            result = self.backend.tool_reconcile(str(target["id"]), str(inp.get("outcome") or ""), str(inp.get("evidence_note") or ""))
        elif command == "tool_reprepare":
            result = self.backend.tool_reprepare(str(target["id"]), inp.get("ttl_minutes"))
        elif command == "goal_create":
            result = self.backend.goal_create(str(inp.get("objective") or ""), inp.get("acceptance_criteria") or [], inp.get("plan_steps") or [], inp.get("source_task_id"))
        elif command == "goal_proof":
            status = str(inp.get("status") or "UNKNOWN").upper()
            verifier_mode = str(inp.get("verifier_mode") or ("system" if status=="UNKNOWN" else "human"))
            if status not in {"PASS","FAIL","UNKNOWN"}:
                raise InteractionSurfaceError("INVALID_COMMAND", "invalid_goal_criterion_status")
            if status=="UNKNOWN":
                verifier_mode="system"
            elif verifier_mode!="human":
                raise InteractionSurfaceError("AUTHORITY_REQUIRED", "goal_human_verification_required", 409)
            result = self.backend.goal_proof(
                str(target["id"]), str(inp.get("criterion_id") or ""), status,
                inp.get("evidence_refs") or [], verifier_mode,
            )
        elif command == "work_board_create":
            deps=inp.get("dependency_map")
            if deps is not None and (type(deps) is not dict or len(deps)>100):
                raise InteractionSurfaceError("INVALID_COMMAND","work_board_dependency_map_invalid")
            result = self.backend.work_board_create(str(target["id"]), bool(inp.get("sequential", True)), int(inp.get("max_parallel", 4)),dependency_map=deps)
        elif command == "work_board_claim":
            ticket_id=inp.get("ticket_id")
            local_model=inp.get("local_model")
            if ticket_id is not None and (not isinstance(ticket_id,str) or not ticket_id.startswith("TKT-")):
                raise InteractionSurfaceError("INVALID_COMMAND","work_ticket_selection_invalid")
            if local_model is not None and (
                not isinstance(local_model,dict) or set(local_model)!={"name","digest"}):
                raise InteractionSurfaceError("INVALID_COMMAND","work_ticket_model_selection_invalid")
            result = self.backend.work_board_claim(str(target["id"]), str(inp.get("worker_id") or "anonymous-worker"), int(inp.get("limit", 1)),ticket_id=ticket_id,local_model=local_model)
        elif command == "work_board_run_worker":
            result = self.backend.work_board_run_worker(str(target["id"]), str(inp.get("ticket_id") or ""), str(inp.get("claim_token") or ""), str(inp.get("worker_id") or "model-worker"))
        elif command == "work_board_recover_worker":
            if (surface!="builtin_web" or set(inp)!={"board_id","ticket_id","claim_token"}
                    or inp.get("board_id")!=str(target["id"])
                    or not all(type(inp.get(k)) is str for k in ("board_id","ticket_id","claim_token"))
                    or not str(inp["ticket_id"]).startswith("TKT-")
                    or not str(inp["claim_token"]).startswith("WCLAIM-")):
                raise InteractionSurfaceError("INVALID_COMMAND","work_ticket_recovery_input_invalid")
            result = self.backend.work_board_recover_worker(
                str(target["id"]),inp["ticket_id"],inp["claim_token"])
        elif command == "work_board_submit_human":
            if (set(inp) != {"board_id", "ticket_id", "report_task_id"}
                    or inp.get("board_id") != str(target["id"])
                    or any(type(inp.get(k)) is not str for k in ("ticket_id", "report_task_id"))
                    or not str(inp["ticket_id"]).startswith("TKT-")
                    or not str(inp["report_task_id"]).startswith("TASK-")):
                raise InteractionSurfaceError("INVALID_COMMAND", "human_report_submission_input_invalid")
            result = self.backend.work_board_submit_human(
                str(target["id"]), inp["ticket_id"], inp["report_task_id"])
        elif command == "work_board_verify":
            verifier_mode = str(inp.get("verifier_mode") or "human")
            if verifier_mode != "human":
                raise InteractionSurfaceError("AUTHORITY_REQUIRED", "work_board_human_verification_required", 409)
            result = self.backend.work_board_verify(str(target["id"]), str(inp.get("ticket_id") or ""), str(inp.get("decision") or ""), "human")
        elif command == "work_board_retry_blocked":
            result = self.backend.work_board_retry_blocked(str(target["id"]), str(inp.get("ticket_id") or ""))
        elif command == "session_bind":
            # Creating the local conversation is independent of model readiness.
            # The identity is a conversation key, never a workspace authority.
            conversation_key = inp.get("conversation_key")
            if (not isinstance(conversation_key,str) or not 1<=len(conversation_key)<=128
                    or not all(ch.isascii() and (ch.isalnum() or ch in "_-.") for ch in conversation_key)
                    or set(inp)!={"conversation_key"}):
                raise InteractionSurfaceError("INVALID_COMMAND", "conversation_key_invalid")
            result = self.backend.session_command(
                "bind", "telegram" if surface == "telegram" else "web", conversation_key
            )
        elif command == "session_select":
            key = inp.get("conversation_key")
            if (surface != "builtin_web" or set(inp) != {"conversation_key"}
                    or not isinstance(key,str)
                    or not (key=="iwxa-desktop-local"
                            or re.fullmatch(r"dialog-[0-9a-f]{32}",key))):
                raise InteractionSurfaceError("INVALID_COMMAND", "desktop_conversation_selection_invalid")
            result = self.backend.session_command("select","web",key)
        elif command == "session_options_save":
            if surface!="builtin_web" or set(inp)!={"conversation_key","options"}:
                raise InteractionSurfaceError("INVALID_COMMAND","conversation_options_input_invalid")
            if type(inp.get("conversation_key")) is not str or type(inp.get("options")) is not dict:
                raise InteractionSurfaceError("INVALID_COMMAND","conversation_options_input_invalid")
            skill=inp["options"].get("skill_id")
            if skill is not None and skill not in self.backend.task_skill_catalog().get("skills",[]) and not any(
                 x.get("skill_id")==skill for x in self.backend.task_skill_catalog().get("skills",[])):
                raise InteractionSurfaceError("INVALID_COMMAND","conversation_skill_unavailable")
            result=self.backend.session_command("options","web",inp["conversation_key"],options=inp["options"])
        elif command == "session_rename":
            if (surface!="builtin_web" or set(inp)!={"conversation_key","title"}
                    or type(inp.get("conversation_key")) is not str
                    or type(inp.get("title")) is not str):
                raise InteractionSurfaceError("INVALID_COMMAND","conversation_title_input_invalid")
            result=self.backend.session_command("rename","web",inp["conversation_key"],title=inp["title"])
        elif command == "conversation_group_create":
            if (surface!="builtin_web" or set(inp)!={"name"}
                    or type(inp.get("name")) is not str):
                raise InteractionSurfaceError("INVALID_COMMAND","conversation_group_create_invalid")
            result=self.backend.conversation_group_create(inp["name"])
        elif command == "conversation_group_rename":
            if (surface!="builtin_web" or set(inp)!={"group_id","name"}
                    or type(inp.get("group_id")) is not str
                    or type(inp.get("name")) is not str):
                raise InteractionSurfaceError("INVALID_COMMAND","conversation_group_rename_invalid")
            result=self.backend.conversation_group_rename(inp["group_id"],inp["name"])
        elif command == "conversation_group_delete":
            if (surface!="builtin_web" or set(inp)!={"group_id"}
                    or type(inp.get("group_id")) is not str):
                raise InteractionSurfaceError("INVALID_COMMAND","conversation_group_delete_invalid")
            result=self.backend.conversation_group_delete(inp["group_id"])
        elif command == "conversation_group_pin":
            if (surface!="builtin_web" or set(inp)!={"group_id","pinned"}
                    or type(inp.get("group_id")) is not str
                    or type(inp.get("pinned")) is not bool):
                raise InteractionSurfaceError("INVALID_COMMAND","conversation_group_pin_invalid")
            result=self.backend.conversation_group_pin(inp["group_id"],inp["pinned"])
        elif command == "conversation_group_assign":
            if (surface!="builtin_web" or set(inp)!={"conversation_key","group_id"}
                    or type(inp.get("conversation_key")) is not str
                    or (inp.get("group_id") is not None
                        and type(inp.get("group_id")) is not str)):
                raise InteractionSurfaceError("INVALID_COMMAND","conversation_group_assign_invalid")
            result=self.backend.conversation_group_assign(inp["conversation_key"],inp["group_id"])
        elif command == "session_steer":
            conversation_key = str(inp.get("conversation_key") or "")
            if not conversation_key:
                raise InteractionSurfaceError("INVALID_COMMAND", "conversation_key_required")
            result = self.backend.session_command("steer", "telegram" if surface == "telegram" else "web", conversation_key, instruction=str(inp.get("instruction") or ""))
        elif command == "session_pause":
            result = self.backend.session_command("pause", "telegram" if surface == "telegram" else "web", str(inp.get("conversation_key") or ""))
        elif command == "session_resume":
            result = self.backend.session_command("resume", "telegram" if surface == "telegram" else "web", str(inp.get("conversation_key") or ""))
        elif command == "session_recycle":
            result = self.backend.session_command("recycle", "telegram" if surface == "telegram" else "web", str(inp.get("conversation_key") or ""))
        elif command == "session_clear":
            result = self.backend.session_command("clear", "telegram" if surface == "telegram" else "web", str(inp.get("conversation_key") or ""))
        elif command == "automation_create":
            result = self.backend.automation_create(
                str(inp.get("job_kind") or ""), inp.get("payload") or {}, due_at=inp.get("due_at"),
                interval_seconds=inp.get("interval_seconds"), source_task_id=inp.get("source_task_id"),
                expected_workspace_id=inp.get("expected_workspace_id"),
                max_attempts=inp.get("max_attempts", 5),
                backoff_seconds=inp.get("backoff_seconds", 60), concurrency_key=inp.get("concurrency_key"),
            )
        elif command == "automation_pause":
            result = self.backend.automation_pause(str(target["id"]))
        elif command == "automation_resume":
            result = self.backend.automation_resume(str(target["id"]), inp.get("due_at"))
        elif command == "automation_cancel":
            result = self.backend.automation_cancel(str(target["id"]))
        elif command == "automation_update_task_prompt":
            result = self.backend.automation_update_task_prompt(
                str(target["id"]), inp.get("payload") or {},
                inp.get("due_at"), inp.get("interval_seconds"),
                expected_workspace_id=inp.get("expected_workspace_id"),
            )
        elif command == "automation_rebind_recovery":
            result = self.backend.automation_rebind_recovery(
                str(target["id"]),
                str(inp.get("case_id") or ""),
                str(inp.get("plan_id") or ""),
                str(inp.get("approval_id") or ""),
                inp.get("due_at"),
            )
        else:
            raise InteractionSurfaceError("INVALID_COMMAND", "unknown_command")
        refs = [] if target is None else [{"kind": str(target.get("kind") or "target"), "id": str(target["id"])}]
        ack_material = {"command": command, "target": target, "input": inp, "result": result}
        return self._envelope(
            kind="CommandAck",
            locale=locale,
            surface=surface,
            data={
                "accepted": True,
                "command": command,
                "ack_id": "IACK-" + _digest(ack_material)[:20],
                "result": result,
                "queued_for_replay": False,
            },
            source_refs=refs,
            cached_ack=(command=="ui_preferences_update" or command=="quick_chat_submit"
                        or command=="submit_task" and inp.get("background") is True),
            observation_max_age=30,
        )

    def _provider_recovery(self, provider_id: str) -> dict[str, Any]:
        snap = self.backend.registry.public_snapshot()
        found = None
        candidates = []
        for slot_id, slot in snap.items():
            rows = list(slot.get("providers") or [])
            if any(str(p.get("provider_id")) == provider_id for p in rows):
                found = (slot_id, slot, rows)
                break
        if found is None:
            raise InteractionSurfaceError("INVALID_COMMAND", "unknown_provider")
        slot_id, slot, rows = found
        current = str((slot.get("binding") or {}).get("provider_id") or "")
        for p in rows:
            pid = str(p.get("provider_id") or "")
            health = p.get("health") or {}
            if pid and pid not in {provider_id, "NONE"} and bool(p.get("compatible")) and bool(health.get("ready")):
                candidates.append(pid)
        candidates.sort()
        health = next((p.get("health") or {} for p in rows if str(p.get("provider_id")) == provider_id), {})
        return {
            "provider_id": provider_id, "slot_id": slot_id, "current_provider_id": current,
            "candidate_id": candidates[0] if candidates else None,
            "capability": "pass" if candidates else "unknown",
            "credentials": "pass" if bool(health.get("ready")) else "unknown",
            "policy": "pass" if candidates else "unknown",
            "health": "pass" if bool(health.get("ready")) else "unknown",
            "rebind_available": bool(candidates),
            "candidate_source": "registry_compatible_ready_provider" if candidates else "none",
        }

    def recovery_view(self) -> dict[str, Any]:
        cases = self.backend.tool_repair_cases(100).get("cases", [])
        return {
            "kind": "RecoveryView",
            "cases": cases,
            "unknown_count": sum(1 for x in cases if self._repair_open(x) and str(x.get("external_effect_state")) == "UNKNOWN"),
            "authority": "OWNER_CELLS_ONLY",
        }

    def notification_intents(self) -> list[dict[str, Any]]:
        # Deliberately bounded: no task objective, plan target, memory content, evidence content,
        # provider payloads, or repair detail. Notifications are navigation hints, not authority.
        intents: list[dict[str, Any]] = []
        for task in self.backend.task_list(100):
            if task.get("status") in {"result_imported", "awaiting_revision"}:
                intents.append({"kind": "review_required", "ref_kind": "task", "ref_id": task.get("task_id"), "sensitivity": "MINIMIZED"})
        plan_projection = self.backend.tool_plans(100)
        plans = plan_projection.get("plans", [])
        approvals = self.backend.tool_approvals(100).get("approvals", [])
        for plan in self._plans_needing_review(plans, approvals, plan_projection.get("execution_by_plan")):
            plan_id = str(plan.get("plan_id") or "")
            if plan_id:
                intents.append({"kind": "approval_required", "ref_kind": "tool_plan", "ref_id": plan_id, "sensitivity": "MINIMIZED"})
        for case in self.backend.tool_repair_cases(100).get("cases", []):
            if self._repair_open(case):
                intents.append({"kind": "recovery_required", "ref_kind": "reconciliation_case", "ref_id": case.get("case_id"), "sensitivity": "MINIMIZED"})
        hosted_activity_fn=getattr(self.backend,"hosted_reference_activity",None)
        if callable(hosted_activity_fn):
            for run in hosted_activity_fn(100).get("runs",[]):
                if run.get("state")=="AWAITING_HUMAN_VERIFICATION":
                    intents.append({"kind":"agent_review_required","ref_kind":"hosted_reference_run","ref_id":run.get("hosted_run_id"),"sensitivity":"MINIMIZED"})
        memory_proposals_fn=getattr(self.backend,"memory_proposals",None)
        if callable(memory_proposals_fn):
            for proposal in memory_proposals_fn(100).get("proposals",[]):
                if not proposal.get("decision"):
                    intents.append({"kind":"memory_review_required","ref_kind":"memory_proposal","ref_id":proposal.get("proposal_id"),"sensitivity":"MINIMIZED"})
        work_board_list_fn=getattr(self.backend,"work_board_list",None)
        if callable(work_board_list_fn):
            for row in work_board_list_fn(100).get("boards",[]):
                if int((row.get("counts") or {}).get("VERIFY") or 0)>0:
                    intents.append({"kind":"work_board_review_required","ref_kind":"work_board","ref_id":(row.get("board") or {}).get("board_id"),"sensitivity":"MINIMIZED"})
        goal_list_fn=getattr(self.backend,"goal_list",None)
        if callable(goal_list_fn):
            for row in goal_list_fn(100).get("goals",[]):
                if int(row.get("human_review_pending") or 0)>0:
                    intents.append({"kind":"goal_review_required","ref_kind":"goal","ref_id":(row.get("goal") or {}).get("goal_id"),"sensitivity":"MINIMIZED"})
        return intents[:100]

# FC1 bounded Control Center extension stays in the InteractionSurface owner Cell module.
FC1_QUERY = "software_lifecycle"
FC1_PREVIEW_COMMAND = "software_lifecycle_preview"
FC1_TARGET_KIND = "software_instance"
_ALLOWED_PREVIEW_INPUT = {"instance_id", "to_revision_ref", "desired_lifecycle", "created_at"}


class FC1InteractionSurfaceCell(InteractionSurfaceCell):
    """Bounded successor extension for FC1 Control Center read/preview.

    Authorization and apply are deliberately absent from the public interaction
    command set. A normal authenticated UI session is not HUMAN_POLICY_OWNER.
    """

    _QUERY_NAMES = set(InteractionSurfaceCell._QUERY_NAMES) | {FC1_QUERY}
    _COMMAND_NAMES = set(InteractionSurfaceCell._COMMAND_NAMES) | {FC1_PREVIEW_COMMAND}
    _TARGET_REQUIRED = set(InteractionSurfaceCell._TARGET_REQUIRED) | {FC1_PREVIEW_COMMAND}
    _TARGET_KIND = dict(InteractionSurfaceCell._TARGET_KIND, **{FC1_PREVIEW_COMMAND: FC1_TARGET_KIND})
    _TARGET_INPUT_ID = dict(InteractionSurfaceCell._TARGET_INPUT_ID, **{FC1_PREVIEW_COMMAND: "instance_id"})
    _OFFLINE_DENIED = set(InteractionSurfaceCell._OFFLINE_DENIED) | {FC1_PREVIEW_COMMAND}

    def _revision_material(self) -> dict[str, Any]:
        material = super()._revision_material()
        material["software_lifecycle"] = self.backend.software_lifecycle.projection()
        return material

    def _snapshot_data(self) -> dict[str, Any]:
        data = super()._snapshot_data()
        data["software_lifecycle"] = self.backend.software_lifecycle.projection()
        features = dict(data.get("features") or {})
        features.update({
            "software_lifecycle_read": True,
            "software_lifecycle_preview": True,
            "software_lifecycle_authorize": False,
            "software_lifecycle_apply": False,
            "software_lifecycle_real_effects": False,
        })
        data["features"] = features
        return data

    def query(self, request: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(request, dict) or str(request.get("query") or "") != FC1_QUERY:
            return super().query(request)
        locale, surface = self._validate_common(request)
        params = request.get("params") or {}
        if not isinstance(params, dict) or params:
            raise InteractionSurfaceError("INVALID_COMMAND", "software_lifecycle_query_params_not_supported")
        projection = self.backend.software_lifecycle.projection()
        return self._envelope(
            kind="InteractionSnapshot",
            locale=locale,
            surface=surface,
            data=projection,
            source_refs=[{"kind": "software_lifecycle", "id": projection.get("projection_digest", "") or "projection"}],
        )

    def _execute_command(self, command: str, inp: dict[str, Any], target: dict[str, Any] | None,
                         locale: str, surface: str, request: dict[str, Any]) -> dict[str, Any]:
        if command != FC1_PREVIEW_COMMAND:
            return super()._execute_command(command, inp, target, locale, surface, request)
        if target is None:
            raise InteractionSurfaceError("INVALID_COMMAND", "command_target_required")
        unknown = set(inp) - _ALLOWED_PREVIEW_INPUT
        if unknown:
            raise InteractionSurfaceError("INVALID_COMMAND", "software_lifecycle_preview_input_not_supported")
        to_revision_ref = str(inp.get("to_revision_ref") or "")
        if not to_revision_ref:
            raise InteractionSurfaceError("INVALID_COMMAND", "to_revision_ref_required")
        desired_lifecycle = inp.get("desired_lifecycle")
        if desired_lifecycle is not None and not isinstance(desired_lifecycle, dict):
            raise InteractionSurfaceError("INVALID_COMMAND", "desired_lifecycle_object_required")
        preview = self.backend.software_lifecycle.preview_change(
            instance_id=str(target["id"]),
            to_revision_ref=to_revision_ref,
            desired_lifecycle=desired_lifecycle,
            created_at=inp.get("created_at"),
        )
        if preview.get("mode") != "SYNTHETIC_NO_EFFECT" or preview.get("real_effects_possible") is not False:
            raise InteractionSurfaceError("INVALID_COMMAND", "software_lifecycle_preview_effect_boundary_invalid", 409)
        if preview.get("preview_is_authorization") is not False:
            raise InteractionSurfaceError("AUTHORITY_REQUIRED", "software_lifecycle_preview_cannot_authorize", 409)
        ack_material = {"command": command, "target": target, "input": inp, "result": preview}
        return self._envelope(
            kind="CommandAck",
            locale=locale,
            surface=surface,
            data={
                "accepted": True,
                "command": command,
                "ack_id": "IACK-" + _digest(ack_material)[:20],
                "result": preview,
                "queued_for_replay": False,
                "authorization_granted": False,
                "apply_performed": False,
                "real_external_effects_performed": False,
            },
            source_refs=[{"kind": FC1_TARGET_KIND, "id": str(target["id"])}],
        )
