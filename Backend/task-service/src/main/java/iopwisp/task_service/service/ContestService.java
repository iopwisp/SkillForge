package iopwisp.task_service.service;

import iopwisp.task_service.dto.ContestRequest;
import iopwisp.task_service.dto.ContestResponse;
import iopwisp.task_service.model.Contest;
import iopwisp.task_service.repository.ContestRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ContestService {

    private final ContestRepository contestRepository;

    @Transactional
    public ContestResponse createContest(Long createdBy, ContestRequest request) {
        validateContestWindow(request);

        Contest contest = new Contest();
        contest.setTitle(request.getTitle());
        contest.setDescription(request.getDescription());
        contest.setStartTime(request.getStartTime());
        contest.setEndTime(request.getEndTime());
        contest.setCreatedBy(createdBy);
        contest.setStatus(Contest.ContestStatus.UPCOMING);

        contest = contestRepository.save(contest);
        return mapToResponse(contest);
    }

    @Transactional(readOnly = true)
    public ContestResponse getContest(Long id) {
        Contest contest = contestRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Contest not found with id: " + id));
        return mapToResponse(contest);
    }

    @Transactional(readOnly = true)
    public List<ContestResponse> getAllContests() {
        return contestRepository.findAll().stream()
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public List<ContestResponse> getActiveContests() {
        LocalDateTime now = LocalDateTime.now();
        return contestRepository.findAll().stream()
                .filter(c -> c.getStartTime().isBefore(now) && c.getEndTime().isAfter(now))
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    @Transactional
    public ContestResponse updateContest(Long id, ContestRequest request) {
        Contest contest = contestRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Contest not found with id: " + id));

        validateContestWindow(request);

        contest.setTitle(request.getTitle());
        contest.setDescription(request.getDescription());
        contest.setStartTime(request.getStartTime());
        contest.setEndTime(request.getEndTime());

        LocalDateTime now = LocalDateTime.now();
        if (now.isBefore(contest.getStartTime())) {
            contest.setStatus(Contest.ContestStatus.UPCOMING);
        } else if (now.isBefore(contest.getEndTime())) {
            contest.setStatus(Contest.ContestStatus.ACTIVE);
        } else {
            contest.setStatus(Contest.ContestStatus.ENDED);
        }

        contest = contestRepository.save(contest);
        return mapToResponse(contest);
    }

    @Transactional
    public void deleteContest(Long id) {
        if (!contestRepository.existsById(id)) {
            throw new ResourceNotFoundException("Contest not found with id: " + id);
        }
        contestRepository.deleteById(id);
    }

    private void validateContestWindow(ContestRequest request) {
        if (!request.getEndTime().isAfter(request.getStartTime())) {
            throw new IllegalArgumentException("Contest end time must be after the start time");
        }
    }

    private ContestResponse mapToResponse(Contest contest) {
        ContestResponse response = new ContestResponse();
        response.setId(contest.getId());
        response.setTitle(contest.getTitle());
        response.setDescription(contest.getDescription());
        response.setStartTime(contest.getStartTime());
        response.setEndTime(contest.getEndTime());
        response.setCreatedBy(contest.getCreatedBy());
        response.setStatus(contest.getStatus());
        response.setCreatedAt(contest.getCreatedAt());
        return response;
    }
}
