package cn.nebulaedata.cccs.nebuwork.backend.api.platformmcp;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class PlatformMcpFaqFilesTest {
    final ObjectMapper json=new ObjectMapper();
    @Test void csvPreservesQuotedCommasQuotesAndMultilineAnswers(){JsonNode data=PlatformMcpFaqFiles.parse(json,"standard_question,answers,is_enabled\n\"问题,含逗号\",\"第一行\n第二行\"\"引用\"\"\",true\n","csv");assertEquals("问题,含逗号",data.path(0).path("standard_question").asText());assertEquals("第二行\"引用\"",data.path(0).path("answers").path(1).asText());assertTrue(data.path(0).path("is_enabled").asBoolean());}
    @Test void chineseTemplateAndJsonMatchExistingImport(){JsonNode csv=PlatformMcpFaqFiles.parse(json,"标签,问题(必填),相似问,反问,答案,全部,禁用,不推荐\n测试,问题,,,答案一##答案二,true,false,false","csv");assertEquals(2,csv.path(0).path("answers").size());assertEquals("all",csv.path(0).path("answer_strategy").asText());assertEquals(1,PlatformMcpFaqFiles.parse(json,"{\"entries\":[{\"standard_question\":\"问题\",\"answers\":[\"答案\"]}]}","json").size());}
    @Test void malformedOrEmptyInputIsAnExplicitFailure(){assertThrows(RuntimeException.class,()->PlatformMcpFaqFiles.parse(json,"standard_question,answers\n\"unclosed","csv"));assertThrows(RuntimeException.class,()->PlatformMcpFaqFiles.parse(json,"[]","json"));assertThrows(RuntimeException.class,()->PlatformMcpFaqFiles.parse(json,"[{\"standard_question\":\"q\",\"answers\":[42]}]","json"));}
}
