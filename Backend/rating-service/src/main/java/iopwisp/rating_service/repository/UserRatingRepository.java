package iopwisp.rating_service.repository;

import iopwisp.rating_service.model.UserRating;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.List;

@Repository
public interface UserRatingRepository extends JpaRepository<UserRating, Long> {
    Optional<UserRating> findByUserId(Long userId);
    List<UserRating> findAllByOrderByRatingDesc();
}
