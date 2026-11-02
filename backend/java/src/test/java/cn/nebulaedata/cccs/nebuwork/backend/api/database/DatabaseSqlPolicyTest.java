package cn.nebulaedata.cccs.nebuwork.backend.api.database;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

class DatabaseSqlPolicyTest {
    final ObjectMapper json=new ObjectMapper();
    JsonNode config(){return json.valueToTree(map("type","postgresql","database","test","schema","public","permissions",map("read",true,"write",true,"schema",true)));}
    @Test void validatesNestedReadQueriesAndRejectsSideEffects(){
        assertDoesNotThrow(()->DatabaseSqlPolicy.validate("WITH totals AS (SELECT code, SUM(value) AS amount FROM public.records GROUP BY code) SELECT * FROM totals WHERE amount > ?",true,config()));
        for(String sql:Arrays.asList("SELECT 1; DELETE FROM records","WITH x AS (DELETE FROM records RETURNING *) SELECT * FROM x","SELECT * INTO stolen FROM records","SELECT pg_read_file('/etc/passwd')","SELECT dblink('x','x')","SELECT * FROM private.records","SELECT * FROM records FOR UPDATE","SELECT lo_export(1,'file')","SELECT 1 /*! INTO OUTFILE 'x' */","CALL do_work()","COPY records TO PROGRAM 'x'","SELECT set_config('x','x',true)"))assertThrows(RuntimeException.class,()->DatabaseSqlPolicy.validate(sql,true,config()),sql);
    }
    @Test void dataAndSchemaWritesHaveSeparatePermissions(){JsonNode c=config();((com.fasterxml.jackson.databind.node.ObjectNode)c.path("permissions")).put("schema",false);
        assertFalse(DatabaseSqlPolicy.validate("INSERT INTO public.records(code) VALUES (?)",false,c));assertThrows(RuntimeException.class,()->DatabaseSqlPolicy.validate("CREATE TABLE x(id INTEGER)",false,c));
        for(String sql:Arrays.asList("ATTACH DATABASE 'file' AS x","CREATE DATABASE stolen","GRANT ALL ON records TO public","PRAGMA writable_schema=ON","DROP SCHEMA public","UPDATE private.records SET code='x'","SELECT 1"))assertThrows(RuntimeException.class,()->DatabaseSqlPolicy.validate(sql,false,config()),sql);
    }
    @Test void csvExportsDoNotActivateSpreadsheetFormulas(){for(String v:Arrays.asList("=1+1"," @SUM(A1)","\t=1+1","-2+3","+1"))assertTrue(DatabaseFiles.csvSafe(v).startsWith("'"));assertEquals("0012",DatabaseFiles.csvSafe("0012"));assertEquals("中文",DatabaseFiles.csvSafe("中文"));}
}
