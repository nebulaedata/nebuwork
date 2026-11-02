package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

final class AgentToolCatalog {
    private AgentToolCatalog(){}
    static ArrayNode tools(ObjectMapper json,boolean knowledge,boolean workflow,boolean memory){ArrayNode out=json.createArrayNode();
        if(knowledge){
            knowledge(json,out,"knowledge_capabilities","查看当前知识库支持、开启和可用的能力","capabilities");
            knowledge(json,out,"knowledge_documents","列出本轮授权知识库的文档、FAQ或Wiki页面","documents");
            knowledge(json,out,"knowledge_search","检索授权资料；可选contentKind=document/faq/wiki。返回evidenceUrl，可在回答中引用","search","query");
            knowledge(json,out,"knowledge_document","读取正文；传chunkId直接读取命中及相邻分块，page读取分页正文","document","documentId");
            knowledge(json,out,"knowledge_wiki_search","检索Wiki页面，生成内容须继续核验sourceRefs原文","wiki.search","query");
            knowledge(json,out,"knowledge_wiki_page","读取Wiki正文、双向链接及来源文档","wiki.page","documentId");
            knowledge(json,out,"knowledge_graph","查询真实实体图谱；mode=overview/query/expand。返回关系及候选来源，关系不是原文断言","graph");
            knowledge(json,out,"knowledge_gallery","浏览或检索图片；mode=config获取真实筛选属性。描述和OCR是派生内容，须核验原图及来源","gallery");
        }
        if(workflow){add(json,out,"workflow_list","查看可用工作流","workflow","list","read");add(json,out,"workflow_definition","读取工作流定义","workflow","definition","read","workflowId");add(json,out,"workflow_start","发起工作流执行","workflow","start","idempotent","workflowId","input:object");add(json,out,"workflow_status","查询工作流运行进度","workflow","status","read","taskId");add(json,out,"workflow_control","控制工作流执行","workflow","control","idempotent","taskId","action","options:object");add(json,out,"workflow_artifacts","查看工作流成果","workflow","artifacts","read","workflowId");add(json,out,"workflow_import_artifact","导入工作流成果到项目","workflow","import_artifact","idempotent","workflowId","artifactId");}
        if(memory){add(json,out,"memory_search","召回当前任务授权范围内的记忆","memory","search","read","query");add(json,out,"memory_propose","记录有来源的记忆建议","memory","propose","idempotent","kind","scopeId","title","content");}
        return out;
    }
    private static void knowledge(ObjectMapper json,ArrayNode out,String name,String description,String operation,String... required){
        Map<String,Object> props=new LinkedHashMap<>();props.put("referenceId",map("type","string"));
        for(String key:Arrays.asList("query","documentId","chunkId","mode","nodeId","sortBy","sortOrder"))props.put(key,map("type","string"));
        props.put("contentKind",map("type","string","enum",Arrays.asList("document","faq","wiki")));
        for(String key:Arrays.asList("page","pageSize","topK","limit"))props.put(key,map("type","integer","minimum",1,"maximum","page".equals(key)?1000000:"topK".equals(key)?20:"limit".equals(key)?200:100));
        for(String key:Arrays.asList("searchIn","documentIds"))props.put(key,map("type","array","items",map("type","string")));
        props.put("isEnabled",map("type","boolean"));props.put("attrFilters",map("type","object","additionalProperties",map("type","array","items",map("type","string"))));
        List<String> req=new ArrayList<>();req.add("referenceId");req.addAll(Arrays.asList(required));
        out.add(json.valueToTree(map("name",name,"description",description,"capability","knowledge","operation",operation,"replay","read","required",false,"parameters",map("type","object","properties",props,"required",req,"additionalProperties",false))));
    }
    private static void add(ObjectMapper json,ArrayNode out,String name,String description,String capability,String operation,String replay,String... fields){Map<String,Object> properties=new LinkedHashMap<>();List<String> required=new ArrayList<>();for(String f:fields){String[] pair=f.split(":");properties.put(pair[0],map("type",pair.length>1?pair[1]:"string"));required.add(pair[0]);}out.add(json.valueToTree(map("name",name,"description",description,"capability",capability,"operation",operation,"replay",replay,"required",false,"parameters",map("type","object","properties",properties,"required",required,"additionalProperties",false))));}
}
