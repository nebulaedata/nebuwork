package cn.nebulaedata.cccs.nebuwork.backend.api.platformmcp;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
/** Uses the same JSON/CSV columns as the existing FAQ import screen. */
final class PlatformMcpFaqFiles {
    static ArrayNode parse(ObjectMapper json,String text,String format){
        try{
            JsonNode entries;
            if("json".equals(format)){entries=json.readTree(text);if(entries.isObject())entries=entries.path("entries");}
            else if("csv".equals(format)){
                List<List<String>> rows=new ArrayList<>();List<String> row=new ArrayList<>();StringBuilder value=new StringBuilder();boolean quoted=false;
                for(int i=0;i<text.length();i++){char ch=text.charAt(i);if(ch=='"'){if(quoted&&i+1<text.length()&&text.charAt(i+1)=='"'){value.append('"');i++;}else quoted=!quoted;}else if(!quoted&&(ch==','||ch=='\n')){row.add(value.toString().replaceAll("\r$",""));value.setLength(0);if(ch=='\n'){rows.add(row);row=new ArrayList<>();if(rows.size()>10001)throw new ApiException(422,"最多导入10000条 FAQ");}}else value.append(ch);}
                if(quoted)throw new ApiException(422,"CSV 引号未闭合");if(value.length()>0||!row.isEmpty()){row.add(value.toString().replaceAll("\r$",""));rows.add(row);}
                if(rows.isEmpty())throw new ApiException(422,"导入文件为空");List<String> header=rows.remove(0);for(int i=0;i<header.size();i++)header.set(i,header.get(i).replace("\uFEFF","").trim());boolean chinese=header.contains("问题(必填)");if(chinese)header=Arrays.asList("tag_name","standard_question","similar_questions","negative_questions","answers","all_answers","disabled","not_recommended");
                if(!header.contains("standard_question")||!header.contains("answers"))throw new ApiException(422,"CSV 缺少 standard_question / answers 列");
                ArrayNode parsed=json.createArrayNode();for(List<String> cells:rows){if(cells.stream().allMatch(String::isEmpty))continue;ObjectNode entry=json.createObjectNode();for(int i=0;i<header.size();i++)if(i<cells.size()&&!cells.get(i).isEmpty())entry.put(header.get(i),cells.get(i));if(chinese){for(String field:Arrays.asList("answers","similar_questions","negative_questions")){ArrayNode list=entry.putArray(field);String raw=cells.size()>header.indexOf(field)?cells.get(header.indexOf(field)):"";for(String part:raw.split("##"))if(!part.isEmpty())list.add(part);}entry.put("answer_strategy",entry.path("all_answers").asText().equalsIgnoreCase("true")?"all":"random");entry.put("is_enabled",!entry.path("disabled").asText().equalsIgnoreCase("true"));entry.put("is_recommended",!entry.path("not_recommended").asText().equalsIgnoreCase("true"));entry.remove(Arrays.asList("all_answers","disabled","not_recommended"));}parsed.add(entry);}entries=parsed;
            }else throw new ApiException(422,"FAQ 文件仅支持 json/csv");
            if(!entries.isArray()||entries.size()<1||entries.size()>10000)throw new ApiException(422,"请导入1～10000条 FAQ");
            ArrayNode out=json.createArrayNode();List<String> allowed=Arrays.asList("standard_question","similar_questions","negative_questions","answers","answer_strategy","tag_name","is_enabled","is_recommended");
            for(JsonNode input:entries){if(!input.isObject()||input.path("standard_question").asText().trim().isEmpty())throw new ApiException(422,"FAQ 缺少标准问题");ObjectNode entry=((ObjectNode)input).deepCopy();entry.retain(allowed);for(String field:Arrays.asList("answers","similar_questions","negative_questions")){JsonNode raw=entry.path(field);if(raw.isTextual()){String value=raw.asText().trim();if(value.startsWith("["))entry.set(field,json.readTree(value));else{ArrayNode list=entry.putArray(field);for(String part:value.split("\r?\n"))if(!part.isEmpty())list.add(part);}}if(entry.has(field)){if(!entry.path(field).isArray())throw new ApiException(422,field+" 必须是文本数组");for(JsonNode part:entry.path(field))if(!part.isTextual())throw new ApiException(422,field+" 必须是文本数组");}}
                for(String field:Arrays.asList("is_enabled","is_recommended"))if(entry.path(field).isTextual()){String value=entry.path(field).asText();if(!value.matches("(?i)true|false|0|1"))throw new ApiException(422,field+" 必须为布尔值");entry.put(field,value.equalsIgnoreCase("true")||value.equals("1"));}out.add(entry);
            }return out;
        }catch(java.io.IOException e){throw new ApiException(422,"FAQ 文件 JSON 格式无效");}
    }
}
