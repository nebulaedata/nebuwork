package cn.nebulaedata.cccs.nebuwork.backend.api.memory;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.util.*;

@Repository
public class MemoryStore {
    private final JdbcTemplate jdbc;
    public MemoryStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public int update(String sql, Object... args) { return jdbc.update(sql, args); }
    public List<Map<String,Object>> rows(String sql, Object... args) { return jdbc.queryForList(sql, args); }
    public Map<String,Object> one(String sql, Object... args) {
        List<Map<String,Object>> rows = rows(sql, args); return rows.isEmpty() ? null : rows.get(0);
    }
    public Map<String,Object> scope(String id) { return one("SELECT * FROM nw_memory_scope WHERE id=?", id); }
    public Map<String,Object> entry(String id, boolean lock) {
        return one("SELECT e.*,s.owner_id,s.kind,s.object_id,s.bank_id FROM nw_memory_entry e JOIN nw_memory_scope s ON s.id=e.scope_id WHERE e.id=?" + (lock ? " FOR UPDATE" : ""), id);
    }
    public Map<String,Object> context(String run) { return one("SELECT * FROM nw_memory_run_context WHERE run_id=?", run); }
    public List<Map<String,Object>> due() {
        return rows("SELECT j.id FROM nw_memory_job j WHERE ((j.state='pending' AND j.next_attempt_at<=CURRENT_TIMESTAMP(6)) OR (j.state='syncing' AND j.lease_until<CURRENT_TIMESTAMP(6))) AND NOT EXISTS (SELECT 1 FROM nw_memory_job p WHERE p.entry_id=j.entry_id AND p.sequence_no<j.sequence_no AND p.state<>'ready') ORDER BY j.sequence_no LIMIT 12");
    }
    public boolean claim(String id, String token) {
        return update("UPDATE nw_memory_job SET state='syncing',lease_token=?,lease_until=DATE_ADD(CURRENT_TIMESTAMP(6),INTERVAL 90 SECOND) WHERE id=? AND ((state='pending' AND next_attempt_at<=CURRENT_TIMESTAMP(6)) OR (state='syncing' AND lease_until<CURRENT_TIMESTAMP(6)))", token, id) == 1;
    }
    public Map<String,Object> job(String id) { return one("SELECT * FROM nw_memory_job WHERE id=?", id); }
    public Map<String,Object> fenced(String id, String token) { return one("SELECT * FROM nw_memory_job WHERE id=? AND lease_token=? FOR UPDATE", id, token); }
}
