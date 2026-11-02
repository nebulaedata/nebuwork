package cn.nebulaedata.cccs.nebuwork.backend.api.platformmcp;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;
class PlatformMcpResourceTest {
    @Test void mutableKnowledgeFilesCannotSilentlyChangeBehindAnIssuedHandle(){
        PlatformMcpDispatch dispatch=mock(PlatformMcpDispatch.class,CALLS_REAL_METHODS);
        com.fasterxml.jackson.databind.node.ObjectNode descriptor=new ObjectMapper().createObjectNode();descriptor.put("type","knowledge_source");descriptor.put("frozenSha256",dispatch.binaryHash(new byte[]{1,2,3}));
        doReturn(new PlatformMcpDispatch.Binary(new byte[]{1,2,3},"application/pdf","source.pdf")).when(dispatch).sourceBinary(null,descriptor);
        assertArrayEquals(new byte[]{1,2,3},dispatch.binary(null,descriptor).bytes);
        doReturn(new PlatformMcpDispatch.Binary(new byte[]{4,5},"application/pdf","source.pdf")).when(dispatch).sourceBinary(null,descriptor);
        assertEquals(409,assertThrows(ApiException.class,()->dispatch.binary(null,descriptor)).status);
    }
}
