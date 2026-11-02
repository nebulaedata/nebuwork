package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import org.apache.ibatis.annotations.*;
import java.util.*;

@Mapper
public interface KnowledgeMapper {
    @Select("SELECT * FROM nw_knowledge_connection WHERE owner_id=#{owner} AND scope_kind=#{kind} AND scope_id=#{scope} ORDER BY created_at,id")
    List<Map<String,Object>> connections(@Param("owner") String owner,@Param("kind") String kind,@Param("scope") String scope);
    @Select("SELECT * FROM nw_knowledge_connection WHERE owner_id=#{owner} AND id=#{id}")
    Map<String,Object> connection(@Param("owner") String owner,@Param("id") String id);
    @Select("SELECT * FROM nw_knowledge_connection WHERE owner_id=#{owner} AND id=#{id} FOR UPDATE")
    Map<String,Object> lockConnection(@Param("owner") String owner,@Param("id") String id);
    @Insert("INSERT INTO nw_knowledge_connection(id,owner_id,scope_kind,scope_id,name,driver,endpoint,auth_type,auth_header,secret_cipher,enabled,tenant_id,published,legacy_migrated) VALUES(#{id},#{owner},#{kind},#{scope},#{name},#{driver},#{endpoint},#{authType},#{authHeader},#{cipher},#{enabled},#{tenantId},#{published},TRUE)")
    void insertConnection(Map<String,Object> p);
    @Update("UPDATE nw_knowledge_connection SET name=#{name},endpoint=#{endpoint},auth_type=#{authType},auth_header=#{authHeader},secret_cipher=#{cipher},enabled=#{enabled},tenant_id=#{tenantId},published=#{published},revision=revision+1,test_status='untested',test_message='',tested_at=NULL,updated_at=CURRENT_TIMESTAMP(6) WHERE owner_id=#{owner} AND id=#{id} AND revision=#{revision}")
    int updateConnection(Map<String,Object> p);
    @Update("UPDATE nw_knowledge_connection SET test_status=#{status},test_message=#{message},tested_at=CURRENT_TIMESTAMP(6) WHERE owner_id=#{owner} AND id=#{id} AND revision=#{revision}")
    int testResult(@Param("owner") String owner,@Param("id") String id,@Param("revision") long revision,@Param("status") String status,@Param("message") String message);
    @Delete("DELETE FROM nw_knowledge_connection WHERE owner_id=#{owner} AND id=#{id} AND revision=#{revision}")
    int deleteConnection(@Param("owner") String owner,@Param("id") String id,@Param("revision") long revision);
    @Select("SELECT * FROM nw_knowledge_reference WHERE owner_id=#{owner} AND scope_kind=#{kind} AND scope_id=#{scope} ORDER BY created_at,id")
    List<Map<String,Object>> references(@Param("owner") String owner,@Param("kind") String kind,@Param("scope") String scope);
    @Select("SELECT * FROM nw_knowledge_reference WHERE owner_id=#{owner} AND connection_id=#{connection} ORDER BY created_at,id")
    List<Map<String,Object>> connectionReferences(@Param("owner") String owner,@Param("connection") String connection);
    @Insert("INSERT INTO nw_knowledge_reference(id,owner_id,scope_kind,scope_id,connection_id,collection_id,collection_hash,collection_name,indexing_status) VALUES(#{id},#{owner},#{kind},#{scope},#{connection},#{collection},#{hash},#{name},#{status})")
    void insertReference(Map<String,Object> p);
    @Delete("DELETE FROM nw_knowledge_reference WHERE owner_id=#{owner} AND scope_kind=#{kind} AND scope_id=#{scope} AND id=#{id}")
    int deleteReference(@Param("owner") String owner,@Param("kind") String kind,@Param("scope") String scope,@Param("id") String id);
    @Insert("INSERT INTO nw_knowledge_scope(owner_id,scope_kind,scope_id) VALUES(#{owner},#{kind},#{scope}) ON DUPLICATE KEY UPDATE owner_id=owner_id")
    void ensureScope(@Param("owner") String owner,@Param("kind") String kind,@Param("scope") String scope);
    @Select("SELECT revision FROM nw_knowledge_scope WHERE owner_id=#{owner} AND scope_kind=#{kind} AND scope_id=#{scope}")
    Long scopeRevision(@Param("owner") String owner,@Param("kind") String kind,@Param("scope") String scope);
    @Update("UPDATE nw_knowledge_scope SET revision=revision+1 WHERE owner_id=#{owner} AND scope_kind=#{kind} AND scope_id=#{scope} AND revision=#{revision}")
    int touchScope(@Param("owner") String owner,@Param("kind") String kind,@Param("scope") String scope,@Param("revision") long revision);
    @Insert("INSERT INTO nw_knowledge_publication(version_id,connection_id,owner_id) VALUES(#{version},#{connection},#{owner})")
    void pin(@Param("owner") String owner,@Param("version") String version,@Param("connection") String connection);
    @Select("SELECT v.id,v.workbench_id,v.version_number,w.name FROM nw_knowledge_publication k JOIN nw_ontology_version v ON v.id=k.version_id JOIN nw_workbench w ON w.id=v.workbench_id WHERE k.owner_id=#{owner} AND k.connection_id=#{connection}")
    List<Map<String,Object>> publications(@Param("owner") String owner,@Param("connection") String connection);
    @Select("SELECT p.id,p.name,p.workbench_id,v.version_number FROM nw_project p JOIN nw_ontology_version v ON v.id=p.ontology_version_id JOIN nw_knowledge_publication k ON k.version_id=v.id WHERE p.owner_id=#{owner} AND k.owner_id=#{owner} AND k.connection_id=#{connection}")
    List<Map<String,Object>> inheritingProjects(@Param("owner") String owner,@Param("connection") String connection);
    @Select("SELECT * FROM nw_project WHERE owner_id=#{owner} AND id=#{id} FOR UPDATE")
    Map<String,Object> lockProject(@Param("owner") String owner,@Param("id") String id);
}

