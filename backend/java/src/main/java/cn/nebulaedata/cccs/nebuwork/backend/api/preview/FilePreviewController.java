package cn.nebulaedata.cccs.nebuwork.backend.api.preview;
import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.*;
import java.io.IOException;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;

@RestController @RequestMapping("/api/file-previews") public class FilePreviewController {
    private final FilePreviews previews;private final org.springframework.core.env.Environment env;public FilePreviewController(FilePreviews previews,org.springframework.core.env.Environment env){this.previews=previews;this.env=env;}
    @GetMapping("/capabilities")public Object capabilities(HttpServletRequest r){RequestIdentity.actor(r);return ok(java.util.Collections.singletonMap("enabled",env.getProperty("nebu.files.enabled",Boolean.class,false)));}
    @PostMapping public Object create(@RequestBody JsonNode body,HttpServletRequest r){return ok(previews.create(RequestIdentity.actor(r),body));}
    @GetMapping("/{id}")public Object status(@PathVariable String id,HttpServletRequest r){return ok(previews.status(RequestIdentity.actor(r),id));}
    @PostMapping("/{id}/{action:retry|cancel}")public Object action(@PathVariable String id,@PathVariable String action,HttpServletRequest r){return ok(previews.action(RequestIdentity.actor(r),id,action));}
    @GetMapping("/{id}/content")public void content(@PathVariable String id,HttpServletRequest r,HttpServletResponse response)throws IOException{previews.content(RequestIdentity.actor(r),id,r.getHeader("Range"),response);}
    @GetMapping("/{id}/download")public void download(@PathVariable String id,HttpServletRequest r,HttpServletResponse response)throws IOException{previews.download(RequestIdentity.actor(r),id,response);}
    @GetMapping("/{id}/sheets/{sheet}/cell")public Object cell(@PathVariable String id,@PathVariable String sheet,@RequestParam long row,@RequestParam int column,@RequestParam(defaultValue="0")int start,HttpServletRequest r,HttpServletResponse response)throws Exception{return ok(previews.cell(RequestIdentity.actor(r),id,sheet,row,column,start,response));}
    @GetMapping("/{id}/sheets/{sheet}/rows")public Object rows(@PathVariable String id,@PathVariable String sheet,@RequestParam(defaultValue="0")long row,@RequestParam(defaultValue="0")int column,@RequestParam(defaultValue="200")int limit,@RequestParam(defaultValue="50")int columns,HttpServletRequest r,HttpServletResponse response)throws Exception{return ok(previews.rows(RequestIdentity.actor(r),id,sheet,row,column,limit,columns,response));}
    @PostMapping("/{id}/locate")public Object locate(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r,HttpServletResponse response)throws Exception{return ok(previews.locate(RequestIdentity.actor(r),id,body,response));}
}
