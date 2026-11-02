package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import org.springframework.web.multipart.MultipartFile;
import java.nio.charset.StandardCharsets;

/** Upload paths are source labels, never local filesystem paths. */
final class KnowledgeUpload {
    static final long MAX_BYTES=2L*1024*1024*1024;
    private KnowledgeUpload() {}
    static String validate(MultipartFile file,String filename,String relativePath) {
        if(file==null||file.isEmpty()||file.getSize()>MAX_BYTES)throw new ApiException(422,"文件不能为空且不得超过 2 GiB");
        if(filename==null||filename.trim().isEmpty()||filename.length()>1024||filename.equals(".")||filename.equals("..")||filename.chars().anyMatch(c->c<32||c==127||c=='\"'||c=='/'||c=='\\'))throw new ApiException(422,"文件名无效");
        if(relativePath==null||relativePath.isEmpty())return filename;
        String path=relativePath.replace('\\','/');
        if(path.startsWith("/")||path.contains(":")||path.chars().anyMatch(c->c<32||c==127||c=='\"'))throw new ApiException(422,"文件夹路径必须是安全的相对路径");
        String[] parts=path.split("/",-1);
        if(parts.length<2||parts.length>17||!filename.equals(parts[parts.length-1]))throw new ApiException(422,"文件夹层级不得超过 16 层，路径末尾须与文件名一致");
        for(int i=0;i<parts.length-1;i++){
            String part=parts[i];
            if(part.isEmpty()||part.equals(".")||part.equals("..")||!part.equals(part.trim())||part.endsWith(".")||part.getBytes(StandardCharsets.UTF_8).length>128)throw new ApiException(422,"文件夹名称无效或超过 128 字节，请调整后上传");
        }
        if(path.substring(0,path.lastIndexOf('/')).getBytes(StandardCharsets.UTF_8).length>1024)throw new ApiException(422,"文件夹路径不得超过 1024 字节");
        return path;
    }
}
