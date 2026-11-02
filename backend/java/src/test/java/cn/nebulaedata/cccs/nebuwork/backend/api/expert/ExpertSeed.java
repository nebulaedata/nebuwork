package cn.nebulaedata.cccs.nebuwork.backend.api.expert;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.io.InputStream;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

@Component
public class ExpertSeed implements ApplicationRunner {
    private final ExpertMapper db; private final ObjectMapper json; private final boolean enabled;
    public ExpertSeed(ExpertMapper db,ObjectMapper json,@Value("\u0024{nebu.seed-enabled:true}") boolean enabled) { this.db=db; this.json=json; this.enabled=enabled; }
    @Override @Transactional
    public void run(ApplicationArguments args) throws Exception {
        if(!enabled||db.seedState().get("completed_at")!=null) return;
        JsonNode seed; try(InputStream in=new ClassPathResource("seed/expert-config-v1.json").getInputStream()) { seed=json.readTree(in); }
        for(JsonNode a:seed.path("agents")) {
            db.insertExpert(map("id",a.path("id").asText(),"name",a.path("name").asText(),"role",a.path("role").asText(),"tagline",a.path("tagline").asText(),
                "model",a.path("model").asText(),"initials",a.path("initials").asText(),"color",a.path("color").asText(),"source",null));
        }
        for(JsonNode x:seed.path("extensions")) db.insertExtension(json.convertValue(x,Map.class));
        for(JsonNode x:seed.path("templates")) db.insertTemplate(json.convertValue(x,Map.class));
        for(JsonNode x:seed.path("marketExperts")) db.insertMarketExpert(json.convertValue(x,Map.class));
        for(JsonNode a:seed.path("agents")) {
            String expert=a.path("id").asText();
            for(JsonNode x:a.path("extensionIds")) db.bindExtension(expert,x.asText());
            for(JsonNode x:a.path("templateIds")) db.bindTemplate(expert,x.asText());
            int sort=0;
            for(JsonNode s:a.path("sopSets")) {
                String sop=s.path("id").asText(),kind=s.path("kind").asText();
                ObjectNode d=((ObjectNode)s.path(kind.equals("workflow")?"wf":"proc")).deepCopy();
                JsonNode materials=d.path("materials"); d.remove("materials");
                db.insertSop(map("id",sop,"expert",expert,"name",s.path("name").asText(),"kind",kind,"description",s.path("desc").asText(),"definition",json.writeValueAsString(d),"sort",sort++));
                for(JsonNode m:materials) db.insertMaterial(map("id",ExpertService.id("mat"),"sop",sop,"file",null,"name",m.asText()));
            }
            for(JsonNode s:a.path("ruleSets")) db.insertRuleSet(map("id",s.path("id").asText(),"expert",expert,"name",s.path("name").asText(),"description",s.path("desc").asText()));
            for(JsonNode r:a.path("rules")) db.insertRule(map("id",r.path("id").asText(),"expert",expert,"ruleSetId",r.path("ruleSetId").asText(),"name",r.path("name").asText(),"content",r.path("content").asText(),"enabled",r.path("enabled").asBoolean()));
        }
        db.audit(map("id",ExpertService.id("audit"),"actor","system:seed","type","seed","object","expert-config-v1","action","initialize","change","{\"source\":\"NebuWorkAgent configuration\",\"metricsImported\":false}"));
        db.finishSeed();
    }
}
