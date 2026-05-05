package iopwisp.user_service.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "clients.submission-service")
public record SubmissionClientProperties(String baseUrl) {
}
