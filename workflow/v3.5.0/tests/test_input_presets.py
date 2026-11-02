import copy
import json

import pytest

from nebulae import Engine
from nebulae.definition import validate
from nebulae.input_presets import validate_input_presets
from nebulae.store import Conflict


def scenarios():
    return [
        {'id': 'initial', 'name': '初始化', 'description': '使用明确指定的数据范围',
         'input': {'mode': 'initial', 'options': {'a/b~c': [1, False]}},
         'fields': {'/mode': '处理模式', '/options': '范围选项', '/options/a~1b~0c': '来源范围',
                    '/options/a~1b~0c/0': '起始编号', '/options/a~1b~0c/1': '是否启用附加处理'}},
        {'id': 'delta', 'name': '增量更新', 'description': '使用已有状态继续处理',
         'input': {'mode': 'delta'}, 'fields': {'/mode': '处理模式'}},
    ]


def test_validate_preserves_order_documentation_and_falsey_values():
    presets = scenarios()
    for value in (0, False, None, [], {}, ''):
        presets.append({'id': 'value' + str(len(presets)), 'name': '完整输入', 'description': '',
                        'input': value, 'fields': {'': '整个输入的说明'}})
    result = validate_input_presets(presets)
    assert result == presets
    result[0]['fields']['/mode'] = 'edited'
    assert presets[0]['fields']['/mode'] == '处理模式'


@pytest.mark.parametrize('change', [
    lambda items: items.append(copy.deepcopy(items[0])),
    lambda items: items[0].update(name='  '),
    lambda items: items[0].update(id='bad id'),
    lambda items: items[0].update(description=42),
    lambda items: items[0].pop('input'),
    lambda items: items[0].update(extra=True),
    lambda items: items[0].update(input={'number': float('inf')}),
    lambda items: items[0].update(fields={'/missing': '不存在'}),
    lambda items: items[0].update(fields={'/options/a~2b': '错误转义'}),
    lambda items: items[0].update(fields={'/options/a~1b~0c/01': '非标准数组下标'}),
    lambda items: items[0].update(fields={'/options/a~1b~0c/2': '越界数组下标'}),
    lambda items: items[0].update(fields={'/mode': None}),
])
def test_invalid_presets_are_rejected(change):
    items = scenarios()
    change(items)
    with pytest.raises(ValueError):
        validate_input_presets(items)


def test_definition_save_copy_restore_and_task_snapshot(tmp_path):
    with Engine(tmp_path) as engine:
        original = engine.catalog.create('input-contract')
        assert 'input_presets' not in original['definition']
        assert 'input_presets' not in validate(original['definition'], engine.catalog.directory('input-contract'))
        definition = {**original['definition'], 'input_presets': scenarios()}
        normalized = validate(definition, engine.catalog.directory('input-contract'))
        assert normalized['input_presets'] == scenarios()
        saved = engine.catalog.save('input-contract', 'workflow.json', json.dumps(definition), original['revision'])
        assert engine.catalog.get('input-contract')['definition']['input_presets'] == scenarios()
        copied = engine.catalog.create('input-copy', copy_from='input-contract')
        assert copied['definition']['input_presets'] == scenarios()
        actual_input = {'mode': 'delta', 'edited': True}
        task = engine.create_task('input-contract', actual_input, 'input-once')
        assert engine.create_task('input-contract', actual_input, 'input-once') == task
        assert engine.status(task)['input'] == actual_input
        assert engine.status(task)['state'] == 'ready'
        assert engine.status(task)['definition']['input_presets'] == scenarios()
        with pytest.raises(Conflict):
            engine.catalog.save('input-contract', 'workflow.json', json.dumps(definition), original['revision'])
        historical = engine.catalog.revisions('input-contract', 'workflow.json')[-1]['id']
        engine.catalog.restore('input-contract', 'workflow.json', historical, saved['revision'])
        assert 'input_presets' not in engine.catalog.get('input-contract')['definition']
        assert engine.status(task)['definition']['input_presets'] == scenarios()


def test_empty_presets_are_supported_without_seeding(tmp_path):
    with Engine(tmp_path) as engine:
        flow = engine.catalog.create('empty')
        flow['definition']['input_presets'] = []
        result = validate(flow['definition'], engine.catalog.directory('empty'))
        assert result['input_presets'] == []
