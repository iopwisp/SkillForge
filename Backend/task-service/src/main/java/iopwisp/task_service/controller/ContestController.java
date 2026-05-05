package iopwisp.task_service.controller;

import iopwisp.task_service.dto.ContestRequest;
import iopwisp.task_service.dto.ContestResponse;
import iopwisp.task_service.service.ContestService;
import io.jsonwebtoken.Claims;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/contests")
@RequiredArgsConstructor
public class ContestController {

    private final ContestService contestService;

    @GetMapping
    public ResponseEntity<List<ContestResponse>> getAllContests() {
        return ResponseEntity.ok(contestService.getAllContests());
    }

    @GetMapping("/{id}")
    public ResponseEntity<ContestResponse> getContest(@PathVariable Long id) {
        return ResponseEntity.ok(contestService.getContest(id));
    }

    @GetMapping("/active")
    public ResponseEntity<List<ContestResponse>> getActiveContests() {
        return ResponseEntity.ok(contestService.getActiveContests());
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ContestResponse> createContest(@Valid @RequestBody ContestRequest request) {
        Long userId = extractCurrentUserId();
        return ResponseEntity.ok(contestService.createContest(userId, request));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ContestResponse> updateContest(
            @PathVariable Long id,
            @Valid @RequestBody ContestRequest request) {
        return ResponseEntity.ok(contestService.updateContest(id, request));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> deleteContest(@PathVariable Long id) {
        contestService.deleteContest(id);
        return ResponseEntity.noContent().build();
    }

    private Long extractCurrentUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth instanceof UsernamePasswordAuthenticationToken token
                && token.getDetails() instanceof Claims claims) {
            Object userId = claims.get("userId");
            if (userId instanceof Number n) {
                return n.longValue();
            }
        }
        return null;
    }
}
