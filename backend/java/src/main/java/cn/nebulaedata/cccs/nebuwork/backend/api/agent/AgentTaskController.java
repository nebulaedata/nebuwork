package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.*;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import javax.annotation.PreDestroy;
import javax.servlet.http.*;
import java.io.IOException;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;

@RestController @RequestMapping("/api")
public class AgentTaskController {
    private final AgentTasks tasks;private final AgentClient engine;private final SessionFilter authentication;
    private final ScheduledExecutorService streams=Executors.newScheduledThreadPool(8,r->{Thread t=new Thread(r,"agent-event-relay");t.setDaemon(true);return t;});
    public AgentTaskController(AgentTasks tasks,AgentClient engine,SessionFilter authentication){this.tasks=tasks;this.engine=engine;this.authentication=authentication;}
    @PreDestroy public void close(){streams.shutdownNow();}
    @GetMapping("/projects/{project}/tasks") public Object list(@PathVariable String project,HttpServletRequest r){return ok(tasks.list(RequestIdentity.actor(r),project));}
    @PostMapping("/projects/{project}/tasks") public Object create(@PathVariable String project,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){return ok(tasks.create(RequestIdentity.actor(r),project,body,key));}
    @GetMapping("/tasks/{task}") public Object detail(@PathVariable String task,HttpServletRequest r){return ok(tasks.detail(RequestIdentity.actor(r),task));}
    @PostMapping("/tasks/{task}") public Object edit(@PathVariable String task,@RequestBody JsonNode body,HttpServletRequest r){return ok(tasks.edit(RequestIdentity.actor(r),task,body));}
    @GetMapping("/tasks/{task}/runs") public Object runs(@PathVariable String task,HttpServletRequest r){return ok(tasks.runs(RequestIdentity.actor(r),task));}
    @PostMapping("/tasks/{task}/runs") public Object send(@PathVariable String task,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){return ok(tasks.send(RequestIdentity.actor(r),task,body,key));}
    @GetMapping("/tasks/{task}/runs/{run}") public Object run(@PathVariable String task,@PathVariable String run,HttpServletRequest r){return ok(tasks.run(RequestIdentity.actor(r),task,run));}
    @GetMapping("/tasks/{task}/experts/{run}") public Object expert(@PathVariable String task,@PathVariable String run,HttpServletRequest r){return ok(tasks.expert(RequestIdentity.actor(r),task,run));}
    @PostMapping("/tasks/{task}/runs/{run}/commands") public Object command(@PathVariable String task,@PathVariable String run,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){return ok(tasks.command(RequestIdentity.actor(r),task,run,body,key));}
    @GetMapping("/tasks/{task}/history") public Object history(@PathVariable String task,@RequestParam(defaultValue="0") long after,HttpServletRequest r){return ok(tasks.events(RequestIdentity.actor(r),task,after));}
    @GetMapping("/projects/{project}/artifacts") public Object artifacts(@PathVariable String project,HttpServletRequest r){return ok(tasks.artifacts(RequestIdentity.actor(r),project));}
    @GetMapping("/projects/{project}/artifacts/{artifact}") public Object artifact(@PathVariable String project,@PathVariable String artifact,@RequestParam(required=false) Integer version,HttpServletRequest r){String owner=RequestIdentity.actor(r);tasks.project(owner,project,false);return ok(engine.get(owner,project,"/v1/artifacts/"+AgentClient.segment(artifact)+(version==null?"":"?version="+version)));}
    @GetMapping("/projects/{project}/artifacts/{artifact}/versions") public Object versions(@PathVariable String project,@PathVariable String artifact,HttpServletRequest r){String owner=RequestIdentity.actor(r);tasks.project(owner,project,false);return ok(engine.get(owner,project,"/v1/artifacts/"+AgentClient.segment(artifact)+"/versions"));}
    @PostMapping("/projects/{project}/artifacts") public Object upload(@PathVariable String project,@RequestParam(required=false) String taskId,@RequestParam("file") MultipartFile file,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r)throws IOException{return ok(tasks.upload(RequestIdentity.actor(r),project,taskId,file,key));}
    @GetMapping("/projects/{project}/artifacts/{artifact}/content") public void content(@PathVariable String project,@PathVariable String artifact,@RequestParam(required=false) Integer version,HttpServletRequest r,HttpServletResponse response)throws IOException{String owner=RequestIdentity.actor(r);tasks.project(owner,project,false);engine.content(owner,project,artifact,version,r.getHeader("Range"),r.getHeader("If-None-Match"),response);}
    @PostMapping("/tasks/{task}/session-grants") public Object grant(@PathVariable String task,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){return ok(tasks.grant(RequestIdentity.actor(r),body.path("sourceTaskId").asText(),task,body.path("beforeSequence").asLong(),key));}
    @GetMapping(value="/tasks/{task}/events",produces="text/event-stream")
    public SseEmitter events(@PathVariable String task,@RequestParam(defaultValue="0") long after,@RequestHeader(value="Last-Event-ID",required=false) String last,HttpServletRequest r,HttpServletResponse response){
        String owner=RequestIdentity.actor(r);tasks.owned(owner,task);long initial=Math.max(0,after);try{if(last!=null)initial=Math.max(initial,Long.parseLong(last));}catch(NumberFormatException ignored){}
        response.setHeader("X-Accel-Buffering","no");response.setHeader("Cache-Control","no-store");SseEmitter emitter=new SseEmitter(60000L);AtomicBoolean ended=new AtomicBoolean();long[] cursor={initial},heartbeat={0};long opened=System.currentTimeMillis();
        emitter.onCompletion(()->ended.set(true));emitter.onTimeout(()->{ended.set(true);emitter.complete();});emitter.onError(e->ended.set(true));final ScheduledFuture<?>[] job=new ScheduledFuture<?>[1];
        job[0]=streams.scheduleWithFixedDelay(()->{if(ended.get()){if(job[0]!=null)job[0].cancel(false);return;}try{long now=System.currentTimeMillis();if(now-heartbeat[0]>15000){if(!authentication.stillAuthenticated(r,owner)){emitter.send(SseEmitter.event().name("auth.expired").data("{}"));emitter.complete();return;}heartbeat[0]=now;emitter.send(SseEmitter.event().comment("keepalive"));}for(JsonNode event:tasks.events(owner,task,cursor[0]).path("items")){emitter.send(SseEmitter.event().id(event.path("sequence").asText()).name(event.path("type").asText()).data(event));cursor[0]=event.path("sequence").asLong();}if(now-opened>55000)emitter.complete();}catch(Exception error){emitter.completeWithError(error);}},0,500,TimeUnit.MILLISECONDS);
        return emitter;
    }
}
