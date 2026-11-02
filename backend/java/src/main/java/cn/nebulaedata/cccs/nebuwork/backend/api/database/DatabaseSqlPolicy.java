package cn.nebulaedata.cccs.nebuwork.backend.api.database;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import net.sf.jsqlparser.statement.Statement;
import net.sf.jsqlparser.statement.select.Select;
import net.sf.jsqlparser.statement.insert.Insert;
import net.sf.jsqlparser.statement.update.Update;
import net.sf.jsqlparser.statement.delete.Delete;
import net.sf.jsqlparser.statement.create.table.CreateTable;
import net.sf.jsqlparser.statement.create.index.CreateIndex;
import net.sf.jsqlparser.statement.alter.Alter;
import net.sf.jsqlparser.statement.drop.Drop;
import net.sf.jsqlparser.statement.truncate.Truncate;
import net.sf.jsqlparser.schema.Table;
import net.sf.jsqlparser.expression.Function;
import net.sf.jsqlparser.util.TablesNamesFinder;
import java.util.*;

/** Parse, classify and traverse SQL before opening a user database connection. */
public final class DatabaseSqlPolicy {
    private DatabaseSqlPolicy(){}
    private static final Set<String> FUNCTIONS=new HashSet<>(Arrays.asList(
        "count","sum","avg","min","max","coalesce","ifnull","nullif","lower","upper","length","char_length",
        "concat","concat_ws","substring","substr","trim","ltrim","rtrim","round","abs","ceil","ceiling","floor",
        "cast","extract","date","date_trunc","date_part","strftime","datetime","julianday","unixepoch",
        "json_extract","json_object","json_array","json_array_length","json_type","json_value","jsonb_extract_path_text",
        "string_agg","group_concat","now","current_timestamp","current_date","to_char","to_date","replace",
        "greatest","least","year","month","day","row_number","rank","dense_rank","lag","lead","first_value","last_value"));
    public static boolean validate(String sql,boolean query,JsonNode config){
        if(sql==null||sql.trim().isEmpty()||sql.length()>100000||sql.indexOf('\0')>=0||sql.contains("\\")||sql.contains("/*!"))
            throw new ApiException(422,"SQL 为空、过长或包含不支持的转义/执行注释");
        final Statement statement;
        try{List<Statement> statements=CCJSqlParserUtil.parseStatements(sql,p->p.withTimeOut(2000)).getStatements();
            if(statements.size()!=1)throw new IllegalArgumentException();statement=statements.get(0);
        }catch(Exception e){throw new ApiException(422,"仅支持一条可以完整解析的 SQL，请拆分或调整语法");}
        boolean read=statement instanceof Select;
        boolean data=statement instanceof Insert||statement instanceof Update||statement instanceof Delete;
        boolean schema=statement instanceof CreateTable||statement instanceof CreateIndex||statement instanceof Alter||statement instanceof Truncate||
            (statement instanceof Drop&&Arrays.asList("TABLE","INDEX").contains(((Drop)statement).getType().toUpperCase(Locale.ROOT)));
        if(query?!read:(!data&&!schema))throw new ApiException(422,query?"查询入口仅允许只读 SELECT":"写入入口仅支持数据写入或表/索引结构变更");
        JsonNode permissions=config.path("permissions");
        if(!permissions.path("read").asBoolean()||(data&&!permissions.path("write").asBoolean())||(schema&&!permissions.path("schema").asBoolean()))
            throw new ApiException(403,"该数据库未授权此类操作");
        String tokens=sql.replaceAll("'(''|[^'])*'","''").replaceAll("\"(\"\"|[^\"])*\"","\"\"").replaceAll("`(``|[^`])*`","``");
        if(tokens.matches("(?is).*\\b(attach|detach|pragma|vacuum|outfile|dumpfile|load|copy|call|execute|prepare|grant|revoke|extension|temporary|temp|tablespace|directory|server|program)\\b.*")||
            (read&&tokens.matches("(?is).*\\b(insert|update|delete|merge|into|lock|for)\\b.*")))
            throw new ApiException(422,"SQL 包含不允许的副作用、文件或管理操作");
        new TablesNamesFinder(){
            @Override public void visit(Table table){
                String name=unquote(table.getName()),scope=unquote(table.getSchemaName());
                String catalog=table.getDatabase()==null?"":unquote(table.getDatabase().getDatabaseName());
                String allowed=config.path("type").asText().equals("postgresql")?config.path("schema").asText("public"):config.path("database").asText();
                if(!catalog.isEmpty()||(!scope.isEmpty()&&!scope.equals(allowed))||name.toLowerCase(Locale.ROOT).startsWith("sqlite_")||name.toLowerCase(Locale.ROOT).startsWith("pg_"))
                    throw new ApiException(403,"SQL 超出当前数据库或 Schema 范围");
                super.visit(table);
            }
            @Override public void visit(Function function){
                if(!FUNCTIONS.contains(function.getName().toLowerCase(Locale.ROOT)))throw new ApiException(422,"SQL 使用了未支持的函数，请使用普通数据表达式");
                super.visit(function);
            }
        }.getTableList(statement);
        return schema;
    }
    private static String unquote(String s){return s==null?"":s.replace("`","").replace("\"","");}
    public static String identifier(String value){
        if(value==null||!value.matches("[\\p{L}_][\\p{L}\\p{N}_]{0,62}"))throw new ApiException(422,"表名或字段名需以文字/下划线开头，最多 63 个字符");
        return value;
    }
}
