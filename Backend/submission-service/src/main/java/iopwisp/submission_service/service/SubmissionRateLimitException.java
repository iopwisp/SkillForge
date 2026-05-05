package iopwisp.submission_service.service;

public class SubmissionRateLimitException extends RuntimeException {
    public SubmissionRateLimitException(String message) {
        super(message);
    }
}
