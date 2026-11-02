package cn.nebulaedata.cccs.nebuwork.backend.api.memory;

import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentTasks;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

/** Memory provenance is read from immutable engine manifests. */
@Service
public class MemoryRuntime {
    private final AgentTasks tasks;private final ObjectMapper json;
    public MemoryRuntime(AgentTasks tasks,ObjectMapper json){this.tasks=tasks;this.json=json;}
    public Object history(String owner,String task){JsonNode detail=json.valueToTree(tasks.detail(owner,task));List<Object> contexts=new ArrayList<>();for(JsonNode run:detail.path("runs"))contexts.add(map("runId",run.path("id").asText(),"context",run.path("manifest").path("memory"),"manifestHash",run.path("manifestHash").asText()));return map("contexts",contexts,"source","agent-engine");}
}
