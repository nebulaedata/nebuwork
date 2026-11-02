package cn.nebulaedata.cccs.nebuwork.backend.api.database;

import cn.nebulaedata.cccs.nebuwork.backend.api.agent.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.ModelSecretCipher;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.*;

@Service
public class DatabaseService {
    final AgentStore db;final ObjectMapper json;final DatabaseSettings settings;final RuntimeResources scopes;
    final ModelSecretCipher cipher;final DatabaseObjects objects;final DatabaseJdbc jdbc;final DatabaseFiles files;final AgentClient engine;final TransactionTemplate tx;
    public DatabaseService(AgentStore db,ObjectMapper json,DatabaseSettings settings,RuntimeResources scopes,ModelSecretCipher cipher,DatabaseObjects objects,DatabaseJdbc jdbc,DatabaseFiles files,AgentClient engine,PlatformTransactionManager manager){
        this.db=db;this.json=json;this.settings=settings;this.scopes=scopes;this.cipher=cipher;this.objects=objects;this.jdbc=jdbc;this.files=files;this.engine=engine;tx=new TransactionTemplate(manager);tx.setTimeout(240);tx.setIsolationLevel(org.springframework.transaction.TransactionDefinition.ISOLATION_READ_COMMITTED);
    }
    public boolean enabled(){return settings.enabled();}
    public Map<String,Object> owned(String owner,String id){settings.require();Map<String,Object> row=db.one("SELECT * FROM nw_database WHERE owner_id=? AND id=? AND deleted=FALSE",owner,id);if(row==null)throw new ApiException(404,"数据库不存在或没有访问权限");scopes.authorize(owner,str(row,"scope_kind"),str(row,"scope_id"));return row;}
    JsonNode version(Map<String,Object> row,long version){Map<String,Object> v=db.one("SELECT * FROM nw_database_version WHERE database_id=? AND owner_id=? AND version=?",row.get("id"),row.get("owner_id"),version);if(v==null)throw new ApiException(409,"数据库配置版本不存在，请重新加载");return decode(json,v.get("config_json"));}
    public Map<String,Object> view(String owner,String id){return view(owned(owner,id),false);}
    Map<String,Object> view(Map<String,Object> row,boolean inherited){
        ObjectNode draft=(ObjectNode)decode(json,row.get("draft_json"));boolean hasPassword=draft.hasNonNull("secretCiphertext");draft.remove("secretCiphertext");draft.put("hasPassword",hasPassword);
        JsonNode config=row.get("active_version")==null?json.createObjectNode():version(row,number(row,"active_version"));
        return map("id",row.get("id"),"scopeKind",row.get("scope_kind"),"scopeId",row.get("scope_id"),"name",row.get("name"),"description",row.get("description"),"type",row.get("driver"),"revision",row.get("revision"),"configVersion",row.get("active_version"),"enabled",bool(row.get("enabled")),"dataVersion",row.get("data_version"),"inherited",inherited,
            "permissions",config.path("permissions"),"draft",draft,"activeConfig",config,"testStatus",row.get("test_status"),"testedAt",time(row.get("tested_at")),"createdAt",time(row.get("created_at")));
    }
    public Object scope(String owner,String kind,String id){
        scopes.authorize(owner,kind,id);List<Object> rows=new ArrayList<>();if(!enabled())return map("enabled",false,"databases",rows);
        for(Map<String,Object> r:db.rows("SELECT * FROM nw_database WHERE owner_id=? AND scope_kind=? AND scope_id=? AND deleted=FALSE ORDER BY created_at,id",owner,kind,id))rows.add(view(r,false));
        if(kind.equals("project")){Map<String,Object> project=db.one("SELECT workbench_id FROM nw_project WHERE id=? AND owner_id=?",id,owner);String wb=str(project,"workbench_id");
            for(Map<String,Object> r:db.rows("SELECT * FROM nw_database WHERE owner_id=? AND scope_kind='workbench' AND scope_id=? AND deleted=FALSE ORDER BY created_at,id",owner,wb))rows.add(view(r,true));}
        return map("enabled",true,"scopeKind",kind,"scopeId",id,"databases",rows);
    }
    ObjectNode config(String owner,String id,JsonNode body,JsonNode previous){
        ObjectNode out=json.createObjectNode();String type=text(body,"type",16,true);if(!Arrays.asList("sqlite","mysql","postgresql").contains(type))throw new ApiException(422,"不支持的数据库类型");
        out.put("type",type);out.put("name",text(body,"name",240,true));out.put("description",text(body,"description",2400,false));
        ObjectNode permissions=out.putObject("permissions");permissions.put("read",true);permissions.put("write",body.path("permissions").path("write").asBoolean(type.equals("sqlite")));permissions.put("schema",body.path("permissions").path("schema").asBoolean(type.equals("sqlite")));
        if(!type.equals("sqlite")){
            String host=text(body,"host",253,true),database=text(body,"database",63,true),schema=text(body,"schema",63,false),username=text(body,"username",128,true),tls=text(body,"tls",32,false);
            if(!database.matches("[\\p{L}\\p{N}_-]{1,63}")||(!schema.isEmpty()&&!schema.matches("[\\p{L}_][\\p{L}\\p{N}_]{0,62}")))throw new ApiException(422,"数据库名或 Schema 格式不正确");
            int port=body.path("port").asInt(type.equals("mysql")?3306:5432);settings.target(host,port);if(tls.isEmpty())tls="verify-full";if(!Arrays.asList("verify-full","disabled").contains(tls))throw new ApiException(422,"不支持的 TLS 配置");
            out.put("host",host.toLowerCase(Locale.ROOT));out.put("port",port);out.put("database",database);out.put("schema",type.equals("postgresql")?(schema.isEmpty()?"public":schema):"");out.put("username",username);out.put("tls",tls);
            if(body.has("password")){JsonNode value=body.get("password");if(!value.isTextual()||value.asText().length()>10000)throw new ApiException(422,"密码格式不正确");out.put("secretCiphertext",cipher.encrypt(owner,"database:"+id,value.asText()));}
            else if(previous.hasNonNull("secretCiphertext"))out.set("secretCiphertext",previous.get("secretCiphertext"));
            else throw new ApiException(422,"请填写数据库密码");
        }return out;
    }
    String endpoint(JsonNode config){ObjectNode copy=json.createObjectNode();for(String field:Arrays.asList("type","host","port","database","schema","username","tls"))if(config.has(field))copy.set(field,config.get(field));return fingerprint(copy);}
    ObjectNode publicConfig(JsonNode config){ObjectNode copy=config.deepCopy();copy.remove("secretCiphertext");return copy;}
    public Object create(String owner,String kind,String target,JsonNode body,String requestKey,JsonNode run){
        settings.require();scopes.authorize(owner,kind,target);String id="db-"+hash(owner+":"+kind+":"+target+":"+key(requestKey)).substring(0,40);ObjectNode config=config(owner,id,body,json.createObjectNode());
        return tx.execute(status->{
            if(db.one("SELECT id FROM nw_database WHERE id=?",id)!=null)throw new ApiException(409,"原创建请求已存在，请通过原操作恢复");
            String sha=null,storage=null;long bytes=0;
            if(config.path("type").asText().equals("sqlite")){
                storage=objects.storage(owner);try(DatabaseJdbc.Session session=jdbc.open(config,"",null)){byte[] data=session.snapshot();JsonNode object=objects.put(owner,data);sha=object.path("sha256").asText();bytes=data.length;}
                catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(503,"无法创建 SQLite，请检查服务端 JDBC 与对象存储配置");}
            }
            db.update("INSERT INTO nw_database(id,owner_id,scope_kind,scope_id,name,description,driver,draft_json,active_version,enabled,data_version,object_sha256,storage_id) VALUES(?,?,?,?,?,?,?,?,1,TRUE,?,?,?)",id,owner,kind,target,config.path("name").asText(),config.path("description").asText(),config.path("type").asText(),config.toString(),sha==null?0:1,sha,storage);
            db.update("INSERT INTO nw_database_version(database_id,version,owner_id,config_json,secret_ciphertext,endpoint_hash) VALUES(?,1,?,?,?,?)",id,owner,publicConfig(config).toString(),config.path("secretCiphertext").asText(null),endpoint(config));
            if(sha!=null)db.update("INSERT INTO nw_database_snapshot(database_id,version,owner_id,object_sha256,storage_id,size_bytes) VALUES(?,1,?,?,?,?)",id,owner,sha,storage,bytes);
            if(run!=null)db.update("INSERT INTO nw_database_run_grant(database_id,owner_id,run_id,include_children,config_version) VALUES(?,?,?,?,1)",id,owner,run.path("id").asText(),!run.hasNonNull("parentRunId")&&kind.equals("project"));
            return view(owner,id);
        });
    }
    public Object save(String owner,String id,JsonNode body){return tx.execute(status->{
        owned(owner,id);Map<String,Object> row=db.one("SELECT * FROM nw_database WHERE owner_id=? AND id=? FOR UPDATE",owner,id);revision(row,body);
        ObjectNode config=config(owner,id,body.path("config"),decode(json,row.get("draft_json")));if(!config.path("type").asText().equals(str(row,"driver")))throw new ApiException(422,"已有数据库不能更换类型，请新建连接");long next=number(row,"revision")+1;
        db.update("UPDATE nw_database SET name=?,description=?,draft_json=?,revision=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=?",config.path("name").asText(),config.path("description").asText(),config.toString(),next,id);
        if(body.path("publish").asBoolean())publishVersion(owner,id,next,config);return view(owner,id);
    });}
    void publishVersion(String owner,String id,long version,JsonNode config){db.update("INSERT INTO nw_database_version(database_id,version,owner_id,config_json,secret_ciphertext,endpoint_hash) VALUES(?,?,?,?,?,?)",id,version,owner,publicConfig(config).toString(),config.path("secretCiphertext").asText(null),endpoint(config));db.update("UPDATE nw_database SET active_version=?,enabled=TRUE WHERE id=?",version,id);}
    public Object change(String owner,String id,String action,JsonNode body){return tx.execute(status->{owned(owner,id);Map<String,Object> row=db.one("SELECT * FROM nw_database WHERE id=? AND owner_id=? FOR UPDATE",id,owner);revision(row,body);
        if(action.equals("disable"))db.update("UPDATE nw_database SET enabled=FALSE,revision=revision+1 WHERE id=?",id);
        else if(action.equals("enable"))db.update("UPDATE nw_database SET enabled=TRUE,revision=revision+1 WHERE id=?",id);
        else if(action.equals("remove")){db.update("UPDATE nw_database SET enabled=FALSE,deleted=TRUE,revision=revision+1 WHERE id=?",id);return map("removed",true);}
        else throw new ApiException(422,"未知数据库管理操作");return view(owner,id);
    });}
    public Object test(String owner,String id){Map<String,Object> row=owned(owner,id);JsonNode config=decode(json,row.get("draft_json"));String state="ready",message="连接成功";
        try(DatabaseJdbc.Session session=jdbc.open(config,secret(owner,id,config.path("secretCiphertext").asText(null)),sqlite(row))){session.connection.getMetaData().getDatabaseProductName();}
        catch(Exception e){state="failed";message=e instanceof ApiException?e.getMessage():"连接失败，请检查地址、账号权限、TLS 和服务端网络";}
        db.update("UPDATE nw_database SET test_status=?,tested_at=CURRENT_TIMESTAMP(6) WHERE id=? AND owner_id=?",state,id,owner);return map("status",state,"message",message,"database",view(owner,id));
    }
    String secret(String owner,String id,String encrypted){return encrypted==null?"":cipher.decrypt(owner,"database:"+id,encrypted);}
    byte[] sqlite(Map<String,Object> row){return "sqlite".equals(row.get("driver"))?objects.get(str(row,"owner_id"),str(row,"object_sha256"),str(row,"storage_id")):null;}
    public ArrayNode references(String owner,String kind,String target){ArrayNode out=json.createArrayNode();if(!enabled())return out;scopes.authorize(owner,kind,target);
        for(Map<String,Object> row:db.rows("SELECT * FROM nw_database WHERE owner_id=? AND scope_kind=? AND scope_id=? AND deleted=FALSE AND enabled=TRUE AND active_version IS NOT NULL ORDER BY created_at,id",owner,kind,target))out.add(reference(row,number(row,"active_version")));return out;
    }
    ObjectNode reference(Map<String,Object> row,long version){JsonNode config=version(row,version);return json.valueToTree(map("id",row.get("id"),"name",config.path("name"),"description",config.path("description"),"type",row.get("driver"),"scopeKind",row.get("scope_kind"),"scopeId",row.get("scope_id"),"configVersion",version,"permissions",config.path("permissions")));}
    public JsonNode active(String owner,String id,long frozenVersion){Map<String,Object> row=owned(owner,id);if(!bool(row.get("enabled")))throw new ApiException(403,"数据库已停用");JsonNode frozen=version(row,frozenVersion),current=version(row,number(row,"active_version"));
        if(!endpoint(frozen).equals(endpoint(current)))throw new ApiException(409,"数据库连接身份已改变，请开启新一轮执行");ObjectNode effective=frozen.deepCopy();ObjectNode permissions=effective.with("permissions");for(String p:Arrays.asList("read","write","schema"))permissions.put(p,frozen.path("permissions").path(p).asBoolean()&&current.path("permissions").path(p).asBoolean());return effective;
    }
    void requirePermission(JsonNode config,String operation,JsonNode args){
        String permission=Arrays.asList("create_table").contains(operation)?"schema":Arrays.asList("insert_rows","mutate_row","import").contains(operation)?"write":"read";
        if(!config.path("permissions").path(permission).asBoolean())throw new ApiException(403,"数据库未授权此操作");
        if(operation.equals("query")||operation.equals("execute")||operation.equals("export")){
            boolean query=!operation.equals("execute");String sql=args.path("sql").asText();if(sql.isEmpty()&&operation.equals("export"))return;DatabaseSqlPolicy.validate(sql,query,config);
        }
        if(operation.equals("import")&&args.has("createTable")&&!config.path("permissions").path("schema").asBoolean())throw new ApiException(403,"新建表导入需要结构修改权限");
    }
    public void authorizeSource(String owner,String database,JsonNode source){String project=text(source,"projectId",128,true);if(project.equals("database-"+database))return;scopes.authorize(owner,"project",project);}
    public Object preview(String owner,String id,JsonNode body){owned(owner,id);authorizeSource(owner,id,body.path("source"));return files.preview(owner,body.path("source"),body.path("sheet").asText(""),body.path("encoding").asText("UTF-8"));}
    public Object submit(String owner,String id,JsonNode body,String requestKey,JsonNode identity){
        Map<String,Object> row=owned(owner,id);String operation=text(body,"operation",32,true);if(!Arrays.asList("schema","browse","query","execute","create_table","mutate_row","insert_rows","import","export").contains(operation))throw new ApiException(422,"未知数据库操作");
        long version=body.has("configVersion")?body.path("configVersion").asLong():number(row,"active_version");JsonNode config=active(owner,id,version),args=body.path("arguments");if(!args.isObject()||args.toString().length()>settings.fileBytes())throw new ApiException(422,"操作参数格式不正确或超过容量限制");requirePermission(config,operation,args);
        if(operation.equals("import"))authorizeSource(owner,id,args.path("source"));String project=text(body,"projectId",128,false);if(!project.isEmpty())scopes.authorize(owner,"project",project);
        String taskId=text(body,"taskId",128,false);if(!taskId.isEmpty()){Map<String,Object> task=db.one("SELECT * FROM nw_agent_task WHERE id=? AND owner_id=? AND project_id=?",taskId,owner,project);if(task==null)throw new ApiException(404,"任务不属于所选项目");}
        String requestHash=fingerprint(body),opId="dbo-"+hash(owner+":"+id+":"+key(requestKey)).substring(0,40);
        return tx.execute(status->{db.update("INSERT INTO nw_database_operation(id,owner_id,database_id,request_key,request_hash,operation,config_version,arguments_ciphertext,project_id,task_id,run_id,identity_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id",opId,owner,id,requestKey,requestHash,operation,version,cipher.encrypt(owner,"database-operation:"+opId,args.toString()),project.isEmpty()?null:project,taskId.isEmpty()?null:taskId,identity==null?null:identity.path("runId").asText(),identity==null?null:identity.toString());
            Map<String,Object> op=db.one("SELECT * FROM nw_database_operation WHERE id=? FOR UPDATE",opId);sameHash(op,requestHash);return operationView(op);});
    }
    Map<String,Object> operationView(Map<String,Object> row){return map("id",row.get("id"),"operationId",row.get("id"),"databaseId",row.get("database_id"),"operation",row.get("operation"),"state",row.get("state"),"configVersion",row.get("config_version"),"result",row.get("result_json")==null?null:decode(json,row.get("result_json")),"error",row.get("error_message"),"errorStatus",row.get("error_status"),"cancelRequested",bool(row.get("cancel_requested")),"projectId",row.get("project_id"),"taskId",row.get("task_id"),"runId",row.get("run_id"),"createdAt",time(row.get("created_at")),"updatedAt",time(row.get("updated_at")));}
    public Object operation(String owner,String id,String operation){owned(owner,id);Map<String,Object> row=db.one("SELECT * FROM nw_database_operation WHERE owner_id=? AND database_id=? AND id=?",owner,id,operation);if(row==null)throw new ApiException(404,"数据库操作不存在");return operationView(row);}
    public Object history(String owner,String id,int offset){owned(owner,id);List<Object> rows=new ArrayList<>();for(Map<String,Object> r:db.rows("SELECT * FROM nw_database_operation WHERE owner_id=? AND database_id=? ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?",owner,id,Math.max(0,offset)))rows.add(operationView(r));return map("items",rows);}
    public Object cancel(String owner,String id,String operation){operation(owner,id,operation);db.update("UPDATE nw_database_operation SET cancel_requested=TRUE,state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND state IN ('queued','running')",operation);return operation(owner,id,operation);}
    JsonNode originalExport(Map<String,Object> op){
        String owner=str(op,"owner_id"),project=Objects.toString(op.get("project_id"),"database-"+op.get("database_id"));
        JsonNode receipt=engine.get(owner,project,"/v1/requests/artifact/"+AgentClient.segment(project)+"?key=database-export:"+op.get("id"));
        JsonNode artifact=receipt.path("result");return receipt.path("found").asBoolean()&&project.equals(artifact.path("projectId").asText())?artifact:null;
    }
    public Object reconcileExport(String owner,String id,String operation){operation(owner,id,operation);Map<String,Object> op=db.one("SELECT * FROM nw_database_operation WHERE id=? AND owner_id=? AND database_id=?",operation,owner,id);
        if(!"export".equals(op.get("operation"))||!"unknown".equals(op.get("state")))return operationView(op);
        try{JsonNode artifact=originalExport(op);if(artifact!=null){String project=Objects.toString(op.get("project_id"),"database-"+id);db.update("UPDATE nw_database_operation SET state='completed',result_json=?,error_status=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND state='unknown'",encode(json,map("artifact",artifact,"projectId",project,"rowCount",null,"queriedAt",null,"recovered",true)),operation);}}
        catch(ApiException e){if(e.status<500)throw e;}return operation(owner,id,operation);
    }
    public byte[] download(String owner,String id){Map<String,Object> row=owned(owner,id);JsonNode config=active(owner,id,number(row,"active_version"));if(!config.path("type").asText().equals("sqlite"))throw new ApiException(422,"仅 SQLite 支持整库下载");return sqlite(row);}
    Map<String,Object> claim(){return tx.execute(status->{
        Map<String,Object> op=db.one("SELECT o.* FROM nw_database_operation o WHERE o.state='queued' AND NOT EXISTS (SELECT 1 FROM nw_database_operation running WHERE running.database_id=o.database_id AND running.state='running') ORDER BY o.created_at,o.id LIMIT 1 FOR UPDATE");
        if(op==null)return null;String token=id();db.update("UPDATE nw_database_operation SET state='running',worker_token=?,lease_until=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=?",token,Timestamp.from(Instant.now().plusSeconds(300)),op.get("id"));op.put("worker_token",token);return op;
    });}
    void recover(){for(Map<String,Object> op:db.rows("SELECT o.*,d.driver FROM nw_database_operation o JOIN nw_database d ON d.id=o.database_id WHERE o.state='running' AND o.lease_until<CURRENT_TIMESTAMP(6)")){
        boolean read=Arrays.asList("query","browse","schema").contains(op.get("operation")),safe=!"export".equals(op.get("operation"))&&(read||"sqlite".equals(op.get("driver")));
        db.update("UPDATE nw_database_operation SET state=?,error_message=?,worker_token=NULL,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND state='running' AND lease_until<CURRENT_TIMESTAMP(6)",safe?"queued":"unknown",safe?null:"执行节点退出，操作结果待核对，未自动重放",op.get("id"));}}
    void fence(Map<String,Object> op){Map<String,Object> current=db.one("SELECT state,worker_token,cancel_requested,lease_until FROM nw_database_operation WHERE id=?",op.get("id"));if(current==null||!"running".equals(current.get("state"))||!Objects.equals(op.get("worker_token"),current.get("worker_token")))throw new ApiException(409,"数据库操作执行权已失效");if(bool(current.get("cancel_requested")))throw new ApiException(499,"数据库操作已取消");if(((Timestamp)current.get("lease_until")).toInstant().isBefore(Instant.now()))throw new ApiException(409,"数据库操作执行租约已过期");}
    /** SQL + object snapshot publish + ledger result are fenced by one business transaction. */
    public void process(Map<String,Object> op,Runnable authorize){
        String owner=str(op,"owner_id"),database=str(op,"database_id"),operation=str(op,"operation");AtomicBoolean externalEffect=new AtomicBoolean(false);AtomicBoolean externalCommitted=new AtomicBoolean(false);AtomicBoolean importedTableCreated=new AtomicBoolean(false);
        try{tx.execute(status->{
            fence(op);authorize.run();owned(owner,database);Map<String,Object> row=db.one("SELECT * FROM nw_database WHERE id=? AND owner_id=? FOR UPDATE",database,owner);JsonNode config=active(owner,database,number(op,"config_version"));JsonNode args=decode(json,cipher.decrypt(owner,"database-operation:"+op.get("id"),str(op,"arguments_ciphertext")));requirePermission(config,operation,args);
            boolean sqlite="sqlite".equals(row.get("driver")),write=!Arrays.asList("schema","browse","query","export").contains(operation);Map<String,Object> activeVersion=db.one("SELECT * FROM nw_database_version WHERE database_id=? AND version=?",database,row.get("active_version"));
            long deadline=System.nanoTime()+230000000000L;AtomicLong last=new AtomicLong();Runnable checkpoint=()->{if(System.nanoTime()>deadline)throw new ApiException(408,"数据库操作超时，未提交的数据已回滚");long now=System.currentTimeMillis();if(now-last.get()>250){last.set(now);fence(op);}};
            try(DatabaseJdbc.Session session=jdbc.open(config,secret(owner,database,str(activeVersion,"secret_ciphertext")),sqlite(row))){
                session.begin(!write);Map<String,Object> result;
                switch(operation){
                    case "schema":result=args.path("table").asText().isEmpty()?map("tables",session.tables()):session.structure(args.path("table").asText());break;
                    case "browse":result=session.browse(text(args,"table",240,true),args);break;
                    case "query":result=session.query(args.path("sql").asText(),args.has("params")?args.get("params"):json.createArrayNode(),settings.maxRows());break;
                    case "execute":
                        boolean ddl=DatabaseSqlPolicy.validate(args.path("sql").asText(),false,config);
                        if(!ddl&&!sqlite)for(String table:new net.sf.jsqlparser.util.TablesNamesFinder().getTableList(net.sf.jsqlparser.parser.CCJSqlParserUtil.parse(args.path("sql").asText())))session.transactional(table.replace("`","").replace("\"","").replaceFirst("^.*\\.",""));
                        result=session.execute(args.path("sql").asText(),args.has("params")?args.get("params"):json.createArrayNode());if(!sqlite&&ddl)externalEffect.set(true);break;
                    case "create_table":result=session.createTable(args);if(!sqlite)externalEffect.set(true);break;
                    case "insert_rows":result=session.insert(text(args,"table",240,true),args.path("rows"),checkpoint);break;
                    case "mutate_row":result=session.mutateRow(text(args,"table",240,true),args);break;
                    case "import":
                        authorizeSource(owner,database,args.path("source"));JsonNode rows=files.mappedRows(files.parse(owner,args.path("source"),args.path("sheet").asText(""),args.path("encoding").asText("UTF-8")),args.path("mapping"));
                        if(rows.isEmpty())throw new ApiException(422,"导入文件没有数据行");if(args.has("createTable")){session.createTable(args.path("createTable"));if(!sqlite&&config.path("type").asText().equals("mysql"))importedTableCreated.set(true);}
                        result=session.insert(text(args,"table",240,true),rows,checkpoint);break;
                    case "export":
                        String sql=args.path("sql").asText();if(sql.isEmpty()){String table=text(args,"table",240,true);session.structure(table);sql="SELECT * FROM "+session.qualified(table);}
                        Map<String,Object> selected=session.query(sql,args.has("params")?args.get("params"):json.createArrayNode(),100000);String format=args.path("format").asText("csv");byte[] bytes=files.export(selected,format);
                        String project=Objects.toString(op.get("project_id"),"database-"+database);String name=text(args,"name",220,false);if(name.isEmpty())name="数据库导出";name=name.replaceAll("[\\\\/\\r\\n]","_")+"."+format;
                        ObjectNode payload=json.valueToTree(map("name",name,"mode","create","mediaType",format.equals("csv")?"text/csv":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","contentBase64",Base64.getEncoder().encodeToString(bytes)));
                        if(op.get("task_id")!=null){Map<String,Object> task=db.task(str(op,"task_id"));if(task!=null)payload.put("sessionId",str(task,"session_id"));}
                        JsonNode artifact;
                        try{artifact=engine.post(owner,project,"/v1/projects/"+AgentClient.segment(project)+"/artifacts",payload,"database-export:"+op.get("id"));}
                        catch(ApiException e){if(e.status<500)throw e;externalEffect.set(true);try{artifact=originalExport(op);}catch(ApiException unavailable){throw e;}if(artifact==null)throw e;}
                        externalEffect.set(true);result=map("artifact",artifact,"projectId",project,"rowCount",selected.get("rowCount"),"queriedAt",selected.get("queriedAt"));break;
                    default:throw new ApiException(422,"数据库操作未实现");
                }
                checkpoint.run();authorize.run();requirePermission(active(owner,database,number(op,"config_version")),operation,args);fence(op);
                if(!sqlite&&write)externalEffect.set(true);session.commit();if(!sqlite&&write)externalCommitted.set(true);
                if(sqlite&&write){byte[] bytes=session.snapshot();JsonNode object=objects.put(owner,bytes);long next=number(row,"data_version")+1;
                    int updated=db.update("UPDATE nw_database SET object_sha256=?,data_version=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND data_version=?",object.path("sha256").asText(),next,database,row.get("data_version"));if(updated!=1)throw new ApiException(409,"数据库版本已变化，未发布本次快照");
                    db.update("INSERT INTO nw_database_snapshot(database_id,version,owner_id,object_sha256,storage_id,size_bytes,operation_id) VALUES(?,?,?,?,?,?,?)",database,next,owner,object.path("sha256").asText(),row.get("storage_id"),bytes.length,op.get("id"));result.put("dataVersion",next);
                }else if(sqlite)result.put("dataVersion",row.get("data_version"));
                int updated=db.update("UPDATE nw_database_operation SET state='completed',result_json=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND worker_token=? AND state='running'",encode(json,result),op.get("id"),op.get("worker_token"));if(updated!=1)throw new ApiException(409,"执行权已失效，未提交本次数据版本");return null;
            }catch(ApiException e){throw e;}catch(Exception e){if(e instanceof SQLException&&(((SQLException)e).getSQLState()==null||((SQLException)e).getSQLState().startsWith("08")||e instanceof SQLTimeoutException))externalEffect.set(!sqlite&&write);throw new DatabaseFailure(e);}
        });}catch(Exception e){Throwable cause=e instanceof DatabaseFailure?e.getCause():e;boolean unknown=externalCommitted.get()||externalEffect.get();int error=cause instanceof ApiException?((ApiException)cause).status:422;String message=unknown?"外部写入或结构变更结果待核对，未自动重放":cause instanceof ApiException?cause.getMessage():"数据库操作失败，请检查表结构、字段类型、约束与连接权限";
            if(!unknown&&importedTableCreated.get())message+="；本次新建表保留，未提交的导入数据已回滚";
            db.update("UPDATE nw_database_operation SET state=?,error_status=?,error_message=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND worker_token=? AND state='running'",unknown?"unknown":error==499?"cancelled":"failed",error,message,op.get("id"),op.get("worker_token"));
        }
    }
    static final class DatabaseFailure extends RuntimeException{DatabaseFailure(Throwable cause){super(cause);}}
}
