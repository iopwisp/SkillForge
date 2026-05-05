package iopwisp.user_service.service;

import iopwisp.user_service.dto.DashboardResponse;
import iopwisp.user_service.dto.UserProfileRequest;
import iopwisp.user_service.dto.UserProfileResponse;
import iopwisp.user_service.dto.UserUpdateRequest;
import iopwisp.user_service.mapper.UserProfileMapper;
import iopwisp.user_service.model.UserProfile;
import iopwisp.user_service.repository.UserProfileRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class UserProfileService {

    private final UserProfileRepository userProfileRepository;
    private final UserProfileMapper userProfileMapper;

    @Transactional
    public UserProfileResponse createProfile(Long userId, String username, UserProfileRequest request) {
        if (userProfileRepository.findByUserId(userId).isPresent()) {
            throw new IllegalStateException("Profile already exists for user: " + userId);
        }

        UserProfile profile = new UserProfile();
        profile.setUserId(userId);
        profile.setUsername(username);
        profile.setFullName(request.getFullName());
        profile.setBio(request.getBio());
        profile.setAvatarUrl(request.getAvatarUrl());
        profile.setCountry(request.getCountry());
        profile.setOrganization(request.getOrganization());

        profile = userProfileRepository.save(profile);

        return userProfileMapper.toResponse(profile);
    }

    @Transactional(readOnly = true)
    public UserProfileResponse getProfile(Long userId) {
        UserProfile profile = userProfileRepository.findByUserId(userId)
                .orElseThrow(() -> new ResourceNotFoundException("Profile not found for user: " + userId));
        return userProfileMapper.toResponse(profile);
    }

    @Transactional(readOnly = true)
    public UserProfileResponse getProfileByUsername(String username) {
        UserProfile profile = userProfileRepository.findByUsername(username)
                .orElseThrow(() -> new ResourceNotFoundException("Profile not found for username: " + username));
        return userProfileMapper.toResponse(profile);
    }

    @Transactional
    public UserProfileResponse getCurrentProfile(Long userId, String username) {
        UserProfile profile = userProfileRepository.findByUserId(userId)
                .orElseGet(() -> userProfileRepository.save(createDefaultProfile(userId, username)));
        return userProfileMapper.toResponse(profile);
    }

    @Transactional
    public UserProfileResponse updateProfile(Long userId, UserProfileRequest request) {
        UserProfile profile = userProfileRepository.findByUserId(userId)
                .orElseThrow(() -> new ResourceNotFoundException("Profile not found for user: " + userId));

        profile.setFullName(request.getFullName());
        profile.setBio(request.getBio());
        profile.setAvatarUrl(request.getAvatarUrl());
        profile.setCountry(request.getCountry());
        profile.setOrganization(request.getOrganization());

        profile = userProfileRepository.save(profile);

        return userProfileMapper.toResponse(profile);
    }

    @Transactional(readOnly = true)
    public List<UserProfileResponse> getAllProfiles() {
        return userProfileRepository.findAll().stream()
                .map(userProfileMapper::toResponse)
                .collect(Collectors.toList());
    }

    @Transactional
    public void updateStats(Long userId, Integer solvedProblems, Integer totalSubmissions) {
        UserProfile profile = userProfileRepository.findByUserId(userId)
                .orElseThrow(() -> new ResourceNotFoundException("Profile not found for user: " + userId));

        profile.setSolvedProblems(solvedProblems);
        profile.setTotalSubmissions(totalSubmissions);

        userProfileRepository.save(profile);
    }

    @Transactional
    public void updateRating(Long userId, Integer rating) {
        UserProfile profile = userProfileRepository.findByUserId(userId)
                .orElseThrow(() -> new ResourceNotFoundException("Profile not found for user: " + userId));

        profile.setRating(rating);

        userProfileRepository.save(profile);
    }

    /** Partial update from the settings page (PATCH /users/me). Only non-null fields are applied. */
    @Transactional
    public UserProfileResponse updateCurrentProfile(Long userId, String username, UserUpdateRequest req) {
        UserProfile profile = userProfileRepository.findByUserId(userId)
                .orElseGet(() -> userProfileRepository.save(createDefaultProfile(userId, username)));

        if (req.getFullName() != null)  profile.setFullName(req.getFullName());
        if (req.getBio() != null)       profile.setBio(req.getBio());
        if (req.getAvatarUrl() != null) profile.setAvatarUrl(req.getAvatarUrl());
        if (req.getLocation() != null)  profile.setLocation(req.getLocation());
        if (req.getWebsite() != null)   profile.setWebsite(req.getWebsite());
        if (req.getTheme() != null) {
            String t = req.getTheme().toLowerCase();
            if (t.equals("dark") || t.equals("light")) {
                profile.setTheme(t);
            }
        }

        profile = userProfileRepository.save(profile);
        return userProfileMapper.toResponse(profile);
    }

    /**
     * Dashboard aggregator. PASS 1: returns the correct shape but most cross-service
     * fields (streak, recommended, recentSubmissions, per-difficulty counts) are stubbed.
     * PASS 2 should populate them via Feign/RestTemplate to submission-service + task-service.
     */
    @Transactional
    public DashboardResponse buildDashboard(Long userId, String username) {
        UserProfile profile = userProfileRepository.findByUserId(userId)
                .orElseGet(() -> userProfileRepository.save(createDefaultProfile(userId, username)));

        int submissions = nz(profile.getTotalSubmissions());
        int accepted = nz(profile.getSolvedProblems());
        double rate = submissions == 0 ? 0.0 : (double) accepted / submissions * 100.0;

        return DashboardResponse.builder()
                .totals(DashboardResponse.Totals.builder()
                        .submissions(submissions)
                        .accepted(accepted)
                        .acceptanceRate(rate)
                        .streak(0) // TODO PASS-2: compute from submission timestamps
                        .rating(nz(profile.getRating()))
                        .build())
                .solvedByDifficulty(List.of(
                        DashboardResponse.DifficultyEntry.builder().difficulty("EASY").solved(0).total(0).build(),
                        DashboardResponse.DifficultyEntry.builder().difficulty("MEDIUM").solved(0).total(0).build(),
                        DashboardResponse.DifficultyEntry.builder().difficulty("HARD").solved(0).total(0).build()
                ))
                .recentSubmissions(List.of())  // TODO PASS-2: fetch from submission-service
                .recommended(List.of())        // TODO PASS-2: fetch from task-service
                .build();
    }

    private static int nz(Integer v) { return v == null ? 0 : v; }

    private UserProfile createDefaultProfile(Long userId, String username) {
        UserProfile profile = new UserProfile();
        profile.setUserId(userId);
        profile.setUsername(username);
        return profile;
    }
}
