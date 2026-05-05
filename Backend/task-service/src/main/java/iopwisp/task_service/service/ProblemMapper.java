package iopwisp.task_service.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import iopwisp.task_service.dto.ProblemDetailResponse;
import iopwisp.task_service.dto.ProblemSummaryResponse;
import iopwisp.task_service.model.Category;
import iopwisp.task_service.model.Task;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Converts {@link Task} JPA entities into frontend-compatible DTOs.
 * The frontend uses richer types than the current DB schema — missing fields
 * (status, favorited, examples parsed from TEXT, etc.) are computed or stubbed here.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ProblemMapper {

    private final ObjectMapper objectMapper;

    /**
     * @param favoritedTaskIds ids of tasks the current user has favorited (empty/null if anonymous).
     * @param solvedTaskIds    ids of tasks the current user has solved (empty/null if anonymous).
     * @param attemptedTaskIds ids the user attempted but didn't solve.
     */
    public ProblemSummaryResponse toSummary(Task task,
                                             Set<Long> favoritedTaskIds,
                                             Set<Long> solvedTaskIds,
                                             Set<Long> attemptedTaskIds) {
        return ProblemSummaryResponse.builder()
                .id(task.getId())
                .slug(task.getSlug())
                .title(task.getTitle())
                .difficulty(task.getDifficulty() != null ? task.getDifficulty().name() : "EASY")
                .problemType(mapType(task.getType()))
                .tags(splitTags(task.getTags()))
                .category(categoryRef(task.getCategory()))
                .isPremium(Boolean.TRUE.equals(task.getIsPremium()))
                .totalSubmissions(nvl(task.getTotalSubmissions()))
                .acceptedSubmissions(nvl(task.getAcceptedSubmissions()))
                .acceptanceRate(computeAcceptanceRate(task))
                .status(statusFor(task.getId(), solvedTaskIds, attemptedTaskIds))
                .favorited(favoritedTaskIds != null && favoritedTaskIds.contains(task.getId()))
                .build();
    }

    public ProblemDetailResponse toDetail(Task task,
                                          Set<Long> favoritedTaskIds,
                                          Set<Long> solvedTaskIds,
                                          Set<Long> attemptedTaskIds) {
        return ProblemDetailResponse.builder()
                // Summary fields
                .id(task.getId())
                .slug(task.getSlug())
                .title(task.getTitle())
                .difficulty(task.getDifficulty() != null ? task.getDifficulty().name() : "EASY")
                .problemType(mapType(task.getType()))
                .tags(splitTags(task.getTags()))
                .category(categoryRef(task.getCategory()))
                .isPremium(Boolean.TRUE.equals(task.getIsPremium()))
                .totalSubmissions(nvl(task.getTotalSubmissions()))
                .acceptedSubmissions(nvl(task.getAcceptedSubmissions()))
                .acceptanceRate(computeAcceptanceRate(task))
                .status(statusFor(task.getId(), solvedTaskIds, attemptedTaskIds))
                .favorited(favoritedTaskIds != null && favoritedTaskIds.contains(task.getId()))
                // Detail fields
                .description(task.getDescription() != null ? task.getDescription() : "")
                .examples(parseExamples(task.getExamples()))
                .constraints(task.getConstraints() != null ? task.getConstraints() : "")
                .hints(splitHints(task.getHints()))
                .starterCode(parseStarterCode(task.getStarterCode()))
                .sqlSetup(task.getSqlSetup())
                .functionName(task.getFunctionName())
                .timeLimitMs(task.getTimeLimit() != null ? task.getTimeLimit() : 1000)
                .memoryLimitMb(task.getMemoryLimit() != null ? task.getMemoryLimit() : 256)
                .build();
    }

    // --- helpers ------------------------------------------------------------

    private static int nvl(Integer v) { return v == null ? 0 : v; }

    private static double computeAcceptanceRate(Task t) {
        int total = nvl(t.getTotalSubmissions());
        if (total == 0) return 0.0;
        return (double) nvl(t.getAcceptedSubmissions()) / total * 100.0;
    }

    /** DB enum ALGO/SQL/FRONTEND/BACKEND → frontend ALGORITHM/SQL/FRONTEND/BACKEND. */
    private static String mapType(Task.Type type) {
        if (type == null) return "ALGORITHM";
        return switch (type) {
            case ALGO -> "ALGORITHM";
            case SQL -> "SQL";
            case FRONTEND -> "FRONTEND";
            case BACKEND -> "BACKEND";
        };
    }

    private static List<String> splitTags(String csv) {
        if (csv == null || csv.isBlank()) return Collections.emptyList();
        return Arrays.stream(csv.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toList());
    }

    /** Hints are stored newline-separated. */
    private static List<String> splitHints(String text) {
        if (text == null || text.isBlank()) return Collections.emptyList();
        return Arrays.stream(text.split("\\r?\\n"))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toList());
    }

    private static ProblemSummaryResponse.CategoryRef categoryRef(Category c) {
        if (c == null) return null;
        return new ProblemSummaryResponse.CategoryRef(c.getSlug(), c.getName());
    }

    private static String statusFor(Long taskId, Set<Long> solved, Set<Long> attempted) {
        if (solved != null && solved.contains(taskId)) return "solved";
        if (attempted != null && attempted.contains(taskId)) return "attempted";
        return null;
    }

    /**
     * examples column is TEXT — may be JSON array of {input, output, explanation?}
     * or plain text. Accept both gracefully.
     */
    private List<ProblemDetailResponse.Example> parseExamples(String raw) {
        if (raw == null || raw.isBlank()) return Collections.emptyList();
        String trimmed = raw.trim();
        if (trimmed.startsWith("[")) {
            try {
                return objectMapper.readValue(trimmed,
                        new TypeReference<List<ProblemDetailResponse.Example>>() {});
            } catch (Exception e) {
                log.debug("examples field is not valid JSON, falling back: {}", e.getMessage());
            }
        }
        // Fallback: put the whole blob as a single example input so nothing is lost.
        ProblemDetailResponse.Example single = new ProblemDetailResponse.Example();
        single.setInput(raw);
        single.setOutput("");
        return List.of(single);
    }

    /** starter_code is a JSON object { "java": "...", "python": "..." }. */
    private Map<String, String> parseStarterCode(String raw) {
        if (raw == null || raw.isBlank()) return Collections.emptyMap();
        try {
            return objectMapper.readValue(raw, new TypeReference<LinkedHashMap<String, String>>() {});
        } catch (Exception e) {
            log.debug("starter_code field is not valid JSON: {}", e.getMessage());
            return Collections.emptyMap();
        }
    }
}
