package cn.nebulaedata.preview;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.font.*;
import java.nio.file.*;
import java.sql.*;
import java.io.*;
import static org.junit.jupiter.api.Assertions.*;

class ConverterTest {
    @TempDir Path dir;
    String value(Path file,String sql)throws Exception{try(Connection c=DriverManager.getConnection("jdbc:sqlite:"+file);Statement s=c.createStatement();ResultSet r=s.executeQuery(sql)){assertTrue(r.next());return r.getString(1);}}
    @Test void csvPreservesLeadingZerosQuotedNewlinesAndUnicode()throws Exception{
        Path source=dir.resolve("source.csv");Files.writeString(source,"编号,说明\n001,\"多行\n说明\"\n002,最后一行\n");Converter.Result result=Converter.convert(source,"csv",dir,s->{});
        assertEquals(3,result.manifest().path("sheets").get(0).path("rowCount").asInt());assertEquals("001",value(dir.resolve("table.sqlite"),"SELECT value FROM cells WHERE r=1 AND c=0"));assertEquals("多行\n说明",value(dir.resolve("table.sqlite"),"SELECT value FROM cells WHERE r=1 AND c=1"));
    }
    @Test void bothExcelFormatsPreserveNamesCoordinatesAndCachedFormulaValues()throws Exception{
        for(boolean legacy:new boolean[]{false,true}){Path folder=Files.createDirectory(dir.resolve(legacy?"xls":"xlsx")),source=folder.resolve("source."+(legacy?"xls":"xlsx"));
            try(Workbook book=legacy?new HSSFWorkbook():new XSSFWorkbook()){Sheet sheet=book.createSheet("数据");sheet.createRow(0).createCell(0).setCellValue("001");Cell formula=sheet.createRow(3).createCell(2);formula.setCellFormula("1+2");book.getCreationHelper().createFormulaEvaluator().evaluateFormulaCell(formula);book.createSheet("空工作表");try(OutputStream out=Files.newOutputStream(source)){book.write(out);}}
            Converter.Result result=Converter.convert(source,legacy?"xls":"xlsx",folder,s->{});assertEquals(2,result.manifest().path("sheets").size());assertEquals("数据",result.manifest().path("sheets").get(0).path("name").asText());assertEquals(4,result.manifest().path("sheets").get(0).path("rowCount").asInt());assertEquals("001",value(folder.resolve("table.sqlite"),"SELECT value FROM cells WHERE sheet='0' AND r=0 AND c=0"));assertEquals("3",value(folder.resolve("table.sqlite"),"SELECT value FROM cells WHERE sheet='0' AND r=3 AND c=2"));
        }
    }
    @Test void pdfIndexUsesActualPageNumbers()throws Exception{
        Path source=dir.resolve("source.pdf");try(PDDocument document=new PDDocument()){for(int i=1;i<=3;i++){PDPage page=new PDPage();document.addPage(page);try(PDPageContentStream stream=new PDPageContentStream(document,page)){stream.beginText();stream.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA),12);stream.newLineAtOffset(30,700);stream.showText("unique-page-"+i);stream.endText();}}document.save(source.toFile());}
        Converter.Result result=Converter.convert(source,"pdf",dir,s->{});assertEquals("indexed-pdf",result.manifest().path("kind").asText());assertEquals(3,result.manifest().path("pageCount").asInt());assertTrue(value(dir.resolve("index.sqlite"),"SELECT text FROM page_text WHERE page=2").contains("unique-page-2"));
    }
    @Test void externalEntitiesAreRejected()throws Exception{assertThrows(Exception.class,()->Converter.xml().parse(new org.xml.sax.InputSource(new StringReader("<!DOCTYPE root [<!ENTITY leak SYSTEM 'file:///etc/passwd'>]><root>&leak;</root>"))));}
    @Test void csvRejectsUnboundedCellsBeforeTheParserRetainsTheEntireField()throws Exception{
        Reader synthetic=new Reader(){long left=17L*1024*1024;public int read(char[] chars,int offset,int length){if(left==0)return -1;int n=(int)Math.min(left,length);java.util.Arrays.fill(chars,offset,offset+n,'x');left-=n;return n;}public void close(){}};
        try(Reader bounded=new Converter.BoundedCsvReader(synthetic,',')){char[] chunk=new char[8192];assertThrows(IOException.class,()->{while(bounded.read(chunk)!=-1){}});}
    }
}
