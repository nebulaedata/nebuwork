package cn.nebulaedata.preview;
import org.apache.poi.xwpf.usermodel.*;
import org.apache.poi.xslf.usermodel.*;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.font.*;
import java.awt.Rectangle;
import java.nio.file.*;
import java.sql.*;
import java.io.*;
import java.util.*;

/** Standalone opt-in format/large-file acceptance; never run against business documents. */
public final class FormatAcceptance {
    static void require(boolean value,String reason){if(!value)throw new IllegalStateException(reason);}
    public static void main(String[] args)throws Exception{
        Path root=Path.of(args.length>0?args[0]:"/work/formats");Files.createDirectories(root);
        if(args.length>1&&args[1].equals("large-csv")){largeCsv(root);return;}
        if(args.length>1&&args[1].equals("large-formats")){largeFormats(root);return;}
        if(args.length>1&&args[1].equals("convert")){for(int i=2;i<args.length;i++){Path source=Path.of(args[i]);String ext=source.toString().substring(source.toString().lastIndexOf('.')+1);Path out=Files.createTempDirectory(root,"converted-");Converter.Result result=Converter.convert(source,ext,out,System.out::println);verifyPages(source,ext,out,result);System.out.println(source.getFileName()+" "+result.manifest());}return;}
        try(XWPFDocument doc=new XWPFDocument()){doc.createParagraph().createRun().setText("React document preview acceptance");doc.createParagraph().createRun().setText("Unique document evidence: total equals 42.");XWPFTable t=doc.createTable(3,2);t.getRow(0).getCell(0).setText("Item");t.getRow(0).getCell(1).setText("Value");t.getRow(1).getCell(0).setText("Leading zeros");t.getRow(1).getCell(1).setText("00123");try(OutputStream out=Files.newOutputStream(root.resolve("source.docx"))){doc.write(out);}}
        try(XMLSlideShow deck=new XMLSlideShow()){for(int n=1;n<=3;n++){XSLFSlide slide=deck.createSlide();XSLFTextBox text=slide.createTextBox();text.setAnchor(new Rectangle(40,50,600,250));text.setText("Slide "+n+"\nUnique slide evidence "+n+"\nTotal equals 42.");}try(OutputStream out=Files.newOutputStream(root.resolve("source.pptx"))){deck.write(out);}}
        for(boolean legacy:new boolean[]{false,true})try(Workbook workbook=legacy?new HSSFWorkbook():new XSSFWorkbook()){
            Sheet s=workbook.createSheet("Data");for(int r=0;r<502;r++){Row row=s.createRow(r);row.createCell(0).setCellValue(String.format("%05d",r));row.createCell(1).setCellValue("Data row "+r);row.createCell(2).setCellValue(r*2);}Sheet second=workbook.createSheet("Summary");second.createRow(0).createCell(0).setCellValue("Total equals 42");try(OutputStream out=Files.newOutputStream(root.resolve(legacy?"source.xls":"source.xlsx"))){workbook.write(out);}
        }
        try(PDDocument document=new PDDocument()){for(int n=1;n<=3;n++){PDPage page=new PDPage();document.addPage(page);try(PDPageContentStream s=new PDPageContentStream(document,page)){s.beginText();s.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA),18);s.newLineAtOffset(40,700);s.showText("Unique PDF page "+n+". Total equals 42.");s.endText();}}document.save(root.resolve("source.pdf").toFile());}
        Files.writeString(root.resolve("source.csv"),"id,name\n001,first\n002,\"two lines\ninside one cell\"\n003,last\n");
        Files.writeString(root.resolve("source.md"),"# Markdown preview\n\nInline $a^2+b^2=c^2$.\n\n$$\\sum_{i=1}^n i=\\frac{n(n+1)}2$$\n\n```javascript\nconst total = 42;\n```\n\n| Item | Value |\n| --- | --- |\n| Leading zeros | 00123 |\n");
        Files.writeString(root.resolve("source.html"),"<!doctype html><html><body><h1>Interactive HTML</h1><button onclick=\"document.querySelector('output').textContent='42'\">Calculate</button><output></output></body></html>");
        System.out.println("Generated valid format fixtures at "+root);
    }
    static void verifyPages(Path source,String ext,Path out,Converter.Result result)throws Exception{
        if(!source.getFileName().toString().startsWith("large.")||!List.of("docx","pptx").contains(ext))return;
        require(result.manifest().path("pageCount").asInt()==32,"32 converted pages");
        try(Connection c=DriverManager.getConnection("jdbc:sqlite:"+out.resolve("index.sqlite"));PreparedStatement q=c.prepareStatement("SELECT text FROM page_text WHERE page=?")){
            for(int page:List.of(1,16,32)){q.setInt(1,page);try(ResultSet rs=q.executeQuery()){require(rs.next(),"indexed page "+page);String text=rs.getString(1).replaceAll("\\s+"," ");require(text.contains((ext.equals("docx")?"Document image ":"Unique slide evidence ")+page),"page content "+page);}}
        }
        System.out.println(source.getFileName()+": first, middle and final PDF pages verified");
    }
    static void largeCsv(Path root)throws Exception{
        Path source=root.resolve("large-2048MiB.csv");byte[] row=new byte[1024*1024];Arrays.fill(row,(byte)'x');row[row.length-1]='\n';
        try(OutputStream out=new BufferedOutputStream(Files.newOutputStream(source),1024*1024)){for(int r=0;r<2048;r++){byte[] prefix=String.format("row%06d,",r).getBytes(java.nio.charset.StandardCharsets.US_ASCII);System.arraycopy(prefix,0,row,0,prefix.length);out.write(row);}}
        require(Files.size(source)==2147483648L,"2 GiB fixture length");Path output=Files.createTempDirectory(root,"large-csv-index-");long started=System.nanoTime();Converter.Result result=Converter.convert(source,"csv",output,System.out::println);require(result.manifest().path("sheets").get(0).path("rowCount").asInt()==2048,"all rows parsed");
        try(Connection c=DriverManager.getConnection("jdbc:sqlite:"+output.resolve("table.sqlite"));Statement s=c.createStatement()){for(int rowNumber:new int[]{0,1024,2047})try(ResultSet rs=s.executeQuery("SELECT value FROM cells WHERE sheet='0' AND r="+rowNumber+" AND c=0")){require(rs.next()&&rs.getString(1).equals(String.format("row%06d",rowNumber)),"random-access row "+rowNumber);}}
        System.out.println("2 GiB CSV acceptance passed: "+result.manifest()+", seconds="+(System.nanoTime()-started)/1_000_000_000+", JVM max heap="+Runtime.getRuntime().maxMemory());
    }
    static void largeFormats(Path root)throws Exception{
        java.util.Random random=new java.util.Random(42);
        try(XWPFDocument doc=new XWPFDocument();XMLSlideShow deck=new XMLSlideShow()){
            doc.createParagraph().createRun().setText("Unique document evidence: total equals 42.");
            for(int n=1;n<=32;n++){
                java.awt.image.BufferedImage image=new java.awt.image.BufferedImage(512,512,java.awt.image.BufferedImage.TYPE_3BYTE_BGR);random.nextBytes(((java.awt.image.DataBufferByte)image.getRaster().getDataBuffer()).getData());ByteArrayOutputStream png=new ByteArrayOutputStream();javax.imageio.ImageIO.write(image,"png",png);byte[] data=png.toByteArray();
                XWPFParagraph paragraph=doc.createParagraph();paragraph.createRun().setText("Document image "+n);paragraph.createRun().addPicture(new ByteArrayInputStream(data),org.apache.poi.xwpf.usermodel.Document.PICTURE_TYPE_PNG,"image"+n+".png",org.apache.poi.util.Units.toEMU(360),org.apache.poi.util.Units.toEMU(360));if(n<32)paragraph.createRun().addBreak(BreakType.PAGE);
                XSLFSlide slide=deck.createSlide();XSLFTextBox title=slide.createTextBox();title.setAnchor(new Rectangle(30,20,650,50));title.setText("Unique slide evidence "+n);slide.createPicture(deck.addPicture(data,org.apache.poi.sl.usermodel.PictureData.PictureType.PNG)).setAnchor(new Rectangle(100,80,320,320));
            }
            try(OutputStream out=Files.newOutputStream(root.resolve("large.docx"))){doc.write(out);}try(OutputStream out=Files.newOutputStream(root.resolve("large.pptx"))){deck.write(out);}
        }
        try(org.apache.poi.xssf.streaming.SXSSFWorkbook book=new org.apache.poi.xssf.streaming.SXSSFWorkbook(100)){Sheet sheet=book.createSheet("Data");for(int r=0;r<65536;r++){Row row=sheet.createRow(r);row.createCell(0).setCellValue(String.format("%05d",r));byte[] entropy=new byte[640];random.nextBytes(entropy);row.createCell(1).setCellValue(Base64.getEncoder().encodeToString(entropy));}try(OutputStream out=Files.newOutputStream(root.resolve("large.xlsx"))){book.write(out);}book.dispose();}
        try(HSSFWorkbook book=new HSSFWorkbook()){Sheet sheet=book.createSheet("Data");for(int r=0;r<3000;r++){Row row=sheet.createRow(r);row.createCell(0).setCellValue(String.format("%05d",r));byte[] entropy=new byte[8000];random.nextBytes(entropy);row.createCell(1).setCellValue(Base64.getEncoder().encodeToString(entropy));}try(OutputStream out=Files.newOutputStream(root.resolve("large.xls"))){book.write(out);}}
        for(String ext:List.of("docx","pptx","xlsx","xls")){long size=Files.size(root.resolve("large."+ext));require(size>20L*1024*1024,"large format must cross browser threshold: "+ext);System.out.println("Valid large "+ext+": "+size+" bytes");}
    }
}
