package cn.nebulaedata.cccs.nebuwork.backend.api.database;

import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentClient;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import org.apache.commons.csv.*;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import java.io.*;
import java.nio.charset.*;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.*;

/** Uploaded sources are immutable artifacts; preview and commit read exactly the same version. */
@Service
public class DatabaseFiles {
    final AgentClient engine;final ObjectMapper json;final DatabaseSettings settings;
    public DatabaseFiles(AgentClient engine,ObjectMapper json,DatabaseSettings settings){this.engine=engine;this.json=json;this.settings=settings;}
    public JsonNode stage(String owner,String database,MultipartFile file,String requestKey)throws IOException{
        String name=Objects.toString(file.getOriginalFilename(),"");checkName(name);if(file.getSize()>settings.fileBytes())throw new ApiException(413,"导入文件超过容量限制");
        String project="database-"+database;JsonNode artifact=engine.post(owner,project,"/v1/projects/"+project+"/artifacts",map("name",name,"mode","create","contentBase64",Base64.getEncoder().encodeToString(file.getBytes()),"mediaType",name.toLowerCase(Locale.ROOT).endsWith(".csv")?"text/csv":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),requestKey);
        return json.valueToTree(map("projectId",project,"artifactId",artifact.path("id"),"version",artifact.path("version"),"name",name));
    }
    static void checkName(String name){String lower=name.toLowerCase(Locale.ROOT);if(!lower.endsWith(".csv")&&!lower.endsWith(".xlsx"))throw new ApiException(422,"仅支持 CSV 或 XLSX 文件");}
    public JsonNode source(String owner,JsonNode source){
        String project=text(source,"projectId",128,true),id=text(source,"artifactId",128,true);int version=source.path("version").asInt(0);if(version<1)throw new ApiException(422,"请选择明确的文件版本");
        JsonNode metadata=engine.get(owner,project,"/v1/artifacts/"+AgentClient.segment(id)+"?version="+version);if(!project.equals(metadata.path("projectId").asText()))throw new ApiException(403,"文件不属于所选项目");checkName(metadata.path("name").asText());if(metadata.path("size").asLong()>settings.fileBytes())throw new ApiException(413,"文件超过导入容量限制");return metadata;
    }
    public Map<String,Object> parse(String owner,JsonNode source,String sheet,String encoding){
        JsonNode metadata=source(owner,source);byte[] bytes=engine.contentBytes(owner,source.path("projectId").asText(),metadata.path("id").asText(),metadata.path("version").asInt());
        List<String> columns=new ArrayList<>(),sheets=new ArrayList<>();List<List<String>> rows=new ArrayList<>();String selectedSheet="";
        try{
            if(metadata.path("name").asText().toLowerCase(Locale.ROOT).endsWith(".csv")){
                if(!Arrays.asList("UTF-8","GB18030").contains(encoding))throw new ApiException(422,"CSV 编码仅支持 UTF-8 或 GB18030");
                int offset=bytes.length>=3&&(bytes[0]&255)==239&&(bytes[1]&255)==187&&(bytes[2]&255)==191?3:0;
                CharsetDecoder decoder=Charset.forName(encoding).newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT);
                CSVFormat format=CSVFormat.DEFAULT.builder().setHeader().setSkipHeaderRecord(true).setDuplicateHeaderMode(DuplicateHeaderMode.DISALLOW).setAllowMissingColumnNames(false).build();
                try(CSVParser parser=format.parse(new InputStreamReader(new ByteArrayInputStream(bytes,offset,bytes.length-offset),decoder))){columns.addAll(parser.getHeaderNames());for(CSVRecord record:parser){if(record.size()!=columns.size())throw new ApiException(422,"CSV 第 "+record.getRecordNumber()+" 行字段数量与表头不一致");List<String> row=new ArrayList<>();record.forEach(row::add);rows.add(row);limits(columns,rows);}}
            }else{
                org.apache.poi.openxml4j.util.ZipSecureFile.setMaxEntrySize(settings.fileBytes());
                try(Workbook book=WorkbookFactory.create(new ByteArrayInputStream(bytes))){for(int i=0;i<book.getNumberOfSheets();i++)sheets.add(book.getSheetName(i));
                    Sheet selected=sheet.isEmpty()?book.getSheetAt(0):book.getSheet(sheet);if(selected==null)throw new ApiException(422,"所选工作表不存在");
                    if(sheet.isEmpty())for(int i=0;i<book.getNumberOfSheets();i++){Sheet candidate=book.getSheetAt(i);Row first=candidate.getRow(candidate.getFirstRowNum());if(first!=null&&first.getLastCellNum()>0){selected=candidate;break;}}selectedSheet=selected.getSheetName();
                    DataFormatter formatter=new DataFormatter(Locale.ROOT);Row header=selected.getRow(selected.getFirstRowNum());if(header==null)throw new ApiException(422,"工作表缺少表头");
                    for(int i=0;i<header.getLastCellNum();i++)columns.add(formatter.formatCellValue(header.getCell(i)));limits(columns,rows);
                    for(int i=header.getRowNum()+1;i<=selected.getLastRowNum();i++){Row raw=selected.getRow(i);if(raw==null)continue;List<String> row=new ArrayList<>();boolean nonempty=false;
                        for(int j=0;j<columns.size();j++){Cell cell=raw.getCell(j);String value=formatter.formatCellValue(cell);row.add(value);if(!value.isEmpty())nonempty=true;}
                        if(nonempty)rows.add(row);limits(columns,rows);}
                }
            }
            if(columns.isEmpty()||columns.stream().anyMatch(String::isEmpty)||new HashSet<>(columns).size()!=columns.size())throw new ApiException(422,"表头不能为空或重复");
            return map("columns",columns,"rows",rows,"rowCount",rows.size(),"sheets",sheets,"sheet",selectedSheet,"source",map("projectId",source.path("projectId"),"artifactId",metadata.path("id"),"version",metadata.path("version"),"name",metadata.path("name")));
        }catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(422,"无法解析文件，请检查文件格式、CSV 编码和表头");}
    }
    private void limits(List<String> columns,List<?> rows){if(columns.size()>200||rows.size()>10000)throw new ApiException(413,"每次导入最多 200 列、10000 行，请分批导入");}
    @SuppressWarnings("unchecked") public Map<String,Object> preview(String owner,JsonNode source,String sheet,String encoding){Map<String,Object> result=parse(owner,source,sheet,encoding);List<?> rows=(List<?>)result.get("rows");result.put("rows",new ArrayList<>(rows.subList(0,Math.min(100,rows.size()))));return result;}
    @SuppressWarnings("unchecked") public JsonNode mappedRows(Map<String,Object> parsed,JsonNode mapping){
        List<String> columns=(List<String>)parsed.get("columns");if(!mapping.isArray()||mapping.isEmpty())throw new ApiException(422,"请配置导入字段映射");
        Set<String> targets=new HashSet<>();for(JsonNode field:mapping){if(!columns.contains(field.path("source").asText())||!targets.add(field.path("target").asText())||field.path("target").asText().isEmpty())throw new ApiException(422,"导入字段映射不存在或目标重复");}
        List<Map<String,Object>> out=new ArrayList<>();int line=1;
        for(List<String> row:(List<List<String>>)parsed.get("rows")){line++;Map<String,Object> item=new LinkedHashMap<>();for(JsonNode field:mapping){String raw=row.get(columns.indexOf(field.path("source").asText()));String type=field.path("type").asText("text");Object value=raw;
                try{if(raw.isEmpty()&&field.path("emptyAsNull").asBoolean())value=null;
                    else if(type.equals("number"))value=new java.math.BigDecimal(raw);
                    else if(type.equals("boolean")){if(!Arrays.asList("true","false","1","0").contains(raw.toLowerCase(Locale.ROOT)))throw new IllegalArgumentException();value=raw.equals("1")||raw.equalsIgnoreCase("true");}
                    else if(!type.equals("text"))throw new IllegalArgumentException();}
                catch(Exception e){throw new ApiException(422,"第 "+line+" 行字段 "+field.path("source").asText()+" 无法转换为所选类型");}item.put(field.path("target").asText(),value);}out.add(item);}
        return json.valueToTree(out);
    }
    @SuppressWarnings("unchecked") public byte[] export(Map<String,Object> result,String format){
        if(Boolean.TRUE.equals(result.get("truncated")))throw new ApiException(413,"结果超过导出行数限制，请缩小范围");
        List<Map<String,Object>> columns=(List<Map<String,Object>>)result.get("columns");List<List<Object>> rows=(List<List<Object>>)result.get("rows");
        try(ByteArrayOutputStream output=new ByteArrayOutputStream()){
            if(format.equals("csv")){
                output.write(new byte[]{(byte)239,(byte)187,(byte)191});try(CSVPrinter printer=new CSVPrinter(new OutputStreamWriter(output,StandardCharsets.UTF_8),CSVFormat.DEFAULT)){
                    List<String> header=new ArrayList<>();for(Map<String,Object> c:columns)header.add(csvSafe(c.get("name").toString()));printer.printRecord(header);for(List<Object> row:rows){List<String> values=new ArrayList<>();for(Object cell:row)values.add(csvSafe(cell==null?"":cell.toString()));printer.printRecord(values);}printer.flush();}
            }else if(format.equals("xlsx")){
                try(Workbook book=new XSSFWorkbook()){Sheet sheet=book.createSheet("数据");Row header=sheet.createRow(0);for(int i=0;i<columns.size();i++)header.createCell(i,CellType.STRING).setCellValue(columns.get(i).get("name").toString());
                    int n=1;for(List<Object> values:rows){Row row=sheet.createRow(n++);for(int i=0;i<values.size();i++)if(values.get(i)!=null)row.createCell(i,CellType.STRING).setCellValue(values.get(i).toString());}book.write(output);}
            }else throw new ApiException(422,"导出格式仅支持 CSV 或 XLSX");
            if(output.size()>settings.fileBytes())throw new ApiException(413,"导出文件超过容量限制，请缩小范围");return output.toByteArray();
        }catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(422,"导出失败，数据中可能包含超长单元格");}
    }
    static String csvSafe(String value){String trimmed=value.replaceFirst("^[\\p{Z}\\s\\uFEFF]+","");return trimmed.matches("(?s)^[=+@-].*")||value.startsWith("\t")||value.startsWith("\r")?"'"+value:value;}
}
