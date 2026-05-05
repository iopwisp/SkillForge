package iopwisp.judge_service;

import iopwisp.judge_service.executor.CodeExecutor;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(MockitoExtension.class)
class CodeExecutorTest {

    @InjectMocks
    private CodeExecutor codeExecutor;

    @Test
    void compile_success() {
        CodeExecutor.CompilationResult result = codeExecutor.compile(
                "public class Main { public static void main(String[] args) {} }", "java");

        assertThat(result.isSuccess()).isTrue();
        assertThat(result.getError()).isNull();
    }

    @Test
    void compile_emptyCode_returnsFailure() {
        CodeExecutor.CompilationResult result = codeExecutor.compile("", "java");

        assertThat(result.isSuccess()).isFalse();
        assertThat(result.getError()).isNotBlank();
    }

    @Test
    void execute_returnsResult() {
        CodeExecutor.ExecutionResult result = codeExecutor.execute(
                "print('hello')", "python", "test input");

        assertThat(result).isNotNull();
        assertThat(result.isSuccess()).isTrue();
        assertThat(result.getOutput()).isNotBlank();
        assertThat(result.getExecutionTime()).isGreaterThanOrEqualTo(0);
        assertThat(result.getMemoryUsed()).isGreaterThanOrEqualTo(0);
    }
}
