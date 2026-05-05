package iopwisp.task_service.repository;

import iopwisp.task_service.model.Task;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

@Repository
public interface TaskRepository extends JpaRepository<Task, Long> {
    List<Task> findByDifficulty(Task.Difficulty difficulty);
    List<Task> findByAuthorId(Long authorId);
    Page<Task> findByDifficulty(Task.Difficulty difficulty, Pageable pageable);
    Page<Task> findByType(Task.Type type, Pageable pageable);
    Page<Task> findByDifficultyAndType(Task.Difficulty difficulty, Task.Type type, Pageable pageable);

    Optional<Task> findBySlug(String slug);
    Page<Task> findByCategorySlug(String categorySlug, Pageable pageable);
    List<Task> findByIdIn(List<Long> ids);

    /** Dynamic filter query covering the frontend's filters. Each parameter is optional (null). */
    @Query("SELECT t FROM Task t WHERE " +
            "(:search IS NULL OR LOWER(t.title) LIKE LOWER(CONCAT('%', :search, '%')) " +
            "   OR LOWER(COALESCE(t.tags, '')) LIKE LOWER(CONCAT('%', :search, '%'))) AND " +
            "(:difficulty IS NULL OR t.difficulty = :difficulty) AND " +
            "(:type IS NULL OR t.type = :type) AND " +
            "(:categorySlug IS NULL OR (t.category IS NOT NULL AND t.category.slug = :categorySlug))")
    Page<Task> findWithFilters(
            @Param("search") String search,
            @Param("difficulty") Task.Difficulty difficulty,
            @Param("type") Task.Type type,
            @Param("categorySlug") String categorySlug,
            Pageable pageable);

    @Query("SELECT t.category.id AS categoryId, COUNT(t) AS cnt FROM Task t WHERE t.category IS NOT NULL GROUP BY t.category.id")
    List<Object[]> countByCategory();
}
