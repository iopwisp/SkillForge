package iopwisp.notification_service;

import iopwisp.notification_service.dto.NotificationResponse;
import iopwisp.notification_service.dto.ResourceNotFoundException;
import iopwisp.notification_service.model.Notification;
import iopwisp.notification_service.service.EmailService;
import iopwisp.notification_service.service.NotificationRepository;
import iopwisp.notification_service.service.NotificationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class NotificationServiceTest {

    @Mock
    private NotificationRepository notificationRepository;

    @Mock
    private SimpMessagingTemplate messagingTemplate;

    @Mock
    private EmailService emailService;

    @InjectMocks
    private NotificationService notificationService;

    private Notification notification;

    @BeforeEach
    void setUp() {
        notification = new Notification();
        notification.setId(1L);
        notification.setUserId(100L);
        notification.setType("SUBMISSION_RESULT");
        notification.setTitle("Test Notification");
        notification.setMessage("Your submission was accepted");
        notification.setRead(false);
        notification.setCreatedAt(LocalDateTime.now());
    }

    @Test
    void getUserNotifications_success() {
        when(notificationRepository.findByUserIdOrderByCreatedAtDesc(100L))
                .thenReturn(List.of(notification));

        List<NotificationResponse> result = notificationService.getUserNotifications(100L);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getUserId()).isEqualTo(100L);
        assertThat(result.get(0).getTitle()).isEqualTo("Test Notification");
        assertThat(result.get(0).isReadStatus()).isFalse();
    }

    @Test
    void markAsRead_success() {
        when(notificationRepository.findById(1L)).thenReturn(Optional.of(notification));
        when(notificationRepository.save(any(Notification.class))).thenReturn(notification);

        notificationService.markAsRead(100L, 1L);

        assertThat(notification.isRead()).isTrue();
        verify(notificationRepository).save(notification);
    }

    @Test
    void markAsRead_notFound_throwsException() {
        when(notificationRepository.findById(999L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> notificationService.markAsRead(100L, 999L))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void getUnreadCount_success() {
        when(notificationRepository.countByUserIdAndReadFalse(100L)).thenReturn(5L);

        long count = notificationService.getUnreadCount(100L);

        assertThat(count).isEqualTo(5L);
    }
}
