package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import org.springframework.core.env.Environment;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.util.concurrent.*;
import java.util.*;
import javax.annotation.PreDestroy;

@Component
public class KnowledgeCreationWorker {
    private final KnowledgeCreationService service;private final Environment env;
    private final ExecutorService pool=Executors.newFixedThreadPool(2,r->{Thread t=new Thread(r,"knowledge-creation");t.setDaemon(true);return t;});
    private final Set<String> active=ConcurrentHashMap.newKeySet();
    public KnowledgeCreationWorker(KnowledgeCreationService service,Environment env){this.service=service;this.env=env;}
    @Scheduled(fixedDelay=2000) public void tick(){if(!env.getProperty("nebu.knowledge.creation-worker-enabled",Boolean.class,true)||active.size()>=2)return;for(String id:service.due())if(active.size()<2&&active.add(id))pool.submit(()->{try{service.process(id);}finally{active.remove(id);}});}
    @PreDestroy public void close(){pool.shutdownNow();}
}
