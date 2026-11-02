"""Build document-ir/1 from WeKnora text chunks.

The chunk payload is produced by the nebuwork server. It contains the document
metadata and every text chunk (with source_locators carrying page/bbox/quote).
No network, OCR, or PyMuPDF access happens here.
"""
from __future__ import annotations

from collections import OrderedDict
from html.parser import HTMLParser
import hashlib
import html
import json
import re


DEFAULT_WIDTH = 595.0
DEFAULT_HEIGHT = 842.0
MAX_SECTION_PARTS = 2


def _norm(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def _clean(text: str) -> str:
    text = html.unescape(text or "")
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("\u00a0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self._row = None
        self._cell = None
        self._buf = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag == "tr":
            self.handle_endtag("tr")
            self._row = []
        elif tag in ("td", "th"):
            self.handle_endtag("td")
            if self._row is None:
                self._row = []
            self._cell = dict(attrs)
            self._buf = []
        elif tag == "br" and self._cell is not None:
            self._buf.append("\n")

    def handle_data(self, data):
        if self._cell is not None:
            self._buf.append(data)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in ("td", "th") and self._cell is not None:
            self._cell["text"] = _clean("".join(self._buf))
            self._row.append(self._cell)
            self._cell = None
            self._buf = []
        elif tag in ("tr", "table") and self._row is not None:
            self.handle_endtag("td")
            if self._row:
                self.rows.append(self._row)
            self._row = None

    def close(self):
        super().close()
        self.handle_endtag("tr")


def _int_attr(cell, name, default=1):
    try:
        value = int(str(cell.get(name, default)).strip())
        return max(1, min(32, value))
    except (TypeError, ValueError):
        return default


def _table_grid(rows):
    """Return rows of cells with stable row/column/span geometry."""
    occupied = {}
    result = []
    for r, row in enumerate(rows):
        cells = []
        c = 0
        for raw in row:
            while (r, c) in occupied:
                c += 1
            rowspan = _int_attr(raw, "rowspan")
            colspan = _int_attr(raw, "colspan")
            text = str(raw.get("text", "")).strip()
            cell = {"row": r, "column": c, "row_span": rowspan, "column_span": colspan, "text": text}
            for rr in range(r, min(r + rowspan, r + 32)):
                for cc in range(c, min(c + colspan, c + 32)):
                    occupied[(rr, cc)] = cell
            cells.append(cell)
            c += colspan
        result.append(cells)
    return result


def _table_id_from_text(text, fallback):
    match = re.search(r"(?:^|\n)\s*(?:续\s*)?表\s*([A-Za-z]?\s*\.?\s*\d+(?:\s*\.\s*\d+)*)", text or "")
    if match:
        return "表" + re.sub(r"\s+", "", match.group(1))
    return fallback


def split_blocks(content: str):
    """Split mixed prose/tables in source order, including unwrapped HTML rows."""
    content = content or ""
    cursor = 0
    opening = re.compile(r"<(table|tr|td|th)\b[^>]*>", re.I)
    while match := opening.search(content, cursor):
        yield from _split_text_blocks(content[cursor:match.start()])
        start = match.start()
        if match.group(1).lower() == "table":
            next_table = re.search(r"<table\b", content[match.end():], re.I)
            limit = match.end() + next_table.start() if next_table else len(content)
            closing = re.search(r"</table\s*>", content[match.end():limit], re.I)
            if closing:
                end = match.end() + closing.end()
            else:
                # An unclosed table may be followed by ordinary prose. Keep
                # complete rows, not the rest of the chunk, inside the table.
                endings = list(re.finditer(r"</(?:tr|td|th)\s*>", content[match.end():limit], re.I))
                end = match.end() + endings[-1].end() if endings else limit
        else:
            # Bare rows/cells are one fragment only while separated by table
            # markup/whitespace. Never absorb following headings or prose.
            end = match.end()
            tag = match.group(1)
            closing = re.search(rf"</{tag}\s*>", content[end:], re.I)
            end = end + closing.end() if closing else len(content)
            while end < len(content):
                suffix = re.match(r"\s*(?:</(?:tbody|thead|tfoot|table)\s*>\s*)*", content[end:], re.I)
                after = end + suffix.end()
                following = opening.match(content, after)
                if not following or following.group(1).lower() == "table":
                    end = after
                    break
                close = re.search(rf"</{following.group(1)}\s*>", content[following.end():], re.I)
                end = following.end() + close.end() if close else len(content)
        yield "table_html", content[start:end]
        cursor = end
    yield from _split_text_blocks(content[cursor:])


def _split_text_blocks(content):
    lines = content.splitlines()
    buf = []
    table = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            if table:
                yield ("table_md", "\n".join(table))
                table = []
            if buf:
                yield ("text", "\n".join(buf).strip())
                buf = []
            yield ("heading", stripped)
        elif stripped.startswith("|"):
            if buf:
                yield ("text", "\n".join(buf).strip())
                buf = []
            table.append(line.rstrip())
        elif not stripped:
            if table:
                yield ("table_md", "\n".join(table))
                table = []
            if buf:
                yield ("text", "\n".join(buf).strip())
                buf = []
        else:
            if table:
                yield ("table_md", "\n".join(table))
                table = []
            if re.match(r"^\s*\d+(?:\.\d+){1,}\s", stripped) and buf:
                yield ("text", "\n".join(buf).strip())
                buf = []
            buf.append(line.rstrip())
    if table:
        yield ("table_md", "\n".join(table))
    if buf:
        yield ("text", "\n".join(buf).strip())


def _parse_markdown_table(text):
    rows = []
    for line in text.splitlines():
        stripped = line.strip().strip("|")
        if not stripped or re.fullmatch(r"[:\-\s|]+", stripped):
            continue
        cells = [cell.strip() for cell in stripped.split("|")]
        rows.append([{"text": cell} for cell in cells])
    return _table_grid(rows)


def _parse_html_table(text, prior_rows=None):
    parser = _TableParser()
    try:
        parser.feed(text)
        parser.close()
    except Exception:
        return []
    if prior_rows is None:
        return _table_grid(parser.rows)
    start = len(prior_rows)
    prior_rows.extend(parser.rows)
    return _table_grid(prior_rows)[start:]


def parse_toc(chunks):
    toc = OrderedDict()
    for chunk in chunks:
        if int(chunk.get("chunk_index") or 0) > 22:
            break
        for line in str(chunk.get("content") or "").splitlines():
            match = re.match(r"^\s*(\d{1,2})\s+(.+?)\s*[.…]{2,}\s*(\d+)\s*$", line)
            if match:
                toc.setdefault(match.group(1), (match.group(2).strip(), int(match.group(3))))
                continue
            match = re.match(
                r"^\s*附录\s*([A-D])\s*[（(]([^）)]+)[）)]\s*(.+?)\s*[.…]{2,}\s*(\d+)\s*$", line
            )
            if match:
                toc.setdefault(match.group(1), (match.group(3).strip(), int(match.group(4))))
    return toc


def heading_info(line, toc):
    match = re.match(r"^(#{1,7})\s*(.*)$", (line or "").strip())
    if not match:
        return None
    level = len(match.group(1))
    text = match.group(2).strip()
    if not text:
        return None
    # Prefer an exact/near-exact TOC chapter title. This repairs OCR forms
    # such as "46 kV、10 kV" (chapter 4) and "1 000 kV" (chapter 13).
    for toc_number, (toc_title, _) in toc.items():
        if _norm(text) == _norm(toc_number + " " + toc_title) or _norm(text) == _norm(toc_title):
            return {"level": level, "number": toc_number, "title": toc_title, "text": text}
        if "." not in text.split(" ")[0] and len(_norm(toc_title)) > 4 and _norm(text).endswith(_norm(toc_title)):
            return {"level": level, "number": toc_number, "title": toc_title, "text": text}
    numbered = re.match(r"^(\d+(?:\.\d+){0,4})(?![\d.])\s*(.*)$", text)
    if numbered:
        number, title = numbered.group(1), numbered.group(2).strip()
        # OCR often drops the space after a chapter number: "46 kV、10 kV".
        if number not in toc and len(number) >= 2:
            for toc_number, (toc_title, _) in toc.items():
                if text.endswith(toc_title) and text.startswith(toc_number + " "):
                    number, title = toc_number, toc_title
                    break
        if number not in toc and not title:
            for toc_number, (toc_title, _) in toc.items():
                if _norm(text) == _norm(toc_title) or _norm(text).endswith(_norm(toc_title)):
                    number, title = toc_number, toc_title
                    break
        return {"level": level, "number": number, "title": title or number, "text": text}
    appendix = re.match(r"^附录\s*([A-D])\s*[（(]?([^）)]*)[）)]?\s*(.*)$", text)
    if appendix:
        title = (appendix.group(2) + " " + appendix.group(3)).strip()
        return {"level": level, "number": appendix.group(1), "title": title or appendix.group(1), "text": text}
    for toc_number, (toc_title, _) in toc.items():
        if _norm(text) == _norm(toc_title) or (len(_norm(toc_title)) > 4 and _norm(toc_title) in _norm(text)):
            return {"level": level, "number": toc_number, "title": toc_title, "text": text}
    return {"level": level, "number": None, "title": text, "text": text}


def _is_section_heading(info):
    if not info or not info.get("number"):
        return False
    number = str(info["number"])
    if number.isalpha():
        return True
    return len(number.split(".")) <= MAX_SECTION_PARTS


def _bbox_from_locator(locator, pages):
    page = locator.get("page") if locator else None
    try:
        page = int(page)
    except (TypeError, ValueError):
        page = None
    box = locator.get("bbox") if locator else None
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        return page, [0.0, 0.0, 10.0, 10.0]
    values = []
    for value in box:
        try:
            values.append(float(value))
        except (TypeError, ValueError):
            values.append(0.0)
    width, height = pages.get(page, (DEFAULT_WIDTH, DEFAULT_HEIGHT))
    if all(0.0 <= value <= 1.5 for value in values):
        values = [values[0] * width, values[1] * height, values[2] * width, values[3] * height]
    return page, values


def _find_locator(chunk, text, pages):
    locators = chunk.get("source_locators") or []
    needle = _norm(_clean(text))
    for locator in locators:
        quote = _norm(_clean(locator.get("quote") or ""))
        if quote and (quote in needle or (len(needle) > 20 and needle in quote)):
            return _bbox_from_locator(locator, pages)
    for locator in locators:
        if locator.get("page"):
            return _bbox_from_locator(locator, pages)
    return None, None


def build_ir(payload):
    document = payload.get("document") or {}
    chunks = [c for c in (payload.get("chunks") or []) if isinstance(c, dict)]
    chunks.sort(key=lambda c: int(c.get("chunk_index") or 0))
    page_count_hint = int(payload.get("pageCount") or 0)
    pages = {}
    for page in range(1, max(page_count_hint, 1) + 1):
        pages[page] = (DEFAULT_WIDTH, DEFAULT_HEIGHT)
    toc = parse_toc(chunks)

    sections = OrderedDict()
    for number, (title, _) in toc.items():
        sections[number] = {"id": number, "parent_id": None, "title": title, "heading_unit_ids": []}

    units = []
    current_section = None
    heading_seen = set()
    table_offsets = {}
    current_table_id = None
    current_table_header = ""
    current_html_rows = []
    pending_caption = None
    pending_continuation = False
    table_counter = 0
    source_warnings = []
    locator_warnings = []
    counter = 0
    last_page = 1
    last_bbox = [0.0, 0.0, 10.0, 10.0]

    def add_unit(kind, text, page, bbox, section_id, extra=None):
        nonlocal counter
        counter += 1
        unit = {
            "id": f"u{counter:05d}",
            "page": int(page or 1),
            "kind": kind,
            "text": text or "",
            "bbox": [float(v) for v in (bbox or last_bbox)],
            "section_id": section_id,
            "method": "weknora",
        }
        if locator_warnings:
            unit["source_warnings"] = list(locator_warnings)
        if extra:
            unit.update(extra)
        units.append(unit)
        return unit

    for chunk in chunks:
        locators = chunk.get("source_locators") or []
        chunk_page = next((int(l.get("page")) for l in locators if l.get("page")), last_page)
        for kind, text in split_blocks(str(chunk.get("content") or "")):
            if not text.strip():
                continue
            located_page, located_bbox = _find_locator(chunk, text, pages)
            locator_warnings = []
            if located_page is None:
                locator_warnings.append("来源页码缺失：page 为兼容占位值，不代表已核实的原文页码；不表示页面不可读。")
            if located_bbox is None or not any(l.get("bbox") for l in locators):
                locator_warnings.append("来源边界缺失：bbox 为兼容占位值，不代表已核实的原文位置。")
            for warning in locator_warnings:
                if warning not in source_warnings:
                    source_warnings.append(warning)
            if kind == "heading":
                current_table_id = None
                current_table_header = ""
                current_html_rows = []
                pending_caption = None
                pending_continuation = False
                info = heading_info(text, toc)
                if not info:
                    continue
                number = info.get("number")
                if number and _is_section_heading(info):
                    if number not in sections:
                        parts = str(number).split(".")
                        parent = ".".join(parts[:-1]) if len(parts) > 1 else None
                        if parent and parent not in sections:
                            p_title = toc.get(parent, (parent, None))[0]
                            sections[parent] = {
                                "id": parent,
                                "parent_id": ".".join(parent.split(".")[:-1]) or None,
                                "title": p_title,
                                "heading_unit_ids": [],
                            }
                        sections[number] = {
                            "id": number,
                            "parent_id": parent,
                            "title": info.get("title") or number,
                            "heading_unit_ids": [],
                        }
                    current_section = number
                    key = (number, info.get("title"))
                    if key in heading_seen:
                        continue
                    heading_seen.add(key)
                    page, bbox = _find_locator(chunk, text, pages)
                    unit = add_unit("heading", _clean(text.lstrip("#").strip()), page or chunk_page,
                                    bbox or last_bbox, number)
                    last_page, last_bbox = unit["page"], unit["bbox"]
                    sections[number]["heading_unit_ids"].append(unit["id"])
                    if not sections[number]["title"] or sections[number]["title"] == number:
                        sections[number]["title"] = info.get("title") or number
                    continue
                # Deep/un-numbered heading: keep as ordinary text so clause
                # planning can still recognise its clause number.
                kind = "text"

            if kind in ("table_html", "table_md"):
                caption = _table_id_from_text(_clean(text), None) or pending_caption
                continuation = bool(current_table_id and (
                    pending_continuation or re.search(r"续表|表\s*\S+\s*[（(]续", _clean(text))
                    or (kind == "table_html" and not re.search(r"<table\b", text, re.I))
                ))
                if caption and caption != current_table_id:
                    continuation = False
                if not continuation:
                    table_counter += 1
                    current_table_id = caption or f"p{chunk_page}-t{table_counter}"
                    if current_table_id in table_offsets:
                        current_table_id += f"-t{table_counter}"
                    current_table_header = ""
                    current_html_rows = []
                table_id = current_table_id
                start = table_offsets.get(table_id, 0)
                rows = (_parse_html_table(text, current_html_rows) if kind == "table_html"
                        else _parse_markdown_table(text))
                pending_caption = None
                pending_continuation = False
                if not rows:
                    page, bbox = _find_locator(chunk, text, pages)
                    add_unit("text", _clean(text), page or chunk_page, bbox or last_bbox, current_section)
                    continue
                # Header comes from the first observed rows of this table.
                header_rows = rows[:2] if start == 0 else []
                if header_rows:
                    current_table_header = " | ".join(
                        " ".join(c["text"] for c in row if c["text"]) for row in header_rows
                    )
                page, bbox = _find_locator(chunk, text, pages)
                for offset, row_cells in enumerate(rows):
                    row_index = start + offset
                    cells = []
                    for cell in row_cells:
                        cells.append({
                            "cell_id": f"{table_id}:r{row_index}-c{cell['column']}",
                            "row": row_index,
                            "column": cell["column"],
                            "row_span": cell["row_span"],
                            "column_span": cell["column_span"],
                            "text": cell["text"],
                        })
                    row_text = " | ".join(
                        ("C" + str(cell["column"]) + ": " + cell["text"]) if cell["text"] else ""
                        for cell in cells
                    ).strip(" |")
                    if not row_text:
                        continue
                    add_unit("table_row", row_text, page or chunk_page, bbox or last_bbox, current_section, {
                        "table_id": table_id,
                        "logical_table_id": table_id,
                        "table_group_id": table_id,
                        "row": row_index,
                        "coordinate_base": 0,
                        "cells": cells,
                        "table_header": current_table_header,
                    })
                table_offsets[table_id] = start + len(rows)
                last_page, last_bbox = page or chunk_page, bbox or last_bbox
                continue

            clean_text = _clean(text)
            # OCR layout wrappers (e.g. standalone div/img tags) carry no
            # visible prose. Ignore them before changing table continuation
            # state; empty table cells are handled separately above.
            if not clean_text:
                continue
            pending_caption = _table_id_from_text(clean_text, None)
            pending_continuation = bool(re.search(r"续表|表\s*\S+\s*[（(]续", clean_text))
            if not pending_continuation:
                current_table_id = None
                current_table_header = ""
                current_html_rows = []
            page, bbox = _find_locator(chunk, text, pages)
            page = page or chunk_page
            bbox = bbox or last_bbox
            unit = add_unit("text", _clean(text), page, bbox, current_section)
            last_page, last_bbox = unit["page"], unit["bbox"]

    # Keep sections that actually own content and all of their ancestors. A
    # heading-only subsection (for example 9.1 followed directly by 9.2) adds a
    # scope call without providing evidence, so it is folded away.
    body_sections = {
        u["section_id"] for u in units
        if u.get("section_id") and u.get("kind") not in ("heading", "unreadable")
    }
    keep = set(body_sections)
    if "1" in sections:
        keep.add("1")
    for sid in list(keep):
        parent = sections.get(sid, {}).get("parent_id")
        while parent:
            keep.add(parent)
            parent = sections.get(parent, {}).get("parent_id")
    sections = OrderedDict((key, value) for key, value in sections.items() if key in keep)
    units = [u for u in units if u.get("section_id") in keep or u.get("section_id") is None]

    max_page = max((u["page"] for u in units), default=1)
    page_count = max(page_count_hint, max_page, 1)
    # Absence of locators is not evidence of an unreadable physical page.
    # Only an upstream original-document parser can establish that condition.

    document_id = str(document.get("id") or payload.get("documentId") or "document")
    sha = str(payload.get("sha256") or "")
    if not re.fullmatch(r"[0-9a-f]{64}", sha):
        sha = _sha256("|".join([
            document_id,
            str(document.get("file_hash") or ""),
            str(document.get("updated_at") or ""),
            str(document.get("title") or ""),
        ]))
    title = str(document.get("title") or document.get("file_name") or payload.get("title") or "未命名文档")
    return {
        "schema_version": "document-ir/1",
        "document_id": document_id,
        "sha256": sha,
        "title": title,
        "document_role": "standard",
        "page_count": page_count,
        "pages": [
            {"page": page, "width": pages.get(page, (DEFAULT_WIDTH, DEFAULT_HEIGHT))[0],
             "height": pages.get(page, (DEFAULT_WIDTH, DEFAULT_HEIGHT))[1], "warnings": []}
            for page in range(1, page_count + 1)
        ],
        "sections": list(sections.values()),
        "source_warnings": source_warnings,
        "units": units,
    }


def build_ir_from_file(path):
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
    return build_ir(payload)
