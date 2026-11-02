package cn.nebulaedata.cccs.nebuwork.backend.api.workflow;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import javax.annotation.PreDestroy;
import java.sql.Timestamp;
import java.util.*;
import java.util.concurrent.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.workflow.WorkflowStore.*;

/** Durable creation only. Historical interrupted workflow runs are never auto-resumed. */
@Component
public class WorkflowWorker {
    private final WorkflowStore db;private final WorkflowSettings settings;private final WorkflowClient client;private final TransactionTemplate tx;
    private final Set<String> queued=ConcurrentHashMap.newKeySet();
    private final ThreadPoolExecutor executor=new ThreadPoolExecutor(2,2,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(2),r->{Thread t=new Thread(r,"workflow-create");t.setDaemon(true);return t;});
    public WorkflowWorker(WorkflowStore db,WorkflowSettings settings,WorkflowClient client,PlatformTransactionManager manager) { this.db=db;this.settings=settings;this.client=client;tx=new TransactionTemplate(manager); }
    @Scheduled(fixedDelay=2000) public void tick() {
        if(!settings.current().enabled)return;
        for(String table:Arrays.asList("nw_workflow","nw_workflow_task")) {
            for(Map<String,Object> row:db.rows("SELECT id FROM "+table+" WHERE state='pending' OR (state='syncing' AND lease_until<CURRENT_TIMESTAMP(6)) ORDER BY created_at LIMIT 8")) {
                String id=str(row,"id"),marker=table+":"+id;
                if(queued.size()>=4||!queued.add(marker))continue;
                try { executor.execute(()->{try { process(table,id); }finally { queued.remove(marker); }}); }
                catch(RejectedExecutionException e) { queued.remove(marker); }
            }
        }
    }
    @PreDestroy public void close() { executor.shutdownNow(); }
    void process(String table,String id) {
        if(!Arrays.asList("nw_workflow","nw_workflow_task").contains(table))throw new IllegalArgumentException();
        String token=UUID.randomUUID().toString();
        if(db.update("UPDATE "+table+" SET state='syncing',lease_token=?,lease_until=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND (state='pending' OR (state='syncing' AND lease_until<CURRENT_TIMESTAMP(6)))",token,new Timestamp(System.currentTimeMillis()+240000),id)!=1)return;
        Map<String,Object> row=db.one("SELECT * FROM "+table+" WHERE id=?",id);
        try {
            WorkflowSettings.Connection c=settings.requireEnabled();
            if("nw_workflow".equals(table)) {
                JsonNode created;
                // The reserved random remote ID belongs to this operation; recover a lost create response by reading it.
                try { created=client.request(c,"GET","/api/v1/workflows/"+str(row,"remote_id"),null); }
                catch(WorkflowClient.Failure e) { if(e.status!=404)throw e;created=client.request(c,"POST","/api/v1/workflows",map("id",str(row,"remote_id"),"name",str(row,"name"))); }
                if(!str(row,"remote_id").equals(created.path("id").asText())||created.hasNonNull("error"))throw new ApiException(502,"Workflow 创建结果无效，请检查原操作");
            } else {
                Map<String,Object> flow=db.owned("nw_workflow",str(row,"workflow_id"),str(row,"owner_id"));
                JsonNode task=client.request(c,"POST","/api/v1/tasks",map("workflow_id",str(flow,"remote_id"),"input",settings.decode(row.get("input_json")),"command_id",id+"-create"));
                String remote=task.path("id").asText();if(!remote.matches("[A-Za-z0-9_-]{1,100}"))throw new ApiException(502,"Workflow 返回了无效任务编号");
                db.update("UPDATE nw_workflow_task SET remote_id=? WHERE id=? AND lease_token=?",remote,id,token);
                // Stable version and command ID are required even if a previous start response was lost.
                client.request(c,"POST","/api/v1/tasks/"+remote+"/actions/start",map("expected_version",0,"command_id",id+"-start"));
            }
            finish(table,id,token,"ready",null);
        } catch(ApiException e) { finish(table,id,token,"failed",e.getMessage()); }
        catch(Exception e) { finish(table,id,token,"failed","创建未完成，请重试原操作或检查服务日志"); }
    }
    private void finish(String table,String id,String token,String state,String error) {
        tx.execute(s->{db.update("UPDATE "+table+" SET state=?,error=?,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND lease_token=?",state,error,id,token);return null;});
    }
}
