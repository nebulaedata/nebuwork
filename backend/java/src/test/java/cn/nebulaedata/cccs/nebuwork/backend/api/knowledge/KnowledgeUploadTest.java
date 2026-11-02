package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class KnowledgeUploadTest {
    MultipartFile file(){return new MockMultipartFile("file","a.md","text/markdown","正文".getBytes(StandardCharsets.UTF_8));}
    @Test void preservesLegacyNamesAndNormalizesRelativeSeparators(){
        assertEquals("a.md",KnowledgeUpload.validate(file(),"a.md",null));
        assertEquals("公司/制度/a.md",KnowledgeUpload.validate(file(),"a.md","公司\\制度\\a.md"));
        assertEquals("a.md",KnowledgeUpload.validate(file(),"a.md",""));
    }
    @ParameterizedTest @ValueSource(strings={"/etc/a.md","C:/资料/a.md","../a.md","资料/../a.md","资料//a.md","资料./a.md","资料 /a.md","资料/other.md","资料\r\n/a.md"})
    void rejectsUnsafePaths(String path){assertEquals(422,assertThrows(ApiException.class,()->KnowledgeUpload.validate(file(),"a.md",path)).status);}
    @Test void rejectsEmptyOversizedAndHeaderInjectionBeforeOpeningAReceipt(){
        assertThrows(ApiException.class,()->KnowledgeUpload.validate(new MockMultipartFile("file",new byte[0]),"a.md",null));
        MultipartFile big=mock(MultipartFile.class);when(big.getSize()).thenReturn(KnowledgeUpload.MAX_BYTES+1);
        assertThrows(ApiException.class,()->KnowledgeUpload.validate(big,"a.md",null));
        when(big.getSize()).thenReturn(KnowledgeUpload.MAX_BYTES);assertEquals("a.md",KnowledgeUpload.validate(big,"a.md",null));
        when(big.getSize()).thenReturn(768L*1024*1024);assertEquals("a.md",KnowledgeUpload.validate(big,"a.md",null));
        assertThrows(ApiException.class,()->KnowledgeUpload.validate(file(),"a\".md",null));
        assertThrows(ApiException.class,()->KnowledgeUpload.validate(file(),"a\r\n.md",null));
    }
    @Test void enforcesUpstreamByteAndDepthLimitsWithoutTruncatingChinese(){
        String segment=new String(new char[43]).replace('\0','中');
        assertThrows(ApiException.class,()->KnowledgeUpload.validate(file(),"a.md",segment+"/a.md"));
        String depth=String.join("/",java.util.Collections.nCopies(16,"目录"));
        assertEquals(depth+"/a.md",KnowledgeUpload.validate(file(),"a.md",depth+"/a.md"));
        assertThrows(ApiException.class,()->KnowledgeUpload.validate(file(),"a.md",depth+"/多/a.md"));
        String longPath=String.join("/",java.util.Collections.nCopies(9,new String(new char[128]).replace('\0','a')));
        assertThrows(ApiException.class,()->KnowledgeUpload.validate(file(),"a.md",longPath+"/a.md"));
    }
}
