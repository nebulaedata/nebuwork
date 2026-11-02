package cn.nebulaedata.cccs.nebuwork.backend.api.workflow;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.util.*;

@Repository
public class WorkflowStore {
    private final JdbcTemplate jdbc;
    public WorkflowStore(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public int update(String sql,Object... args) { return jdbc.update(sql,args); }
    public List<Map<String,Object>> rows(String sql,Object... args) { return jdbc.queryForList(sql,args); }
    public Map<String,Object> one(String sql,Object... args) { List<Map<String,Object>> rows=rows(sql,args);return rows.isEmpty()?null:rows.get(0); }
    public Map<String,Object> settings(boolean lock) {
        Map<String,Object> row=one("SELECT * FROM nw_workflow_settings WHERE id=1"+(lock?" FOR UPDATE":""));
        if(row==null) throw new ApiException(503,"请先应用 V14 Workflow 数据库迁移");return row;
    }
    public Map<String,Object> owned(String table,String id,String actor) {
        if(!Arrays.asList("nw_workflow","nw_workflow_task").contains(table)) throw new IllegalArgumentException();
        Map<String,Object> row=one("SELECT * FROM "+table+" WHERE id=? AND owner_id=?",id,actor);
        if(row==null) throw new ApiException(404,"工作流或任务不存在");return row;
    }
    public static boolean flag(Object value) { return Boolean.TRUE.equals(value)||(value instanceof Number&&((Number)value).intValue()!=0); }
    public static String str(Map<String,Object> row,String key) { return Objects.toString(row.get(key),""); }
    public static long number(Map<String,Object> row,String key) { Object v=row.get(key);return v==null?0:((Number)v).longValue(); }
}
