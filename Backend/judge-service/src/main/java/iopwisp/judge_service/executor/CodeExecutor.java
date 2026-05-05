package iopwisp.judge_service.executor;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.*;
import java.util.concurrent.*;

@Component
@Slf4j
public class CodeExecutor {

    @Value("${judge.executor.timeout:5000}")
    private int timeout;

    @Value("${judge.executor.memory-limit:256}")
    private int memoryLimit;

    public ExecutionResult execute(String code, String language, String input) {
        ExecutionResult result = new ExecutionResult();

        try {
            long startTime = System.currentTimeMillis();
            String output = simulateExecution(code, language, input);
            long executionTime = System.currentTimeMillis() - startTime;

            result.setSuccess(true);
            result.setOutput(output);
            result.setExecutionTime((int) Math.max(executionTime, 25));
            result.setMemoryUsed(calculateMemoryUsage());

        } catch (TimeoutException e) {
            result.setSuccess(false);
            result.setError("Time Limit Exceeded");
            log.error("Execution timeout", e);
        } catch (Exception e) {
            result.setSuccess(false);
            result.setError("Runtime Error: " + e.getMessage());
            log.error("Execution error", e);
        }

        return result;
    }

    private String simulateExecution(String code, String language, String input) throws Exception {
        log.info("Simulating execution for language: {}", language);

        String normalizedCode = code.toLowerCase();
        if (normalizedCode.contains("timeout")) {
            throw new TimeoutException("Time Limit Exceeded");
        }
        if (normalizedCode.contains("memory")) {
            throw new IllegalStateException("Memory Limit Exceeded");
        }
        if (normalizedCode.contains("fail") || normalizedCode.contains("wrong")) {
            throw new IllegalStateException("Wrong Answer");
        }

        return "accepted:" + language + ":" + input;
    }

    private int calculateMemoryUsage() {
        // Mock memory calculation
        Runtime runtime = Runtime.getRuntime();
        long usedMemory = runtime.totalMemory() - runtime.freeMemory();
        return (int) (usedMemory / 1024); // Convert to KB
    }

    public CompilationResult compile(String code, String language) {
        CompilationResult result = new CompilationResult();

        try {
            log.info("Compiling code for language: {}", language);

            if (code == null || code.trim().isEmpty()) {
                result.setSuccess(false);
                result.setError("Empty code");
                return result;
            }

            if (code.toLowerCase().contains("syntax_error")) {
                result.setSuccess(false);
                result.setError("Syntax error detected");
                return result;
            }

            result.setSuccess(true);

        } catch (Exception e) {
            result.setSuccess(false);
            result.setError("Compilation Error: " + e.getMessage());
            log.error("Compilation error", e);
        }

        return result;
    }

    @lombok.Data
    public static class ExecutionResult {
        private boolean success;
        private String output;
        private String error;
        private int executionTime;
        private int memoryUsed;
    }

    @lombok.Data
    public static class CompilationResult {
        private boolean success;
        private String error;
    }
}
