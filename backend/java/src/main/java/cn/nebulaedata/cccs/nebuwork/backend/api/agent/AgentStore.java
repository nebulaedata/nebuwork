package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.util.*;

/** Business associations and configuration only; no duplicate engine transcript. */
@Repository
public class AgentStore {
    public final JdbcTemplate jdbc;
    public AgentStore(JdbcTemplate jdbc){this.jdbc=jdbc;}
    public List<Map<String,Object>> rows(String sql,Object... args){return jdbc.queryForList(sql,args);}
    public Map<String,Object> one(String sql,Object... args){List<Map<String,Object>> rows=rows(sql,args);return rows.isEmpty()?null:rows.get(0);}
    public int update(String sql,Object...args){return jdbc.update(sql,args);}
    public Map<String,Object> task(String id){return one("SELECT * FROM nw_agent_task WHERE id=?",id);}
    public Map<String,Object> session(String session){return one("SELECT * FROM nw_agent_task WHERE session_id=?",session);}
    public Map<String,Object> draft(String owner,String kind,String target){return one("SELECT * FROM nw_agent_resource WHERE owner_id=? AND scope_kind=? AND scope_id=?",owner,kind,target);}
    public Map<String,Object> active(String owner,String kind,String target){return one("SELECT v.* FROM nw_agent_resource d JOIN nw_agent_resource_version v ON v.id=d.active_version_id WHERE d.owner_id=? AND d.scope_kind=? AND d.scope_id=?",owner,kind,target);}
}
