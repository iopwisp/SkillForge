package iopwisp.submission_service.controller;

import io.jsonwebtoken.Claims;
import iopwisp.submission_service.client.TaskClient;
import iopwisp.submission_service.dto.SlugSubmissionRequest;
import iopwisp.submission_service.dto.SubmissionRequest;
import iopwisp.submission_service.dto.SubmissionResponse;
import iopwisp.submission_service.model.Submission;
import iopwisp.submission_service.service.SubmissionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@RestController
@RequestMapping("/submissions")
@RequiredArgsConstructor
public class SubmissionController {

    private final SubmissionService submissionService;
    private final TaskClient taskClient;

    // ---------- existing ID-based endpoints ----------

    @PostMapping
    public ResponseEntity<SubmissionResponse> submitCode(@Valid @RequestBody SubmissionRequest request) {
        return ResponseEntity.ok(submissionService.submitCode(currentUserId(), request));
    }

    @GetMapping("/my")
    public ResponseEntity<List<SubmissionResponse>> getMySubmissions() {
        return ResponseEntity.ok(submissionService.getUserSubmissions(currentUserId()));
    }

    @GetMapping("/user/{userId}")
    public ResponseEntity<List<SubmissionResponse>> getUserSubmissions(@PathVariable Long userId) {
        return ResponseEntity.ok(submissionService.getUserSubmissions(userId));
    }

    @GetMapping("/task/{taskId}")
    public ResponseEntity<List<SubmissionResponse>> getTaskSubmissions(@PathVariable Long taskId) {
        return ResponseEntity.ok(submissionService.getTaskSubmissions(taskId));
    }

    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("Submission Service is running");
    }

    // ---------- slug-based endpoints (used by the frontend) ----------

    /** Resolve slug via task-service, then return submissions for that task. */
    @GetMapping("/by-slug/{slug}")
    public ResponseEntity<List<SubmissionResponse>> getTaskSubmissionsBySlug(@PathVariable String slug) {
        Long taskId = taskClient.resolveSlugToId(slug).orElse(null);
        if (taskId == null) return ResponseEntity.ok(List.of());
        return ResponseEntity.ok(submissionService.getTaskSubmissions(taskId));
    }

    /** Alternate mount the frontend uses: /submissions/problem/{slug}. */
    @GetMapping("/problem/{slug}")
    public ResponseEntity<List<SubmissionResponse>> getTaskSubmissionsByProblemSlug(@PathVariable String slug) {
        return getTaskSubmissionsBySlug(slug);
    }

    /** Submit by slug — translates to existing ID-based submit. */
    @PostMapping("/by-slug/{slug}")
    public ResponseEntity<SubmissionResponse> submitBySlug(
            @PathVariable String slug,
            @Valid @RequestBody SlugSubmissionRequest req) {
        Long taskId = taskClient.resolveSlugToId(slug)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Problem not found: " + slug));
        SubmissionRequest forwarded = new SubmissionRequest(taskId, req.getCode(), req.getLanguage());
        return ResponseEntity.ok(submissionService.submitCode(currentUserId(), forwarded));
    }

    /**
     * Test-run endpoint. PASS 1: returns a synthetic PENDING response without
     * persisting anything. A real implementation needs to push the code to
     * judge-service and wait for a verdict.
     */
    @PostMapping("/by-slug/{slug}/run")
    public ResponseEntity<SubmissionResponse> runBySlug(
            @PathVariable String slug,
            @Valid @RequestBody SlugSubmissionRequest req) {
        // Validate that the slug resolves (so the frontend gets a clean 404 if typo),
        // but intentionally do NOT create a DB row.
        Optional<Long> taskId = taskClient.resolveSlugToId(slug);
        if (taskId.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Problem not found: " + slug);
        }
        SubmissionResponse stub = new SubmissionResponse();
        stub.setId(0L);
        stub.setTaskId(taskId.get());
        stub.setUserId(currentUserId());
        stub.setSourceCode(req.getCode());
        stub.setLanguage(req.getLanguage());
        stub.setStatus(Submission.Status.PENDING);
        stub.setPassedTestCases(0);
        stub.setTotalTestCases(0);
        stub.setSubmittedAt(LocalDateTime.now());
        return ResponseEntity.ok(stub);
    }

    // Keep /{submissionId} LAST so the slug-based paths above take precedence.
    @GetMapping("/{submissionId:\\d+}")
    public ResponseEntity<SubmissionResponse> getSubmission(@PathVariable Long submissionId) {
        return ResponseEntity.ok(submissionService.getSubmission(submissionId));
    }

    // ---------- helpers ----------

    private Long currentUserId() {
        UsernamePasswordAuthenticationToken authentication =
                (UsernamePasswordAuthenticationToken) SecurityContextHolder.getContext().getAuthentication();
        Claims claims = (Claims) authentication.getDetails();
        return claims.get("userId", Long.class);
    }
}
