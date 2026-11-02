package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletResponse;
import javax.servlet.ServletOutputStream;
import javax.servlet.WriteListener;
import java.net.InetSocketAddress;
import java.io.OutputStream;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicLong;
import static org.junit.jupiter.api.Assertions.*;

class KnowledgeLargeStreamTest {
    @Test void streamsPastTheLegacy100MiBLimitWithoutBufferingAndPreservesRange()throws Exception{
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);long size=128L*1024*1024;
        server.createContext("/api/v1/knowledge/document/preview",exchange->{
            assertEquals("fixture-key",exchange.getRequestHeaders().getFirst("X-API-Key"));boolean range=exchange.getRequestHeaders().containsKey("Range");
            exchange.getResponseHeaders().set("Content-Type","application/pdf");exchange.getResponseHeaders().set("Accept-Ranges","bytes");if(range)exchange.getResponseHeaders().set("Content-Range","bytes 0-3/"+size);
            exchange.sendResponseHeaders(range?206:200,range?4:size);try(OutputStream output=exchange.getResponseBody()){if(range)output.write(new byte[]{'%', 'P', 'D', 'F'});else{byte[] chunk=new byte[65536];for(long offset=0;offset<size;offset+=chunk.length)output.write(chunk);}}finally{exchange.close();}
        });server.start();String root="http://127.0.0.1:"+server.getAddress().getPort();MockEnvironment env=new MockEnvironment().withProperty("nebu.knowledge.allowed-internal-origins",root);
        KnowledgeRestClient client=new KnowledgeRestClient(new ObjectMapper(),env,new KnowledgeNetworkPolicy(env));AtomicLong bytes=new AtomicLong();
        MockHttpServletResponse sink=new MockHttpServletResponse(){@Override public ServletOutputStream getOutputStream(){return new ServletOutputStream(){public void write(int b){bytes.incrementAndGet();}public void write(byte[] b,int offset,int length){bytes.addAndGet(length);}public boolean isReady(){return true;}public void setWriteListener(WriteListener listener){}};}};
        try{client.execute(root,Collections.singletonMap("X-API-Key","fixture-key"),session->{session.streamPreview("/knowledge/document/preview",null,sink);return null;});assertEquals(size,bytes.get());bytes.set(0);
            client.execute(root,Collections.singletonMap("X-API-Key","fixture-key"),session->{session.streamPreview("/knowledge/document/preview","bytes=0-3",sink);return null;});assertEquals(206,sink.getStatus());assertEquals(4,bytes.get());assertEquals("bytes 0-3/"+size,sink.getHeader("Content-Range"));
        }finally{client.close();server.stop(0);}
    }
}
