import { useEffect, useState } from "react";
import { Alert, Button, Dialog, Input, InputNumber, Select, Table, Tag, Tooltip, MessagePlugin } from "tdesign-react";
import { Row, send } from "./api";
import { Busy, ErrorNotice, useData } from "./ui";

export function columnName(column: number): string {
  let name = "";
  while (column > 0) { column--; name = String.fromCharCode(65 + column % 26) + name; column = Math.floor(column / 26); }
  return name;
}
export const excelWarnings: Record<string, string> = {
  FORMULA_CACHE_MISSING: "公式没有已保存的计算结果，当前显示原始公式；未执行计算。",
  NUMBER_FORMAT_UNSUPPORTED: "该数字格式暂未完整还原，当前显示保存值，原格式仍保留。",
  CELL_IMAGE_UNAVAILABLE: "单元格图片未能提取；外部图片不会自动下载。",
};

function normalizedLocator(value?: Row): Row | undefined {
  if (!value?.cell_range || value.row_start || value.row) return value;
  const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(value.cell_range);
  if (!match) return value;
  const col = (s: string) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  return {...value, row_start: Number(match[2]), row_end: Number(match[4] || match[2]), column_start: col(match[1]), column_end: col(match[3] || match[1])};
}

export function SpreadsheetPreview({ id, query, locator: inputLocator }: { id: string; query: string; locator?: Row }) {
  const locator = normalizedLocator(inputLocator);
  const workbook = useData<Row>(`/knowledge/${id}/sheets?${query}`);
  const [sheetId, setSheetId] = useState("");
  const [rowStart, setRowStart] = useState(1);
  const [colStart, setColStart] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [headers, setHeaders] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const sheets: Row[] = workbook.data?.sheets || [];
  const active = sheets.find(s => s.id === sheetId) || sheets[0];
  const verified = locator?.type === "sheet" && locator.mapping !== "converted_structure" && locator.mapping !== "unverified";
  useEffect(() => {
    if (!workbook.data) return;
    const target = verified ? sheets.find(s => s.id === locator?.sheet_id || s.name === locator?.sheet) : undefined;
    setSheetId(target?.id || sheets[0]?.id || "");
    setRowStart(target ? Math.max(1, Number(locator?.row_start || locator?.row || 1) - 2) : 1);
    setColStart(target ? Math.max(1, Number(locator?.column_start || locator?.column || 1)) : 1);
  }, [workbook.data, inputLocator]);
  const fixedQuery = workbook.data ? `file_version_id=${workbook.data.file_version_id}&parse_version_id=${workbook.data.parse_version_id || ""}` : query;
  const range = useData<Row>(active ? `/knowledge/${id}/sheets/${active.id}/cells?${fixedQuery}&row_start=${rowStart}&column_start=${colStart}&row_count=50&column_count=12` : "");
  const data = range.data;
  const matchesSheet = verified && (active?.id === locator?.sheet_id || active?.name === locator?.sheet);
  const selected = (r: number, c: number) => matchesSheet && r >= (locator?.row_start || locator?.row || 1) && r <= (locator?.row_end || locator?.row_start || locator?.row || 1) && (!locator?.column_start || c >= locator.column_start && c <= (locator.column_end || locator.column_start));
  const merges: Row[] = data?.merged_ranges || [];
  const mergeAt = (r: number, c: number) => merges.find(m => r >= Math.max(m.row_start, rowStart) && r <= m.row_end && c >= Math.max(m.column_start, colStart) && c <= m.column_end);
  const columns: any[] = [{ colKey: "row", title: "行", width: 64, fixed: "left", cell: ({ row }: {row: Row}) => row.row }];
  for (let c = colStart; c <= (data?.column_end || 0); c++) {
    columns.push({colKey: `c${c}`, title: columnName(c), width: 170, cell: ({ row }: {row: Row}) => {
      const merged = mergeAt(row.row, c);
      const cell = merged ? merged.master : row.cells.find((v: Row) => v.column === c);
      const highlight = selected(row.row, c) || merged && selected(merged.row_start, merged.column_start);
      return <Tooltip content={cell ? `${cell.address}${merged ? ` · 合并 ${merged.range}` : ""}${cell.formula ? ` · ${cell.formula}` : ""} · 格式 ${cell.format}${cell.warning ? " · " + (excelWarnings[cell.warning] || cell.warning) : ""}` : "空单元格"}>
        <div className={`spreadsheet-cell${highlight ? " spreadsheet-selected" : ""}`} data-address={`${columnName(c)}${row.row}`}>
          {cell?.display || (cell?.image_formula ? "[单元格图片]" : "")}{cell?.warning && <Tag size="small" theme="warning">待核验</Tag>}
        </div>
      </Tooltip>;
    }});
  }
  async function saveHeaders() {
    const values = headers.trim() ? headers.split(/[,，\s]+/).map(Number) : [];
    if (values.some(n => !Number.isInteger(n) || n < 1 || n > active.row_count) || new Set(values).size !== values.length || values.length > 20) { MessagePlugin.error("请输入有效且不重复的原始行号，最多 20 行"); return; }
    setBusy(true);
    try {
      const current = workbook.data?.settings || {};
      await send(`/knowledge/${id}/spreadsheet-settings`, {file_version_id: workbook.data?.file_version_id, excel: {...current, sheets: {...current.sheets, [active.name]: {header_rows: values}}}}, "PUT");
      setSettingsOpen(false); setSaved(true); workbook.reload();
      MessagePlugin.success("表头设置已保存，重新处理后生效");
    } catch(e) { MessagePlugin.error((e as Error).message); } finally { setBusy(false); }
  }
  async function reparse() {
    setBusy(true);
    try { await send(`/knowledge/${id}/reparse`, {}); setSaved(false); MessagePlugin.success("已提交重新处理"); }
    catch(e) { MessagePlugin.error((e as Error).message); }
    finally { setBusy(false); }
  }
  if (workbook.loading && !workbook.data) return <Busy />;
  return <div className="spreadsheet-preview">
    <ErrorNotice message={workbook.error || range.error} />
    <div className="toolbar spreadsheet-toolbar">
      <Select aria-label="工作表" value={active?.id || ""} style={{width:220}} options={sheets.map(s => ({value:s.id,label:s.name + (s.hidden ? "（隐藏工作表）" : "")}))} onChange={value => {setSheetId(String(value));setRowStart(1);setColStart(1);setSaved(false);}} />
      <span className="help">{active?.row_count || 0} 行 · {active?.column_count || 0} 列</span>
      <Button size="small" variant="outline" disabled={!active} onClick={() => {const cfg = workbook.data?.settings || {};setHeaders((cfg.sheets?.[active.name]?.header_rows ?? cfg.header_rows ?? []).join(", "));setSettingsOpen(true);}}>设置表头</Button>
    </div>
    {saved && <Alert theme="info" message="设置已保存，当前解析结果保持原版本。" operation={<Button size="small" variant="text" loading={busy} onClick={reparse}>按新表头重新处理</Button>} />}
    {locator && !verified && <Alert theme="warning" message="该来源未核验原工作表位置，下面仅展示源文件表格，不高亮推测位置。" />}
    <div className="spreadsheet-controls">
      <Button size="small" variant="outline" disabled={rowStart === 1} onClick={() => setRowStart(Math.max(1,rowStart-50))}>上 50 行</Button>
      <span>起始行</span><InputNumber aria-label="起始行" size="small" min={1} max={Math.max(1,active?.row_count || 1)} value={rowStart} onChange={v => setRowStart(Number(v) || 1)} />
      <Button size="small" variant="outline" disabled={!active || rowStart+50 > active.row_count} onClick={() => setRowStart(rowStart+50)}>下 50 行</Button>
      <span>起始列</span><InputNumber aria-label="起始列" size="small" min={1} max={Math.max(1,active?.column_count || 1)} value={colStart} onChange={v => setColStart(Number(v) || 1)} />
      <span className="help">{columnName(colStart)}–{columnName(data?.column_end || colStart)}</span>
    </div>
    <Table rowKey="row" bordered size="small" tableLayout="fixed" maxHeight={580} loading={range.loading} data={data?.rows || []} columns={columns} empty="工作表没有单元格数据"
      rowspanAndColspan={({row, colIndex}: any) => {
        if (colIndex === 0) return {rowspan:1,colspan:1};
        const c = colStart + colIndex - 1;
        const m = mergeAt(row.row,c);
        if (!m) return {rowspan:1,colspan:1};
        const top = Math.max(rowStart,m.row_start), left = Math.max(colStart,m.column_start);
        if (row.row === top && c === left) return {rowspan:Math.min(data!.row_end,m.row_end)-top+1,colspan:Math.min(data!.column_end,m.column_end)-left+1};
        return {rowspan:0,colspan:0};
      }} />
    <p className="help">源文件行列预览 · 合并范围保留 · 公式使用保存值，未执行重算。复杂图表和完整 Excel 样式请下载原文件查看。</p>
    <Dialog visible={settingsOpen} header={`表头设置 · ${active?.name || ""}`} closeOnOverlayClick={false} confirmBtn={{content:"保存设置",loading:busy}} onConfirm={saveHeaders} onClose={() => setSettingsOpen(false)}>
      <p>填写原始表头行号，以逗号分隔，例如 1, 2。留空保留所有行，并使用 A、B、C 作为列标识。</p>
      <Input aria-label="表头行号" value={headers} onChange={setHeaders} placeholder="留空表示不指定表头" />
      <p className="help">仅影响当前文件的此工作表；保存不会自动重跑，也不会修改源文件。</p>
    </Dialog>
  </div>;
}
