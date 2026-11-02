package cn.nebulaedata.cccs.nebuwork.backend.api.workbench;

import org.apache.ibatis.annotations.*;
import java.util.List;
import java.util.Map;

@Mapper
public interface WorkbenchMapper {
    @Select("SELECT id FROM nw_project WHERE id=#{id} AND owner_id=#{owner} FOR UPDATE") String lockProjectForTasks(@Param("owner") String owner,@Param("id") String id);
    String WB="SELECT w.*,v.version_number AS active_version,v.source_revision AS published_revision FROM nw_workbench w LEFT JOIN nw_ontology_version v ON v.id=w.active_version_id ";
    @Select(WB+"WHERE w.owner_id=#{owner} AND w.deleted_at IS NULL ORDER BY w.created_at,w.id")
    List<Map<String,Object>> workbenches(String owner);
    @Select(WB+"WHERE w.owner_id=#{owner} AND w.id=#{id} AND w.deleted_at IS NULL")
    Map<String,Object> workbench(@Param("owner") String owner,@Param("id") String id);
    @Select("SELECT * FROM nw_workbench WHERE owner_id=#{owner} AND id=#{id} AND deleted_at IS NULL FOR UPDATE")
    Map<String,Object> lockWorkbench(@Param("owner") String owner,@Param("id") String id);
    @Select("SELECT * FROM nw_workbench WHERE owner_id=#{owner} AND create_request_key=#{key} FOR UPDATE")
    Map<String,Object> createdWorkbench(@Param("owner") String owner,@Param("key") String key);
    @Insert("INSERT INTO nw_workbench(id,owner_id,name,description,icon,color,create_request_key,create_request_hash) VALUES(#{id},#{owner},#{name},#{desc},#{icon},#{color},#{key},#{hash}) ON DUPLICATE KEY UPDATE id=id")
    void insertWorkbench(Map<String,Object> p);
    @Update("UPDATE nw_workbench SET name=#{name},description=#{desc},icon=#{icon},color=#{color},revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE id=#{id} AND owner_id=#{owner} AND revision=#{revision}")
    int updateWorkbench(Map<String,Object> p);
    @Update("UPDATE nw_workbench SET revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE id=#{id} AND owner_id=#{owner} AND revision=#{revision}")
    int touch(@Param("owner") String owner,@Param("id") String id,@Param("revision") long revision);
    @Update("UPDATE nw_workbench SET active_version_id=#{version},updated_at=CURRENT_TIMESTAMP(6) WHERE id=#{id}")
    void activate(@Param("id") String id,@Param("version") String version);
    // Keep the creation key tombstone so a retry cannot recreate a deliberately deleted workbench.
    @Update("UPDATE nw_workbench SET deleted_at=CURRENT_TIMESTAMP(6),active_version_id=NULL,revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE id=#{id}")
    void deleteWorkbench(String id);

    @Select("SELECT definition_json FROM nw_workbench_draft WHERE workbench_id=#{id}")
    String draft(String id);
    @Insert("INSERT INTO nw_workbench_draft(workbench_id,definition_json) VALUES(#{id},#{json})")
    void insertDraft(@Param("id") String id,@Param("json") String json);
    @Update("UPDATE nw_workbench_draft SET definition_json=#{json} WHERE workbench_id=#{id}")
    void updateDraft(@Param("id") String id,@Param("json") String json);
    @Delete("DELETE FROM nw_workbench_draft WHERE workbench_id=#{id}")
    void deleteDraft(String id);
    @Select("SELECT expert_id FROM nw_workbench_agent WHERE workbench_id=#{id} ORDER BY sort_order,expert_id")
    List<String> agents(String id);
    @Select("SELECT template_id FROM nw_workbench_case WHERE workbench_id=#{id} ORDER BY sort_order,template_id")
    List<String> cases(String id);
    @Select("SELECT COALESCE(MAX(sort_order),-1)+1 FROM nw_workbench_agent WHERE workbench_id=#{id}")
    int nextAgentOrder(String id);
    @Select("SELECT COALESCE(MAX(sort_order),-1)+1 FROM nw_workbench_case WHERE workbench_id=#{id}")
    int nextCaseOrder(String id);
    @Insert("INSERT INTO nw_workbench_agent(workbench_id,expert_id,sort_order) VALUES(#{id},#{target},#{sort})")
    void bindAgent(@Param("id") String id,@Param("target") String target,@Param("sort") int sort);
    @Insert("INSERT INTO nw_workbench_case(workbench_id,template_id,sort_order) VALUES(#{id},#{target},#{sort})")
    void bindCase(@Param("id") String id,@Param("target") String target,@Param("sort") int sort);
    @Delete("DELETE FROM nw_workbench_agent WHERE workbench_id=#{id} AND expert_id=#{target}")
    void unbindAgent(@Param("id") String id,@Param("target") String target);
    @Delete("DELETE FROM nw_workbench_case WHERE workbench_id=#{id} AND template_id=#{target}")
    void unbindCase(@Param("id") String id,@Param("target") String target);
    @Delete("DELETE FROM nw_workbench_agent WHERE workbench_id=#{id}") void deleteAgents(String id);
    @Delete("DELETE FROM nw_workbench_case WHERE workbench_id=#{id}") void deleteCases(String id);

