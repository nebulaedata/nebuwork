package cn.nebulaedata.cccs.nebuwork.backend.api.common;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Activate the durable Workflow, knowledge creation and memory queue workers. */
@Configuration
@EnableScheduling
public class BackgroundJobScheduling {
}
