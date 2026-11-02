package cn.nebulaedata.cccs.nebuwork.backend.api.database;

import org.springframework.core.env.Environment;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import javax.annotation.PreDestroy;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

@Component
public class DatabaseWorker {
    final DatabaseService service;final DatabaseRuntime runtime;final Environment env;
    final ExecutorService workers=Executors.newFixedThreadPool(2,r->{Thread t=new Thread(r,"nebu-database-operation");t.setDaemon(true);return t;});final AtomicInteger active=new AtomicInteger();
    public DatabaseWorker(DatabaseService service,DatabaseRuntime runtime,Environment env){this.service=service;this.runtime=runtime;this.env=env;}
    @Scheduled(fixedDelay=1000) public void tick(){if(!service.enabled()||!env.getProperty("nebu.databases.worker-enabled",Boolean.class,true))return;service.recover();while(active.get()<2){Map<String,Object> op=service.claim();if(op==null)return;active.incrementAndGet();workers.submit(()->{try{service.process(op,()->runtime.authorizeOperation(op));}finally{active.decrementAndGet();}});}}
    @PreDestroy public void close(){workers.shutdownNow();}
}
