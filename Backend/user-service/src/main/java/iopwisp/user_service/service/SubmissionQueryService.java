package iopwisp.user_service.service;

import iopwisp.user_service.config.SubmissionClientProperties;
import iopwisp.user_service.dto.SubmissionSummaryResponse;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.List;

@Service
public class SubmissionQueryService {

    private static final ParameterizedTypeReference<List<SubmissionSummaryResponse>> SUBMISSION_LIST_TYPE =
            new ParameterizedTypeReference<>() {
            };

    private final RestClient restClient;

    public SubmissionQueryService(RestClient.Builder restClientBuilder, SubmissionClientProperties properties) {
        this.restClient = restClientBuilder
                .baseUrl(properties.baseUrl())
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .build();
    }

    public List<SubmissionSummaryResponse> getCurrentUserSubmissions(String authorizationHeader) {
        return restClient.get()
                .uri("/submissions/my")
                .header(HttpHeaders.AUTHORIZATION, authorizationHeader)
                .retrieve()
                .body(SUBMISSION_LIST_TYPE);
    }
}
