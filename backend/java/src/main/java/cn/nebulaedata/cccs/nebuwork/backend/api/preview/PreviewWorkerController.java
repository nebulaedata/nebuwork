package cn.nebulaedata.cccs.nebuwork.backend.api.preview;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.*;
import java.io.*;

/** Internal worker transport. Every endpoint authenticates its service key AND job lease. */
@RestController @RequestMapping("/internal/file-preview") public class PreviewWorkerController {
    private final FilePreviews service;public PreviewWorkerController(FilePreviews service){this.service=service;}
    private String lease(HttpServletRequest r){service.workerAuth(r.getHeader("Authorization"));return r.getHeader("X-Preview-Lease");}
    @PostMapping("/claim")public Object claim(HttpServletRequest r){service.workerAuth(r.getHeader("Authorization"));return service.claim();}
    @PostMapping("/jobs/{id}/heartbeat")public Object heartbeat(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r){return service.heartbeat(id,lease(r),body);}
    @GetMapping("/jobs/{id}/input")public void input(@PathVariable String id,HttpServletRequest r,HttpServletResponse response)throws IOException{service.input(id,lease(r),response);}
    @PostMapping("/jobs/{id}/outputs")public Object create(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r){return service.outputCreate(id,lease(r),body);}
    @GetMapping("/jobs/{id}/uploads/{upload}")public Object status(@PathVariable String id,@PathVariable String upload,HttpServletRequest r){return service.outputStatus(id,lease(r),upload);}
    @PostMapping(value="/jobs/{id}/uploads/{upload}/parts/{part}",consumes="application/octet-stream")public Object part(@PathVariable String id,@PathVariable String upload,@PathVariable int part,@RequestHeader("X-Part-Sha256")String digest,HttpServletRequest r)throws IOException{return service.outputPart(id,lease(r),upload,part,digest,r.getInputStream(),r.getContentLengthLong());}
    @PostMapping("/jobs/{id}/uploads/{upload}/complete")public Object complete(@PathVariable String id,@PathVariable String upload,HttpServletRequest r){return service.outputComplete(id,lease(r),upload);}
    @PostMapping("/jobs/{id}/finish")public Object finish(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r){return service.finish(id,lease(r),body);}
}
