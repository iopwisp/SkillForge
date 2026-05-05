package iopwisp.task_service.service;

import iopwisp.task_service.dto.TaskRequest;
import iopwisp.task_service.dto.TaskResponse;
import iopwisp.task_service.dto.TestCaseRequest;
import iopwisp.task_service.dto.TestCaseResponse;
import iopwisp.task_service.model.Task;
import iopwisp.task_service.model.TestCase;
import iopwisp.task_service.repository.TaskRepository;
import iopwisp.task_service.repository.TestCaseRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class TaskService {

    private final TaskRepository taskRepository;
    private final TestCaseRepository testCaseRepository;

    @Transactional
    @CacheEvict(value = "tasks", allEntries = true)
    public TaskResponse createTask(Long authorId, TaskRequest request) {
        Task task = new Task();
        task.setTitle(request.getTitle());
        task.setSlug(request.getSlug());
        task.setDescription(request.getDescription());
        task.setInputFormat(request.getInputFormat());
        task.setOutputFormat(request.getOutputFormat());
        task.setConstraints(request.getConstraints());
        task.setExamples(request.getExamples());
        task.setTags(request.getTags());
        task.setType(request.getType() != null ? request.getType() : Task.Type.ALGO);
        task.setDifficulty(request.getDifficulty());
        task.setTimeLimit(request.getTimeLimit());
        task.setMemoryLimit(request.getMemoryLimit());
        task.setAuthorId(authorId);

        task = taskRepository.save(task);

        return mapToResponse(task);
    }

    @Transactional(readOnly = true)
    public TaskResponse getTask(Long taskId) {
        Task task = taskRepository.findById(taskId)
                .orElseThrow(() -> new ResourceNotFoundException("Task not found with id: " + taskId));
        return mapToResponse(task);
    }

    @Transactional(readOnly = true)
    @Cacheable(value = "tasks", key = "#pageable.pageNumber + '-' + #pageable.pageSize + '-' + (#difficulty == null ? 'all' : #difficulty.name()) + '-' + (#type == null ? 'all' : #type.name())")
    public Page<TaskResponse> getAllTasks(Pageable pageable, Task.Difficulty difficulty, Task.Type type) {
        Page<Task> tasks;

        if (difficulty != null && type != null) {
            tasks = taskRepository.findByDifficultyAndType(difficulty, type, pageable);
        } else if (difficulty != null) {
            tasks = taskRepository.findByDifficulty(difficulty, pageable);
        } else if (type != null) {
            tasks = taskRepository.findByType(type, pageable);
        } else {
            tasks = taskRepository.findAll(pageable);
        }

        return tasks.map(this::mapToResponse);
    }

    @Transactional(readOnly = true)
    public List<TaskResponse> getTasksByDifficulty(Task.Difficulty difficulty) {
        return taskRepository.findByDifficulty(difficulty).stream()
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    @Transactional
    @CacheEvict(value = "tasks", allEntries = true)
    public TaskResponse updateTask(Long taskId, TaskRequest request) {
        Task task = taskRepository.findById(taskId)
                .orElseThrow(() -> new ResourceNotFoundException("Task not found with id: " + taskId));

        task.setTitle(request.getTitle());
        task.setSlug(request.getSlug());
        task.setDescription(request.getDescription());
        task.setInputFormat(request.getInputFormat());
        task.setOutputFormat(request.getOutputFormat());
        task.setConstraints(request.getConstraints());
        task.setExamples(request.getExamples());
        task.setTags(request.getTags());
        if (request.getType() != null) {
            task.setType(request.getType());
        }
        task.setDifficulty(request.getDifficulty());
        task.setTimeLimit(request.getTimeLimit());
        task.setMemoryLimit(request.getMemoryLimit());

        task = taskRepository.save(task);

        return mapToResponse(task);
    }

    @Transactional
    @CacheEvict(value = "tasks", allEntries = true)
    public void deleteTask(Long taskId) {
        if (!taskRepository.existsById(taskId)) {
            throw new ResourceNotFoundException("Task not found with id: " + taskId);
        }
        testCaseRepository.deleteAll(testCaseRepository.findByTaskId(taskId));
        taskRepository.deleteById(taskId);
    }

    @Transactional
    public TestCaseResponse addTestCase(Long taskId, TestCaseRequest request) {
        if (!taskRepository.existsById(taskId)) {
            throw new ResourceNotFoundException("Task not found with id: " + taskId);
        }

        TestCase testCase = new TestCase();
        testCase.setTaskId(taskId);
        testCase.setInput(request.getInput());
        testCase.setExpectedOutput(request.getExpectedOutput());
        testCase.setSample(request.getSample() != null ? request.getSample() : false);
        testCase.setOrderIndex(request.getOrderIndex() != null ? request.getOrderIndex() : 0);

        testCase = testCaseRepository.save(testCase);

        return mapToTestCaseResponse(testCase);
    }

    @Transactional(readOnly = true)
    public List<TestCaseResponse> getTestCases(Long taskId) {
        return testCaseRepository.findByTaskId(taskId).stream()
                .map(this::mapToTestCaseResponse)
                .collect(Collectors.toList());
    }

    @Transactional
    public void updateTaskStats(Long taskId, boolean accepted) {
        Task task = taskRepository.findById(taskId)
                .orElseThrow(() -> new ResourceNotFoundException("Task not found with id: " + taskId));

        task.setTotalSubmissions(task.getTotalSubmissions() + 1);
        if (accepted) {
            task.setAcceptedSubmissions(task.getAcceptedSubmissions() + 1);
        }

        taskRepository.save(task);
    }

    private TaskResponse mapToResponse(Task task) {
        TaskResponse response = new TaskResponse();
        response.setId(task.getId());
        response.setTitle(task.getTitle());
        response.setSlug(task.getSlug());
        response.setDescription(task.getDescription());
        response.setInputFormat(task.getInputFormat());
        response.setOutputFormat(task.getOutputFormat());
        response.setConstraints(task.getConstraints());
        response.setExamples(task.getExamples());
        response.setTags(task.getTags());
        response.setType(task.getType());
        response.setDifficulty(task.getDifficulty());
        response.setTimeLimit(task.getTimeLimit());
        response.setMemoryLimit(task.getMemoryLimit());
        response.setAuthorId(task.getAuthorId());
        response.setTotalSubmissions(task.getTotalSubmissions());
        response.setAcceptedSubmissions(task.getAcceptedSubmissions());

        if (task.getTotalSubmissions() > 0) {
            response.setAcceptanceRate((double) task.getAcceptedSubmissions() / task.getTotalSubmissions() * 100);
        } else {
            response.setAcceptanceRate(0.0);
        }

        response.setCreatedAt(task.getCreatedAt());
        response.setUpdatedAt(task.getUpdatedAt());

        List<TestCaseResponse> sampleTestCases = testCaseRepository.findByTaskIdAndSample(task.getId(), Boolean.TRUE)
                .stream()
                .map(this::mapToTestCaseResponse)
                .collect(Collectors.toList());
        response.setSampleTestCases(sampleTestCases);

        return response;
    }

    private TestCaseResponse mapToTestCaseResponse(TestCase testCase) {
        TestCaseResponse response = new TestCaseResponse();
        response.setId(testCase.getId());
        response.setTaskId(testCase.getTaskId());
        response.setInput(testCase.getInput());
        response.setExpectedOutput(testCase.getExpectedOutput());
        response.setSample(testCase.getSample());
        response.setOrderIndex(testCase.getOrderIndex());
        return response;
    }
}
