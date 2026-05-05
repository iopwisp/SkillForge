package iopwisp.submission_service.repository;

import iopwisp.submission_service.model.Submission;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface SubmissionRepository extends JpaRepository<Submission, Long> {
    List<Submission> findByUserId(Long userId);
    List<Submission> findByTaskId(Long taskId);
    List<Submission> findByUserIdAndTaskId(Long userId, Long taskId);
}
