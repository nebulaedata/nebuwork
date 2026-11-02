package cn.nebulaedata.cccs.nebuwork.backend.api.model;

import org.apache.ibatis.annotations.*;
import java.util.List;
import java.util.Map;

@Mapper
public interface ModelProviderMapper {
    @Select("SELECT id,owner_id,provider_type,base_url,model_name,test_status,last_tested_at,last_latency_ms,last_model_found,created_at,updated_at FROM nw_model_provider WHERE owner_id=#{owner} ORDER BY created_at,id")
    List<Map<String,Object>> list(String owner);
    @Select("SELECT * FROM nw_model_provider WHERE owner_id=#{owner} AND id=#{id}")
    Map<String,Object> owned(@Param("owner") String owner,@Param("id") String id);
    @Insert("INSERT INTO nw_model_provider(id,owner_id,provider_type,base_url,model_name,config_fingerprint,api_key_ciphertext) VALUES(#{id},#{owner},#{type},#{url},#{model},#{fingerprint},#{secret})")
    void insert(Map<String,Object> values);
    @Delete("DELETE FROM nw_model_provider WHERE owner_id=#{owner} AND id=#{id}")
    int delete(@Param("owner") String owner,@Param("id") String id);
    @Update("UPDATE nw_expert SET model_provider_id=NULL,revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE model_provider_id=#{id}")
    int clearExpertReferences(String id);
    @Update("UPDATE nw_model_provider SET test_status=#{status},last_tested_at=CURRENT_TIMESTAMP(6),last_latency_ms=#{latency},last_model_found=#{found},updated_at=CURRENT_TIMESTAMP(6) WHERE owner_id=#{owner} AND id=#{id}")
    int tested(Map<String,Object> values);

    @Select("SELECT * FROM nw_user_model_settings WHERE user_id=#{owner}")
    Map<String,Object> settings(String owner);
    // The per-user row is also the mutex for provider deletion, settings and expert references.
    @Insert("INSERT INTO nw_user_model_settings(user_id) VALUES(#{owner}) ON DUPLICATE KEY UPDATE user_id=user_id")
    void ensureSettings(String owner);
    @Select("SELECT * FROM nw_user_model_settings WHERE user_id=#{owner} FOR UPDATE")
    Map<String,Object> lockSettings(String owner);
    @Update("UPDATE nw_user_model_settings SET default_provider_id=#{defaultProviderId},audit_fallback_provider_id=#{auditFallbackProviderId},retain_audit_trail=#{retainAuditTrail},auto_archive_artifacts=#{autoArchiveArtifacts},auto_memory_backflow=#{autoMemoryBackflow},revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=#{owner} AND revision=#{revision}")
    int updateSettings(Map<String,Object> values);
    @Insert("INSERT INTO nw_config_audit(id,actor,object_type,object_id,action_name,change_json) VALUES(#{id},#{actor},#{type},#{object},#{action},#{change})")
    void audit(Map<String,Object> values);
}
