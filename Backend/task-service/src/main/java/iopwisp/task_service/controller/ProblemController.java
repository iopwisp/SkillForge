package iopwisp.task_service.controller;

import io.jsonwebtoken.Claims;
import iopwisp.task_service.dto.CategoryResponse;
import iopwisp.task_service.dto.ProblemDetailResponse;
import iopwisp.task_service.dto.ProblemListResponse;
import iopwisp.task_service.dto.ProblemSummaryResponse;
import iopwisp.task_service.model.Task;
import iopwisp.task_service.service.ProblemService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * Frontend-facing controller. Lives alongside the legacy /tasks controller
 * and returns data in shapes matching `ProblemSummary`/`ProblemDetail` in the
 * frontend's types.ts (competitive-programming terminology).
 */
@RestController
@RequiredArgsConstructor
public class ProblemController {

    private final ProblemService problemService;

    // ---------- Problems ----------

    @GetMapping("/problems")
    public ResponseEntity<ProblemListResponse> list(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Task.Difficulty difficulty,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String category,
            @RequestParam(name = "pageSize", defaultValue = "50") int pageSize,
            @RequestParam(defaultValue = "0") int page) {

        Task.Type mappedType = mapFrontendType(type);
        return ResponseEntity.ok(problemService.listProblems(
                search, difficulty, mappedType, category, pageSize, page, currentUserIdOrNull()));
    }

    @GetMapping("/problems/favorites")
    public ResponseEntity<List<ProblemSummaryResponse>> favorites() {
        Long userId = requireCurrentUserId();
        return ResponseEntity.ok(problemService.listFavorites(userId));
    }

    @GetMapping("/problems/{slug}")
    public ResponseEntity<ProblemDetailResponse> detail(@PathVariable String slug) {
        return ResponseEntity.ok(problemService.getProblemBySlug(slug, currentUserIdOrNull()));
    }

    @PostMapping("/problems/{slug}/favorite")
    public ResponseEntity<Map<String, Object>> toggleFavorite(@PathVariable String slug) {
        Long userId = requireCurrentUserId();
        boolean favorited = problemService.toggleFavorite(slug, userId);
        return ResponseEntity.ok(Map.of("slug", slug, "favorited", favorited));
    }

    // ---------- Categories ----------

    @GetMapping("/categories")
    public ResponseEntity<List<CategoryResponse>> categories() {
        return ResponseEntity.ok(problemService.listCategories());
    }

    // ---------- helpers ----------

    /** Frontend sends ALGORITHM/BACKEND/FRONTEND/SQL; DB enum is ALGO/BACKEND/FRONTEND/SQL. */
    private static Task.Type mapFrontendType(String raw) {
        if (raw == null || raw.isBlank()) return null;
        String upper = raw.trim().toUpperCase();
        return switch (upper) {
            case "ALGORITHM", "ALGO" -> Task.Type.ALGO;
            case "SQL" -> Task.Type.SQL;
            case "FRONTEND" -> Task.Type.FRONTEND;
            case "BACKEND" -> Task.Type.BACKEND;
            default -> null;
        };
    }

    /** userId from JWT if the request is authenticated; null otherwise (anonymous browsing). */
    private Long currentUserIdOrNull() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (!(auth instanceof UsernamePasswordAuthenticationToken token)) return null;
        Object details = token.getDetails();
        if (!(details instanceof Claims claims)) return null;
        Long id = claims.get("userId", Long.class);
        return id;
    }

    private Long requireCurrentUserId() {
        Long id = currentUserIdOrNull();
        if (id == null) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.UNAUTHORIZED, "Authentication required");
        }
        return id;
    }
}
