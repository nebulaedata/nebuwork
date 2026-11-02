package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.sun.net.httpserver.*;
import org.junit.jupiter.api.*;
import org.springframework.mock.env.MockEnvironment;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

/** Local protocol fixture only, started by the test runner; no production MCP or core access. */
class KnowledgeMcpClientTest {
    final ObjectMapper json=new ObjectMapper();
    HttpServer server;ExecutorService executor;KnowledgeMcpClient client;NebulaeV1HttpDriver driver;MockEnvironment environment;
    String endpoint;boolean sse,session,toolError,rpcError,outside,empty,missingTool;
    JsonNode collectionFixture;boolean documentToolError,partialDocuments;
    int failStatus,failCount,delay;AtomicInteger failures=new AtomicInteger(),deletes=new AtomicInteger();
    List<JsonNode> requests=new CopyOnWriteArrayList<>();
    List<String> cookies=new CopyOnWriteArrayList<>();
    @BeforeEach void setup() throws Exception {
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        executor=Executors.newCachedThreadPool();server.setExecutor(executor);
        endpoint="http://127.0.0.1:"+server.getAddress().getPort()+"/mcp/common-knowledge";
        environment=new MockEnvironment().withProperty("nebu.knowledge.internal-allowlist-enabled","true").withProperty("nebu.knowledge.allowed-internal-origins","http://127.0.0.1:"+server.getAddress().getPort());
        client=new KnowledgeMcpClient(json,environment,new KnowledgeNetworkPolicy(environment));driver=new NebulaeV1HttpDriver(client,json);
        server.createContext("/mcp/common-knowledge",this::handle);server.start();
    }
    @AfterEach void close(){if(client!=null)client.close();if(server!=null)server.stop(0);if(executor!=null)executor.shutdownNow();}
    void send(HttpExchange exchange,int status,String type,String body)throws IOException {
        byte[] bytes=body.getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type",type);
        exchange.sendResponseHeaders(status,bytes.length==0?-1:bytes.length);
        if(bytes.length>0)exchange.getResponseBody().write(bytes);exchange.close();
    }
    void handle(HttpExchange e)throws IOException {
        if(!"POST".equals(e.getRequestMethod())){deletes.incrementAndGet();send(e,405,"text/plain","");return;}
        JsonNode request=json.readTree(e.getRequestBody());requests.add(request);
        cookies.add(Objects.toString(e.getRequestHeaders().getFirst("Cookie"),""));
        if(delay>0)try{Thread.sleep(delay);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();}
        if(failStatus!=0&&failures.getAndIncrement()<failCount){e.getResponseHeaders().set("Retry-After","0");send(e,failStatus,"text/plain","private-upstream-secret");return;}
        String method=request.path("method").asText();
        if("notifications/initialized".equals(method)){send(e,202,"application/json","");return;}
        Object result;
        if("initialize".equals(method)){
            if(session)e.getResponseHeaders().set("Mcp-Session-Id","fixture-session");
            result=map("protocolVersion","2025-11-25","capabilities",map("tools",map()),"serverInfo",map("name","fixture","version","1"));
        }else{
            if(!"2025-11-25".equals(e.getRequestHeaders().getFirst("MCP-Protocol-Version"))){send(e,400,"text/plain","protocol version missing");return;}
            if(session&&!"fixture-session".equals(e.getRequestHeaders().getFirst("Mcp-Session-Id"))){send(e,400,"text/plain","session missing");return;}
            if("tools/list".equals(method)){
                List<Object> tools=new ArrayList<>();for(String name:NebulaeV1HttpDriver.TOOLS)if(!missingTool||!name.endsWith("answer"))tools.add(map("name",name,"inputSchema",map("type","object")));
                result=map("tools",tools);
            }else{
                String name=request.path("params").path("name").asText();Object business;
                switch(name){
                    case "common_knowledge_list":business=map("collections",collectionFixture!=null?collectionFixture:empty?Collections.emptyList():Arrays.asList(map("id","remote:/A?x=1","name","A","indexingStatus","ready"),map("id","B","name","B","indexingStatus","pending")));break;
                    case "common_knowledge_list_documents":business=map("partial",partialDocuments,"documents",Collections.singletonList(map("id","document-a","collectionId",request.path("params").path("arguments").path("collectionId").asText(),"title","文档","sourceUri","private","extractedText","must not be listed")));break;
                    case "common_knowledge_get_document":business=map("document",map("id","document-a","collectionId","remote:/A?x=1","extractedText","正文","sourceUri","private"));break;
                    default:
                        Map<String,Object> citation=map("id","K1","collectionId",outside?"B":"remote:/A?x=1","documentId","document-a","chunkId","chunk-1");
                        Map<String,Object> search=map("query","材料","partial",true,"warnings",Collections.singletonList("重排降级"),"results",Collections.singletonList(map("citation",citation,"text","凭据","score",0.8)));
                        business=name.endsWith("answer")?map("answer","[K1] 凭据","citations",Collections.singletonList(citation),"search",search):search;
                }
                result=map("content",Collections.singletonList(map("type","text","text",json.writeValueAsString(business))),"isError",toolError||(documentToolError&&"common_knowledge_list_documents".equals(name)));
            }
        }
        Object response=rpcError?map("jsonrpc","2.0","id",request.get("id"),"error",map("code",-32602,"message","private-upstream-secret")):map("jsonrpc","2.0","id",request.get("id"),"result",result);
        String encoded=json.writeValueAsString(response);
        if(sse){
            // An unrelated progress event and multi-line data must not be parsed as the response.
            int split=encoded.indexOf(',')+1;
            send(e,200,"text/event-stream",": keepalive\n\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\nevent: message\ndata: "+encoded.substring(0,split)+"\ndata: "+encoded.substring(split)+"\n\n");
        }else send(e,200,"application/json",encoded);
    }
    JsonNode call(String operation,JsonNode body){return driver.execute(endpoint,Collections.emptyMap(),operation,"remote:/A?x=1",body);}
    long called(String name){return requests.stream().filter(r->name.equals(r.path("params").path("name").asText())).count();}
    @Test void jsonAndSseBothDiscoverAndSearchOnlyTheSelectedOpaqueId(){
        for(boolean stream:new boolean[]{false,true}){
            sse=stream;JsonNode result=call("search",json.valueToTree(map("query","材料")));
            assertTrue(result.path("partial").asBoolean());assertEquals("重排降级",result.path("warnings").get(0).asText());
            JsonNode request=requests.get(requests.size()-1).path("params");
            assertEquals("common_knowledge_search",request.path("name").asText());
            assertEquals(json.valueToTree(Collections.singletonList("remote:/A?x=1")),request.path("arguments").path("collections"));
            assertEquals(5,request.path("arguments").path("topK").asInt());
            assertFalse(request.path("arguments").has("collectionIds"));assertFalse(request.path("arguments").has("scope"));
        }
        assertTrue(cookies.stream().allMatch(String::isEmpty));assertEquals(0,deletes.get());
    }
    @Test void collectionOverviewPreservesDescriptionsAndOnlyCountsMissingTotals(){
        collectionFixture=json.valueToTree(Arrays.asList(
            map("id","remote:/A?x=1","name","制度","description","合同与法规说明","indexingStatus","ready","documentCount",12),
            map("id","B","name","空库","documentCount",0),map("id","C","name","远程库")));
        JsonNode basic=call("collections",json.createObjectNode()).path("collections");
        assertEquals("合同与法规说明",basic.get(0).path("description").asText());
        assertEquals(12,basic.get(0).path("documentCount").asInt());
        assertTrue(basic.get(2).path("documentCount").isNull());
        assertEquals(0,called("common_knowledge_list_documents"));
        for(boolean stream:new boolean[]{false,true}){
            sse=stream;requests.clear();
            JsonNode rows=call("collections",json.valueToTree(map("includeDocumentCounts",true))).path("collections");
            assertEquals(3,rows.size());assertEquals("reported",rows.get(0).path("documentCountSource").asText());
            assertEquals(0,rows.get(1).path("documentCount").asInt());
            assertEquals("",rows.get(2).path("description").asText());
            assertEquals(1,rows.get(2).path("documentCount").asInt());
            assertEquals("visible",rows.get(2).path("documentCountSource").asText());
            assertEquals(1,called("common_knowledge_list_documents"));
            assertEquals("C",requests.get(requests.size()-1).path("params").path("arguments").path("collectionId").asText());
            assertFalse(rows.toString().contains("sourceUri"));assertFalse(rows.toString().contains("extractedText"));
        }
    }
    @Test void failedFileCountsPreserveCollectionsAndPartialCountsAreLabelled(){
        documentToolError=true;
        JsonNode rows=call("collections",json.valueToTree(map("includeDocumentCounts",true))).path("collections");
        assertEquals(2,rows.size());
        for(JsonNode row:rows){assertTrue(row.path("documentCount").isNull());assertTrue(row.path("documentCountError").asText().contains("暂不可用"));}
        documentToolError=false;partialDocuments=true;
        rows=call("collections",json.valueToTree(map("includeDocumentCounts",true))).path("collections");
        assertEquals(1,rows.get(0).path("documentCount").asInt());
        assertEquals("visible",rows.get(0).path("documentCountSource").asText());
        assertTrue(rows.get(0).path("documentCountWarning").asText().contains("可能不完整"));
    }
    @Test void optionalSessionsArePropagatedAndDelete405IsHarmless(){
        session=true;sse=true;assertEquals(2,call("collections",json.createObjectNode()).path("collections").size());assertEquals(1,deletes.get());
    }
    @Test void emptyDirectoryIsSuccessfulButCannotSearchAllCollections(){
        empty=true;assertEquals(0,call("collections",json.createObjectNode()).path("collections").size());
        assertEquals(409,assertThrows(ApiException.class,()->call("search",json.valueToTree(map("query","x")))).status);
        assertEquals(0,called("common_knowledge_search"));
    }
    @Test void missingToolsInvalidTopKAndForeignDocumentsFailClosed(){
        missingTool=true;assertEquals(422,assertThrows(ApiException.class,()->call("collections",json.createObjectNode())).status);
        missingTool=false;assertEquals(422,assertThrows(ApiException.class,()->call("search",json.valueToTree(map("query","x","topK",0)))).status);
        assertEquals(404,assertThrows(ApiException.class,()->call("document",json.valueToTree(map("documentId","foreign")))).status);
        assertEquals(0,called("common_knowledge_get_document"));assertEquals(0,called("common_knowledge_search"));
    }
    @Test void validatesEvidenceAndSanitizesDocuments(){
        outside=true;assertEquals(502,assertThrows(ApiException.class,()->call("search",json.valueToTree(map("query","x")))).status);
        outside=false;JsonNode docs=call("documents",json.createObjectNode());assertFalse(docs.toString().contains("sourceUri"));assertFalse(docs.toString().contains("extractedText"));
        JsonNode doc=call("document",json.valueToTree(map("documentId","document-a")));assertEquals("正文",doc.path("document").path("extractedText").asText());assertFalse(doc.toString().contains("sourceUri"));
        assertTrue(call("answer",json.valueToTree(map("query","x"))).path("answer").asText().startsWith("[K1]"));
    }
    @Test void upstreamAndToolErrorsDoNotLeakBodiesOrBecomeLocalAuthenticationFailures(){
        failStatus=403;failCount=1;ApiException e=assertThrows(ApiException.class,()->call("collections",json.createObjectNode()));
        assertEquals(502,e.status);assertFalse(e.getMessage().contains("private-upstream-secret"));
        failStatus=0;toolError=true;assertEquals(502,assertThrows(ApiException.class,()->call("collections",json.createObjectNode())).status);
        toolError=false;rpcError=true;assertFalse(assertThrows(ApiException.class,()->call("collections",json.createObjectNode())).getMessage().contains("private-upstream-secret"));
    }
    @Test void retry503IsLimitedToTwoRetries(){
        failStatus=503;failCount=2;assertEquals(2,call("collections",json.createObjectNode()).path("collections").size());
        failures.set(0);failCount=99;assertEquals(503,assertThrows(ApiException.class,()->call("collections",json.createObjectNode())).status);assertEquals(3,failures.get());
    }
    @Test void reports404AndTotalTimeoutWithoutFallback(){
        failStatus=404;failCount=1;assertTrue(assertThrows(ApiException.class,()->call("collections",json.createObjectNode())).getMessage().contains("404"));
        failStatus=0;delay=500;environment.withProperty("nebu.knowledge.request-timeout-ms","100");
        assertEquals(504,assertThrows(ApiException.class,()->call("collections",json.createObjectNode())).status);
    }
    @Test void refreshedAllowlistSwitchControlsTheNextMcpOperation(){
        environment.setProperty("nebu.knowledge.allowed-internal-origins","");
        assertEquals(422,assertThrows(ApiException.class,()->call("collections",json.createObjectNode())).status);
        assertTrue(requests.isEmpty());
        environment.setProperty("nebu.knowledge.internal-allowlist-enabled","false");
        assertEquals(2,call("collections",json.createObjectNode()).path("collections").size());
        assertFalse(requests.isEmpty());
        requests.clear();
        environment.setProperty("nebu.knowledge.internal-allowlist-enabled","true");
        assertEquals(422,assertThrows(ApiException.class,()->call("collections",json.createObjectNode())).status);
        assertTrue(requests.isEmpty());
    }
    @Test void networkPolicyRequiresExplicitInternalOriginsAndRejectsMetadataEvenIfAllowed()throws Exception{
        KnowledgeNetworkPolicy policy=new KnowledgeNetworkPolicy(new MockEnvironment().withProperty("nebu.knowledge.internal-allowlist-enabled","true").withProperty("nebu.knowledge.block-special-addresses","true"));
        assertThrows(ApiException.class,()->policy.validate(URI.create(endpoint),new InetAddress[]{InetAddress.getByName("127.0.0.1")}));
        assertThrows(ApiException.class,()->policy.validate(URI.create("http://169.254.169.254/mcp"),new InetAddress[]{InetAddress.getByName("169.254.169.254")}));
        assertThrows(ApiException.class,()->KnowledgeNetworkPolicy.endpoint("http://example.com/mcp?token=secret"));
    }
    @Test void legacyCapabilitiesDoNotPretendDocumentSearchIsWikiOrGraph(){
        JsonNode caps=call("capabilities",json.createObjectNode());assertTrue(caps.path("capabilities").path("search").path("supported").asBoolean());assertFalse(caps.path("capabilities").path("graph").path("supported").asBoolean());
        assertEquals(422,assertThrows(ApiException.class,()->call("search",json.valueToTree(map("query","x","contentKind","wiki")))).status);assertEquals(0,called("common_knowledge_search"));
    }

}
