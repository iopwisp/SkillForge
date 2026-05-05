package iopwisp.rating_service.service;

import iopwisp.rating_service.config.ResourceNotFoundException;
import iopwisp.rating_service.dto.SubmissionEvent;
import iopwisp.rating_service.dto.UserRatingResponse;
import iopwisp.rating_service.model.UserRating;
import iopwisp.rating_service.repository.UserRatingRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class RatingService {

    private final UserRatingRepository userRatingRepository;

    @Transactional
    public UserRatingResponse createUserRating(Long userId) {
        if (userRatingRepository.findByUserId(userId).isPresent()) {
            throw new IllegalArgumentException("Rating already exists for this user");
        }
        UserRating rating = new UserRating();
        rating.setUserId(userId);
        rating.setRating(1500);
        rating = userRatingRepository.save(rating);
        return mapToResponse(rating);
    }

    @Transactional(readOnly = true)
    public UserRatingResponse getUserRating(Long userId) {
        UserRating rating = userRatingRepository.findByUserId(userId)
                .orElseThrow(() -> new ResourceNotFoundException("Rating not found for user: " + userId));
        return mapToResponse(rating);
    }

    @Cacheable("leaderboard")
    @Transactional(readOnly = true)
    public List<UserRatingResponse> getLeaderboard(Pageable pageable) {
        Page<UserRating> page = userRatingRepository.findAll(
                PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(),
                        Sort.by(Sort.Direction.DESC, "rating")));
        List<UserRating> ratings = page.getContent();
        int rankOffset = pageable.getPageNumber() * pageable.getPageSize();
        for (int i = 0; i < ratings.size(); i++) {
            ratings.get(i).setRank(rankOffset + i + 1);
        }
        return ratings.stream().map(this::mapToResponse).collect(Collectors.toList());
    }

    @KafkaListener(topics = "judge-results", groupId = "rating-service-group")
    @CacheEvict(value = "leaderboard", allEntries = true)
    @Transactional
    public void handleSubmissionResult(SubmissionEvent event) {
        log.info("Processing submission result for user {}: accepted={}", event.getUserId(), event.getAccepted());

        UserRating rating = userRatingRepository.findByUserId(event.getUserId())
                .orElseGet(() -> {
                    UserRating newRating = new UserRating();
                    newRating.setUserId(event.getUserId());
                    newRating.setRating(1500);
                    return userRatingRepository.save(newRating);
                });

        if (Boolean.TRUE.equals(event.getAccepted())) {
            rating.setTotalSolved(rating.getTotalSolved() + 1);
            if (event.getDifficulty() != null) {
                switch (event.getDifficulty().toUpperCase()) {
                    case "EASY":
                        rating.setSolvedEasy(rating.getSolvedEasy() + 1);
                        rating.setRating(rating.getRating() + 5);
                        break;
                    case "MEDIUM":
                        rating.setSolvedMedium(rating.getSolvedMedium() + 1);
                        rating.setRating(rating.getRating() + 10);
                        break;
                    case "HARD":
                        rating.setSolvedHard(rating.getSolvedHard() + 1);
                        rating.setRating(rating.getRating() + 20);
                        break;
                }
            }
            userRatingRepository.save(rating);
            log.info("Updated rating for user {}: {}", event.getUserId(), rating.getRating());
        }
    }

    @CacheEvict(value = "leaderboard", allEntries = true)
    @Transactional
    public void updateContestParticipation(Long userId, Integer ratingChange) {
        UserRating rating = userRatingRepository.findByUserId(userId)
                .orElseThrow(() -> new ResourceNotFoundException("Rating not found for user: " + userId));
        rating.setContestsParticipated(rating.getContestsParticipated() + 1);
        rating.setRating(rating.getRating() + ratingChange);
        userRatingRepository.save(rating);
        log.info("Updated contest participation for user {}: new rating {}", userId, rating.getRating());
    }

    private UserRatingResponse mapToResponse(UserRating rating) {
        UserRatingResponse response = new UserRatingResponse();
        response.setId(rating.getId());
        response.setUserId(rating.getUserId());
        response.setUsername(rating.getUsername());
        response.setRating(rating.getRating());
        response.setSolvedEasy(rating.getSolvedEasy());
        response.setSolvedMedium(rating.getSolvedMedium());
        response.setSolvedHard(rating.getSolvedHard());
        response.setTotalSolved(rating.getTotalSolved());
        response.setContestsParticipated(rating.getContestsParticipated());
        response.setRank(rating.getRank());
        response.setCreatedAt(rating.getCreatedAt());
        response.setUpdatedAt(rating.getUpdatedAt());
        return response;
    }
}
