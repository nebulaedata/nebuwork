"""Document genre classification for the v3 extraction workflow.

Genre selects the prompt branch, block sizing, and front-matter policy.
Everything here is deterministic: title patterns first, structure second.
"""
from __future__ import annotations

import re

GENRES = (
    'report',
    'overview',
    'bid',
    'procurement_dedicated',
    'procurement_general',
    'standard',
    'generic',
)

_TITLE_PATTERNS = [
    ('report', re.compile(r'检验报告|试验报告|检测报告|签章报告|监造报告|评估报告|鉴定报告|检测报告|型式试验')),
    ('overview', re.compile(r'供应商|信息概览|概览|名录|台账|清单')),
    ('bid', re.compile(r'固化ID|招标文件|招标公告|投标邀请|资格预审')),
    ('procurement_dedicated', re.compile(r'专用技术规范|技术规范.{0,6}专用|专用部分')),
    ('procurement_general', re.compile(r'通用技术规范|采购标准|通用部分|技术规范书|技术规范')),
    ('standard', re.compile(r'(GB|GB/T|GB∕T|Q/GDW|Q／GDW|DL/T|DL∕T|NB/T|IEC|IEEE|ISO)\s*[\d.]+', re.I)),
]

_BODY_STANDARD = re.compile(r'范围[\s\S]{0,800}?规范性引用文件|规范性引用文件[\s\S]{0,1500}?术语和定义')
_BODY_REPORT = re.compile(r'检验结论|试验结论|检验项目|实测|委托单位|样品名称')
_BODY_PROCUREMENT = re.compile(r'投标人|招标人|项目单位|供货方|交货|技术参数表')


def classify(title: str, units: list) -> str:
    """Return one of GENRES. Title wins; body structure breaks ties."""
    text = title or ''
    for genre, pattern in _TITLE_PATTERNS:
        if pattern.search(text):
            return genre
    head = '\n'.join(str(u.get('text') or '') for u in units[:60])[:6000]
    if _BODY_STANDARD.search(head):
        return 'standard'
    if _BODY_PROCUREMENT.search(head) and re.search(r'技术规范|采购|招标', head):
        return 'procurement_general'
    if _BODY_REPORT.search(head):
        return 'report'
    return 'generic'


GENRE_LABELS = {
    'report': '检验/试验/报告类文档',
    'overview': '供应商/信息概览类文档',
    'bid': '招标/采购文件类文档',
    'procurement_dedicated': '采购专用技术规范',
    'procurement_general': '采购通用技术规范/技术规范书',
    'standard': '国家/行业/企业标准',
    'generic': '通用文档',
}
