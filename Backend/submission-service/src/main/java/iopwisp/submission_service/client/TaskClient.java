package iopwisp.submission_service.client;

import iopwisp.submission_service.dto.ProblemStub;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.Optional;

/**
 * Resolves problem slugs to task IDs by calling task-service's
 * {@code GET /problems/{slug}} endpoint. Uses Eureka load-balancing
 * via the injected {@link RestTemplate} (see RestClientConfig).
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class TaskClient {

    private final RestTemplate restTemplate;

    public Optional<ProblemStub> getBySlug(String slug) {
        if (slug == null || slug.isBlank()) return Optional.empty();
        try {
            ProblemStub body = restTemplate.getForObject(
                    "http://task-service/problems/{slug}", ProblemStub.class, slug);
            return Optional.ofNullable(body);
        } catch (RestClientException e) {
            log.warn("Failed to resolve slug '{}' via task-service: {}", slug, e.getMessage());
            return Optional.empty();
        }
    }

    public Optional<Long> resolveSlugToId(String slug) {
        return getBySlug(slug).map(ProblemStub::getId);
    }
}
