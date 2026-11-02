package cn.nebulaedata.cccs.nebuwork.backend.api.workbenchservice;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.core.io.ClassPathResource;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.regex.*;
final class ServicePageHtml {
    static String mcp(String html,JsonNode bootstrap){try(InputStream in=new ClassPathResource("workbench-service/page-sdk.js").getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);String sdk=new String(out.toByteArray(),StandardCharsets.UTF_8);String prefix="<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'\"><script>window.__NEBU_SERVICE_BOOTSTRAP__="+bootstrap.toString().replace("<","\\u003c")+";\n"+sdk.replace("</script","<\\/script")+"</script>";Matcher match=Pattern.compile("^(?:\\s|<!--[\\s\\S]*?-->)*(?:<!doctype\\b[^>]*>(?:\\s|<!--[\\s\\S]*?-->)*)?(?:<html\\b[^>]*>(?:\\s|<!--[\\s\\S]*?-->)*)?(?:<head\\b[^>]*>)?",Pattern.CASE_INSENSITIVE).matcher(html);int position=match.find()?match.end():0;return html.substring(0,position)+prefix+html.substring(position);}catch(IOException e){throw new IllegalStateException("页面 SDK 不可用",e);}}
    private ServicePageHtml(){}
}
