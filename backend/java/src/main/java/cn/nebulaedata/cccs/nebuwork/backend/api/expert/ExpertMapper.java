package cn.nebulaedata.cccs.nebuwork.backend.api.expert;

import org.apache.ibatis.annotations.*;
import java.util.List;
import java.util.Map;

@Mapper
public interface ExpertMapper {
    @Select("SELECT * FROM nw_expert ORDER BY created_at,id")
    List<Map<String,Object>> experts();
    @Select("SELECT e.* FROM nw_expert e WHERE NOT EXISTS (SELECT 1 FROM nw_expert_membership m WHERE m.owner_id=#{owner} AND m.expert_id=e.id AND m.removed=TRUE) ORDER BY e.created_at,e.id")
    List<Map<String,Object>> visibleExperts(String owner);
    @Select("SELECT e.* FROM nw_expert e WHERE e.id=#{id} AND NOT EXISTS (SELECT 1 FROM nw_expert_membership m WHERE m.owner_id=#{owner} AND m.expert_id=e.id AND m.removed=TRUE)")
    Map<String,Object> visibleExpert(@Param("owner") String owner,@Param("id") String id);
    @Select("SELECT * FROM nw_expert_membership WHERE owner_id=#{owner} AND expert_id=#{expert}")
    Map<String,Object> membership(@Param("owner") String owner,@Param("expert") String expert);
    @Insert("INSERT INTO nw_expert_membership(owner_id,expert_id,removed) VALUES(#{owner},#{expert},#{removed}) ON DUPLICATE KEY UPDATE removed=#{removed},revision=revision+1,updated_at=CURRENT_TIMESTAMP(6)")
    void membershipState(@Param("owner") String owner,@Param("expert") String expert,@Param("removed") boolean removed);
    @Select("SELECT w.name FROM nw_workbench_agent a JOIN nw_workbench w ON w.id=a.workbench_id WHERE a.expert_id=#{expert} AND w.owner_id=#{owner} AND w.deleted_at IS NULL ORDER BY w.id LIMIT 5")
    List<String> referencingWorkbenches(@Param("owner") String owner,@Param("expert") String expert);
    @Select("SELECT * FROM nw_expert WHERE id=#{id}")
    Map<String,Object> expert(String id);
    @Select("SELECT * FROM nw_expert WHERE id=#{id} FOR UPDATE")
    Map<String,Object> lockExpert(String id);
    @Select("SELECT * FROM nw_expert WHERE source_market_id=#{id}")
    Map<String,Object> hired(String id);
    @Insert("INSERT INTO nw_expert(id,name,role_label,tagline,model_name,model_provider_id,initials,color,source_market_id) VALUES(#{id},#{name},#{role},#{tagline},#{model},#{modelProviderId},#{initials},#{color},#{source})")
    void insertExpert(Map<String,Object> p);
    @Update("UPDATE nw_expert SET name=#{name},role_label=#{role},tagline=#{tagline},model_name=#{model},model_provider_id=#{modelProviderId},initials=#{initials},revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE id=#{id} AND revision=#{revision}")
    int updateExpert(Map<String,Object> p);
    @Update("UPDATE nw_expert SET revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE id=#{id}")
    void touchExpert(String id);

    @Select("SELECT * FROM nw_sop WHERE expert_id=#{id} ORDER BY sort_order,created_at,id")
    List<Map<String,Object>> sops(String id);
    @Select("SELECT * FROM nw_sop WHERE expert_id=#{expert} AND id=#{id}")
    Map<String,Object> sop(@Param("expert") String expert,@Param("id") String id);
    @Insert("INSERT INTO nw_sop(id,expert_id,name,kind,description,definition_json,sort_order) VALUES(#{id},#{expert},#{name},#{kind},#{description},#{definition},#{sort})")
    void insertSop(Map<String,Object> p);
    @Update("UPDATE nw_sop SET name=#{name},description=#{description},definition_json=#{definition},revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE id=#{id} AND expert_id=#{expert} AND revision=#{revision}")
    int updateSop(Map<String,Object> p);
    @Update("UPDATE nw_sop SET revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE id=#{id} AND expert_id=#{expert} AND revision=#{revision}")
    int touchSop(@Param("expert") String expert,@Param("id") String id,@Param("revision") long revision);
    @Delete("DELETE FROM nw_sop WHERE expert_id=#{expert} AND id=#{id} AND revision=#{revision}")
    int deleteSop(@Param("expert") String expert,@Param("id") String id,@Param("revision") long revision);

