package cn.nebulaedata.cccs.nebuwork.backend.api.agent;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** Disposable HTTP/SQL browser fixture. Never included in the application JAR. */
@EnabledIfEnvironmentVariable(named="NEBU_SERVICE_BROWSER_ACCEPTANCE",matches="1")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.DEFINED_PORT,properties={
 "server.port=42024","spring.datasource.url=jdbc:h2:mem:servicebrowser;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
 "spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=",
 "spring.cloud.nacos.config.enabled=false","spring.cloud.nacos.discovery.enabled=false","nebu.seed-enabled=false",
 "nebu.models.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","nebu.knowledge.admin-ids=admin",
 "nebu.knowledge.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","nebu.agent.base-url=http://engine.invalid",
 "nebu.agent.signing-key=12345678901234567890123456789012","nebu.agent.callback-key=callback-key-1234567890123456789012","nebu.agent.namespace=nebuwork-v2"})
@TestPropertySource(properties={"nebu.workbench-services.enabled=true","nebu.workbench-services.polling-enabled=false","nebu.workbench-services.public-base-url=http://127.0.0.1:5174/nebulaedev/nwaa","nebu.workbench-services.frontend-url=http://127.0.0.1:5174","nebu.platform-mcp.url=http://127.0.0.1:42225/mcp","nebu.platform-mcp.service-key=service-browser-protocol-key-123456789012345","nebu.auth.allowed-origins=http://127.0.0.1:5174"})
class WorkbenchServiceBrowserHostTest extends AgentIntegrationTest {
    @Test void serveUntilExternalAssertionsFinish()throws Exception{
        String wb=workbench(),project=project(wb);
        String html="<!doctype html><html lang=zh-CN><meta charset=utf-8><title>项目交互看板</title><style>body{font:16px system-ui;padding:24px;color:#302b43}h1{font-size:25px}section{border:1px solid #ded9ec;border-radius:12px;padding:20px;margin:20px 0}input,button{font:inherit;padding:10px;border:1px solid #c9c1df;border-radius:8px}button{background:#7253d7;color:white;cursor:pointer}label{display:block;margin:12px 0}#error{color:#b42318}</style><h1>项目交互看板</h1><p>数据来自平台业务接口，设置保存到页面实例。</p><section><p>当前项目：<b id=name>读取中…</b></p><p>数据版本：<b id=version>—</b></p><label>项目名称 <input id=rename></label><button id=save>保存项目名称</button><p id=event></p></section><section><label>我的筛选条件 <input id=filter></label><button id=saveState>保存页面设置</button><p id=stateStatus></p></section><p id=error role=alert></p><script>let project,stateRevision;const api=window.NebuService;async function refresh(){try{const o=await api.invoke('overview',{});if(o.status!=='succeeded')throw Error(o.error||o.status);project=o.result;document.getElementById('name').textContent=project.name;document.getElementById('version').textContent=project.revision;document.getElementById('rename').value=project.name;document.getElementById('error').textContent='';}catch(e){document.getElementById('error').textContent=e.message;}}api.ready().then(async c=>{stateRevision=c.revision;document.getElementById('filter').value=c.state.filter||'';await refresh();});api.on('refresh',refresh);document.getElementById('save').onclick=async()=>{try{const o=await api.invoke('rename',{revision:project.revision,name:document.getElementById('rename').value});api.subscribe(o.id,e=>{document.getElementById('event').textContent='执行事件：'+e.status;});if(o.status==='succeeded')await refresh();else throw Error(o.error||o.status);}catch(e){document.getElementById('error').textContent=e.message;}};document.getElementById('saveState').onclick=async()=>{try{const r=await api.state.save({filter:document.getElementById('filter').value},stateRevision);stateRevision=r.revision;document.getElementById('stateStatus').textContent='设置已保存，版本 '+r.revision;}catch(e){document.getElementById('error').textContent=e.message;}};</script></html>";
        JsonNode asset=data(postJson("/api/workbenches/"+wb+"/service/assets",map("html",html)),"alice");
        List<Object> capabilities=new ArrayList<>();for(String key:Arrays.asList("overview","rename"))capabilities.add(map("key",key,"name",key.equals("overview")?"查询项目":"更新项目","inputSchema",map("type","object"),"outputSchema",map("type","object"),"projectIds",Collections.singletonList(project),"channels",map("api",true,"mcp",true,"page",true),"binding",map("type","platform","operation",key.equals("overview")?"project.get":"project.update"),"pageKey","board"));
        Object definition=map("name","项目服务验收","description","隔离数据库中的真实业务调用","capabilities",capabilities,"pages",Collections.singletonList(map("key","board","name","项目交互看板","assetId",asset.path("id"),"capabilities",Arrays.asList("overview","rename"),"refreshSeconds",5)));
        data(postJson("/api/workbenches/"+wb+"/service",map("revision",0,"definition",definition)),"alice");JsonNode release=data(postJson("/api/workbenches/"+wb+"/service/publish",map("revision",1)),"alice");
        Map<String,Object> metadata=map("workbenchId",wb,"projectId",project,"releaseId",release.path("id"),"workbenchUrl","http://127.0.0.1:5174/#/workbench?tab=pro&id="+wb,"pageUrl","http://127.0.0.1:5174/nebulaedev/nwaa/api/workbench-services/"+wb+"/pages/board?projectId="+project);
        Files.write(Paths.get(System.getProperty("nebu.service.acceptance.metadata")),json.writeValueAsBytes(metadata));
        Path done=Paths.get(System.getProperty("nebu.service.acceptance.done"));long deadline=System.currentTimeMillis()+15*60*1000;
        while(!Files.exists(done)&&System.currentTimeMillis()<deadline)Thread.sleep(250);
        assertTrue(Files.exists(done),"Browser acceptance did not finish");
    }
}
