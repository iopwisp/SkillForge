package iopwisp.submission_service;

import iopwisp.submission_service.dto.JudgeRequest;
import iopwisp.submission_service.dto.SubmissionRequest;
import iopwisp.submission_service.model.Submission;
import iopwisp.submission_service.repository.SubmissionRepository;
import iopwisp.submission_service.service.ResourceNotFoundException;
import iopwisp.submission_service.service.SubmissionRateLimitService;
import iopwisp.submission_service.service.SubmissionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.core.KafkaTemplate;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SubmissionServiceTest {

    @Mock
    private SubmissionRepository submissionRepository;

    @Mock
    private KafkaTemplate<String, Object> kafkaTemplate;

    @Mock
    private SubmissionRateLimitService submissionRateLimitService;

    @InjectMocks
    private SubmissionService submissionService;

    private Submission submission;
    private SubmissionRequest request;

    @BeforeEach
    void setUp() {
        request = new SubmissionRequest(1L,
                "public class Main { public static void main(String[] args) {} }",
                "java");

        submission = new Submission();
        submission.setId(1L);
        submission.setTaskId(1L);
        submission.setUserId(2L);
        submission.setCode(request.getSourceCode());
        submission.setLanguage(request.getLanguage());
        submission.setStatus(Submission.Status.RUNNING);
    }

    @Test
    void submitCode_shouldCreateSubmissionAndSendToKafka() {
        when(submissionRepository.save(any(Submission.class))).thenReturn(submission);

        var response = submissionService.submitCode(2L, request);

        assertThat(response).isNotNull();
        assertThat(response.getTaskId()).isEqualTo(1L);
        assertThat(response.getUserId()).isEqualTo(2L);
        assertThat(response.getStatus()).isEqualTo(Submission.Status.RUNNING);
        verify(submissionRepository).save(any(Submission.class));
        verify(submissionRateLimitService).assertWithinLimit(2L);
        verify(kafkaTemplate).send(eq("submission.created"), any(JudgeRequest.class));
    }

    @Test
    void getSubmission_success() {
        when(submissionRepository.findById(1L)).thenReturn(Optional.of(submission));

        var response = submissionService.getSubmission(1L);

        assertThat(response).isNotNull();
        assertThat(response.getId()).isEqualTo(1L);
        assertThat(response.getStatus()).isEqualTo(Submission.Status.RUNNING);
        verify(submissionRepository).findById(1L);
    }

    @Test
    void getSubmission_notFound_throwsResourceNotFoundException() {
        when(submissionRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> submissionService.getSubmission(99L))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Submission not found");
        verify(submissionRepository).findById(99L);
    }
}
