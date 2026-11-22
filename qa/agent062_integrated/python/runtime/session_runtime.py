from __future__ import annotations
from pathlib import Path
import datetime, hashlib, json, re, threading, unicodedata, uuid
from runtime import personal_agent as core
from runtime.operation_refs import oref
from runtime.state_bundle_journal import StateBundleJournal
from runtime.model_provider_registry import local_model_pin

_UNCHANGED=object()

PROFILE='IWXA_PERSONAL_SESSION_RUNTIME_0.11'

def _iso(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def _key(surface,key): return hashlib.sha256((str(surface)+'\x00'+str(key)).encode('utf-8')).hexdigest()
def _sha(s): return hashlib.sha256(str(s).encode('utf-8')).hexdigest()
def _tokens(text): return {x for x in re.findall(r'[\w.-]+',str(text).casefold(),flags=re.UNICODE) if len(x)>=2}
def _canonical(obj): return json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def _atomic(path,obj):
    # Reuse the established fsync + os.replace writer: it normalizes Windows
    # long Unicode paths to extended-length form before mkstemp and replace.
    # JSON serialization and newline are byte-compatible with this former writer.
    core.save_json(path,obj)


class SessionRuntime:
    def __init__(self,instance_root,core_root=None):
        self.root=Path(core._native_path(Path(instance_root)/'sessions-0.11')); self.sessions=self.root/'sessions'; self.session_history=self.root/'session-history'; self.events=self.root/'events'; self.steering=self.root/'steering'; self.links=self.root/'task-links'; self.index_path=self.root/'index.json'; self.consumed_path=self.root/'consumed-steering.json'; self.core_root=Path(core._native_path(core_root if core_root is not None else Path(instance_root)/'core')); self.lock=threading.RLock()
        for p in (self.sessions,self.session_history,self.events,self.steering,self.links): p.mkdir(parents=True,exist_ok=True)
        self._state_bundle=StateBundleJournal(self.root,journal_filename='.session-state-bundle.json')
        try: self._state_bundle.recover()
        except Exception as exc: raise ValueError('session_state_recovery_failed') from exc
        if not self.index_path.exists(): _atomic(self.index_path,{'schema':'IWXA_SESSION_INDEX_0.11','routes':{}})
        if not self.consumed_path.exists(): _atomic(self.consumed_path,{'schema':'IWXA_STEERING_CONSUMED_0.11','event_ids':[]})
    @staticmethod
    def _composer_knowledge_sources(value):
        """Persist selectors, never the contents of a private knowledge vault."""
        if type(value) is not list or len(value)>8:
            raise ValueError('composer_knowledge_sources_invalid')
        verified=[]; seen=set()
        for row in value:
            if not isinstance(row,dict) or set(row) not in (
                    {'path','expected_sha256','title'},
                    {'path','expected_sha256','title','provider_id','binding_digest'}):
                raise ValueError('composer_knowledge_source_invalid')
            path=row['path']; digest=row['expected_sha256']; title=row['title']
            if (type(path) is not str or not path.strip() or len(path)>1024
                    or any(ord(char)<32 for char in path)
                    or type(digest) is not str or re.fullmatch(r'[0-9a-f]{64}',digest) is None
                    or type(title) is not str or len(title)>200
                    or any(ord(char)<32 for char in title)):
                raise ValueError('composer_knowledge_source_identity_invalid')
            binding={}
            if 'provider_id' in row:
                provider_id=row['provider_id']; binding_digest=row['binding_digest']
                if (type(provider_id) is not str or not 1<=len(provider_id)<=200
                        or type(binding_digest) is not str
                        or re.fullmatch(r'[0-9a-f]{64}',binding_digest) is None):
                    raise ValueError('composer_knowledge_source_binding_invalid')
                binding={'provider_id':provider_id,'binding_digest':binding_digest}
            key=(path,digest,binding.get('provider_id'),binding.get('binding_digest'))
            if key in seen: raise ValueError('composer_knowledge_source_duplicate')
            seen.add(key)
            verified.append({'path':path,'expected_sha256':digest,'title':title,**binding})
        return verified

    @staticmethod
    def _composer_attachments(value):
        """Only explicitly chosen, bounded text uploads. Never copy vault contents."""
        if type(value) is not list or len(value)>8:
            raise ValueError('composer_attachments_invalid')
        out=[]; seen=set(); total=0
        for row in value:
            if type(row) is not dict or set(row)!={'name','text'}:
                raise ValueError('composer_attachment_invalid')
            name=row['name']; content=row['text']
            if (type(name) is not str or type(content) is not str
                    or name != unicodedata.normalize('NFC',name)
                    or re.fullmatch(r'[\w .()-]{1,120}',name) is None
                    or name.startswith('.') or '..' in name or name[-1] in '. '
                    or re.search(r'\.(?:txt|md|csv|json)$',name,re.I) is None
                    or re.match(r'^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)',name,re.I)):
                raise ValueError('composer_attachment_filename_invalid')
            key=name.casefold()
            if key in seen:
                raise ValueError('composer_attachment_duplicate')
            seen.add(key)
            try:
                size=len(content.encode('utf-8'))
            except UnicodeError as exc:
                raise ValueError('composer_attachment_encoding_invalid') from exc
            total+=size
            if not content.strip() or total>48000:
                raise ValueError('composer_attachment_content_out_of_bounds')
            out.append({'name':name,'text':content})
        return out

    @staticmethod
    def _composer_draft_digest(value):
        fields={key:value[key] for key in (
            "text","knowledge_sources","attachments","local_model")}
        if "workspace_id" in value:
            fields["workspace_id"]=value["workspace_id"]
        return core.digest_obj(fields)

    def _composer_storage_path(self, profile_id):
        from runtime.composer_workspace_scope import bind_composer_scope
        with self.lock:
            self._require_bundle_clear()
            return bind_composer_scope(self, profile_id)[1]

    def _composer_pending_submission(self, value):
        if value is None:
            return None
        if (type(value) is not dict
                or set(value) not in ({'submission_id','draft_digest'},
                                      {'submission_id','draft_digest','context_options'},
                                      {'submission_id','draft_digest','workspace_id'})
                or type(value['submission_id']) is not str
                or re.fullmatch(r'[0-9a-f]{32}',value['submission_id']) is None
                or type(value['draft_digest']) is not str
                or re.fullmatch(r'[0-9a-f]{64}',value['draft_digest']) is None):
            raise ValueError('composer_pending_submission_invalid')
        result=dict(value)
        if 'workspace_id' in result and (type(result['workspace_id']) is not str
                or re.fullmatch(r'(?:personal|AREA-[0-9a-f]{18})',result['workspace_id']) is None):
            raise ValueError('composer_pending_workspace_invalid')
        if 'context_options' in result:
            # Preserve the original request flags without a separate state file.
            # Two-field markers from earlier builds remain readable.
            try:
                result['context_options']=self._chat_options(result['context_options'])
            except ValueError as exc:
                raise ValueError('composer_pending_submission_invalid') from exc
        return result

    def composer_draft(self, profile_id, text=None, knowledge_sources=None, attachments=None,
                       local_model=_UNCHANGED, pending_submission=_UNCHANGED,
                       expected_pending_submission_id=None, expected_draft_digest=None,
                       clear_submitted_draft=False, cancel_prepared_submission=False,
                       task_context=False, task_claim=None,
                       expected_pending_workspace_id=None):
        # Same local session owner for pending text, verified vault selectors
        # and manually selected file contents. No background vault reads.
        write_requested=(text is not None or knowledge_sources is not None or attachments is not None
                         or local_model is not _UNCHANGED or pending_submission is not _UNCHANGED)
        if (type(clear_submitted_draft) is not bool or type(cancel_prepared_submission) is not bool
                or (clear_submitted_draft and cancel_prepared_submission)
                or ((clear_submitted_draft or cancel_prepared_submission) and pending_submission is not None)):
            raise ValueError('composer_pending_action_invalid')
        if expected_draft_digest is not None and (
                type(expected_draft_digest) is not str
                or re.fullmatch(r'[0-9a-f]{64}',expected_draft_digest) is None):
            raise ValueError('composer_draft_revision_invalid')
        if expected_pending_workspace_id is not None and (
                not task_context or type(expected_pending_workspace_id) is not str
                or re.fullmatch(r'(?:personal|AREA-[0-9a-f]{18})',expected_pending_workspace_id) is None
                or pending_submission is not None
                or not (cancel_prepared_submission or clear_submitted_draft)):
            raise ValueError('composer_pending_workspace_invalid')
        with self.lock:
            self._require_bundle_clear()
            from runtime.composer_workspace_scope import bind_composer_scope
            profile_id,path,scope=bind_composer_scope(self,profile_id)
            if (scope and expected_pending_workspace_id is not None
                    and expected_pending_workspace_id!=scope['workspace_id']):
                raise ValueError('composer_pending_workspace_invalid')
            current={'text':'','knowledge_sources':[],'attachments':[],'local_model':None,'pending_submission':None,'state':'EMPTY_OR_UNREADABLE',**scope}
            try:
                if path.is_symlink(): raise ValueError('composer_draft_link_forbidden')
                if path.stat().st_size>384000: raise ValueError('composer_draft_oversized')
                value=json.loads(path.read_text(encoding='utf-8'))
                if (not isinstance(value,dict) or value.get('schema')!='IWXA_COMPOSER_DRAFT/1'
                        or value.get('profile_id')!=profile_id
                        or (scope and value.get('workspace_id')!=scope['workspace_id']) or
                        not isinstance(value.get('text'),str) or len(value['text'])>65536):
                    raise ValueError('composer_draft_storage_invalid')
                current={'text':value['text'],
                         'knowledge_sources':self._composer_knowledge_sources(value.get('knowledge_sources',[])),
                         'attachments':self._composer_attachments(value.get('attachments',[])),
                         'local_model':local_model_pin(value.get('local_model')),
                         'pending_submission':self._composer_pending_submission(value.get('pending_submission')),
                         'state':'SAVED',**scope}
                if (scope and current['pending_submission'] is not None
                        and current['pending_submission'].get('workspace_id')!=scope['workspace_id']):
                    raise ValueError('composer_pending_workspace_invalid')
            except FileNotFoundError as exc:
                # A missing draft is a valid new profile; a dangling link is not.
                if path.is_symlink():
                    raise ValueError('composer_draft_unreadable') from exc
            except (ValueError,OSError,TypeError,AttributeError,UnicodeError) as exc:
                if isinstance(exc,ValueError) and (str(exc).startswith('composer_pending_submission_')
                        or str(exc)=='composer_pending_workspace_invalid'):
                    raise  # An invalid saved submission identity is never ignored.
                # Failed reads must also fail closed. Otherwise an empty UI
                # projection could replace a saved but currently unreadable draft.
                raise ValueError('composer_draft_unreadable') from exc
            if write_requested:
                if expected_draft_digest is not None and (
                        self._composer_draft_digest(current)!=expected_draft_digest
                        or (current['state']!='SAVED'
                            and (path.exists() or path.is_symlink()))):
                    # An empty, never-written composer has a Core digest too.
                    # Permit its first compare-and-save only while the path is
                    # still absent under the existing SessionRuntime lock.
                    # Corrupt or unreadable drafts remain blocked above.
                    raise ValueError('composer_draft_changed')
                if text is not None and (type(text) is not str or len(text)>65536):
                    raise ValueError('composer_draft_invalid')
                next_text=current['text'] if text is None else text
                next_sources=(current['knowledge_sources'] if knowledge_sources is None
                              else self._composer_knowledge_sources(knowledge_sources))
                next_attachments=(current['attachments'] if attachments is None
                                  else self._composer_attachments(attachments))
                next_model=current['local_model'] if local_model is _UNCHANGED else local_model_pin(local_model)
                old_pending=current['pending_submission']
                next_pending=old_pending
                cancellation=None
                if pending_submission is not _UNCHANGED:
                    dialogue=bool(re.search(r':dialogue(?::dialog-[0-9a-f]{32})?$',profile_id))
                    if (not dialogue and not task_context) or (dialogue and task_context):
                        raise ValueError('composer_pending_context_invalid')
                    requested=self._composer_pending_submission(pending_submission)
                    if (task_context and requested is not None and scope
                            and requested.get('workspace_id')!=scope['workspace_id']):
                        raise ValueError('composer_pending_workspace_invalid')
                    if requested is not None:
                        if ('workspace_id' in requested)!=bool(task_context):
                            raise ValueError('composer_pending_context_invalid')
                        if old_pending is not None and old_pending!=requested:
                            raise ValueError('composer_pending_submission_unresolved')
                        if old_pending is None:
                            claim_path=(self._task_cancel_path(requested['submission_id'])
                                        if task_context else self._chat_path(requested['submission_id']))
                            if claim_path.exists() or claim_path.is_symlink():
                                raise ValueError('composer_pending_submission_used')
                            digest=self._composer_draft_digest(current)
                            if (current['state']!='SAVED' or not current['text'].strip()
                                    or requested['draft_digest']!=digest
                                    or (next_text,next_sources,next_attachments,next_model)!=(
                                        current['text'],current['knowledge_sources'],
                                        current['attachments'],current['local_model'])):
                                raise ValueError('composer_pending_draft_changed')
                        next_pending=requested
                    else:
                        if (task_context and old_pending is None
                                and cancel_prepared_submission
                                and expected_pending_workspace_id is not None):
                            # The transport of the original reservation might
                            # have failed before it reached Core. A human may
                            # explicitly abandon its exact identity. The
                            # immutable tombstone is committed BEFORE any
                            # delayed reservation can claim the same ID.
                            sid=self._chat_submission_id(expected_pending_submission_id)
                            if (current['state']!='SAVED'
                                    or expected_draft_digest!=self._composer_draft_digest(current)
                                    or (next_text,next_sources,next_attachments,next_model)!=(
                                        current['text'],current['knowledge_sources'],
                                        current['attachments'],current['local_model'])):
                                raise ValueError('composer_pending_resolution_stale')
                            claim_path=self._task_cancel_path(sid)
                            if claim_path.is_symlink():
                                raise ValueError('composer_pending_cancellation_invalid')
                            if claim_path.exists():
                                # A lost cancellation ACK must be read back,
                                # not turned into another blocked UI state.
                                if not self.task_submission_cancelled(sid):
                                    raise ValueError('composer_pending_cancellation_invalid')
                                existing=json.loads(claim_path.read_text(encoding='utf-8'))
                                if existing['workspace_id']!=expected_pending_workspace_id:
                                    raise ValueError('composer_pending_resolution_scope_invalid')
                                return {**current,'draft_digest':self._composer_draft_digest(current)}
                            tombstone={'schema':'IWXA_SESSION_TASK_CANCELLED/1',
                                       'submission_id':sid,
                                       'workspace_id':expected_pending_workspace_id,
                                       'draft_digest':expected_draft_digest,
                                       'created_at':_iso()}
                            cancellation={**tombstone,'turn_digest':core.digest_obj(tombstone)}
                            next_pending=None
                        else:
                            if (old_pending is None
                                    or expected_pending_submission_id!=old_pending['submission_id']
                                    or ('workspace_id' in old_pending)!=bool(task_context)
                                    or (expected_pending_workspace_id is not None
                                        and expected_pending_workspace_id!=old_pending.get('workspace_id'))):
                                raise ValueError('composer_pending_resolution_conflict')
                            if clear_submitted_draft or cancel_prepared_submission:
                                if (next_text,next_sources,next_attachments,next_model)!=(
                                        current['text'],current['knowledge_sources'],
                                        current['attachments'],current['local_model']):
                                    raise ValueError('composer_pending_resolution_stale')
                            if cancel_prepared_submission:
                                # One atomic SessionRuntime journal commit cancels the
                                # exact reserved ID and releases the draft. The Core's
                                # shared mutation lock prevents racing a job claim.
                                claim_path=(self._task_cancel_path(old_pending['submission_id'])
                                            if task_context else self._chat_path(old_pending['submission_id']))
                                if claim_path.exists() or claim_path.is_symlink():
                                    raise ValueError('composer_pending_already_submitted')
                                if task_context:
                                    tombstone={'schema':'IWXA_SESSION_TASK_CANCELLED/1',
                                               'submission_id':old_pending['submission_id'],
                                               'workspace_id':old_pending['workspace_id'],
                                               'draft_digest':old_pending['draft_digest'],
                                               'created_at':_iso()}
                                else:
                                    key=(profile_id.split(':dialogue:',1)[1]
                                         if ':dialogue:' in profile_id else 'iwxa-desktop-local')
                                    tombstone={'schema':'IWXA_SESSION_CHAT_CANCELLED/1',
                                               'submission_id':old_pending['submission_id'],
                                               'conversation_key_digest':_key('web',key),
                                               'draft_digest':old_pending['draft_digest'],
                                               'created_at':_iso()}
                                cancellation={**tombstone,'turn_digest':core.digest_obj(tombstone)}
                            else:
                                if task_context:
                                    if (type(task_claim) is not dict
                                            or task_claim.get('submission_id')!=old_pending['submission_id']
                                            or task_claim.get('workspace_id')!=old_pending['workspace_id']):
                                        raise ValueError('composer_pending_resolution_scope_invalid')
                                    if (self._composer_draft_digest(current)==old_pending['draft_digest']
                                            and task_claim.get('message')!=current['text'].strip()):
                                        raise ValueError('composer_pending_task_content_changed')
                                else:
                                    key=(profile_id.split(':dialogue:',1)[1]
                                         if ':dialogue:' in profile_id else 'iwxa-desktop-local')
                                    turn=self._chat_load(old_pending['submission_id'])
                                    if turn['conversation_key_digest']!=_key('web',key):
                                        raise ValueError('composer_pending_resolution_scope_invalid')
                                if (clear_submitted_draft and
                                        self._composer_draft_digest(current)==old_pending['draft_digest']):
                                    next_text='';next_sources=[];next_attachments=[]
                        next_pending=None
                if path.is_symlink(): raise ValueError('composer_draft_link_forbidden')
                stored={'schema':'IWXA_COMPOSER_DRAFT/1','profile_id':profile_id,
                        'text':next_text,'knowledge_sources':next_sources,'attachments':next_attachments,
                        'local_model':next_model,**scope}
                if next_pending is not None:
                    stored['pending_submission']=next_pending
                if cancellation is not None:
                    self._commit_entries({
                        path:stored,(self._task_cancel_path(
                            old_pending['submission_id'] if old_pending is not None
                            else expected_pending_submission_id)
                                     if task_context else self._chat_path(old_pending['submission_id'])):cancellation})
                else:
                    _atomic(path,stored)
                saved={'text':next_text,'knowledge_sources':next_sources,
                       'attachments':next_attachments,'local_model':next_model,
                       'pending_submission':next_pending,'state':'SAVED',**scope}
                return {**saved,'draft_digest':self._composer_draft_digest(saved)}
            return {**current,'draft_digest':self._composer_draft_digest(current)}


    def document_editor_draft(self, profile_id, source_task_id, *, value=None, expected_digest=None):
        """Persist an unfinished file editor in the existing SessionRuntime.

        This local text is not a Task, a file write or an authorization.
        Compare-and-swap prevents a stale window from losing another edit.
        """
        if (type(profile_id) is not str or not profile_id
                or type(source_task_id) is not str
                or re.fullmatch(r"TASK-[A-Za-z0-9_-]{1,120}", source_task_id) is None):
            raise ValueError("document_editor_identity_invalid")
        target = self.root / ("document-editor-" + _sha(profile_id + "\x00" + source_task_id) + ".json")
        empty = {"schema": "IWXA_SESSION_DOCUMENT_EDITOR/1", "profile_id": profile_id,
                 "source_task_id": source_task_id, "active": False, "path": "action-plan.md",
                 "mode": "create", "text": "", "expected_sha256": None}
        def valid(row):
            return (type(row) is dict and set(row) == set(empty)
                    and all(row.get(k) == empty[k] for k in ("schema", "profile_id", "source_task_id"))
                    and type(row.get("active")) is bool
                    and type(row.get("path")) is str and len(row["path"]) <= 160
                    and row["path"] == unicodedata.normalize("NFC", row["path"])
                    and not any(ord(c) < 32 for c in row["path"])
                    and row.get("mode") in ("create", "replace")
                    and type(row.get("text")) is str
                    and len(row["text"].encode("utf-8")) <= 128 * 1024
                    and (row.get("expected_sha256") is None
                         or (type(row["expected_sha256"]) is str
                             and re.fullmatch(r"[0-9a-f]{64}", row["expected_sha256"]) is not None))
                    and (row["mode"] == "replace" or row["expected_sha256"] is None)
                    and (row["active"] or row == empty))
        def projection(row):
            fields = {k: row[k] for k in ("source_task_id", "active", "path", "mode", "text", "expected_sha256")}
            return {**fields, "state": "SAVED" if row["active"] else "EMPTY",
                    "draft_digest": core.digest_obj(fields)}
        with self.lock:
            self._require_bundle_clear()
            if target.is_symlink():
                raise ValueError("document_editor_storage_invalid")
            current = empty
            if target.exists():
                try:
                    if target.stat().st_size > 400000:
                        raise ValueError("document_editor_storage_invalid")
                    current = json.loads(target.read_text(encoding="utf-8"))
                except (OSError, ValueError, UnicodeError) as exc:
                    raise ValueError("document_editor_storage_invalid") from exc
                if not valid(current):
                    raise ValueError("document_editor_storage_invalid")
            if value is not None:
                if (type(expected_digest) is not str
                        or re.fullmatch(r"[0-9a-f]{64}", expected_digest) is None
                        or projection(current)["draft_digest"] != expected_digest):
                    raise ValueError("document_editor_changed")
                next_value = {**empty, **value} if type(value) is dict and set(value) == {
                    "active", "path", "mode", "text", "expected_sha256"} else None
                if not valid(next_value):
                    raise ValueError("document_editor_draft_invalid")
                if next_value != current:
                    _atomic(target, next_value)
                    if json.loads(target.read_text(encoding="utf-8")) != next_value:
                        raise ValueError("document_editor_save_readback_failed")
                current = next_value
            return {**projection(current), "read_only": value is None}

    def append_tool_read_text(self, profile_id, receipt_id, text, expected_draft_digest):
        """Append one verified read result to the existing conversation draft.

        Tool output is evidence, never an instruction or an authority. The
        caller must validate the immutable ToolRuntime receipt and output digest.
        """
        if (type(receipt_id) is not str
                or re.fullmatch(r"TRR-[A-Za-z0-9_-]{1,100}",receipt_id) is None
                or type(text) is not str or not text.strip()
                or "\x00" in text or len(text.encode("utf-8"))>44000):
            raise ValueError("tool_dialogue_source_invalid")
        if type(expected_draft_digest) is not str or re.fullmatch(r"[0-9a-f]{64}",expected_draft_digest) is None:
            raise ValueError("tool_dialogue_draft_digest_invalid")
        name="tool-read-"+receipt_id+".txt"
        with self.lock:
            path=self._composer_storage_path(profile_id)
            draft=self.composer_draft(profile_id)
            if draft["state"]!="SAVED" and (path.exists() or path.is_symlink()):
                raise ValueError("tool_dialogue_draft_unreadable")
            for item in draft["attachments"]:
                if item["name"].casefold()==name.casefold():
                    if item["text"]!=text: raise ValueError("tool_dialogue_receipt_conflict")
                    return {"reused":True,"attachment_name":name,"draft":draft}
            if draft["draft_digest"]!=expected_draft_digest:
                raise ValueError("tool_dialogue_draft_changed")
            if len(draft["attachments"])>=8:
                raise ValueError("tool_dialogue_attachment_limit")
            updated=self.composer_draft(profile_id,attachments=[
                *draft["attachments"],{"name":name,"text":text}
            ])
            if updated["state"]!="SAVED" or not any(
                    x["name"]==name and x["text"]==text for x in updated["attachments"]):
                raise ValueError("tool_dialogue_attachment_readback_failed")
            return {"reused":False,"attachment_name":name,"draft":updated}

    def append_accepted_agent_text(self, profile_id, text, expected_draft_digest, *,
                                   attachment_prefix="Goose-result"):
        # This is the existing Session owner, not a new attachment Store.
        # User-approved Graph results have a distinct name; any other
        # arbitrary prefix is forbidden to avoid filename injection.
        if attachment_prefix not in {"Goose-result", "Program-result"}:
            raise ValueError("agent_task_seed_attachment_prefix_invalid")
        """Append accepted evidence only to the draft version the human saw.

        The caller verifies immutable human acceptance. A compare-and-update
        under the same SessionRuntime lock prevents silently replacing newer
        edits to model pins, text, selected sources or existing attachments.
        """
        if (type(text) is not str or not text.strip() or "\x00" in text
                or len(text.encode("utf-8")) > 8000):
            raise ValueError("goose_task_seed_output_invalid")
        if (type(expected_draft_digest) is not str
                or re.fullmatch(r"[0-9a-f]{64}",expected_draft_digest) is None):
            raise ValueError("goose_task_seed_expected_draft_digest_invalid")
        with self.lock:
            path=self._composer_storage_path(profile_id)
            draft=self.composer_draft(profile_id)
            if draft["draft_digest"]!=expected_draft_digest:
                raise ValueError("goose_task_seed_draft_changed")
            # A Task already reserved for submission must retain its exact
            # text, sources and attachment set until its original claim is
            # resolved. An imported program/Goose Result is a *new* choice,
            # never an edit to a queued Task.
            if draft.get("pending_submission") is not None:
                raise ValueError("agent_task_seed_pending_submission")
            if draft["state"]!="SAVED" and (path.exists() or path.is_symlink()):
                raise ValueError("goose_task_seed_existing_draft_unreadable")
            existing=draft["attachments"]
            for entry in existing:
                if (re.fullmatch(re.escape(attachment_prefix)+r"-[1-8]\.md",entry["name"],re.I)
                        and entry["text"]==text):
                    return {"attachment_name":entry["name"],"reused":True,
                            "draft":draft,"source_text_sha256":hashlib.sha256(text.encode("utf-8")).hexdigest()}
            if len(existing)>=8:
                raise ValueError("goose_task_seed_attachment_limit")
            names={str(row["name"]).casefold() for row in existing}
            name=next((f"{attachment_prefix}-{i}.md" for i in range(1,9)
                       if f"{attachment_prefix}-{i}.md".casefold() not in names),None)
            if name is None:
                raise ValueError("goose_task_seed_attachment_name_unavailable")
            updated=self.composer_draft(profile_id,attachments=[*existing,{"name":name,"text":text}])
            if (updated["state"]!="SAVED"
                    or not any(item["name"]==name and item["text"]==text
                               for item in updated["attachments"])):
                raise ValueError("goose_task_seed_draft_readback_failed")
            return {"attachment_name":name,"reused":False,"draft":updated,
                    "source_text_sha256":hashlib.sha256(text.encode("utf-8")).hexdigest()}

    # Personal work areas belong to this existing session owner and its state
    # bundle. They organize tasks and goals; they do not create OS sandboxes,
    # access tokens, new storage roots or external-effect authority.
    _WORK_AREA_SCHEMA = 'IWXA_PERSONAL_WORK_AREAS/1'

    @staticmethod
    def _area_profile(profile_id):
        if type(profile_id) is not str or not 1<=len(profile_id)<=160 or any(ord(c)<33 or ord(c)>126 for c in profile_id):
            raise ValueError('work_area_profile_invalid')
        return profile_id

    @staticmethod
    def _area_text(value,field,maximum,required=False):
        if type(value) is not str or len(value)>maximum or (required and not value.strip()) or any(ord(c)<32 for c in value):
            raise ValueError('work_area_'+field+'_invalid')
        return value.strip()

    @staticmethod
    def _area_policy(value,local_only=False):
        if type(value) is not dict or set(value)!={'memory','obsidian','web','selected_notes'} or any(type(v) is not bool for v in value.values()):
            raise ValueError('work_area_source_permissions_invalid')
        if local_only and value['web']:
            raise ValueError('work_area_local_web_forbidden')
        return dict(value)

    @classmethod
    def _personal_area(cls):
        return {'id':'personal','name':'Личное','purpose':'','local_only':False,
                'permissions':{'memory':True,'obsidian':True,'web':True,'selected_notes':True},
                'goal_refs':[],'created_at':'','updated_at':''}

    def _areas_path(self,profile_id):
        return self.root/('work-areas-'+_sha(self._area_profile(profile_id))+'.json')

    def _areas_read(self,profile_id):
        self._require_bundle_clear()
        path=self._areas_path(profile_id)
        material={'schema':self._WORK_AREA_SCHEMA,'profile_id':profile_id,'active_id':'personal','areas':[]}
        if not path.exists():
            if path.is_symlink(): raise ValueError('work_area_storage_link_forbidden')
            return {**material,'catalog_digest':core.digest_obj(material)}
        if path.is_symlink() or path.stat().st_size>256000: raise ValueError('work_area_storage_invalid')
        try: obj=json.loads(path.read_text(encoding='utf-8'))
        except (OSError,UnicodeError,ValueError) as exc: raise ValueError('work_area_storage_unreadable') from exc
        if type(obj) is not dict or set(obj)!={'schema','profile_id','active_id','areas','catalog_digest'}:
            raise ValueError('work_area_storage_invalid')
        original=dict(obj); digest=original.pop('catalog_digest')
        if (original['schema']!=self._WORK_AREA_SCHEMA or original['profile_id']!=profile_id
                or type(digest) is not str or digest!=core.digest_obj(original)):
            raise ValueError('work_area_storage_integrity_failed')
        areas=original['areas']
        if type(areas) is not list or len(areas)>32: raise ValueError('work_area_catalog_invalid')
        ids={'personal'}
        for row in areas:
            if type(row) is not dict or set(row)!={'id','name','purpose','local_only','permissions','goal_refs','created_at','updated_at'}:
                raise ValueError('work_area_entry_invalid')
            area_id=row['id']
            if type(area_id) is not str or re.fullmatch(r'AREA-[0-9a-f]{18}',area_id) is None or area_id in ids:
                raise ValueError('work_area_identity_invalid')
            ids.add(area_id)
            self._area_text(row['name'],'name',90,required=True)
            self._area_text(row['purpose'],'purpose',500)
            if type(row['local_only']) is not bool: raise ValueError('work_area_local_policy_invalid')
            self._area_policy(row['permissions'],row['local_only'])
            if (type(row['created_at']) is not str or type(row['updated_at']) is not str
                    or not row['created_at'] or not row['updated_at']):
                raise ValueError('work_area_dates_invalid')
            refs=row['goal_refs']
            if type(refs) is not list or len(refs)>100: raise ValueError('work_area_goal_refs_invalid')
            seen=set()
            for link in refs:
                if (type(link) is not dict or set(link)!={'goal_id','goal_digest'}
                        or type(link['goal_id']) is not str or not re.fullmatch(r'GOAL-[0-9a-f]{18}',link['goal_id'])
                        or type(link['goal_digest']) is not str or not re.fullmatch(r'[0-9a-f]{64}',link['goal_digest'])
                        or link['goal_id'] in seen):
                    raise ValueError('work_area_goal_ref_invalid')
                seen.add(link['goal_id'])
        if type(original['active_id']) is not str or original['active_id'] not in ids:
            raise ValueError('work_area_active_identity_invalid')
        return obj

    def _areas_write(self,obj):
        material=dict(obj);material.pop('catalog_digest',None)
        saved={**material,'catalog_digest':core.digest_obj(material)}
        path=self._areas_path(material['profile_id'])
        if path.is_symlink(): raise ValueError('work_area_storage_link_forbidden')
        self._commit_entries({path:saved})
        if self._areas_read(material['profile_id']) != saved:
            raise ValueError('work_area_storage_readback_failed')
        return saved

    def workspace_catalog(self,profile_id):
        with self.lock:
            obj=self._areas_read(self._area_profile(profile_id))
            return {'schema':self._WORK_AREA_SCHEMA,'active_id':obj['active_id'],
                    'areas':[self._personal_area(),*obj['areas']],
                    'catalog_digest':obj['catalog_digest'],
                    'authority_granted':False,'isolation_implemented':False}

    def workspace_get(self,profile_id,area_id):
        with self.lock:
            obj=self._areas_read(self._area_profile(profile_id))
            if type(area_id) is not str: raise ValueError('work_area_identity_invalid')
            area=next((row for row in [self._personal_area(),*obj['areas']] if row['id']==area_id),None)
            if area is None: raise ValueError('work_area_unknown')
            return dict(area)

    def workspace_create(self,profile_id,name,purpose,local_only,permissions):
        with self.lock:
            obj=self._areas_read(self._area_profile(profile_id))
            name=self._area_text(name,'name',90,required=True)
            purpose=self._area_text(purpose,'purpose',500)
            if type(local_only) is not bool: raise ValueError('work_area_local_policy_invalid')
            permissions=self._area_policy(permissions,local_only)
            if len(obj['areas'])>=32: raise ValueError('work_area_limit_reached')
            now=_iso()
            area={'id':'AREA-'+uuid.uuid4().hex[:18],'name':name,'purpose':purpose,
                  'local_only':local_only,'permissions':permissions,'goal_refs':[],
                  'created_at':now,'updated_at':now}
            obj['areas'].append(area)
            saved=self._areas_write(obj)
            return {'area':area,'catalog_digest':saved['catalog_digest'],'authority_granted':False}

    def workspace_select(self,profile_id,area_id):
        with self.lock:
            obj=self._areas_read(self._area_profile(profile_id))
            area=self.workspace_get(profile_id,area_id)
            if obj['active_id']!=area_id:
                obj['active_id']=area_id
                obj=self._areas_write(obj)
            return {'active_id':area_id,'area':area,'catalog_digest':obj['catalog_digest'],'authority_granted':False}

    def workspace_update(self,profile_id,area_id,expected_digest,name,purpose,local_only,permissions):
        with self.lock:
            obj=self._areas_read(self._area_profile(profile_id))
            if type(expected_digest) is not str or obj['catalog_digest']!=expected_digest:
                raise ValueError('work_area_stale_catalog')
            if area_id=='personal': raise ValueError('work_area_personal_immutable')
            area=next((row for row in obj['areas'] if row['id']==area_id),None)
            if area is None: raise ValueError('work_area_unknown')
            name=self._area_text(name,'name',90,required=True)
            purpose=self._area_text(purpose,'purpose',500)
            if type(local_only) is not bool: raise ValueError('work_area_local_policy_invalid')
            permissions=self._area_policy(permissions,local_only)
            area.update(name=name,purpose=purpose,local_only=local_only,permissions=permissions,updated_at=_iso())
            obj=self._areas_write(obj)
            return {'area':area,'catalog_digest':obj['catalog_digest'],'authority_granted':False}

    def workspace_link_goal(self,profile_id,area_id,goal_id,goal_digest):
        with self.lock:
            obj=self._areas_read(self._area_profile(profile_id))
            if area_id=='personal': raise ValueError('work_area_personal_immutable')
            area=next((row for row in obj['areas'] if row['id']==area_id),None)
            if area is None: raise ValueError('work_area_unknown')
            refs=area['goal_refs']
            old=next((row for row in refs if row['goal_id']==goal_id),None)
            if old:
                if old['goal_digest']!=goal_digest: raise ValueError('work_area_goal_binding_changed')
                return {'area':area,'idempotent_replay':True,'authority_granted':False}
            if len(refs)>=100: raise ValueError('work_area_goal_limit_reached')
            refs.append({'goal_id':goal_id,'goal_digest':goal_digest})
            area['updated_at']=_iso()
            self._areas_write(obj)
            return {'area':area,'idempotent_replay':False,'authority_granted':False}

    def workspace_task_ids(self,profile_id,area_id):
        """Derive membership from verified existing session/task links, not UI labels."""
        with self.lock:
            self.workspace_get(profile_id,area_id)
            ids=set()
            self._require_bundle_clear()
            for path in sorted(self.links.glob('STL-*.json')):
                row=core.load(path); core.validate('session-task-link.schema.json',row)
                material=dict(row); claimed=material.pop('link_digest',None)
                if claimed!=core.digest_obj(material): raise ValueError('work_area_task_link_integrity_failed')
                session=self._verify_session_ref(row['session_ref'])
                recorded=str(session.get('workspace_ref') or 'personal')
                if recorded==area_id: ids.add(row['task_ref']['ref_id'])
            return ids

    def _require_bundle_clear(self):
        if self._state_bundle.recovery_required: raise ValueError('session_state_recovery_required')
    @staticmethod
    def _require_immutable_match_or_absent(path,obj):
        path=Path(path)
        if not Path(core._native_path(path)).exists(): return
        try: existing=core.load(path)
        except Exception as exc: raise ValueError('session_immutable_collision') from exc
        if not isinstance(existing,dict) or _canonical(existing)!=_canonical(obj): raise ValueError('session_immutable_collision')
    def _commit_entries(self,entries,immutable_entries=()):
        self._require_bundle_clear()
        for path,obj in immutable_entries: self._require_immutable_match_or_absent(path,obj)
        try: self._state_bundle.commit(entries)
        except Exception as exc: raise ValueError('session_state_persist_failed') from exc
    def _seal(self,o):
        b=dict(o); b.pop('session_digest',None); return {**b,'session_digest':core.digest_obj(b)}
    def _session_object(self,o):
        obj=self._seal(o); core.validate('agent-session.schema.json',obj); return obj
    def _session_entries(self,o):
        obj=self._session_object(o); hp=self.session_history/(obj['session_id']+'-'+obj['session_digest']+'.json')
        return obj,{hp:obj,self.sessions/(obj['session_id']+'.json'):obj},[(hp,obj)]
    def _write_session(self,o):
        obj,entries,immutable=self._session_entries(o); self._commit_entries(entries,immutable); return obj
    def _verify_session_ref(self,ref):
        self._require_bundle_clear(); core.validate('operation-ref.schema.json',ref)
        hp=self.session_history/(ref['ref_id']+'-'+ref['digest_sha256']+'.json')
        if not Path(core._native_path(hp)).is_file(): raise ValueError('session_history_ref_missing')
        o=core.load(hp); core.validate('agent-session.schema.json',o)
        if o['session_digest']!=ref['digest_sha256']: raise ValueError('session_history_ref_digest_mismatch')
        b=dict(o); d=b.pop('session_digest')
        if core.digest_obj(b)!=d: raise ValueError('session_history_integrity_failure')
        return o
    def _load_session(self,sid):
        self._require_bundle_clear(); p=self.sessions/(sid+'.json')
        if not p.is_file(): raise ValueError('unknown_session')
        o=json.loads(p.read_text(encoding='utf-8')); core.validate('agent-session.schema.json',o); b=dict(o); d=b.pop('session_digest')
        if core.digest_obj(b)!=d: raise ValueError('session_digest_mismatch')
        return o
    def _event_object(self,s,event_type,instruction=None):
        digest=_sha(instruction) if instruction is not None else None
        base={'schema_version':'0.11','event_id':'SEV-'+uuid.uuid4().hex[:18],'session_ref':oref('session',s['session_id'],s['session_digest']),'event_type':event_type,'instruction_digest':digest,'created_at':_iso()}
        e={**base,'event_digest':core.digest_obj(base)}; core.validate('session-event.schema.json',e); return e
    def _event(self,s,event_type,instruction=None):
        e=self._event_object(s,event_type,instruction); ep=self.events/(e['event_id']+'.json')
        if instruction is not None:
            core.save_text(self.steering/(e['event_id']+'.txt'),str(instruction),immutable=True)
        self._commit_entries({ep:e},[(ep,e)])
        return e
    def _index(self):
        self._require_bundle_clear(); return json.loads(self.index_path.read_text(encoding='utf-8'))
    def _route(self,surface,key): return str(surface)+':'+_key(surface,key)
    @staticmethod
    def _desktop_key(key):
        return key=='iwxa-desktop-local' or (
            isinstance(key,str) and re.fullmatch(r'dialog-[0-9a-f]{32}',key) is not None)

    @staticmethod
    def _conversation_group_name(name):
        if (type(name) is not str or name!=unicodedata.normalize('NFC',name)
                or not 1<=len(name.strip())<=60
                or any(ord(char)<32 or ord(char)==127 for char in name)):
            raise ValueError('conversation_group_name_invalid')
        return name.strip()

    @staticmethod
    def _conversation_group_id(group_id):
        if type(group_id) is not str or re.fullmatch(r'grp-[0-9a-f]{32}',group_id) is None:
            raise ValueError('conversation_group_id_invalid')
        return group_id

    def _conversation_group_index(self,idx):
        """Validate group metadata in the existing signed SessionRuntime index."""
        groups=idx.get('conversation_groups') or {}
        members=idx.get('conversation_group_memberships') or {}
        if (type(groups) is not dict or len(groups)>32
                or type(members) is not dict or len(members)>100):
            raise ValueError('conversation_groups_invalid')
        for group_id,name in groups.items():
            self._conversation_group_id(group_id)
            if self._conversation_group_name(name)!=name:
                raise ValueError('conversation_group_name_invalid')
        routes=idx.get('routes') or {}
        for route,group_id in members.items():
            if type(route) is not str or route not in routes or group_id not in groups:
                raise ValueError('conversation_group_membership_invalid')
        return groups,members

    def _conversation_group_pins(self,idx,groups):
        pinned=idx.get('conversation_group_pins',[])
        if (type(pinned) is not list or len(pinned)>32
                or any(type(group_id) is not str or group_id not in groups
                       for group_id in pinned)
                or len(set(pinned))!=len(pinned)):
            raise ValueError('conversation_group_pins_invalid')
        return pinned

    def conversation_group_pin(self,group_id,pinned):
        group_id=self._conversation_group_id(group_id)
        if type(pinned) is not bool:
            raise ValueError('conversation_group_pin_invalid')
        with self.lock:
            idx=self._index()
            groups,_=self._conversation_group_index(idx)
            pins=self._conversation_group_pins(idx,groups)
            if group_id not in groups:
                raise ValueError('conversation_group_not_found')
            next_pins=([group for group in pins if group!=group_id]
                       if not pinned else
                       (pins if group_id in pins else [*pins,group_id]))
            if next_pins!=pins:
                self._commit_entries({self.index_path:{**idx,
                    'conversation_group_pins':next_pins}})
            return {'group_id':group_id,'pinned':pinned}

    def conversation_group_create(self,name):
        name=self._conversation_group_name(name)
        with self.lock:
            idx=self._index()
            groups,members=self._conversation_group_index(idx)
            if len(groups)>=32:
                raise ValueError('conversation_group_limit_reached')
            if any(value.casefold()==name.casefold() for value in groups.values()):
                raise ValueError('conversation_group_name_exists')
            group_id='grp-'+uuid.uuid4().hex
            next_groups={**groups,group_id:name}
            self._commit_entries({self.index_path:{**idx,
                'conversation_groups':next_groups}})
            return {'group_id':group_id,'name':name}

    def conversation_group_rename(self,group_id,name):
        group_id=self._conversation_group_id(group_id)
        name=self._conversation_group_name(name)
        with self.lock:
            idx=self._index()
            groups,_=self._conversation_group_index(idx)
            if group_id not in groups:
                raise ValueError('conversation_group_not_found')
            if any(gid!=group_id and value.casefold()==name.casefold()
                   for gid,value in groups.items()):
                raise ValueError('conversation_group_name_exists')
            self._commit_entries({self.index_path:{**idx,
                'conversation_groups':{**groups,group_id:name}}})
            return {'group_id':group_id,'name':name}

    def conversation_group_delete(self,group_id):
        """Delete only the grouping; never delete Sessions, messages or Tasks."""
        group_id=self._conversation_group_id(group_id)
        with self.lock:
            idx=self._index()
            groups,members=self._conversation_group_index(idx)
            if group_id not in groups:
                raise ValueError('conversation_group_not_found')
            pins=self._conversation_group_pins(idx,groups)
            remaining={key:value for key,value in groups.items() if key!=group_id}
            assignments={key:value for key,value in members.items() if value!=group_id}
            self._commit_entries({self.index_path:{**idx,
                'conversation_groups':remaining,
                'conversation_group_memberships':assignments,
                'conversation_group_pins':[gid for gid in pins if gid!=group_id]}})
            return {'group_id':group_id,
                    'ungrouped_count':len(members)-len(assignments)}

    def conversation_group_assign(self,conversation_key,group_id):
        """A chat can belong to one group, or remain ungrouped."""
        if not self._desktop_key(conversation_key):
            raise ValueError('desktop_conversation_key_invalid')
        if group_id is not None:
            self._conversation_group_id(group_id)
        with self.lock:
            idx=self._index()
            groups,members=self._conversation_group_index(idx)
            if group_id is not None and group_id not in groups:
                raise ValueError('conversation_group_not_found')
            route=self._route('web',conversation_key)
            sid=(idx.get('routes') or {}).get(route)
            if type(sid) is not str or not sid:
                raise ValueError('desktop_conversation_not_found')
            if conversation_key!='iwxa-desktop-local' and (
                    (idx.get('conversation_keys') or {}).get(route)!=conversation_key):
                raise ValueError('desktop_conversation_index_invalid')
            session=self._load_session(sid)
            if (session['surface']!='web'
                    or session['conversation_key_digest']!=_key('web',conversation_key)
                    or session['state']=='CLEARED'):
                raise ValueError('desktop_conversation_session_mismatch')
            updated=dict(members)
            if group_id is None:
                updated.pop(route,None)
            else:
                updated[route]=group_id
            if updated!=members:
                self._commit_entries({self.index_path:{**idx,
                    'conversation_group_memberships':updated}})
            return {'conversation_key':conversation_key,'group_id':group_id,
                    'session_id':sid}

    def conversation_catalog(self,limit=50,fast=False):
        """Enumerate only explicit desktop keys, using the existing session index."""
        limit=max(1,min(100,int(limit)))
        with self.lock:
            idx=self._index()
            routes=idx.get('routes') or {}
            keys=idx.get('conversation_keys') or {}
            if not isinstance(routes,dict) or not isinstance(keys,dict) or len(keys)>100:
                raise ValueError('conversation_catalog_invalid')
            listed=dict(keys)
            legacy='iwxa-desktop-local'
            if self._route('web',legacy) in routes:
                listed.setdefault(self._route('web',legacy),legacy)
            session_ids={sid for rk in listed for sid in [routes.get(rk)]
                         if isinstance(sid,str) and sid}
            # The tab bar never needs every historical Task bundle. Preserve
            # the full historical projection for explicit slow callers only.
            links_by_session=(self._linked_rows_many(session_ids)
                              if session_ids and not fast else {})
            activity=idx.get('conversation_last_activity') or {}
            if type(activity) is not dict or len(activity)>100 or any(
                type(value) is not str for value in activity.values()):
                raise ValueError('conversation_activity_invalid')
            groups,members=self._conversation_group_index(idx)
            pins=self._conversation_group_pins(idx,groups)
            rows=[]
            for route_key,key in listed.items():
                if not self._desktop_key(key) or route_key!=self._route('web',key):
                    raise ValueError('conversation_catalog_invalid')
                sid=routes.get(route_key)
                if not sid: continue
                session=self._load_session(sid)
                if session['surface']!='web' or session['conversation_key_digest']!=_key('web',key):
                    raise ValueError('conversation_catalog_session_mismatch')
                links=links_by_session.get(sid,[])
                links.sort(key=lambda row:(row['linked_at'],row['task_id']))
                latest=links[-1] if links else {}
                user_titles=idx.get('conversation_titles') or {}
                if not isinstance(user_titles,dict) or len(user_titles)>100:
                    raise ValueError('conversation_titles_invalid')
                titled=user_titles.get(route_key)
                if titled is not None and (type(titled) is not str or not titled.strip() or len(titled)>90):
                    raise ValueError('conversation_title_invalid')
                chat_ids=(idx.get('chat_turn_ids') or {}).get(route_key) or []
                rows.append({'conversation_key':key,'session_id':sid,'state':session['state'],
                             'generation':session['generation'],'title':titled or str((links[0] if links else {}).get('objective') or '')[:120],
                             'created_at':session['created_at'],'last_activity':max(session['updated_at'],str(latest.get('linked_at') or ''),activity.get(route_key,'')),
                             'task_count':len(links),'message_count':len(chat_ids),
                             'group_id':members.get(route_key)})
            rows.sort(key=lambda row:(row['last_activity'],row['session_id']),reverse=True)
            present={row['conversation_key'] for row in rows}
            selected=idx.get('active_conversation_key')
            if selected is not None and not self._desktop_key(selected):
                raise ValueError('conversation_catalog_invalid')
            if selected not in present:
                selected=rows[0]['conversation_key'] if rows else None
            return {'schema':'IWXA_CONVERSATION_CATALOG/1','total':len(rows),
                    'active_conversation_key':selected,'groups':[
                        {'group_id':gid,'name':name,'pinned':gid in pins}
                        for gid,name in groups.items()],
                    'conversations':rows[:limit]}

    # Lightweight conversation messages are SessionRuntime records, not Tasks.
    # Reuse the existing session-history directory and atomic state journal.
    # Historical Task links remain intact and continue to be readable.
    @staticmethod
    def _chat_submission_id(value):
        if type(value) is not str or re.fullmatch(r'[0-9a-f]{32}',value) is None:
            raise ValueError('chat_submission_identity_invalid')
        return value

    def _chat_path(self,submission_id):
        return self.session_history/('CHAT-'+self._chat_submission_id(submission_id)+'.json')

    def _task_cancel_path(self,submission_id):
        return self.session_history/('TASK-CANCELLED-'+self._chat_submission_id(submission_id)+'.json')

    def task_submission_cancelled(self,submission_id):
        """Read an immutable cancellation in the existing SessionRuntime."""
        path=self._task_cancel_path(submission_id)
        with self.lock:
            self._require_bundle_clear()
            if path.is_symlink(): raise ValueError('task_submission_cancellation_invalid')
            if not path.exists(): return False
            if path.stat().st_size>4096: raise ValueError('task_submission_cancellation_invalid')
            try: record=json.loads(path.read_text(encoding='utf-8'))
            except (OSError,UnicodeError,ValueError) as exc:
                raise ValueError('task_submission_cancellation_invalid') from exc
            if (type(record) is not dict or set(record)!={
                    'schema','submission_id','workspace_id','draft_digest','created_at','turn_digest'}
                    or record.get('schema')!='IWXA_SESSION_TASK_CANCELLED/1'
                    or record.get('submission_id')!=submission_id
                    or type(record.get('workspace_id')) is not str
                    or re.fullmatch(r'(?:personal|AREA-[0-9a-f]{18})',record['workspace_id']) is None
                    or type(record.get('draft_digest')) is not str
                    or re.fullmatch(r'[0-9a-f]{64}',record['draft_digest']) is None
                    or record['turn_digest']!=core.digest_obj({
                        key:value for key,value in record.items() if key!='turn_digest'})):
                raise ValueError('task_submission_cancellation_invalid')
            return True

    def _chat_load(self,submission_id):
        p=self._chat_path(submission_id)
        if not p.is_file() or p.is_symlink(): raise ValueError('chat_message_unavailable')
        value=core.load(p)
        if (type(value) is not dict or value.get('schema')!='IWXA_SESSION_CHAT_TURN/1'
                or value.get('submission_id')!=submission_id
                or value.get('status') not in {'RUNNING','COMPLETED','FAILED','INTERRUPTED'}
                or type(value.get('user')) is not str or type(value.get('session_id')) is not str
                or type(value.get('generation')) is not int
                or type(value.get('request_digest')) is not str):
            raise ValueError('chat_message_invalid')
        claimed=value.get('turn_digest')
        if claimed!=core.digest_obj({k:v for k,v in value.items() if k!='turn_digest'}):
            raise ValueError('chat_message_integrity_failure')
        return value

    def _chat_write(self,record):
        base={k:v for k,v in record.items() if k!='turn_digest'}
        row={**base,'turn_digest':core.digest_obj(base)}
        self._commit_entries({self._chat_path(row['submission_id']):row})
        return row

    def chat_recover_interrupted(self):
        """Finalize replies abandoned by the previous Core process.

        One outstanding turn per conversation is allowed. Recover only each
        topic's last turn: do not scan historical Tasks or launch inference.
        Called once by the new DailyDriverEngine owner at startup.
        """
        with self.lock:
            index=self._index()
            topics=index.get('chat_turn_ids') or {}
            if type(topics) is not dict or len(topics)>100:
                raise ValueError('chat_catalog_invalid')
            changes={}
            for route,ids in topics.items():
                if type(ids) is not list or len(ids)>3000:
                    raise ValueError('chat_catalog_invalid')
                if not ids: continue
                previous=self._chat_load(ids[-1])
                if (previous['status']!='RUNNING'
                        or route!='web:'+previous['conversation_key_digest']
                        or (index.get('routes') or {}).get(route)!=previous['session_id']):
                    continue
                row={k:v for k,v in previous.items() if k!='turn_digest'}
                row.update({'status':'INTERRUPTED','error_code':'chat_interrupted_after_restart',
                            'updated_at':_iso()})
                changes[self._chat_path(ids[-1])]={**row,'turn_digest':core.digest_obj(row)}
            if changes: self._commit_entries(changes)
            return {'interrupted':len(changes)}

    def chat_claim(self,conversation_key,submission_id,message,request_digest,local_model=None,
                   prepared_profile_id=None,prepared_request=None):
        if not self._desktop_key(conversation_key):
            raise ValueError('chat_conversation_invalid')
        self._chat_submission_id(submission_id)
        if (type(message) is not str or not message.strip() or len(message)>12000
                or type(request_digest) is not str
                or re.fullmatch(r'[0-9a-f]{64}',request_digest) is None):
            raise ValueError('chat_request_invalid')
        selected_model=local_model_pin(local_model)
        with self.lock:
            s=self.resolve('web',conversation_key)
            if s is None: s=self.bind('web',conversation_key)['session']
            if s['state']!='ACTIVE': raise ValueError('chat_session_not_active')
            idx=self._index();route=self._route('web',conversation_key)
            if conversation_key!='iwxa-desktop-local' and (idx.get('conversation_keys') or {}).get(route)!=conversation_key:
                raise ValueError('chat_conversation_binding_invalid')
            p=self._chat_path(submission_id)
            if p.exists() or p.is_symlink():
                old=self._chat_load(submission_id)
                if (old['session_id']!=s['session_id']
                        or old['generation']!=s['generation']
                        or old['request_digest']!=request_digest
                        or old['user']!=message.strip()):
                    raise ValueError('chat_submission_id_conflict')
                return {'reused':True,'turn':old}
            if prepared_profile_id is not None:
                if type(prepared_request) is not dict:
                    raise ValueError('chat_prepared_request_invalid')
                # This check shares the Session lock with draft edits and
                # claim, so a changed request cannot race the saved intent.
                draft=self.composer_draft(prepared_profile_id)
                marker=draft.get('pending_submission')
                if marker is not None:
                    if marker['submission_id']!=submission_id:
                        raise ValueError('chat_previous_prepared_submission_unresolved')
                    if (draft['state']!='SAVED'
                            or draft['draft_digest']!=marker['draft_digest']
                            or draft['text'].strip()!=message.strip()
                            or draft['local_model']!=prepared_request.get('local_model')
                            or draft['knowledge_sources']!=prepared_request.get('knowledge_sources')
                            or draft['attachments']!=prepared_request.get('attachments')
                            or ('context_options' in marker and
                                marker['context_options']!=prepared_request.get('context_options'))):
                        raise ValueError('chat_prepared_request_changed')
            recent=dict(idx.get('chat_turn_ids') or {})
            if type(recent) is not dict or len(recent)>100:
                raise ValueError('chat_catalog_invalid')
            ids=list(recent.get(route) or [])
            if len(ids)>=3000: raise ValueError('chat_history_limit_reached')
            # One in-flight message per conversation preserves history order.
            # Existing receipt identity is checked above before this guard.
            for prior_id in ids[-12:]:
                previous=self._chat_load(prior_id)
                if previous['session_id']==s['session_id'] and previous['status']=='RUNNING':
                    raise ValueError('chat_previous_message_pending')
            now=_iso()
            row={'schema':'IWXA_SESSION_CHAT_TURN/1','submission_id':submission_id,
                 'session_id':s['session_id'],'generation':s['generation'],
                 'conversation_key_digest':_key('web',conversation_key),
                 'request_digest':request_digest,'user':message.strip(),
                 'assistant':'','status':'RUNNING','provider_id':None,'model':None,
                 'local_model':selected_model,
                 'created_at':now,'updated_at':now,'error_code':None}
            recent[route]=[*ids,submission_id]
            titles=dict(idx.get('conversation_titles') or {})
            if route not in titles and len(titles)<100:
                titles[route]=message.strip()[:90]
            activity=dict(idx.get('conversation_last_activity') or {})
            if len(activity)>100: raise ValueError('conversation_activity_invalid')
            activity[route]=now
            value={**idx,'chat_turn_ids':recent,'conversation_titles':titles,
                   'conversation_last_activity':activity}
            sealed={**row,'turn_digest':core.digest_obj(row)}
            self._commit_entries({p:sealed,self.index_path:value})
            return {'reused':False,'turn':sealed}

    def chat_finish(self,conversation_key,submission_id,assistant,provider_id,model,source_refs=None):
        if type(assistant) is not str or not assistant.strip() or len(assistant.encode('utf-8'))>65536:
            raise ValueError('chat_response_out_of_bounds')
        sources=list(source_refs or [])
        if len(sources)>32 or any(
            type(item) is not dict or set(item)!={'kind','title','digest'}
            or item['kind'] not in {'file','note','memory','web'}
            or type(item['title']) is not str or len(item['title'])>180
            or type(item['digest']) is not str or re.fullmatch(r'[0-9a-f]{64}',item['digest']) is None
            for item in sources):
            raise ValueError('chat_source_provenance_invalid')
        with self.lock:
            row=self._chat_load(submission_id)
            if row['conversation_key_digest']!=_key('web',conversation_key):
                raise ValueError('chat_response_conversation_mismatch')
            if row['status']=='COMPLETED':
                if row['assistant']!=assistant: raise ValueError('chat_response_duplicate_changed')
                return row
            if row['status']!='RUNNING': raise ValueError('chat_response_not_running')
            return self._chat_write({**row,'status':'COMPLETED','assistant':assistant,
                'provider_id':str(provider_id or '')[:120],'model':str(model or '')[:160],
                'source_refs':sources,'updated_at':_iso(),'error_code':None})

    def chat_fail(self,conversation_key,submission_id,reason):
        with self.lock:
            row=self._chat_load(submission_id)
            if row['conversation_key_digest']!=_key('web',conversation_key):
                raise ValueError('chat_failure_conversation_mismatch')
            if row['status']!='RUNNING': return row
            return self._chat_write({**row,'status':'FAILED',
                'error_code':str(reason or 'model_unavailable').split(':',1)[0][:120],
                'updated_at':_iso()})

    def chat_history(self,conversation_key,query='',limit=80):
        if not self._desktop_key(conversation_key): raise ValueError('chat_conversation_invalid')
        with self.lock:
            idx=self._index();route=self._route('web',conversation_key)
            session=self.resolve('web',conversation_key)
            ids=(idx.get('chat_turn_ids') or {}).get(route) or []
            if type(ids) is not list or len(ids)>3000: raise ValueError('chat_catalog_invalid')
            rows=[];terms=_tokens(query)
            for mid in reversed(ids):
                row=self._chat_load(mid)
                if (not session or row['session_id']!=session['session_id']
                        or row['conversation_key_digest']!=_key('web',conversation_key)
                        or row['generation']!=session['generation']):
                    continue
                if terms and not terms.intersection(_tokens(row['user']+' '+row['assistant'])): continue
                state=row['status']
                rows.append({'message_id':mid,'objective':row['user'],
                    'summary':row['assistant'],'status':state,
                    'created_at':row['created_at'],'updated_at':row['updated_at'],
                    'session_generation':row['generation'],
                    'provider':{'id':row['provider_id'],'model':row['model']},
                    # The model chosen for this exact durable turn, not the
                    # provider currently active when the history is reopened.
                    'local_model':row.get('local_model'),
                    'sources':row.get('source_refs') or [],
                    'error_code':row['error_code']})
                if len(rows)>=max(1,min(200,int(limit))): break
            return {'conversation_key':conversation_key,'turns':list(reversed(rows)),
                    'legacy_tasks_preserved':True,'session':session}

    def chat_detail(self,conversation_key,submission_id):
        with self.lock:
            record=self._chat_load(submission_id)
            if record['conversation_key_digest']!=_key('web',conversation_key):
                raise ValueError('chat_submission_scope_invalid')
            session=self.resolve('web',conversation_key)
            if (not session or record['session_id']!=session['session_id']
                    or record['generation']!=session['generation']):
                raise ValueError('chat_submission_session_changed')
            return {'submission_id':submission_id,
                    'state':record['status'],
                    'message_id':submission_id,'error_code':record['error_code'],
                    'text':record['assistant'],'model':record['model'],
                    'local_model':record.get('local_model'),
                    'sources':record.get('source_refs') or [],
                    'created_at':record['created_at'],'updated_at':record['updated_at']}

    def chat_prepare_task_draft(self,profile_id,conversation_key,message_id,expected_draft_digest):
        """Explicitly selected conversation turn becomes Task input, not a Task."""
        if type(expected_draft_digest) is not str or not re.fullmatch(r'[0-9a-f]{64}',expected_draft_digest):
            raise ValueError('chat_task_draft_revision_invalid')
        with self.lock:
            selected=self.chat_detail(conversation_key,message_id)
            if selected['state']!='COMPLETED':
                raise ValueError('chat_task_source_incomplete')
            turn=self._chat_load(message_id)
            references=turn.get('source_refs') or []
            provenance=("\n\nИспользованные источники:\n"+"\n".join(
                "- "+str(item['kind'])+": "+str(item['title']).replace("\n"," ")+" ("+str(item['digest'])+")"
                for item in references)) if references else ""
            content="Сообщение:\n"+turn['user']+"\n\nОтвет IWXA:\n"+turn['assistant']+provenance
            if len(content.encode('utf-8'))>44000:raise ValueError('chat_task_source_too_large')
            path=self._composer_storage_path(profile_id)
            draft=self.composer_draft(profile_id)
            name='Conversation-'+message_id+'.txt'
            for item in draft['attachments']:
                if item['name']==name:
                    if item['text']!=content:raise ValueError('chat_task_source_changed')
                    return {'reused':True,'attachment_name':name,'draft':draft}
            if draft['draft_digest']!=expected_draft_digest:
                raise ValueError('chat_task_draft_changed')
            if draft['state']!='SAVED' and (path.exists() or path.is_symlink()):
                raise ValueError('chat_task_draft_unreadable')
            if len(draft['attachments'])>=8:raise ValueError('chat_task_attachment_limit')
            task_text=draft['text'] if draft['text'].strip() else turn['user']
            selected_model=turn.get('local_model') or draft['local_model']
            result=self.composer_draft(profile_id,text=task_text,attachments=[
                *draft['attachments'],{'name':name,'text':content}],local_model=selected_model)
            if (not any(x['name']==name and x['text']==content for x in result['attachments'])
                    or result['local_model']!=selected_model):
                raise ValueError('chat_task_draft_readback_mismatch')
            return {'reused':False,'attachment_name':name,'draft':result,
                    'text_initialized':not bool(draft['text'].strip())}

    @staticmethod
    def _chat_options(value):
        if type(value) is not dict or set(value)!={'skill_id','use_memory','use_obsidian','use_web'}:
            raise ValueError('conversation_options_invalid')
        if value['skill_id'] is not None and (type(value['skill_id']) is not str
                or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,100}',value['skill_id'])):
            raise ValueError('conversation_skill_invalid')
        if any(type(value[k]) is not bool for k in ('use_memory','use_obsidian','use_web')):
            raise ValueError('conversation_source_flags_invalid')
        return dict(value)

    def conversation_options(self,conversation_key, options=None):
        if not self._desktop_key(conversation_key):
            raise ValueError('desktop_conversation_key_invalid')
        with self.lock:
            idx=self._index()
            route=self._route('web',conversation_key)
            sid=(idx.get('routes') or {}).get(route)
            if not isinstance(sid,str) or not sid:
                defaults={'skill_id':None,'use_memory':False,'use_obsidian':False,'use_web':False}
                if options is None:
                    return {'conversation_key':conversation_key,'options':defaults,'session_id':None}
                # Changing settings explicitly can begin the first topic.
                # SessionRuntime is still the sole lifecycle owner.
                self._chat_options(options)
                self.bind('web',conversation_key)
                idx=self._index()
                sid=(idx.get('routes') or {}).get(route)
                if not isinstance(sid,str) or not sid:
                    raise ValueError('desktop_conversation_not_found')
            current=self._load_session(sid)
            if current['state']=='CLEARED' or current['conversation_key_digest']!=_key('web',conversation_key):
                raise ValueError('desktop_conversation_session_mismatch')
            if conversation_key!='iwxa-desktop-local' and (idx.get('conversation_keys') or {}).get(route)!=conversation_key:
                raise ValueError('desktop_conversation_index_invalid')
            rows=dict(idx.get('conversation_options') or {})
            if len(rows)>100: raise ValueError('conversation_options_catalog_invalid')
            if options is not None:
                selected=self._chat_options(options)
                rows[route]=selected
                self._commit_entries({self.index_path:{**idx,'conversation_options':rows}})
            else:
                selected=self._chat_options(rows[route]) if route in rows else {
                    'skill_id':None,'use_memory':False,'use_obsidian':False,'use_web':False}
            return {'conversation_key':conversation_key,'options':selected,'session_id':sid}

    def rename_conversation(self,conversation_key,title):
        """Human-visible topic labels live in the existing SessionRuntime index."""
        if not self._desktop_key(conversation_key):
            raise ValueError('desktop_conversation_key_invalid')
        if (type(title) is not str or not 1<=len(title.strip())<=90
                or title!=unicodedata.normalize('NFC',title)
                or any(ord(char)<32 for char in title)):
            raise ValueError('conversation_title_invalid')
        with self.lock:
            idx=self._index()
            route=self._route('web',conversation_key)
            sid=(idx.get('routes') or {}).get(route)
            if not isinstance(sid,str) or not sid:
                raise ValueError('desktop_conversation_not_found')
            session=self._load_session(sid)
            if session['surface']!='web' or session['conversation_key_digest']!=_key('web',conversation_key) or session['state']=='CLEARED':
                raise ValueError('desktop_conversation_session_mismatch')
            if conversation_key!='iwxa-desktop-local' and (idx.get('conversation_keys') or {}).get(route)!=conversation_key:
                raise ValueError('desktop_conversation_index_invalid')
            titles=dict(idx.get('conversation_titles') or {})
            if len(titles)>100:
                raise ValueError('conversation_titles_invalid')
            titles[route]=title.strip()
            self._commit_entries({self.index_path:{**idx,'conversation_titles':titles}})
            return {'conversation_key':conversation_key,'title':titles[route],
                    'session_id':sid}

    def select_conversation(self,conversation_key):
        """Persist desktop navigation in the existing SessionRuntime index."""
        if not self._desktop_key(conversation_key):
            raise ValueError('desktop_conversation_key_invalid')
        with self.lock:
            idx=self._index()
            route=self._route('web',conversation_key)
            sid=(idx.get('routes') or {}).get(route)
            if not isinstance(sid,str) or not sid:
                raise ValueError('desktop_conversation_not_found')
            if conversation_key!='iwxa-desktop-local' and (
                    (idx.get('conversation_keys') or {}).get(route)!=conversation_key):
                raise ValueError('desktop_conversation_index_invalid')
            session=self._load_session(sid)
            if session['surface']!='web' or session['conversation_key_digest']!=_key('web',conversation_key) or session['state']=='CLEARED':
                raise ValueError('desktop_conversation_session_mismatch')
            if idx.get('active_conversation_key')!=conversation_key:
                self._commit_entries({self.index_path:{**idx,'active_conversation_key':conversation_key}})
            return {'active_conversation_key':conversation_key,'session_id':sid,'state':session['state']}

    def _new_session(self,surface,conversation_key,workspace_ref=None):
        now=_iso(); s={'schema_version':'0.11','session_id':'SES-'+uuid.uuid4().hex[:18],'surface':surface,'conversation_key_digest':_key(surface,conversation_key),'state':'ACTIVE','generation':1,'created_at':now,'updated_at':now}
        if workspace_ref: s['workspace_ref']=str(workspace_ref)[:400]
        return self._session_object(s)
    def bind(self,surface,conversation_key,workspace_ref=None):
        if surface not in ('web','pwa','telegram','desktop','api'): raise ValueError('invalid_session_surface')
        rk=self._route(surface,conversation_key)
        with self.lock:
            idx=self._index(); sid=idx['routes'].get(rk)
            if sid:
                s=self._load_session(sid)
                if s['state']!='CLEARED': return {'session':s,'created':False}
            s=self._new_session(surface,conversation_key,workspace_ref); e=self._event_object(s,'BIND'); ep=self.events/(e['event_id']+'.json'); _,entries,immutable=self._session_entries(s); entries[ep]=e; immutable.append((ep,e))
            next_idx={**idx,'routes':dict(idx.get('routes') or {})}
            next_idx['routes'][rk]=s['session_id']
            if surface=='web' and self._desktop_key(conversation_key):
                keys=dict(idx.get('conversation_keys') or {})
                if rk not in keys and len(keys)>=100: raise ValueError('conversation_catalog_limit_reached')
                keys[rk]=conversation_key
                next_idx['conversation_keys']=keys
                next_idx['active_conversation_key']=conversation_key
            entries[self.index_path]=next_idx
            self._commit_entries(entries,immutable); return {'session':s,'created':True}
    def resolve(self,surface,conversation_key):
        idx=self._index(); sid=idx['routes'].get(self._route(surface,conversation_key)); return self._load_session(sid) if sid else None
    def _transition(self,s,event_type,state=None,generation_delta=0):
        candidate=dict(s); candidate['state']=state or candidate['state']; candidate['generation']=candidate['generation']+generation_delta; candidate['updated_at']=_iso(); obj,entries,immutable=self._session_entries(candidate); e=self._event_object(obj,event_type); ep=self.events/(e['event_id']+'.json'); entries[ep]=e; immutable.append((ep,e)); self._commit_entries(entries,immutable); return {'session':obj,'event':e}
    def resume(self,surface,key):
        with self.lock:
            s=self.resolve(surface,key)
            if not s: raise ValueError('session_not_bound')
            if s['state']=='CLEARED': raise ValueError('session_cleared')
            return self._transition(s,'RESUME','ACTIVE')
    def _reject_live_desktop_chat_context_change(self,surface,key,session):
        """A running model reply must retain the generation that claimed it.

        Call only under the existing SessionRuntime lock, shared with
        chat_claim/chat_finish. No new state or in-memory authority is needed.
        """
        if surface!='web' or not self._desktop_key(key): return
        ids=(self._index().get('chat_turn_ids') or {}).get(self._route(surface,key)) or []
        if type(ids) is not list or len(ids)>3000:
            raise ValueError('chat_catalog_invalid')
        if ids:
            last=self._chat_load(ids[-1])
            if (last['session_id']==session['session_id']
                    and last['generation']==session['generation']
                    and last['status']=='RUNNING'):
                raise ValueError('chat_context_change_wait_for_reply')

    def recycle(self,surface,key):
        with self.lock:
            s=self.resolve(surface,key)
            if not s or s['state']=='CLEARED': raise ValueError('session_not_active')
            self._reject_live_desktop_chat_context_change(surface,key,s)
            return self._transition(s,'RECYCLE','ACTIVE',1)
    def pause(self,surface,key):
        with self.lock:
            s=self.resolve(surface,key)
            if not s or s['state']=='CLEARED': raise ValueError('session_not_active')
            return self._transition(s,'PAUSE','PAUSED')
    def steer(self,surface,key,instruction):
        text=str(instruction or '').strip()
        if not text: raise ValueError('steering_instruction_required')
        if len(text)>8000: raise ValueError('steering_instruction_too_large')
        with self.lock:
            s=self.resolve(surface,key)
            if not s or s['state']=='CLEARED': raise ValueError('session_not_active')
            e=self._event(s,'STEER',text); return {'session':s,'event':e}
    def clear(self,surface,key):
        rk=self._route(surface,key)
        with self.lock:
            idx=self._index(); sid=idx['routes'].get(rk)
            if not sid: return self.bind(surface,key)
            old=self._load_session(sid)
            self._reject_live_desktop_chat_context_change(surface,key,old)
            workspace_ref=old.get('workspace_ref'); entries={}; immutable=[]
            if old['state']!='CLEARED':
                candidate=dict(old); candidate['state']='CLEARED'; candidate['updated_at']=_iso(); cleared,old_entries,old_immutable=self._session_entries(candidate); clear_event=self._event_object(cleared,'CLEAR'); clear_ep=self.events/(clear_event['event_id']+'.json'); old_entries[clear_ep]=clear_event; old_immutable.append((clear_ep,clear_event)); entries.update(old_entries); immutable.extend(old_immutable)
            fresh=self._new_session(surface,key,workspace_ref); bind_event=self._event_object(fresh,'BIND'); bind_ep=self.events/(bind_event['event_id']+'.json'); _,fresh_entries,fresh_immutable=self._session_entries(fresh); fresh_entries[bind_ep]=bind_event; fresh_immutable.append((bind_ep,bind_event)); entries.update(fresh_entries); immutable.extend(fresh_immutable)
            next_idx={**idx,'routes':dict(idx.get('routes') or {})}; next_idx['routes'][rk]=fresh['session_id']; entries[self.index_path]=next_idx
            self._commit_entries(entries,immutable); return {'session':fresh,'created':True}
    def pending_steering(self,surface,key):
        self._require_bundle_clear(); s=self.resolve(surface,key)
        if not s: return []
        consumed=set(json.loads(self.consumed_path.read_text(encoding='utf-8'))['event_ids']); out=[]
        for p in sorted(self.events.glob('SEV-*.json')):
            e=json.loads(p.read_text(encoding='utf-8'))
            if e['event_type']=='STEER' and e['session_ref']['ref_id']==s['session_id'] and e['event_id'] not in consumed:
                tp=self.steering/(e['event_id']+'.txt'); text=tp.read_text(encoding='utf-8')
                if _sha(text)!=e['instruction_digest']: raise ValueError('steering_instruction_digest_mismatch')
                out.append({'event':e,'instruction':text})
        return out
    def consume_steering(self,event_ids):
        with self.lock:
            self._require_bundle_clear(); o=json.loads(self.consumed_path.read_text(encoding='utf-8')); ids=set(o['event_ids']); ids.update(str(x) for x in event_ids); o['event_ids']=sorted(ids); self._commit_entries({self.consumed_path:o}); return o
    def link_task(self,session_or_id,task_id):
        self._require_bundle_clear(); s=self._load_session(session_or_id) if isinstance(session_or_id,str) else dict(session_or_id)
        tp=self.core_root/'tasks'/str(task_id)/'task.json'
        if not tp.is_file(): raise ValueError('unknown_session_task')
        task,_=core.load_task_state(tp,check_expiry=False)
        td=core.contract_digest_path(tp)
        for p in self.links.glob('STL-*.json'):
            o=core.load(p); core.validate('session-task-link.schema.json',o); b=dict(o); d=b.pop('link_digest')
            if core.digest_obj(b)!=d: raise ValueError('session_task_link_digest_mismatch')
            if o['session_ref']['ref_id']==s['session_id'] and o['task_ref']['ref_id']==task['task_id']:
                if o['task_ref']['digest_sha256']!=td: raise ValueError('session_task_link_task_digest_changed')
                return o
        base={'schema_version':'0.11','link_id':'STL-'+uuid.uuid4().hex[:18],'session_ref':oref('session',s['session_id'],s['session_digest']),'task_ref':core.tref('task',task['task_id'],td),'linked_at':_iso()}
        link={**base,'link_digest':core.digest_obj(base)}; core.validate('session-task-link.schema.json',link); core.save_json(self.links/(link['link_id']+'.json'),link,immutable=True); return link
    def _linked_rows_many(self,session_ids):
        """Single verified scan for all requested existing sessions."""
        self._require_bundle_clear()
        groups={sid:[] for sid in session_ids}
        for p in sorted(self.links.glob('STL-*.json')):
            o=core.load(p); core.validate('session-task-link.schema.json',o); b=dict(o); d=b.pop('link_digest')
            if core.digest_obj(b)!=d: raise ValueError('session_task_link_digest_mismatch')
            sid=o['session_ref']['ref_id']
            if sid not in groups: continue
            linked_session=self._verify_session_ref(o['session_ref'])
            tp=self.core_root/'tasks'/o['task_ref']['ref_id']/'task.json'
            if not Path(core._native_path(tp)).is_file() or core.contract_digest_path(tp)!=o['task_ref']['digest_sha256']: raise ValueError('session_task_link_task_integrity_failure')
            task,state=core.load_task_state(tp,check_expiry=False); summary=''; model_meta=None
            if state.get('result_ref'):
                rp=tp.parent/'results'/(state['result_ref']['ref_id']+'.json')
                if not Path(core._native_path(rp)).is_file(): raise ValueError('session_task_result_missing')
                if core.contract_digest_path(rp)!=state['result_ref']['digest_sha256']: raise ValueError('session_task_result_integrity_failure')
                result=core.load(rp); core.validate('agent-result.schema.json',result); summary=str(result.get('summary') or '')
                meta=result.get('runtime_meta') if isinstance(result.get('runtime_meta'),dict) else {}
                model=meta.get('model')
                if isinstance(model,str) and model.strip():
                    provider=meta.get('provider')
                    model_meta={'model':model,'id':provider if isinstance(provider,str) else ''}
            row={'link':o,'task_id':task['task_id'],'objective':task['objective'],'summary':summary,'status':state.get('status'),
                 'session_generation':linked_session['generation'],'linked_at':o['linked_at']}
            if model_meta: row['provider']=model_meta
            groups[sid].append(row)
        return groups

    def _linked_rows(self,session_id):
        return self._linked_rows_many({session_id})[session_id]
    def dialogue_history(self,surface,conversation_key,max_turns=12,max_chars=16000):
        """Bounded current-generation dialogue, read from the existing task journal."""
        with self.lock:
            self._require_bundle_clear(); session=self.resolve(surface,conversation_key)
            if not session: return []
            rows=sorted(self._linked_rows(session['session_id']),key=lambda r:(r['linked_at'],r['task_id']))
            selected=[]; remaining=max(0,min(16000,int(max_chars)))
            for row in reversed(rows):
                if row['session_generation']!=session['generation'] or not row['summary']: continue
                user=str(row['objective']); assistant=str(row['summary'])
                size=len(user)+len(assistant)
                if size>remaining: break
                selected.append({'user':user,'assistant':assistant}); remaining-=size
                if len(selected)>=max(1,min(12,int(max_turns))): break
            return list(reversed(selected))
    def search(self,surface,conversation_key,query,limit=20):
        self._require_bundle_clear(); s=self.resolve(surface,conversation_key)
        if not s: return {'profile':PROFILE,'session':None,'results':[]}
        qt=_tokens(query); ranked=[]
        for row in self._linked_rows(s['session_id']):
            if not qt: score=1
            else:
                text=_tokens(row['objective']+' '+row['summary']); score=len(qt & text)
            if score>0: ranked.append((score,row))
        # Recent saved messages take priority over the oldest bounded page.
        ranked.sort(key=lambda x:(x[1]['linked_at'],x[1]['task_id']),reverse=True)
        if qt: ranked.sort(key=lambda x:x[0],reverse=True)
        return {'profile':PROFILE,'session':s,'results':[dict(r,score=sc) for sc,r in ranked[:max(1,min(200,int(limit)))]],
                'scope_policy':'CURRENT_SESSION_ONLY_NOT_CANONICAL_MEMORY'}
