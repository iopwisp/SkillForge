package iopwisp.user_service.mapper;

import iopwisp.user_service.dto.UserProfileResponse;
import iopwisp.user_service.model.UserProfile;
import org.mapstruct.Mapper;

@Mapper(componentModel = "spring")
public interface UserProfileMapper {

    UserProfileResponse toResponse(UserProfile userProfile);
}
