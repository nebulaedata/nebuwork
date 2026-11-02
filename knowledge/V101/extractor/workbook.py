from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill


def export_workbook(payload, output):
    workbook = Workbook()
    workbook.remove(workbook.active)
    headers = ['序号', '类型', '适用对象', '对象／指标', '条件', '内容', '补充', '章节',
               '原文引文', '原文位置', '校验状态', '待核问题', '文件版本', '解析版本', '来源链接', '记录ID']
    records = payload['records']
    labels = {'requirement': '要求', 'definition': '定义', 'explanation': '解释', 'other': '其他'}
    def rows(items):
        result = []
        for index, record in enumerate(items):
            source = record.get('source') or {}
            evidence = source.get('evidence') or []
            refs = [ref for e in evidence for ref in e.get('source_refs', [])]
            supplement = record.get('supplement') or {}
            result.append([index + 1, labels.get(record.get('type'), record.get('type')),
                record.get('applicability', {}).get('text'), record.get('subject'), record.get('conditions'),
                record.get('content'), '；'.join(sum([supplement.get(k) or [] for k in ('exceptions', 'references', 'relations')], [])),
                record.get('applicability', {}).get('section_id'), '\n'.join(e.get('quote') or '' for e in evidence),
                '\n'.join(str(ref.get('locators')) for ref in refs),
                '待核验' if record['validation']['status'] == 'needs_review' else '程序校验通过',
                '；'.join(record['validation'].get('issues') or []), source.get('file_version_id'),
                source.get('parse_version_id'), '\n'.join(ref['preview_url'] for ref in refs), record['id']])
        return result
    sheets = [
        ('规范条款', [headers] + rows(records)),
        ('待核验', [headers] + rows([r for r in records if r['validation']['status'] == 'needs_review'])),
        ('覆盖与问题', [['单元', '处置', '原因']] + [
            [c.get('unit_id'), c.get('disposition'), c.get('reason')] for c in payload.get('coverage', [])]),
        ('说明', [['项目', '内容']] + [[key, str(value)] for key, value in payload.get('run', {}).items()]),
    ]
    for name, data in sheets:
        sheet = workbook.create_sheet(name)
        for row in data:
            sheet.append(row)
        # Values from documents are always strings, never Excel formulas.
        for row in sheet:
            for cell in row:
                if isinstance(cell.value, str):
                    cell.data_type = 's'
                cell.alignment = Alignment(vertical='top', wrap_text=True)
        for cell in sheet[1]:
            cell.font = Font(color='FFFFFF', bold=True)
            cell.fill = PatternFill('solid', fgColor='6254E8')
        sheet.freeze_panes = 'A2'
        sheet.auto_filter.ref = sheet.dimensions
        for column in sheet.columns:
            sheet.column_dimensions[column[0].column_letter].width = 32 if column[0].column > 2 else 16
    workbook.save(output)
