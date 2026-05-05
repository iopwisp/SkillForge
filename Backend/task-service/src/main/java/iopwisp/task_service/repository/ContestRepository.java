package iopwisp.task_service.repository;

import iopwisp.task_service.model.Contest;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface ContestRepository extends JpaRepository<Contest, Long> {
    List<Contest> findByStatus(Contest.ContestStatus status);
    List<Contest> findByStartTimeAfter(LocalDateTime dateTime);
    List<Contest> findByEndTimeBefore(LocalDateTime dateTime);
}
