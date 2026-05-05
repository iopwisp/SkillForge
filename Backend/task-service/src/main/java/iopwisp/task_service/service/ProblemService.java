package iopwisp.task_service.service;

import iopwisp.task_service.dto.CategoryResponse;
import iopwisp.task_service.dto.ProblemDetailResponse;
import iopwisp.task_service.dto.ProblemListResponse;
import iopwisp.task_service.dto.ProblemSummaryResponse;
import iopwisp.task_service.model.Category;
import iopwisp.task_service.model.Favorite;
import iopwisp.task_service.model.Task;
import iopwisp.task_service.repository.CategoryRepository;
import iopwisp.task_service.repository.FavoriteRepository;
import iopwisp.task_service.repository.TaskRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ProblemService {

    private final TaskRepository taskRepository;
    private final CategoryRepository categoryRepository;
    private final FavoriteRepository favoriteRepository;
    private final ProblemMapper problemMapper;

    @Transactional(readOnly = true)
    public ProblemListResponse listProblems(String search,
                                            Task.Difficulty difficulty,
                                            Task.Type type,
                                            String categorySlug,
                                            int pageSize,
                                            int page,
                                            Long currentUserId) {
        // Clamp pageSize to something sane.
        int size = Math.max(1, Math.min(pageSize, 500));
        Pageable pageable = PageRequest.of(Math.max(0, page), size, Sort.by("id").ascending());

        Page<Task> result = taskRepository.findWithFilters(
                blankToNull(search),
                difficulty,
                type,
                blankToNull(categorySlug),
                pageable);

        List<Task> tasks = result.getContent();

        Set<Long> favorited = currentUserId == null
                ? Collections.emptySet()
                : favoriteRepository.findFavoritedTaskIds(currentUserId,
                        tasks.stream().map(Task::getId).collect(Collectors.toList()));

        // TODO(PASS-2): solved/attempted sets require cross-service lookup to submission-service.
        Set<Long> solved = Collections.emptySet();
        Set<Long> attempted = Collections.emptySet();

        List<ProblemSummaryResponse> items = tasks.stream()
                .map(t -> problemMapper.toSummary(t, favorited, solved, attempted))
                .collect(Collectors.toList());

        return new ProblemListResponse(items, result.getTotalElements());
    }

    @Transactional(readOnly = true)
    public ProblemDetailResponse getProblemBySlug(String slug, Long currentUserId) {
        Task task = taskRepository.findBySlug(slug)
                .orElseThrow(() -> new ResourceNotFoundException("Problem not found: " + slug));

        Set<Long> favorited = currentUserId == null
                ? Collections.emptySet()
                : favoriteRepository.findFavoritedTaskIds(currentUserId, List.of(task.getId()));

        return problemMapper.toDetail(task, favorited, Collections.emptySet(), Collections.emptySet());
    }

    /** Toggle favorite status for a slug; returns the new favorited state. */
    @Transactional
    public boolean toggleFavorite(String slug, Long userId) {
        Task task = taskRepository.findBySlug(slug)
                .orElseThrow(() -> new ResourceNotFoundException("Problem not found: " + slug));
        if (favoriteRepository.existsByUserIdAndTaskId(userId, task.getId())) {
            favoriteRepository.deleteByUserIdAndTaskId(userId, task.getId());
            return false;
        }
        Favorite f = new Favorite();
        f.setUserId(userId);
        f.setTaskId(task.getId());
        favoriteRepository.save(f);
        return true;
    }

    @Transactional(readOnly = true)
    public List<ProblemSummaryResponse> listFavorites(Long userId) {
        List<Favorite> favs = favoriteRepository.findByUserId(userId);
        if (favs.isEmpty()) return List.of();
        List<Long> ids = favs.stream().map(Favorite::getTaskId).collect(Collectors.toList());
        List<Task> tasks = taskRepository.findByIdIn(ids);
        Set<Long> favorited = new java.util.HashSet<>(ids);
        return tasks.stream()
                .map(t -> problemMapper.toSummary(t, favorited, Collections.emptySet(), Collections.emptySet()))
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public List<CategoryResponse> listCategories() {
        Map<Long, Long> counts = taskRepository.countByCategory().stream()
                .collect(Collectors.toMap(
                        row -> (Long) row[0],
                        row -> (Long) row[1]));
        return categoryRepository.findAll(Sort.by("name").ascending()).stream()
                .map(c -> toCategoryResponse(c, counts.getOrDefault(c.getId(), 0L).intValue()))
                .collect(Collectors.toList());
    }

    private static CategoryResponse toCategoryResponse(Category c, int count) {
        return CategoryResponse.builder()
                .id(c.getId())
                .slug(c.getSlug())
                .name(c.getName())
                .description(c.getDescription())
                .icon(c.getIcon())
                .color(c.getColor())
                .problemCount(count)
                .build();
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }
}
