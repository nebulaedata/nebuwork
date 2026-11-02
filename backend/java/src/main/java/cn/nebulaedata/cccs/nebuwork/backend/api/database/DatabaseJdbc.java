package cn.nebulaedata.cccs.nebuwork.backend.api.database;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import org.springframework.stereotype.Component;
import java.io.*;
import java.math.BigDecimal;
import java.nio.file.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.*;

/** Connections are operation-local. No user credentials are installed in the business datasource. */
@Component
public class DatabaseJdbc {
    final DatabaseSettings settings;final ObjectMapper json;
    public DatabaseJdbc(DatabaseSettings settings,ObjectMapper json){this.settings=settings;this.json=json;}
    public Session open(JsonNode config,String password,byte[] snapshot)throws Exception{return new Session(config,password,snapshot);}
    public final class Session implements AutoCloseable {
        public final Connection connection;final JsonNode config;final String type;final Path temporary;boolean committed;
        Session(JsonNode config,String password,byte[] snapshot)throws Exception{
            this.config=config;type=config.path("type").asText();Path dir=null;Connection opened=null;
            try{
                Properties p=new Properties();String url;
                if(type.equals("sqlite")){
                    dir=Files.createTempDirectory("nebu-database-");Path file=dir.resolve("database.sqlite");if(snapshot!=null)Files.write(file,snapshot);
                    Class.forName("org.sqlite.JDBC");url="jdbc:sqlite:"+file.toAbsolutePath();p.setProperty("busy_timeout","5000");p.setProperty("enable_load_extension","false");
                }else{
                    String host=config.path("host").asText();int port=config.path("port").asInt();settings.target(host,port);
                    p.setProperty("user",config.path("username").asText());p.setProperty("password",password);
                    String database=config.path("database").asText();
                    if(type.equals("mysql")){
                        Class.forName("com.mysql.cj.jdbc.Driver");url="jdbc:mysql://"+host+":"+port+"/"+database;
                        p.setProperty("sslMode",config.path("tls").asText().equals("disabled")?"DISABLED":"VERIFY_IDENTITY");
                        p.setProperty("allowMultiQueries","false");p.setProperty("allowLoadLocalInfile","false");p.setProperty("allowUrlInLocalInfile","false");p.setProperty("allowPublicKeyRetrieval","false");
                        p.setProperty("connectTimeout","5000");p.setProperty("socketTimeout",String.valueOf((settings.timeout()+5)*1000));p.setProperty("useUnicode","true");p.setProperty("characterEncoding","UTF-8");
                    }else{
                        Class.forName("org.postgresql.Driver");url="jdbc:postgresql://"+host+":"+port+"/"+database;
                        p.setProperty("sslmode",config.path("tls").asText().equals("disabled")?"disable":"verify-full");p.setProperty("connectTimeout","5");p.setProperty("socketTimeout",String.valueOf(settings.timeout()+5));
                        p.setProperty("currentSchema",config.path("schema").asText("public"));p.setProperty("ApplicationName","NebuWork database resource");
                    }
                }
                opened=DriverManager.getConnection(url,p);
                if(type.equals("sqlite"))try(Statement s=opened.createStatement()){s.execute("PRAGMA journal_mode=DELETE");s.execute("PRAGMA foreign_keys=ON");s.execute("PRAGMA trusted_schema=OFF");if(snapshot==null)s.execute("PRAGMA user_version=0");}
                connection=opened;temporary=dir;
            }catch(Exception e){if(opened!=null)try{opened.close();}catch(Exception ignored){}if(dir!=null)clean(dir);throw e;}
        }
        String schema(){return type.equals("postgresql")?config.path("schema").asText("public"):null;}
        String catalog(){return type.equals("mysql")?config.path("database").asText():null;}
        String quote(String name){String q=type.equals("mysql")?"`":"\"";return q+name.replace(q,q+q)+q;}
        String qualified(String name){return type.equals("postgresql")?quote(schema())+"."+quote(name):quote(name);}
        public void begin(boolean read)throws SQLException{
            if(!type.equals("sqlite"))connection.setReadOnly(read);
            if(type.equals("mysql"))try(Statement s=connection.createStatement()){s.execute("SET SESSION sql_mode=CONCAT(@@sql_mode,',NO_BACKSLASH_ESCAPES')");}
            if(type.equals("sqlite")&&read)try(Statement s=connection.createStatement()){s.execute("PRAGMA query_only=ON");}
            connection.setAutoCommit(false);
            if(type.equals("postgresql"))try(Statement s=connection.createStatement()){s.execute("SET LOCAL statement_timeout="+(settings.timeout()*1000));s.execute("SET LOCAL lock_timeout=5000");}
        }
        public void commit()throws SQLException{connection.commit();committed=true;}
        public byte[] snapshot()throws Exception{
            connection.close();byte[] data=Files.readAllBytes(temporary.resolve("database.sqlite"));if(data.length>settings.maxBytes())throw new ApiException(413,"SQLite 超出服务端容量限制，原数据版本保持有效");return data;
        }
        public List<Map<String,Object>> tables()throws SQLException{
            List<Map<String,Object>> rows=new ArrayList<>();try(ResultSet r=connection.getMetaData().getTables(catalog(),schema(),"%",new String[]{"TABLE","VIEW"})){
                while(r.next()){String name=r.getString("TABLE_NAME"),kind=r.getString("TABLE_TYPE");if(name.startsWith("sqlite_")||name.startsWith("pg_")||name.startsWith("_nebu_"))continue;
                    rows.add(map("name",name,"type",kind.equalsIgnoreCase("VIEW")?"view":"table","comment",r.getString("REMARKS")));}
            }rows.sort(Comparator.comparing(r->r.get("name").toString()));return rows;
        }
        public Map<String,Object> structure(String table)throws SQLException{
            Map<String,Object> found=null;for(Map<String,Object> row:tables())if(row.get("name").equals(table))found=row;
            if(found==null)throw new ApiException(404,"表或视图不存在");
            List<Map<String,Object>> columns=new ArrayList<>(),indexes=new ArrayList<>();TreeMap<Short,String> primary=new TreeMap<>();DatabaseMetaData md=connection.getMetaData();
            try(ResultSet r=md.getPrimaryKeys(catalog(),schema(),table)){while(r.next())primary.put(r.getShort("KEY_SEQ"),r.getString("COLUMN_NAME"));}
            try(ResultSet r=md.getColumns(catalog(),schema(),table,"%")){while(r.next()){
                String generated="NO",auto="NO";try{generated=r.getString("IS_GENERATEDCOLUMN");auto=r.getString("IS_AUTOINCREMENT");}catch(SQLException ignored){}
                String name=r.getString("COLUMN_NAME");columns.add(map("name",name,"type",r.getString("TYPE_NAME"),"jdbcType",r.getInt("DATA_TYPE"),"nullable",r.getInt("NULLABLE")!=DatabaseMetaData.columnNoNulls,
                    "defaultValue",r.getString("COLUMN_DEF"),"primaryKey",primary.containsValue(name),"generated","YES".equals(generated),"autoIncrement","YES".equals(auto),"comment",r.getString("REMARKS")));}}
            Map<String,TreeMap<Short,String>> unique=new LinkedHashMap<>();
            if(!found.get("type").equals("view"))try(ResultSet r=md.getIndexInfo(catalog(),schema(),table,false,false)){while(r.next()){
                String index=r.getString("INDEX_NAME"),column=r.getString("COLUMN_NAME");if(index==null||column==null)continue;
                boolean nonUnique=r.getBoolean("NON_UNIQUE");indexes.add(map("name",index,"column",column,"unique",!nonUnique));
                if(!nonUnique)unique.computeIfAbsent(index,k->new TreeMap<>()).put(r.getShort("ORDINAL_POSITION"),column);
            }}
            List<String> key=new ArrayList<>(primary.values());
            if(key.isEmpty())for(TreeMap<Short,String> fields:unique.values()){
                boolean safe=true;for(String field:fields.values())if(columns.stream().noneMatch(c->c.get("name").equals(field)&&Boolean.FALSE.equals(c.get("nullable"))))safe=false;
                if(safe){key.addAll(fields.values());break;}}
            return map("name",table,"type",found.get("type"),"columns",columns,"indexes",indexes,"keyColumns",key,"editable",!key.isEmpty()&&!found.get("type").equals("view"));
        }
        @SuppressWarnings("unchecked") Map<String,Map<String,Object>> columns(Map<String,Object> structure){Map<String,Map<String,Object>> out=new LinkedHashMap<>();for(Map<String,Object> c:(List<Map<String,Object>>)structure.get("columns"))out.put(c.get("name").toString(),c);return out;}
        void transactional(String table)throws SQLException{
            if(type.equals("mysql"))try(PreparedStatement s=connection.prepareStatement("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?")){s.setString(1,catalog());s.setString(2,table);try(ResultSet r=s.executeQuery()){if(!r.next()||!"InnoDB".equalsIgnoreCase(r.getString(1)))throw new ApiException(422,"批量写入和行编辑仅支持 InnoDB 事务表");}}
        }
        public Map<String,Object> query(String sql,JsonNode params,int limit)throws Exception{
            if(!params.isArray()||params.size()>10000)throw new ApiException(422,"SQL 参数必须是数组且不超过 10000 项");List<Object> values=new ArrayList<>();for(JsonNode p:params)values.add(value(p));return queryValues(sql,values,limit);
        }
        private Map<String,Object> queryValues(String sql,List<Object> values,int limit)throws Exception{
            try(PreparedStatement s=connection.prepareStatement(sql)){
                s.setQueryTimeout(settings.timeout());s.setMaxRows(limit+1);for(int i=0;i<values.size();i++)s.setObject(i+1,values.get(i));
                try(ResultSet r=s.executeQuery()){return result(r,limit);}
            }
        }
        public Map<String,Object> execute(String sql,JsonNode params)throws Exception{
            try(PreparedStatement s=connection.prepareStatement(sql)){s.setQueryTimeout(settings.timeout());bind(s,params);int affected=s.executeUpdate();return map("affectedRows",affected,"queriedAt",Instant.now().toString());}
        }
        public Map<String,Object> browse(String table,JsonNode args)throws Exception{
            Map<String,Object> structure=structure(table);Map<String,Map<String,Object>> cols=columns(structure);List<Object> params=new ArrayList<>();List<String> filters=new ArrayList<>();
            for(JsonNode filter:args.path("filters")){String column=filter.path("column").asText();if(!cols.containsKey(column))throw new ApiException(422,"筛选字段不存在");String op=filter.path("operator").asText("eq"),q=quote(column);
                if(op.equals("is_null")){filters.add(q+" IS NULL");continue;}
                Map<String,String> operators=new HashMap<>();operators.put("eq","=");operators.put("gt",">");operators.put("lt","<");operators.put("gte",">=");operators.put("lte","<=");operators.put("contains","LIKE");if(!operators.containsKey(op))throw new ApiException(422,"不支持的筛选条件");
                if(op.equals("contains"))q="CAST("+q+" AS "+(type.equals("mysql")?"CHAR":"TEXT")+")";
                filters.add(q+" "+operators.get(op)+" ?");params.add(op.equals("contains")?"%"+filter.path("value").asText()+"%":columnValue(cols.get(column),filter.path("value")));}
            int size=Math.min(100,Math.max(1,args.path("pageSize").asInt(100))),page=Math.max(1,Math.min(1000000,args.path("page").asInt(1)));String sort=args.path("sortBy").asText();
            if(!sort.isEmpty()&&!cols.containsKey(sort))throw new ApiException(422,"排序字段不存在");
            String sql="SELECT * FROM "+qualified(table)+(filters.isEmpty()?"":" WHERE "+String.join(" AND ",filters));
            if(!sort.isEmpty())sql+=" ORDER BY "+quote(sort)+(args.path("sortOrder").asText().equals("desc")?" DESC":" ASC");
            else {List<?> keys=(List<?>)structure.get("keyColumns");if(!keys.isEmpty()){List<String> order=new ArrayList<>();for(Object k:keys)order.add(quote(k.toString()));sql+=" ORDER BY "+String.join(",",order);}}
            sql+=" LIMIT "+(size+1)+" OFFSET "+((long)(page-1)*size);
            Map<String,Object> result=queryValues(sql,params,size);result.put("page",page);result.put("pageSize",size);result.put("structure",structure);
            List<String> hashes=new ArrayList<>();for(Object row:(List<?>)result.get("rows"))hashes.add(fingerprint(json.valueToTree(row)));result.put("rowHashes",hashes);return result;
        }
        @SuppressWarnings("unchecked") public Map<String,Object> mutateRow(String table,JsonNode args)throws Exception{
            transactional(table);Map<String,Object> structure=structure(table);Map<String,Map<String,Object>> cols=columns(structure);
            if(!Boolean.TRUE.equals(structure.get("editable")))throw new ApiException(422,"此表缺少可靠唯一键或为视图，无法安全修改/删除行");
            List<String> keys=(List<String>)structure.get("keyColumns");List<String> where=new ArrayList<>();List<Object> params=new ArrayList<>();
            for(String key:keys){if(!args.path("key").hasNonNull(key))throw new ApiException(422,"缺少行唯一键");where.add(quote(key)+"=?");params.add(columnValue(cols.get(key),args.path("key").get(key)));}
            Map<String,Object> selected=queryValues("SELECT * FROM "+qualified(table)+" WHERE "+String.join(" AND ",where)+(type.equals("sqlite")?"":" FOR UPDATE"),params,2);
            List<?> rows=(List<?>)selected.get("rows");if(rows.size()!=1||!fingerprint(json.valueToTree(rows.get(0))).equals(args.path("rowHash").asText()))throw new ApiException(409,"这行数据已变化，请刷新后重新编辑");
            if(args.path("action").asText().equals("delete"))return executeValues("DELETE FROM "+qualified(table)+" WHERE "+String.join(" AND ",where),params);
            List<String> setters=new ArrayList<>();List<Object> all=new ArrayList<>();Iterator<Map.Entry<String,JsonNode>> fields=args.path("values").fields();
            while(fields.hasNext()){Map.Entry<String,JsonNode> f=fields.next();Map<String,Object> c=cols.get(f.getKey());if(c==null||keys.contains(f.getKey())||Boolean.TRUE.equals(c.get("generated")))throw new ApiException(422,"不能修改唯一键、生成列或未知字段");setters.add(quote(f.getKey())+"=?");all.add(columnValue(c,f.getValue()));}
            if(setters.isEmpty())throw new ApiException(422,"没有需要修改的字段");all.addAll(params);return executeValues("UPDATE "+qualified(table)+" SET "+String.join(",",setters)+" WHERE "+String.join(" AND ",where),all);
        }
        Map<String,Object> executeValues(String sql,List<Object> values)throws SQLException{try(PreparedStatement s=connection.prepareStatement(sql)){s.setQueryTimeout(settings.timeout());for(int i=0;i<values.size();i++)s.setObject(i+1,values.get(i));return map("affectedRows",s.executeUpdate());}}
        public Map<String,Object> insert(String table,JsonNode rows,Runnable checkpoint)throws Exception{
            transactional(table);Map<String,Object> structure=structure(table);if(structure.get("type").equals("view"))throw new ApiException(422,"视图首期只读");Map<String,Map<String,Object>> columns=columns(structure);
            if(!rows.isArray()||rows.isEmpty()||rows.size()>10000)throw new ApiException(422,"每批需包含 1–10000 行数据");int affected=0,index=0;
            for(JsonNode row:rows){checkpoint.run();index++;if(!row.isObject())throw new ApiException(422,"第 "+index+" 行必须是字段对象");
                if(row.isEmpty()){try{affected+=((Number)executeValues(type.equals("mysql")?"INSERT INTO "+qualified(table)+" () VALUES ()":"INSERT INTO "+qualified(table)+" DEFAULT VALUES",Collections.emptyList()).get("affectedRows")).intValue();continue;}catch(SQLException e){throw new ApiException(422,"第 "+index+" 行缺少必填字段，整批未提交");}}
                List<String> names=new ArrayList<>();List<Object> values=new ArrayList<>();Iterator<Map.Entry<String,JsonNode>> fields=row.fields();
                while(fields.hasNext()){Map.Entry<String,JsonNode> f=fields.next();Map<String,Object> c=columns.get(f.getKey());if(c==null||Boolean.TRUE.equals(c.get("generated")))throw new ApiException(422,"第 "+index+" 行包含未知字段或生成列");names.add(quote(f.getKey()));values.add(columnValue(c,f.getValue()));}
                try{Map<String,Object> out=executeValues("INSERT INTO "+qualified(table)+" ("+String.join(",",names)+") VALUES ("+String.join(",",Collections.nCopies(names.size(),"?"))+")",values);affected+=((Number)out.get("affectedRows")).intValue();}
                catch(SQLException e){throw new ApiException(422,"第 "+index+" 行不符合字段类型或唯一键约束，整批未提交");}
            }return map("affectedRows",affected);
        }
        public Map<String,Object> createTable(JsonNode args)throws Exception{
            String name=DatabaseSqlPolicy.identifier(args.path("table").asText());List<String> definitions=new ArrayList<>(),keys=new ArrayList<>();Set<String> names=new HashSet<>();JsonNode fields=args.path("columns");
            if(!fields.isArray()||fields.isEmpty()||fields.size()>200)throw new ApiException(422,"请配置 1–200 个字段");
            for(JsonNode c:fields){String field=DatabaseSqlPolicy.identifier(c.path("name").asText());if(!names.add(field.toLowerCase(Locale.ROOT)))throw new ApiException(422,"字段名重复");String t=c.path("type").asText("TEXT").toUpperCase(Locale.ROOT);
                if(!Arrays.asList("TEXT","VARCHAR","INTEGER","BIGINT","DECIMAL","REAL","DOUBLE","BOOLEAN","DATE","TIMESTAMP","JSON","BLOB").contains(t))throw new ApiException(422,"不支持的字段类型");
                if(t.equals("VARCHAR"))t="VARCHAR(255)";if(t.equals("DECIMAL"))t="DECIMAL(38,10)";if(t.equals("BLOB")&&type.equals("postgresql"))t="BYTEA";if(t.equals("DOUBLE")&&type.equals("postgresql"))t="DOUBLE PRECISION";
                boolean pk=c.path("primaryKey").asBoolean(),auto=c.path("autoIncrement").asBoolean();String def=quote(field)+" "+t;
                if(auto){if(!pk||!(t.equals("INTEGER")||t.equals("BIGINT")))throw new ApiException(422,"自增字段必须是整数主键");
                    if(type.equals("sqlite")){if(fields.findValues("primaryKey").stream().filter(JsonNode::asBoolean).count()>1)throw new ApiException(422,"SQLite 自增仅支持单列主键");def=quote(field)+" INTEGER PRIMARY KEY AUTOINCREMENT";}
                    else def+=type.equals("mysql")?" AUTO_INCREMENT":" GENERATED BY DEFAULT AS IDENTITY";}
                if(pk&&!(auto&&type.equals("sqlite")))keys.add(quote(field));if(!c.path("nullable").asBoolean(true)||pk)def+=" NOT NULL";
                if(c.has("defaultValue")&&!auto){JsonNode d=c.get("defaultValue");if(d.isContainerNode())throw new ApiException(422,"默认值必须是常量");def+=" DEFAULT "+(d.isNull()?"NULL":d.isNumber()?d.asText():d.isBoolean()?(d.asBoolean()?"TRUE":"FALSE"):"'"+d.asText().replace("'","''")+"'");}
                definitions.add(def);}
            if(!keys.isEmpty())definitions.add("PRIMARY KEY ("+String.join(",",keys)+")");String sql="CREATE TABLE "+qualified(name)+" ("+String.join(",",definitions)+")"+(type.equals("mysql")?" ENGINE=InnoDB":"");
            return execute(sql,json.createArrayNode());
        }
        private Map<String,Object> result(ResultSet r,int limit)throws Exception{
            ResultSetMetaData md=r.getMetaData();List<Map<String,Object>> columns=new ArrayList<>();for(int i=1;i<=md.getColumnCount();i++)columns.add(map("name",md.getColumnLabel(i),"type",md.getColumnTypeName(i),"jdbcType",md.getColumnType(i)));
            List<List<Object>> rows=new ArrayList<>();boolean truncated=false;int bytes=0;
            int budget=limit>settings.maxRows()?settings.fileBytes():settings.resultBytes();
            while(r.next()){if(rows.size()==limit){truncated=true;break;}List<Object> row=new ArrayList<>();for(int i=1;i<=md.getColumnCount();i++)row.add(cell(r,i,md.getColumnType(i)));bytes+=encode(json,row).getBytes(java.nio.charset.StandardCharsets.UTF_8).length;if(bytes>budget)throw new ApiException(413,"查询结果超过容量限制，请缩小查询范围或分批导出");rows.add(row);}
            return map("columns",columns,"rows",rows,"rowCount",rows.size(),"truncated",truncated,"queriedAt",Instant.now().toString());
        }
        private Object cell(ResultSet r,int i,int jdbc)throws SQLException{
            if(r.getObject(i)==null)return null;
            if(Arrays.asList(Types.BINARY,Types.VARBINARY,Types.LONGVARBINARY,Types.BLOB).contains(jdbc)){byte[] bytes=r.getBytes(i);return map("type","binary","size",bytes.length,"sha256",DatabaseObjects.digest(bytes));}
            if(Arrays.asList(Types.BIGINT,Types.DECIMAL,Types.NUMERIC).contains(jdbc))return r.getString(i);
            Object value=r.getObject(i);if(value instanceof Number||value instanceof Boolean)return value;String text=r.getString(i);if(text!=null&&text.length()>1024*1024)throw new ApiException(413,"单元格超过 1 MiB，请缩小查询字段");return text;
        }
        private Object columnValue(Map<String,Object> column,JsonNode node){
            if(node==null||node.isNull())return null;int t=((Number)column.get("jdbcType")).intValue();try{
                if(Arrays.asList(Types.INTEGER,Types.SMALLINT,Types.TINYINT,Types.BIGINT,Types.NUMERIC,Types.DECIMAL,Types.DOUBLE,Types.FLOAT,Types.REAL).contains(t))return new BigDecimal(node.asText());
                if(t==Types.DATE)return java.sql.Date.valueOf(node.asText());
                if(t==Types.TIMESTAMP)return Timestamp.valueOf(node.asText().replace('T',' '));
                if(t==Types.TIMESTAMP_WITH_TIMEZONE)return OffsetDateTime.parse(node.asText());
                if(type.equals("postgresql")&&(t==Types.OTHER||t==Types.ARRAY)){org.postgresql.util.PGobject object=new org.postgresql.util.PGobject();object.setType(column.get("type").toString());object.setValue(node.isContainerNode()?node.toString():node.asText());return object;}
                if(t==Types.BOOLEAN||t==Types.BIT){if(!Arrays.asList("true","false","1","0").contains(node.asText()))throw new IllegalArgumentException();return node.asText().equals("true")||node.asText().equals("1");}
                return value(node);
            }catch(Exception e){throw new ApiException(422,"字段 "+column.get("name")+" 的值与类型不一致");}
        }
        private void bind(PreparedStatement s,JsonNode params)throws SQLException{if(!params.isArray()||params.size()>10000)throw new ApiException(422,"SQL 参数必须是数组且不超过 10000 项");for(int i=0;i<params.size();i++)s.setObject(i+1,value(params.get(i)));}
        private Object value(JsonNode node){if(node==null||node.isNull())return null;if(node.isBoolean())return node.asBoolean();if(node.isIntegralNumber())return node.canConvertToLong()?node.longValue():node.decimalValue();if(node.isFloatingPointNumber())return node.doubleValue();if(node.isTextual())return node.asText();throw new ApiException(422,"数据单元格必须为字符串、数字、布尔值或 NULL");}
        @Override public void close(){try{if(!connection.isClosed()){if(!connection.getAutoCommit())connection.rollback();connection.close();}}catch(SQLException ignored){}if(temporary!=null)clean(temporary);}
    }
    private static void clean(Path directory){try(java.util.stream.Stream<Path> files=Files.walk(directory)){files.sorted(Comparator.reverseOrder()).forEach(path->{try{Files.deleteIfExists(path);}catch(IOException ignored){}});}catch(IOException ignored){}}
}
