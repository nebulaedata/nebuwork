package cn.nebulaedata.preview;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.apache.poi.openxml4j.opc.OPCPackage;
import org.apache.poi.openxml4j.util.ZipSecureFile;
import org.apache.poi.xssf.eventusermodel.*;
import org.apache.poi.xssf.model.SharedStrings;
import org.apache.poi.xssf.usermodel.XSSFRichTextString;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.ss.util.CellReference;
import org.apache.poi.hssf.eventusermodel.*;
import org.apache.poi.hssf.record.*;
import org.apache.poi.hssf.record.Record;
import org.apache.poi.poifs.filesystem.POIFSFileSystem;
import org.apache.commons.csv.*;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.xml.sax.*;
import org.xml.sax.helpers.DefaultHandler;
import javax.xml.parsers.SAXParserFactory;
import java.io.*;
import java.nio.file.*;
import java.nio.charset.*;
import java.sql.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.zip.*;

/** Conversion has no browser state and never evaluates workbook formulae. */
public final class Converter {
    public static final ObjectMapper JSON=new ObjectMapper();
    public record Result(ObjectNode manifest,List<Path> outputs){}
    static XMLReader xml()throws Exception{SAXParserFactory f=SAXParserFactory.newInstance();f.setNamespaceAware(true);f.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);f.setFeature("http://xml.org/sax/features/external-general-entities",false);f.setFeature("http://xml.org/sax/features/external-parameter-entities",false);return f.newSAXParser().getXMLReader();}
    static Connection database(Path path)throws Exception{Connection c=DriverManager.getConnection("jdbc:sqlite:"+path);try(Statement s=c.createStatement()){s.execute("PRAGMA journal_mode=OFF");s.execute("PRAGMA synchronous=OFF");s.execute("PRAGMA temp_store=FILE");}c.setAutoCommit(false);return c;}
    static void validateZip(Path source)throws Exception{try(ZipFile zip=new ZipFile(source.toFile())){long total=0;Enumeration<? extends ZipEntry> es=zip.entries();while(es.hasMoreElements()){ZipEntry entry=es.nextElement();if(entry.getSize()<0||entry.getSize()>32L*1024*1024*1024)throw new IOException("压缩条目大小无效");total=Math.addExact(total,entry.getSize());if(total>32L*1024*1024*1024)throw new IOException("文档解压后超过 32 GiB");}}}
    public static Result convert(Path source,String ext,Path dir,java.util.function.Consumer<String> stage)throws Exception{
        if(Arrays.asList("xlsx","docx","pptx").contains(ext))validateZip(source);
        if(Arrays.asList("xlsx","xls","csv","tsv","tab").contains(ext))return table(source,ext,dir);
        Path pdf=source;boolean original="pdf".equals(ext);
        if(!original){stage.accept("转换 PDF");pdf=office(source,ext,dir);}
        stage.accept("建立页码与文本索引");Path index=dir.resolve("index.sqlite");int count;
        try(PDDocument document=Loader.loadPDF(pdf.toFile());Connection c=database(index);Statement s=c.createStatement()){
            s.execute("CREATE TABLE IF NOT EXISTS page_text(page INTEGER PRIMARY KEY,text TEXT NOT NULL)");count=document.getNumberOfPages();if(count==0)throw new IOException("文档没有可预览页面");PDFTextStripper stripper=new PDFTextStripper();
            try(PreparedStatement put=c.prepareStatement("INSERT INTO page_text(page,text) VALUES(?,?)")){
            for(int page=1;page<=count;page++){if(Thread.currentThread().isInterrupted())throw new InterruptedIOException();stripper.setStartPage(page);stripper.setEndPage(page);String text=stripper.getText(document);if(text.length()>8*1024*1024)throw new IOException("单页文本超过处理限额");put.setInt(1,page);put.setString(2,text);put.executeUpdate();if(page%100==0)c.commit();}c.commit();}
        }
        ObjectNode manifest=JSON.createObjectNode().put("kind",original?"indexed-pdf":"pdf").put("pageCount",count).put("renderer","libreoffice-pdfbox-v1");
        if(ext.equals("pptx")){final int[] slides={0};try(ZipFile zip=new ZipFile(source.toFile());InputStream in=zip.getInputStream(zip.getEntry("ppt/presentation.xml"))){XMLReader r=xml();r.setContentHandler(new DefaultHandler(){public void startElement(String u,String l,String q,Attributes a){if(l.equals("sldId"))slides[0]++;}});r.parse(new InputSource(in));}manifest.put("slideMappingExact",slides[0]==count);}
        return new Result(manifest,original?List.of(index):List.of(pdf,index));
    }
    static Path office(Path source,String ext,Path dir)throws Exception{
        Path profile=dir.resolve("profile/user"),out=dir.resolve("office");Files.createDirectories(profile);Files.createDirectories(out);
        Files.writeString(profile.resolve("registrymodifications.xcu"),"<?xml version=\"1.0\"?><oor:items xmlns:oor=\"http://openoffice.org/2001/registry\"><item oor:path=\"/org.openoffice.Office.Common/Security/Scripting\"><prop oor:name=\"MacroSecurityLevel\" oor:op=\"fuse\"><value>3</value></prop></item><item oor:path=\"/org.openoffice.Office.Common/Load\"><prop oor:name=\"UpdateLinkMode\" oor:op=\"fuse\"><value>0</value></prop></item></oor:items>");
        List<String> command=new ArrayList<>();if("true".equals(System.getenv("PREVIEW_CONVERTER_ISOLATED"))){new ProcessBuilder("chown","-R","10002:10002",dir.toString()).inheritIO().start().waitFor();command.addAll(List.of("setpriv","--reuid=10002","--regid=10002","--clear-groups","--no-new-privs"));}
        command.addAll(List.of(System.getenv().getOrDefault("LIBREOFFICE_BIN","soffice"),"-env:UserInstallation="+dir.resolve("profile").toUri(),"--headless","--nologo","--nodefault","--nofirststartwizard","--convert-to",ext.equals("pptx")?"pdf:impress_pdf_Export:{\"ExportHiddenSlides\":{\"type\":\"boolean\",\"value\":\"true\"}}":"pdf:writer_pdf_Export","--outdir",out.toString(),source.toString()));
        ProcessBuilder builder=new ProcessBuilder(command).redirectErrorStream(true).redirectOutput(dir.resolve("converter.log").toFile());builder.environment().clear();builder.environment().put("PATH","/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");builder.environment().put("HOME",dir.toString());builder.environment().put("LANG","C.UTF-8");Process p=builder.start();
        try{if(!p.waitFor(Math.max(1000,Long.parseLong(System.getenv().getOrDefault("PREVIEW_TIMEOUT_MS","3600000"))-30000),TimeUnit.MILLISECONDS)||p.exitValue()!=0)throw new IOException("Office 转换失败或超时");}finally{if(p.isAlive()){p.descendants().forEach(ProcessHandle::destroyForcibly);p.destroyForcibly();}}
        Path converted=out.resolve(source.getFileName().toString().replaceFirst("\\.[^.]+$","")+".pdf");if(!Files.isRegularFile(converted)||Files.size(converted)==0)throw new IOException("未生成 PDF 预览");Path result=dir.resolve("document.pdf");Files.move(converted,result,StandardCopyOption.REPLACE_EXISTING);return result;
    }
    static final class Cells implements AutoCloseable{
        final Connection c;final PreparedStatement put;final ArrayNode sheets=JSON.createArrayNode();int sheet=-1,colCount,pending;long rowCount;String sheetId;
        Cells(Path file)throws Exception{c=database(file);try(Statement s=c.createStatement()){s.execute("CREATE TABLE cells(sheet TEXT NOT NULL,r INTEGER NOT NULL,c INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(sheet,r,c)) WITHOUT ROWID");s.execute("CREATE TABLE strings(id INTEGER PRIMARY KEY,value TEXT NOT NULL)");}put=c.prepareStatement("INSERT OR REPLACE INTO cells VALUES(?,?,?,?)");}
        void sheet(String name)throws SQLException{endSheet();sheetId=String.valueOf(++sheet);sheets.addObject().put("id",sheetId).put("name",name);rowCount=colCount=0;}
        void row(long row){rowCount=Math.max(rowCount,row+1);}
        void cell(long row,int col,String value)throws SQLException{if(row<0||col<0)throw new SQLException("无效单元格坐标");row(row);colCount=Math.max(colCount,col+1);if(value==null||value.isEmpty())return;if(value.length()>16*1024*1024)throw new SQLException("单元格文本过长");put.setString(1,sheetId);put.setLong(2,row);put.setInt(3,col);put.setString(4,value);put.executeUpdate();if(++pending%10000==0)c.commit();}
        void endSheet(){if(sheet>=0)((ObjectNode)sheets.get(sheet)).put("rowCount",rowCount).put("columnCount",colCount);}
        String string(int index)throws SQLException{try(PreparedStatement q=c.prepareStatement("SELECT value FROM strings WHERE id=?")){q.setInt(1,index);try(ResultSet rs=q.executeQuery()){return rs.next()?rs.getString(1):"";}}}
        void string(int index,String value)throws SQLException{try(PreparedStatement q=c.prepareStatement("INSERT OR REPLACE INTO strings VALUES(?,?)")){q.setInt(1,index);q.setString(2,value);q.executeUpdate();}}
        public void close()throws SQLException{endSheet();try(Statement s=c.createStatement()){s.execute("DROP TABLE strings");}c.commit();put.close();c.close();}
    }
    static Result table(Path source,String ext,Path dir)throws Exception{
        Path index=dir.resolve("table.sqlite");ArrayNode sheets;
        try(Cells cells=new Cells(index)){if(ext.equals("xlsx"))xlsx(source,cells);else if(ext.equals("xls"))xls(source,cells);else csv(source,ext,cells);cells.endSheet();sheets=cells.sheets.deepCopy();}
        ObjectNode manifest=JSON.createObjectNode().put("kind","table").put("renderer","poi-event-csv-v1");manifest.set("sheets",sheets);return new Result(manifest,List.of(index));
    }
    /** Reject oversized fields/records before Commons CSV can accumulate them. */
    static final class BoundedCsvReader extends FilterReader{
        final char delimiter;boolean quoted;long field,record;int columns;
        BoundedCsvReader(Reader input,char delimiter){super(input);this.delimiter=delimiter;}
        private void check(int ch)throws IOException{if(ch<0)return;if(ch=='"')quoted=!quoted;if(!quoted&&(ch==delimiter||ch=='\n'||ch=='\r')){field=0;if(ch==delimiter){if(++columns>16384)throw new IOException("CSV 每行超过 16384 列处理限额");}else{record=0;columns=0;}}else if(++field>16L*1024*1024)throw new IOException("CSV 单元格超过 16 MiB 处理限额");if(++record>32L*1024*1024)throw new IOException("CSV 单行超过 32 MiB 处理限额");}
        @Override public int read()throws IOException{int ch=in.read();check(ch);return ch;}
        @Override public int read(char[] chars,int offset,int length)throws IOException{int count=in.read(chars,offset,length);for(int i=0;i<count;i++)check(chars[offset+i]);return count;}
    }
    static void csv(Path source,String ext,Cells cells)throws Exception{
        Charset encoding=StandardCharsets.UTF_8;try(Reader r=new InputStreamReader(new BufferedInputStream(Files.newInputStream(source),1024*1024),StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT))){char[] b=new char[65536];while(r.read(b)!=-1){}}catch(CharacterCodingException e){encoding=Charset.forName("GB18030");}
        cells.sheet("Sheet1");try(Reader input=new InputStreamReader(new BufferedInputStream(Files.newInputStream(source),1024*1024),encoding);PushbackReader reader=new PushbackReader(new BoundedCsvReader(input,ext.equals("csv")?',':'\t'),1)){int first=reader.read();if(first!=-1&&first!='\ufeff')reader.unread(first);CSVFormat format=CSVFormat.DEFAULT.builder().setDelimiter(ext.equals("csv")?',':'\t').setIgnoreEmptyLines(false).get();try(CSVParser parser=format.parse(reader)){long row=0;for(CSVRecord record:parser){if(Thread.currentThread().isInterrupted())throw new InterruptedIOException();for(int col=0;col<record.size();col++)cells.cell(row,col,record.get(col));cells.row(row++);}}}
    }
    static void xlsx(Path source,Cells cells)throws Exception{
        ZipSecureFile.setMaxEntrySize(32L*1024*1024*1024);ZipSecureFile.setMinInflateRatio(.00001);
        try(OPCPackage pkg=OPCPackage.open(source.toFile(),org.apache.poi.openxml4j.opc.PackageAccess.READ)){
            XSSFReader book=new XSSFReader(pkg);int[] count={0};
            try(InputStream strings=book.getSharedStringsData()){if(strings!=null){XMLReader r=xml();r.setContentHandler(new DefaultHandler(){StringBuilder value;boolean text;public void startElement(String u,String l,String q,Attributes a){if(l.equals("si"))value=new StringBuilder();if(l.equals("t"))text=true;}public void characters(char[] c,int s,int n)throws SAXException{if(text&&value!=null){value.append(c,s,n);if(value.length()>16*1024*1024)throw new SAXException("共享字符串过长");}}public void endElement(String u,String l,String q)throws SAXException{if(l.equals("t"))text=false;if(l.equals("si"))try{cells.string(count[0]++,value.toString());}catch(SQLException e){throw new SAXException(e);}}});r.parse(new InputSource(strings));cells.c.commit();}}
            SharedStrings strings=new SharedStrings(){public RichTextString getItemAt(int i){try{return new XSSFRichTextString(cells.string(i));}catch(SQLException e){throw new IllegalStateException(e);}}public int getCount(){return count[0];}public int getUniqueCount(){return count[0];}};
            XSSFReader.SheetIterator iterator=(XSSFReader.SheetIterator)book.getSheetsData();while(iterator.hasNext())try(InputStream in=iterator.next()){
                cells.sheet(iterator.getSheetName());XMLReader reader=xml();reader.setContentHandler(new XSSFSheetXMLHandler(book.getStylesTable(),null,strings,new XSSFSheetXMLHandler.SheetContentsHandler(){int row;public void startRow(int r){row=r;cells.row(r);}public void endRow(int r){}public void cell(String ref,String value,org.apache.poi.xssf.usermodel.XSSFComment comment){try{cells.cell(row,ref==null?0:new CellReference(ref).getCol(),value);}catch(SQLException e){throw new IllegalStateException(e);}}public void headerFooter(String t,boolean h,String tag){}},new DataFormatter(Locale.ROOT),false));reader.parse(new InputSource(in));}
        }
    }
    static void xls(Path source,Cells cells)throws Exception{
        try(POIFSFileSystem fs=new POIFSFileSystem(source.toFile(),true)){
            List<String> names=new ArrayList<>();final int[] sheet={-1};final int[] formula={-1,-1};final FormatTrackingHSSFListener[] formats=new FormatTrackingHSSFListener[1];
            HSSFListener listener=record->{try{
                if(record instanceof BoundSheetRecord b)names.add(b.getSheetname());
                else if(record instanceof SSTRecord sst){for(int i=0;i<sst.getNumUniqueStrings();i++)cells.string(i,sst.getString(i).getString());}
                else if(record instanceof BOFRecord b&&b.getType()==BOFRecord.TYPE_WORKSHEET){sheet[0]++;cells.sheet(sheet[0]<names.size()?names.get(sheet[0]):"Sheet"+(sheet[0]+1));}
                else if(sheet[0]>=0){if(record instanceof LabelSSTRecord v)cells.cell(v.getRow(),v.getColumn(),cells.string(v.getSSTIndex()));else if(record instanceof NumberRecord v)cells.cell(v.getRow(),v.getColumn(),formats[0].formatNumberDateCell(v));else if(record instanceof RKRecord v)cells.cell(v.getRow(),v.getColumn(),Double.toString(v.getRKNumber()));else if(record instanceof MulRKRecord v){for(int i=0;i<v.getNumColumns();i++)cells.cell(v.getRow(),v.getFirstColumn()+i,Double.toString(v.getRKNumberAt(i)));}else if(record instanceof LabelRecord v)cells.cell(v.getRow(),v.getColumn(),v.getValue());else if(record instanceof FormulaRecord v){if(v.hasCachedResultString()){formula[0]=v.getRow();formula[1]=v.getColumn();}else if(v.getCachedResultTypeEnum()==org.apache.poi.ss.usermodel.CellType.BOOLEAN)cells.cell(v.getRow(),v.getColumn(),v.getCachedBooleanValue()?"TRUE":"FALSE");else if(v.getCachedResultTypeEnum()==org.apache.poi.ss.usermodel.CellType.ERROR)cells.cell(v.getRow(),v.getColumn(),org.apache.poi.ss.usermodel.FormulaError.forInt(v.getCachedErrorValue()).getString());else cells.cell(v.getRow(),v.getColumn(),formats[0].formatNumberDateCell(v));}else if(record instanceof StringRecord v&&formula[0]>=0){cells.cell(formula[0],formula[1],v.getString());formula[0]=-1;}else if(record instanceof BoolErrRecord v)cells.cell(v.getRow(),v.getColumn(),v.isBoolean()?Boolean.toString(v.getBooleanValue()):"#ERROR");}
            }catch(SQLException e){throw new IllegalStateException(e);}};
            formats[0]=new FormatTrackingHSSFListener(listener);
            // HSSFEventFactory retains the entire SSTRecord. Consume its strings one at a time instead.
            try(InputStream input=fs.createDocumentInputStream(fs.getRoot().hasEntry("Workbook")?"Workbook":"Book")){
                RecordInputStream records=new RecordInputStream(input);
                while(records.hasNextRecord()){
                    if(Thread.currentThread().isInterrupted())throw new InterruptedIOException();records.nextRecord();
                    if(records.getSid()==SSTRecord.sid){records.readInt();int unique=records.readInt();if(unique<0)throw new IOException("共享字符串数量无效");for(int i=0;i<unique;i++)cells.string(i,new org.apache.poi.hssf.record.common.UnicodeString(records).getString());cells.c.commit();}
                    else for(Record record:RecordFactory.createRecord(records))formats[0].processRecord(record);
                }
            }
        }
    }
}
