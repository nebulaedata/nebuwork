package cn.nebulaedata.cccs.nebuwork.backend.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@SpringBootApplication
@EnableAsync
public class NebuworkBackendApiApplication {
    public static void main(String[] args) {
        SpringApplication.run(NebuworkBackendApiApplication.class, args);
    }
}
