package cn.nebulaedata.cccs.nebuwork.backend.api.memory;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentStore;
import cn.nebulaedata.cccs.nebuwork.backend.api.workbench.WorkbenchMapper;
import cn.nebulaedata.cccs.nebuwork.backend.api.expert.ExpertMapper;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.*;

@Component
public class MemoryScopes {
    private final AgentStore tasks;
    private final WorkbenchMapper projects;
    private final ExpertMapper experts;
    public MemoryScopes(AgentStore tasks, WorkbenchMapper projects, ExpertMapper experts) {
        this.tasks = tasks; this.projects = projects; this.experts = experts;
    }
    public Map<String,Object> authorize(String owner, String kind, String object, boolean write) {
        Map<String,Object> row; String label;
        switch (kind) {
            case "user":
                if (!"self".equals(object)) throw new ApiException(404, "记忆范围不存在");
                return map("kind", kind, "scopeId", "self", "name", "我的记忆", "readOnly", false);
            case "task":
                row = tasks.task(object);
                if (row == null || !owner.equals(row.get("owner_id")) || row.get("deleted_at") != null) throw new ApiException(404, "任务记忆不可用");
                label = str(row, "title");
                Map<String,Object> project = projects.project(owner, str(row, "project_id"));
                if (project == null) throw new ApiException(404, "项目不存在");
                boolean archived = "archived".equals(project.get("status"));
                if (write && archived) throw new ApiException(409, "归档项目的记忆只读");
                return map("kind", kind, "scopeId", object, "name", label, "readOnly", archived);
            case "project": row = projects.project(owner, object); label = row == null ? "" : str(row, "name"); break;
            case "workbench": row = projects.workbench(owner, object); label = row == null ? "" : str(row, "name"); break;
            case "expert": row = experts.visibleExpert(owner, object); label = row == null ? "" : str(row, "name"); break;
            default: throw new ApiException(422, "不支持的记忆范围");
        }
        if (row == null) throw new ApiException(404, "记忆范围不存在");
        boolean archived = "project".equals(kind) && "archived".equals(row.get("status"));
        if (write && archived) throw new ApiException(409, "归档项目的记忆只读");
        return map("kind", kind, "scopeId", object, "name", label, "readOnly", archived);
    }
    /** Membership comes from the run's immutable manifest, never the current workbench draft. */
    public List<Map<String,Object>> forRun(String owner, String task, String projectId, JsonNode snapshot) {
        List<Map<String,Object>> result = new ArrayList<>();
        result.add(authorize(owner, "task", task, false));
        result.add(authorize(owner, "project", projectId, false));
        result.add(authorize(owner, "user", "self", false));
        Map<String,Object> project = projects.project(owner, projectId);
        addAvailable(result, owner, "workbench", str(project, "workbench_id"));
        Set<String> ids = new LinkedHashSet<>();
        for (JsonNode a : snapshot.path("experts")) if (a.hasNonNull("id")) ids.add(a.path("id").asText());
        for (String id : ids) addAvailable(result, owner, "expert", id);
        return result;
    }
    private void addAvailable(List<Map<String,Object>> result, String owner, String kind, String id) {
        try { result.add(authorize(owner, kind, id, false)); } catch (ApiException ignored) { /* Revoked membership is not available. */ }
    }
    public List<Map<String,Object>> targets(String owner) {
        List<Map<String,Object>> result = new ArrayList<>();
        result.add(authorize(owner, "user", "self", false));
        for (Map<String,Object> p : projects.projects(owner, null)) result.add(authorize(owner, "project", str(p,"id"), false));
        for (Map<String,Object> w : projects.workbenches(owner)) result.add(authorize(owner, "workbench", str(w,"id"), false));
        for (Map<String,Object> e : experts.visibleExperts(owner)) result.add(authorize(owner, "expert", str(e,"id"), false));
        return result;
    }
}
