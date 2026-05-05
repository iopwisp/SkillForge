package iopwisp.rating_service;

import iopwisp.rating_service.config.ResourceNotFoundException;
import iopwisp.rating_service.dto.SubmissionEvent;
import iopwisp.rating_service.dto.UserRatingResponse;
import iopwisp.rating_service.model.UserRating;
import iopwisp.rating_service.repository.UserRatingRepository;
import iopwisp.rating_service.service.RatingService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RatingServiceTest {

    @Mock
    private UserRatingRepository userRatingRepository;

    @InjectMocks
    private RatingService ratingService;

    private UserRating userRating;

    @BeforeEach
    void setUp() {
        userRating = new UserRating();
        userRating.setId(1L);
        userRating.setUserId(100L);
        userRating.setRating(1500);
        userRating.setSolvedEasy(0);
        userRating.setSolvedMedium(0);
        userRating.setSolvedHard(0);
        userRating.setTotalSolved(0);
        userRating.setContestsParticipated(0);
        userRating.setRank(0);
    }

    @Test
    void getUserRating_success() {
        when(userRatingRepository.findByUserId(100L)).thenReturn(Optional.of(userRating));

        UserRatingResponse response = ratingService.getUserRating(100L);

        assertThat(response).isNotNull();
        assertThat(response.getUserId()).isEqualTo(100L);
        assertThat(response.getRating()).isEqualTo(1500);
    }

    @Test
    void getUserRating_notFound_throwsException() {
        when(userRatingRepository.findByUserId(999L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> ratingService.getUserRating(999L))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void getLeaderboard_success() {
        Pageable pageable = PageRequest.of(0, 10, Sort.by(Sort.Direction.DESC, "rating"));
        Page<UserRating> page = new PageImpl<>(List.of(userRating), pageable, 1);
        when(userRatingRepository.findAll(any(PageRequest.class))).thenReturn(page);

        List<UserRatingResponse> result = ratingService.getLeaderboard(pageable);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getRating()).isEqualTo(1500);
        assertThat(result.get(0).getRank()).isEqualTo(1);
    }

    @Test
    void handleSubmissionResult_accepted_updatesRating() {
        SubmissionEvent event = new SubmissionEvent();
        event.setUserId(100L);
        event.setAccepted(true);
        event.setDifficulty("MEDIUM");

        when(userRatingRepository.findByUserId(100L)).thenReturn(Optional.of(userRating));
        when(userRatingRepository.save(any(UserRating.class))).thenReturn(userRating);

        ratingService.handleSubmissionResult(event);

        assertThat(userRating.getRating()).isEqualTo(1510);
        assertThat(userRating.getSolvedMedium()).isEqualTo(1);
        assertThat(userRating.getTotalSolved()).isEqualTo(1);
    }

    @Test
    void handleSubmissionResult_rejected_doesNotUpdateRating() {
        SubmissionEvent event = new SubmissionEvent();
        event.setUserId(100L);
        event.setAccepted(false);
        event.setDifficulty("EASY");

        when(userRatingRepository.findByUserId(100L)).thenReturn(Optional.of(userRating));

        ratingService.handleSubmissionResult(event);

        assertThat(userRating.getRating()).isEqualTo(1500);
        assertThat(userRating.getTotalSolved()).isEqualTo(0);
    }
}
