from __future__ import annotations

import json
import pytest

from runtime.session_runtime import SessionRuntime


def test_conversation_groups_persist_without_moving_sessions_or_messages(tmp_path):
    owner = SessionRuntime(tmp_path)
    alpha = 'dialog-' + 'a' * 32
    beta = 'dialog-' + 'b' * 32
    ids = {
        key: owner.bind('web', key)['session']['session_id']
        for key in (alpha, beta)
    }
    work = owner.conversation_group_create('Работа')
    personal = owner.conversation_group_create('Личное')
    assert work['group_id'].startswith('grp-')
    assert len(owner.conversation_catalog()['groups']) == 2
    moved = owner.conversation_group_assign(alpha, work['group_id'])
    assert moved['session_id'] == ids[alpha]
    owner.conversation_group_assign(beta, personal['group_id'])
    restarted = SessionRuntime(tmp_path)
    grouped = restarted.conversation_catalog()
    assert {row['conversation_key']: row['group_id'] for row in grouped['conversations']} == {
        alpha: work['group_id'], beta: personal['group_id']
    }
    assert {row['conversation_key']: row['session_id'] for row in grouped['conversations']} == ids
    renamed = restarted.conversation_group_rename(work['group_id'], 'Проекты')
    assert renamed['name'] == 'Проекты'
    before = restarted.conversation_catalog()['total']
    deleted = restarted.conversation_group_delete(work['group_id'])
    assert deleted['ungrouped_count'] == 1
    after = SessionRuntime(tmp_path).conversation_catalog()
    assert after['total'] == before
    assert alpha in {row['conversation_key'] for row in after['conversations']}
    assert next(row for row in after['conversations'] if row['conversation_key'] == alpha)['group_id'] is None
    assert owner.conversation_group_assign(alpha, None)['group_id'] is None


def test_conversation_group_invalid_inputs_leave_index_unchanged(tmp_path):
    owner = SessionRuntime(tmp_path)
    key = 'dialog-' + 'c' * 32
    owner.bind('web', key)
    first = owner.conversation_group_create('Первый')
    baseline = owner.index_path.read_bytes()
    for name in ('', ' ', '\n', 'x' * 61, 'Первый'):
        with pytest.raises(ValueError):
            owner.conversation_group_create(name)
    for invalid in ('../../escape', 'grp-' + 'z' * 32, 'grp-' + 'f' * 31):
        with pytest.raises(ValueError):
            owner.conversation_group_assign(key, invalid)
    with pytest.raises(ValueError):
        owner.conversation_group_assign('dialog-' + 'd' * 32, first['group_id'])
    assert owner.index_path.read_bytes() == baseline
    with pytest.raises(ValueError):
        owner.conversation_group_rename(first['group_id'], ' ')
    with pytest.raises(ValueError):
        owner.conversation_group_delete('grp-' + 'e' * 32)


def test_conversation_group_tampering_is_rejected(tmp_path):
    owner = SessionRuntime(tmp_path)
    key = 'dialog-' + 'a' * 32
    owner.bind('web', key)
    group_id = owner.conversation_group_create('Work')['group_id']
    owner.conversation_group_assign(key, group_id)
    idx = json.loads(owner.index_path.read_text(encoding='utf-8'))
    idx['conversation_group_memberships']['web:unknown'] = group_id
    owner.index_path.write_text(json.dumps(idx), encoding='utf-8')
    with pytest.raises(ValueError, match='conversation_group_membership_invalid'):
        SessionRuntime(tmp_path).conversation_catalog()


def test_group_limit_and_duplicate_names(tmp_path):
    owner = SessionRuntime(tmp_path)
    for n in range(32):
        owner.conversation_group_create('Group ' + str(n))
        if n == 1:
            with pytest.raises(ValueError, match='conversation_group_name_exists'):
                owner.conversation_group_create('group 1')
    with pytest.raises(ValueError, match='conversation_group_limit_reached'):
        owner.conversation_group_create('Extra')


def test_group_pin_is_persisted_and_only_affects_display_order(tmp_path):
    owner = SessionRuntime(tmp_path)
    alpha = 'dialog-' + 'a' * 32
    original_session = owner.bind('web', alpha)['session']['session_id']
    group_id = owner.conversation_group_create('Project')['group_id']
    assigned = owner.conversation_group_assign(alpha, group_id)
    assert assigned['session_id'] == original_session
    pinned = owner.conversation_group_pin(group_id, True)
    assert pinned == {'group_id':group_id,'pinned':True}
    recovered = SessionRuntime(tmp_path).conversation_catalog()
    assert recovered['groups'] == [{'group_id':group_id,'name':'Project','pinned':True}]
    assert recovered['conversations'][0]['session_id'] == original_session
    assert recovered['conversations'][0]['group_id'] == group_id
    owner.conversation_group_pin(group_id, False)
    assert SessionRuntime(tmp_path).conversation_catalog()['groups'][0]['pinned'] is False
    owner.conversation_group_pin(group_id, True)
    owner.conversation_group_delete(group_id)
    after = SessionRuntime(tmp_path).conversation_catalog()
    assert after['groups'] == []
    assert after['conversations'][0]['session_id'] == original_session
    assert after['conversations'][0]['group_id'] is None


def test_invalid_group_pinning_is_rejected_without_mutation(tmp_path):
    owner = SessionRuntime(tmp_path)
    group_id = owner.conversation_group_create('Team')['group_id']
    before = owner.index_path.read_bytes()
    for value in ('true', 1, 0, None, [], {}):
        with pytest.raises(ValueError, match='conversation_group_pin_invalid'):
            owner.conversation_group_pin(group_id, value)
    with pytest.raises(ValueError, match='conversation_group_not_found'):
        owner.conversation_group_pin('grp-'+'f'*32, True)
    assert owner.index_path.read_bytes() == before
    idx = json.loads(owner.index_path.read_text(encoding='utf-8'))
    idx['conversation_group_pins'] = [[]]
    owner.index_path.write_text(json.dumps(idx),encoding='utf-8')
    with pytest.raises(ValueError, match='conversation_group_pins_invalid'):
        SessionRuntime(tmp_path).conversation_catalog()
