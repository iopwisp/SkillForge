package iopwisp.submission_service.config;

import org.springframework.cloud.client.loadbalancer.LoadBalanced;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

/**
 * Service-to-service HTTP client. The {@link LoadBalanced @LoadBalanced}
 * annotation integrates with the Spring Cloud load-balancer + Eureka so we
 * can call other services by their application name (e.g. {@code http://task-service/...}).
 */
@Configuration
public class RestClientConfig {

    @Bean
    @LoadBalanced
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}
