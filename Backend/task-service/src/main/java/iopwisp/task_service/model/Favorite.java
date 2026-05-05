package iopwisp.task_service.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.io.Serializable;
import java.time.LocalDateTime;
import java.util.Objects;

@Entity
@Table(name = "favorites")
@IdClass(Favorite.FavoriteId.class)
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Favorite {

    @Id
    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Id
    @Column(name = "task_id", nullable = false)
    private Long taskId;

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class FavoriteId implements Serializable {
        private Long userId;
        private Long taskId;

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof FavoriteId that)) return false;
            return Objects.equals(userId, that.userId) && Objects.equals(taskId, that.taskId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(userId, taskId);
        }
    }
}
