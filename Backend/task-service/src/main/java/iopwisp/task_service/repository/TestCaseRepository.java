package iopwisp.task_service.repository;

import iopwisp.task_service.model.TestCase;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TestCaseRepository extends JpaRepository<TestCase, Long> {
    List<TestCase> findByTaskId(Long taskId);
    List<TestCase> findByTaskIdAndSample(Long taskId, Boolean sample);
}