    @Select("SELECT * FROM nw_ontology_version WHERE workbench_id=#{id} ORDER BY version_number DESC")
    List<Map<String,Object>> versions(String id);
    @Select("SELECT * FROM nw_ontology_version WHERE workbench_id=#{id} AND id=#{version}")
    Map<String,Object> version(@Param("id") String id,@Param("version") String version);
    @Select("SELECT * FROM nw_ontology_version WHERE workbench_id=#{id} AND source_revision=#{revision}")
    Map<String,Object> versionForRevision(@Param("id") String id,@Param("revision") long revision);
    @Select("SELECT COALESCE(MAX(version_number),0)+1 FROM nw_ontology_version WHERE workbench_id=#{id}")
    int nextVersion(String id);
    @Insert("INSERT INTO nw_ontology_version(id,workbench_id,version_number,source_revision,snapshot_json,content_hash,published_by) VALUES(#{id},#{workbench},#{number},#{revision},#{snapshot},#{hash},#{actor})")
    void insertVersion(Map<String,Object> p);
    @Delete("DELETE FROM nw_ontology_version WHERE workbench_id=#{id}") void deleteVersions(String id);

    String PROJECT="SELECT p.*,w.name AS workbench_name,v.version_number,v.snapshot_json FROM nw_project p JOIN nw_workbench w ON w.id=p.workbench_id JOIN nw_ontology_version v ON v.id=p.ontology_version_id ";
    @Select("<script>"+PROJECT+"WHERE p.owner_id=#{owner} AND w.owner_id=#{owner} AND w.deleted_at IS NULL <if test='workbench != null'>AND p.workbench_id=#{workbench}</if> ORDER BY p.created_at DESC,p.id</script>")
    List<Map<String,Object>> projects(@Param("owner") String owner,@Param("workbench") String workbench);
    @Select(PROJECT+"WHERE p.owner_id=#{owner} AND w.owner_id=#{owner} AND p.id=#{id} AND w.deleted_at IS NULL")
    Map<String,Object> project(@Param("owner") String owner,@Param("id") String id);
    @Select("SELECT * FROM nw_project WHERE owner_id=#{owner} AND create_request_key=#{key} FOR UPDATE")
    Map<String,Object> createdProject(@Param("owner") String owner,@Param("key") String key);
    @Select("SELECT id FROM nw_project WHERE workbench_id=#{id} ORDER BY created_at,id")
    List<String> projectIds(String id);
    @Insert("INSERT INTO nw_project(id,owner_id,workbench_id,ontology_version_id,name,description,create_request_key,create_request_hash) VALUES(#{id},#{owner},#{workbench},#{version},#{name},#{desc},#{key},#{hash}) ON DUPLICATE KEY UPDATE id=id")
    void insertProject(Map<String,Object> p);
    @Update("UPDATE nw_project SET name=#{name},description=#{desc},status=#{status},revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE id=#{id} AND owner_id=#{owner} AND revision=#{revision}")
    int updateProject(Map<String,Object> p);
    @Update("UPDATE nw_project SET parameters_json=#{json} WHERE id=#{id}") void parameters(@Param("id") String id,@Param("json") String json);
}
