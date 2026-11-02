package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.sun.net.httpserver.*;
import org.junit.jupiter.api.*;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockMultipartFile;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class KnowledgeRestClientTest {
    final ObjectMapper json=new ObjectMapper();HttpServer server;ExecutorService executor;KnowledgeRestClient client;String root;
    String method,path,key,tenant,body,contentType;int status=200,delay;String response="{\"id\":\"raw-wiki-page\"}";AtomicInteger requests=new AtomicInteger();
    @BeforeEach void start()throws Exception{
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);executor=Executors.newCachedThreadPool();server.setExecutor(executor);
        root="http://127.0.0.1:"+server.getAddress().getPort();
        MockEnvironment env=new MockEnvironment().withProperty("nebu.knowledge.allowed-internal-origins",root).withProperty("nebu.knowledge.request-timeout-ms","800");
        client=new KnowledgeRestClient(json,env,new KnowledgeNetworkPolicy(env));server.createContext("/",e->{
            requests.incrementAndGet();method=e.getRequestMethod();path=e.getRequestURI().toString();key=e.getRequestHeaders().getFirst("X-API-Key");tenant=e.getRequestHeaders().getFirst("X-Tenant-ID");contentType=e.getRequestHeaders().getFirst("Content-Type");
            ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] bytes=new byte[1024];int n;while((n=e.getRequestBody().read(bytes))!=-1)out.write(bytes,0,n);body=new String(out.toByteArray(),StandardCharsets.UTF_8);
            try{if(delay>0)Thread.sleep(delay);byte[] result=response.getBytes(StandardCharsets.UTF_8);e.sendResponseHeaders(status,status==204?-1:result.length);if(status!=204)e.getResponseBody().write(result);}catch(InterruptedException x){Thread.currentThread().interrupt();}finally{e.close();}
        });server.start();
    }
    @AfterEach void close(){client.close();server.stop(0);executor.shutdownNow();}
    Map<String,String> headers(){Map<String,String> h=new HashMap<>();h.put("X-API-Key","fixture-key");h.put("X-Tenant-ID","7");return h;}
    @Test void retrievalHasBudgetBeyondTheOrdinaryReadDeadline(){
        delay=900;
        JsonNode result=client.executeRetrieval(root,headers(),s->s.request("GET","/search-proof",null));
        assertEquals("raw-wiki-page",result.path("id").asText());
    }
    @Test void preservesDeploymentPathAuthRawJsonAndNoContent(){
        JsonNode result=client.execute(root+"/deploy/",headers(),s->s.request("GET","/knowledgebase/k/wiki/pages/a",null));assertEquals("raw-wiki-page",result.path("id").asText());
        assertEquals("/deploy/api/v1/knowledgebase/k/wiki/pages/a",path);assertEquals("fixture-key",key);assertEquals("7",tenant);
        status=204;assertTrue(client.execute(root+"/deploy/api/v1/",headers(),s->s.request("DELETE","/knowledge-bases/k",null)).isObject());assertEquals("/deploy/api/v1/knowledge-bases/k",path);
    }
    @Test void forwardsMultipartFilenameAndBinaryWithoutJsonCoercion(){
        client.execute(root,headers(),s->s.upload("/knowledge-bases/k/knowledge/file",new MockMultipartFile("file","测试.md","text/markdown","# text".getBytes(StandardCharsets.UTF_8)),"测试.md"));
        assertTrue(contentType.startsWith("multipart/form-data; boundary="));assertTrue(body.contains("filename=\"测试.md\""));assertTrue(body.contains("# text"));
        response="binary-file";assertArrayEquals(response.getBytes(StandardCharsets.UTF_8),client.execute(root,headers(),s->s.download("/knowledge/doc/download")).bytes);
    }
    @Test void folderPathIsAFormFieldWhileTheBinaryFilenameIsOnlyTheBasename(){
        client.execute(root,headers(),s->s.upload("/knowledge-bases/k/knowledge/file",new MockMultipartFile("file","测试.md","text/markdown","正文".getBytes(StandardCharsets.UTF_8)),"公司/制度/测试.md"));
        assertTrue(body.contains("name=\"fileName\"\r\n\r\n公司/制度/测试.md\r\n"));
        assertTrue(body.contains("filename=\"测试.md\""));assertFalse(body.contains("filename=\"公司/"));assertEquals(1,requests.get());
    }
    @Test void onlyRecognizedUploadDuplicatesBecomeSanitizedReceipts(){
        status=409;response="{\"success\":false,\"code\":\"duplicate_file\",\"message\":\"private-key\",\"data\":{\"id\":\"existing\",\"knowledge_base_id\":\"k\",\"folder_path\":\"原目录\",\"api_key\":\"private-key\"}}";
        JsonNode result=client.execute(root,headers(),s->s.upload("/knowledge-bases/k/knowledge/file",new MockMultipartFile("file","a.md","text/plain",new byte[]{1}),"新目录/a.md"));
        assertEquals("duplicate",result.path("uploadOutcome").asText());assertEquals("原目录",result.path("data").path("folder_path").asText());assertFalse(result.toString().contains("private-key"));
        response="{\"success\":false,\"code\":\"other_conflict\"}";
        assertEquals(409,assertThrows(ApiException.class,()->client.execute(root,headers(),s->s.upload("/knowledge-bases/k/knowledge/file",new MockMultipartFile("file",new byte[]{1}),"a.md"))).status);
        assertEquals(2,requests.get());
    }
    @Test void neverReplaysWritesAndRemoteAuthDoesNotInvalidateLocalLogin(){
        status=503;assertThrows(ApiException.class,()->client.execute(root,headers(),s->s.request("POST","/knowledge-bases",json.createObjectNode())));assertEquals(1,requests.get());
        status=401;ApiException auth=assertThrows(ApiException.class,()->client.execute(root,headers(),s->s.request("GET","/models",null)));assertEquals(502,auth.status);assertFalse(auth.getMessage().contains(response));
    }
    @Test void timeoutsDoNotReplayOrExposeResponseSecrets(){
        delay=1200;ApiException error=assertThrows(ApiException.class,()->client.execute(root,headers(),s->s.request("POST","/knowledge-bases",json.createObjectNode())));assertEquals(504,error.status);assertEquals(1,requests.get());
    }
    @Test void multipartUploadsHaveAnIndependentLongDeadline(){
        delay=1000;JsonNode result=client.executeUpload(root,headers(),s->s.uploadV101("/knowledge-bases/k/knowledge/file",new MockMultipartFile("file","large.zip","application/zip",new byte[]{1}),"法律法规/large.zip"));
        assertEquals("raw-wiki-page",result.path("id").asText());assertEquals(1,requests.get());assertTrue(body.contains("relative_path"));assertTrue(body.contains("法律法规/large.zip"));
    }
    @Test void configurationGenerationHasAnIndependentLongDeadline(){
        delay=1000;response="{\"success\":true,\"data\":{\"name\":\"generated\"}}";
        JsonNode result=client.generateConfiguration(root+"/deploy",headers(),json.createObjectNode().put("description","business"));
        assertEquals("generated",result.path("data").path("name").asText());assertEquals("/deploy/api/v1/initialization/generate/knowledge-base-config",path);assertEquals(1,requests.get());
    }
    @Test void explainsKnownVectorBindingRejectionsWithoutExposingUpstreamDetails(){
        status=400;response="{\"success\":false,\"error\":{\"code\":2200,\"message\":\"vector store not found\",\"details\":\"api_key=private https://internal.invalid\"}}";
        ApiException error=assertThrows(ApiException.class,()->client.execute(root,headers(),s->s.request("POST","/knowledge-bases",json.createObjectNode())));
        assertEquals(422,error.status);assertTrue(error.getMessage().contains("空间默认向量存储"));assertFalse(error.getMessage().contains("private"));assertFalse(error.getMessage().contains("internal.invalid"));assertEquals(1,requests.get());
        response="{\"error\":{\"code\":1000,\"message\":\"api_key=private\"}}";
        ApiException unknown=assertThrows(ApiException.class,()->client.execute(root,headers(),s->s.request("POST","/knowledge-bases",json.createObjectNode())));
        assertTrue(unknown.getMessage().contains("HTTP 400"));assertFalse(unknown.getMessage().contains("private"));
    }
    @Test void canonicalizesRestBaseAndRejectsTraversal(){
        assertEquals(root+"/app/api/v1",KnowledgeRestClient.normalize(root+"/app"));assertEquals("dir/a%3Fb",KnowledgeRestClient.slug("dir/a?b"));assertThrows(ApiException.class,()->KnowledgeRestClient.slug("../other"));
    }
    @Test void generationErrorsExposeOnlyAllowlistedReasons(){
        status=500;response="{\"error\":{\"code\":1007,\"message\":\"secret\",\"details\":{\"generation_reason\":\"invalid_response\",\"api_key\":\"private\"}}}";
        ApiException error=assertThrows(ApiException.class,()->client.generateConfiguration(root,headers(),json.createObjectNode()));
        assertTrue(error.getMessage().contains("结构要求"));assertFalse(error.getMessage().contains("private"));assertEquals(1,requests.get());
    }
}