    @Select("SELECT * FROM nw_rule_set WHERE expert_id=#{id} ORDER BY created_at,id")
    List<Map<String,Object>> ruleSets(String id);
    @Select("SELECT * FROM nw_rule_set WHERE expert_id=#{expert} AND name=#{name}")
    Map<String,Object> ruleSetByName(@Param("expert") String expert,@Param("name") String name);
    @Select("SELECT * FROM nw_rule_set WHERE expert_id=#{expert} AND id=#{id}")
    Map<String,Object> ruleSet(@Param("expert") String expert,@Param("id") String id);
    @Insert("INSERT INTO nw_rule_set(id,expert_id,name,description) VALUES(#{id},#{expert},#{name},#{description})")
    void insertRuleSet(Map<String,Object> p);
    @Select("SELECT r.*,s.name AS scene FROM nw_rule r JOIN nw_rule_set s ON r.rule_set_id=s.id WHERE r.expert_id=#{id} ORDER BY r.created_at DESC,r.id")
    List<Map<String,Object>> rules(String id);
    @Select("SELECT r.*,s.name AS scene FROM nw_rule r JOIN nw_rule_set s ON r.rule_set_id=s.id WHERE r.expert_id=#{expert} AND r.id=#{id}")
    Map<String,Object> rule(@Param("expert") String expert,@Param("id") String id);
    @Insert("INSERT INTO nw_rule(id,expert_id,rule_set_id,name,content,enabled) VALUES(#{id},#{expert},#{ruleSetId},#{name},#{content},#{enabled})")
    void insertRule(Map<String,Object> p);
    @Update("UPDATE nw_rule SET rule_set_id=#{ruleSetId},name=#{name},content=#{content},enabled=#{enabled},revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE expert_id=#{expert} AND id=#{id} AND revision=#{revision}")
    int updateRule(Map<String,Object> p);
    @Delete("DELETE FROM nw_rule WHERE expert_id=#{expert} AND id=#{id} AND revision=#{revision}")
    int deleteRule(@Param("expert") String expert,@Param("id") String id,@Param("revision") long revision);

    @Select("SELECT e.*,(SELECT COUNT(*) FROM nw_expert_extension b WHERE b.extension_id=e.id) AS bindings FROM nw_extension e ORDER BY id")
    List<Map<String,Object>> extensions();
    @Select("SELECT * FROM nw_extension WHERE id=#{id}")
    Map<String,Object> extension(String id);
    @Select("SELECT extension_id FROM nw_expert_extension WHERE expert_id=#{id} ORDER BY created_at,extension_id")
    List<String> extensionIds(String id);
    @Insert("INSERT INTO nw_extension(id,name,kind,description,version_label,color) VALUES(#{id},#{name},#{kind},#{desc},#{version},#{color})")
    void insertExtension(Map<String,Object> p);
    @Insert("INSERT INTO nw_expert_extension(expert_id,extension_id) VALUES(#{expert},#{id})")
    void bindExtension(@Param("expert") String expert,@Param("id") String id);
    @Delete("DELETE FROM nw_expert_extension WHERE expert_id=#{expert} AND extension_id=#{id}")
    int unbindExtension(@Param("expert") String expert,@Param("id") String id);

    @Select("SELECT t.*,(SELECT COUNT(*) FROM nw_expert_case b WHERE b.template_id=t.id) AS bindings FROM nw_case_template t ORDER BY id")
    List<Map<String,Object>> templates();
    @Select("SELECT * FROM nw_case_template WHERE id=#{id}")
    Map<String,Object> template(String id);
    @Select("SELECT template_id FROM nw_expert_case WHERE expert_id=#{id} ORDER BY created_at,template_id")
    List<String> templateIds(String id);
    @Insert("INSERT INTO nw_case_template(id,name,scene,description,color,agent_count) VALUES(#{id},#{name},#{scene},#{desc},#{color},#{agents})")
    void insertTemplate(Map<String,Object> p);
    @Insert("INSERT INTO nw_expert_case(expert_id,template_id) VALUES(#{expert},#{id})")
    void bindTemplate(@Param("expert") String expert,@Param("id") String id);
    @Delete("DELETE FROM nw_expert_case WHERE expert_id=#{expert} AND template_id=#{id}")
    int unbindTemplate(@Param("expert") String expert,@Param("id") String id);

    @Select("SELECT * FROM nw_market_expert ORDER BY id")
    List<Map<String,Object>> marketExperts();
    @Select("SELECT * FROM nw_market_expert WHERE id=#{id} FOR UPDATE")
    Map<String,Object> marketExpert(String id);
    @Insert("INSERT INTO nw_market_expert(id,name,role_label,tagline,color,model_name) VALUES(#{id},#{name},#{role},#{tagline},#{color},#{model})")
    void insertMarketExpert(Map<String,Object> p);

    @Select("SELECT * FROM nw_sop_material WHERE sop_id=#{sop} ORDER BY created_at,id")
    List<Map<String,Object>> materials(String sop);
    @Select("SELECT * FROM nw_sop_material WHERE sop_id=#{sop} AND id=#{id}")
    Map<String,Object> material(@Param("sop") String sop,@Param("id") String id);
    @Insert("INSERT INTO nw_sop_material(id,sop_id,display_name,artifact_id,artifact_version,artifact_owner_id,byte_size,sha256) VALUES(#{id},#{sop},#{name},#{artifact},#{version},#{owner},#{size},#{sha256})")
    void insertMaterial(Map<String,Object> p);
    @Delete("DELETE FROM nw_sop_material WHERE sop_id=#{sop} AND id=#{id}")
    void deleteMaterial(@Param("sop") String sop,@Param("id") String id);
    @Delete("DELETE FROM nw_sop_material WHERE sop_id=#{sop}")
    void deleteMaterials(String sop);

    @Insert("INSERT INTO nw_config_audit(id,actor,object_type,object_id,action_name,change_json) VALUES(#{id},#{actor},#{type},#{object},#{action},#{change})")
    void audit(Map<String,Object> p);
    @Select("SELECT * FROM nw_seed_history WHERE seed_key='expert-config-v1' FOR UPDATE")
    Map<String,Object> seedState();
    @Update("UPDATE nw_seed_history SET completed_at=CURRENT_TIMESTAMP(6) WHERE seed_key='expert-config-v1'")
    void finishSeed();
}
