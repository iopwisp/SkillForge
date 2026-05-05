package iopwisp.task_service.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** Frontend expects `{ items: ProblemSummary[], total: number }`. */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ProblemListResponse {
    private List<ProblemSummaryResponse> items;
    private long total;
}
