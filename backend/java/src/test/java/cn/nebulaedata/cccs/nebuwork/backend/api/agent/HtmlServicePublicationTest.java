package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInfo;
import org.springframework.test.context.TestPropertySource;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@TestPropertySource(properties={"nebu.workbench-services.enabled=true","nebu.workbench-services.polling-enabled=false","nebu.workbench-services.public-base-url=http://localhost:42020/nwaa","nebu.workbench-services.frontend-url=http://localhost:5173"})
class HtmlServicePublicationTest extends AgentIntegrationTest {
    String wb,project,base;
    @BeforeEach void htmlService(TestInfo info)throws Exception{if(info.getTestMethod().get().getDeclaringClass()!=HtmlServicePublicationTest.class)return;wb=workbench();project=project(wb);base="/api/workbenches/"+wb+"/service";when(engine.get("alice",project,"/v1/capabilities")).thenReturn(json.valueToTree(map("htmlArtifactBundles",true)));}
    String digest(String html)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(html.getBytes(StandardCharsets.UTF_8)))out.append(String.format("%02x",b&255));return out.toString();}
    ObjectNode definition(JsonNode asset){return json.valueToTree(map("name","HTML 页面服务","description","","capabilities",Collections.emptyList(),"pages",Collections.singletonList(map("key","report","name","任务报告","assetId",asset.path("id"),"capabilities",Collections.emptyList(),"projectIds",Collections.singletonList(project),"refreshSeconds",0))));}
    JsonNode asset()throws Exception{return data(postJson(base+"/assets",map("html","<!doctype html><h1>report</h1>")),"alice");}
    @Test void pureHtmlPagesExposeTheirProjectAndKeepPublishedInstancesImmutable()throws Exception{
        JsonNode asset=asset();ObjectNode definition=definition(asset);
        JsonNode saved=data(postJson(base,map("revision",0,"definition",definition)),"alice");assertEquals(1,saved.path("revision").asInt());
        assertEquals(1,data(postJson(base,map("revision",0,"definition",definition)),"alice").path("revision").asInt());
        JsonNode release=data(postJson(base+"/publish",map("revision",1)),"alice");
        JsonNode manifest=data(get("/api/workbench-services/"+wb+"/manifest"),"alice");assertEquals(project,manifest.path("projects").get(0).path("id").asText());assertEquals(0,manifest.path("capabilities").size());
        String instances="/api/workbench-services/"+wb+"/pages/report/instances";
        JsonNode instance=data(postJson(instances,map("projectId",project)).header("Idempotency-Key","html-instance"),"alice");assertTrue(instance.path("html").asText().contains("report"));
        String another=project(wb);mvc.perform(postJson(instances,map("projectId",another)).header("token","alice-token").header("Idempotency-Key","wrong-project")).andExpect(status().isForbidden());
        ObjectNode changed=definition.deepCopy();changed.put("description","updated");data(postJson(base,map("revision",1,"definition",changed)),"alice");
        assertEquals(release.path("id"),data(postJson(base+"/publish",map("revision",1)),"alice").path("id"));
        assertEquals(release.path("id"),data(get("/api/workbench-services/"+wb+"/page-instances/"+instance.path("id").asText()),"alice").path("releaseId"));
        mvc.perform(postJson(base,map("revision",0,"definition",definition)).header("token","alice-token")).andExpect(status().isConflict());
        data(postJson(base+"/disable",map("revision",2)),"alice");mvc.perform(get("/api/workbench-services/"+wb+"/page-instances/"+instance.path("id").asText()).header("token","alice-token")).andExpect(status().isConflict());
    }
    @Test void copiesValidatedBundleAndProvenanceToIndependentAssetsAndRecoversTheSameImport()throws Exception{
        String html="<!doctype html><style>body{color:purple}</style><h1>fixed</h1>";
        JsonNode source=json.valueToTree(map("kind","html-bundle","projectId",project,"entryPath","index.html","files",Arrays.asList(map("artifactId","entry","version",2,"sha256","entry-sha"),map("artifactId","css","version",3,"sha256","css-sha"))));
        when(engine.post(eq("alice"),eq(project),eq("/v1/projects/"+project+"/html-bundles"),any(),anyString())).thenReturn(json.valueToTree(map("html",html,"sha256",digest(html),"source",source)));
        Object input=map("projectId",project,"artifactId","entry","version",2,"entryPath","index.html","resources",Collections.singletonList(map("path","style.css","artifactId","css","version",3)));
        JsonNode first=data(postJson(base+"/assets",input),"alice"),again=data(postJson(base+"/assets",input),"alice");assertEquals(first.path("id"),again.path("id"));
        assertEquals(source,first.path("source"));JsonNode detail=data(get(base+"/assets/"+first.path("id").asText()),"alice");assertEquals(html,detail.path("html").asText());assertEquals(digest(html),detail.path("sha256").asText());
        mvc.perform(get(base+"/assets/"+first.path("id").asText()).header("token","bob-token")).andExpect(status().isNotFound());
        when(engine.get("alice",project,"/v1/capabilities")).thenReturn(json.valueToTree(map()));
        mvc.perform(postJson(base+"/assets",input).header("token","alice-token")).andExpect(status().isConflict());
    }
    @Test void pageOnlyApplicationRespectsProjectScopeAndRevocation()throws Exception{
        String privateProject=project(wb);ObjectNode d=definition(asset());((ObjectNode)d.path("pages").get(0)).set("projectIds",json.valueToTree(Arrays.asList(project,privateProject)));data(postJson(base,map("revision",0,"definition",d)),"alice");data(postJson(base+"/publish",map("revision",1)),"alice");
        JsonNode app=data(postJson(base+"/apps",map("name","HTML应用","scope",map("capabilities",Collections.emptyList(),"pages",Collections.singletonList("report"),"projects",Collections.singletonList(project),"redirectUris",Collections.emptyList(),"origins",Collections.emptyList()))).header("Idempotency-Key","html-app"),"alice");
        JsonNode token=json.readTree(mvc.perform(post("/api/service-oauth/token").contentType("application/x-www-form-urlencoded").param("grant_type","client_credentials").param("client_id",app.path("id").asText()).param("client_secret",app.path("clientSecret").asText())).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        String bearer="Bearer "+token.path("access_token").asText();
        JsonNode manifest=json.readTree(mvc.perform(get("/api/workbench-services/"+wb+"/manifest").header("Authorization",bearer)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).path("data");assertEquals(project,manifest.path("projects").get(0).path("id").asText());
        String instance=mvc.perform(postJson("/api/workbench-services/"+wb+"/pages/report/instances",map("projectId",project)).header("Authorization",bearer).header("Idempotency-Key","application-page")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();assertFalse(instance.contains(privateProject));
        data(postJson(base+"/apps/"+app.path("id").asText()+"/rotate",map("revision",1)),"alice");
        mvc.perform(get("/api/workbench-services/"+wb+"/manifest").header("Authorization",bearer)).andExpect(status().isUnauthorized());
    }
}
