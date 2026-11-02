"""Wiki page graph lifecycle; run only against the isolated acceptance stack."""
from client import BASE, request, check
from pathlib import Path
import json

assert ':19081/' in BASE, 'Requires isolated tests/compose.settings.yaml'
kb = request('/knowledge-bases', {'name': 'Wiki 页面关系图验收'})['id']
other = request('/knowledge-bases', {'name': 'Wiki 跨库隔离验收'})['id']
prefix = '/knowledge-bases/' + kb + '/wiki'
def create(title, content, root=prefix):
    return request(root + '/pages', {'title': title, 'content': content, 'source_ids': []})['id']
outside = create('外部页面', '外部正文', '/knowledge-bases/' + other + '/wiki')
origin = create('变压器总览', '## 关联页面\n- [设备规范](#)\n- 未生成章节\n\n[跨库](wiki:' + outside + ')')
target = create('设备规范', '引用 [[变压器总览]]\n\n`[[孤立页面]]`')
isolated = create('孤立页面', '## 正文\n- 变压器总览')
g = request(prefix + '/graph?view=overview')
check(len(g['nodes']) == 3 and len(g['edges']) == 2 and g['unresolved_references'] == 2, 'existing related pages, directed references, unresolved and cross-KB separation')
check(all('content' not in n for n in g['nodes']), 'graph transfers metadata, not every article body')
check(request(prefix + '/graph') == g['edges'], 'legacy edge-array response preserved')
check(request(prefix + '/stats')['links'] == 2, 'stats use current derived links')
check(request(prefix + '/rebuild-links', {})['links'] == 2, 'materialized link rebuild uses same rules')
request(prefix + '/pages/' + target, {'title': '设备规范', 'content': '更新正文', 'source_ids': []}, 'PUT')
check(len(request(prefix + '/graph')) == 1, 'editing removes stale outbound relationships without rebuild')
revisions = request(prefix + '/pages/' + target + '/revisions')
request(prefix + '/pages/' + target + '/revert', {'revision_id': revisions[-1]['id']})
check(len(request(prefix + '/graph')) == 2, 'reverting restores relationships immediately')
request(prefix + '/pages/' + target, method='DELETE')
check(len(request(prefix + '/graph')) == 0, 'deleting a target removes incoming and outgoing edges')
target = create('设备规范', '引用 [[变压器总览]]')
for i in range(101): create('附录 %03d' % i, '独立页面')
check(len(request(prefix + '/graph?view=overview')['nodes']) == 104, 'page graph includes pages beyond the old 100-page limit')
entities = request('/knowledge-bases/' + kb + '/graph')
check(not entities['nodes'] and not entities['relations'], 'Wiki links never create entity graph nodes or evidence')
Path('test-results/wiki-graph.json').write_text(json.dumps({'kb':kb, 'page':origin, 'target':target, 'isolated':isolated}), encoding='utf-8')
print('UI fixture:', kb)
