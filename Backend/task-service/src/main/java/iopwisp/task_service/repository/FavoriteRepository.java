package iopwisp.task_service.repository;

import iopwisp.task_service.model.Favorite;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Set;

@Repository
public interface FavoriteRepository extends JpaRepository<Favorite, Favorite.FavoriteId> {

    List<Favorite> findByUserId(Long userId);

    boolean existsByUserIdAndTaskId(Long userId, Long taskId);

    void deleteByUserIdAndTaskId(Long userId, Long taskId);

    @Query("SELECT f.taskId FROM Favorite f WHERE f.userId = :userId AND f.taskId IN :taskIds")
    Set<Long> findFavoritedTaskIds(@Param("userId") Long userId, @Param("taskIds") List<Long> taskIds);
}
