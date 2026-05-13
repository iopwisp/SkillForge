import { z } from 'zod';

const SlugSchema = z.string()
  .min(3).max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'lowercase letters, digits, and single hyphens only');

const DifficultySchema = z.enum(['EASY', 'MEDIUM', 'HARD']);
const ProblemTypeSchema = z.enum(['ALGORITHM', 'SQL', 'BACKEND', 'FRONTEND', 'STDIO']);

const ExampleSchema = z.object({
  input: z.string().min(1).max(10000),
  output: z.string().min(1).max(10000),
  explanation: z.string().max(10000).optional(),
});

const StarterCodeSchema = z.record(z.string().min(1), z.string().max(50000));
const TestCaseSchema = z.record(z.any());

const BaseProblemSchema = z.object({
  slug: SlugSchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(20000),
  difficulty: DifficultySchema,
  problemType: ProblemTypeSchema,
  categorySlug: z.string().min(1).max(100),
  tags: z.array(z.string().min(1).max(100)).max(50).default([]),
  examples: z.array(ExampleSchema).max(20).default([]),
  constraints: z.string().max(10000).default(''),
  hints: z.array(z.string().min(1).max(5000)).max(20).default([]),
  starterCode: StarterCodeSchema.default({}),
  expectedOutput: z.string().max(10000).optional(),
  testCases: z.array(TestCaseSchema).min(1).max(100).optional(),
  sqlSetup: z.string().max(50000).optional(),
  functionName: z.string().min(1).max(200).optional(),
  timeLimitMs: z.number().int().min(50).max(30000).optional(),
  memoryLimitMb: z.number().int().min(16).max(2048).optional(),
  isPremium: z.boolean().default(false),
  // STDIO-specific fields (optional at schema level; validated by superRefine)
  comparatorMode: z.enum(['EXACT', 'TRIMMED', 'WHITESPACE_NORMALIZED']).optional(),
  languageAllowlist: z.array(z.enum(['JAVASCRIPT', 'PYTHON', 'JAVA', 'GO', 'CPP']))
    .min(1, 'At least one language must be allowed')
    .optional(),
  outputSizeCapKb: z.number().int().min(1).max(1024).optional(),
});

export const CreateProblemSchema = BaseProblemSchema.superRefine((value, ctx) => {
  validateProblemDefinition(value, ctx);
});

export const UpdateProblemSchema = BaseProblemSchema.omit({ slug: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

// STDIO test case schema
const StdioTestCaseSchema = z.object({
  stdin: z.string(),
  expected_stdout: z.string(),
  visibility: z.enum(['SAMPLE', 'HIDDEN']),
  name: z.string().optional(),
});

// STDIO-specific fields for create
const StdioFieldsSchema = z.object({
  testCases: z.array(StdioTestCaseSchema)
    .min(1, 'At least one test case is required')
    .refine(
      cases => cases.some(c => c.visibility === 'SAMPLE'),
      { message: 'At least one SAMPLE test case is required', path: ['testCases'] }
    ),
  comparatorMode: z.enum(['EXACT', 'TRIMMED', 'WHITESPACE_NORMALIZED']),
  languageAllowlist: z.array(z.enum(['JAVASCRIPT', 'PYTHON', 'JAVA', 'GO', 'CPP']))
    .min(1, 'At least one language must be allowed'),
  timeLimitMs: z.number().int().min(100).max(10000).optional(),
  memoryLimitMb: z.number().int().min(16).max(512).optional(),
  outputSizeCapKb: z.number().int().min(1).max(1024).optional(),
});

// STDIO update fields (all optional for partial updates)
const StdioUpdateFieldsSchema = z.object({
  testCases: z.array(StdioTestCaseSchema)
    .min(1, 'At least one test case is required')
    .refine(
      cases => cases.some(c => c.visibility === 'SAMPLE'),
      { message: 'At least one SAMPLE test case is required', path: ['testCases'] }
    )
    .optional(),
  comparatorMode: z.enum(['EXACT', 'TRIMMED', 'WHITESPACE_NORMALIZED']).optional(),
  languageAllowlist: z.array(z.enum(['JAVASCRIPT', 'PYTHON', 'JAVA', 'GO', 'CPP']))
    .min(1, 'At least one language must be allowed')
    .optional(),
  timeLimitMs: z.number().int().min(100).max(10000).optional(),
  memoryLimitMb: z.number().int().min(16).max(512).optional(),
  outputSizeCapKb: z.number().int().min(1).max(1024).optional(),
});

export { StdioTestCaseSchema, StdioFieldsSchema, StdioUpdateFieldsSchema };

function validateProblemDefinition(value, ctx) {
  if (value.problemType === 'SQL') {
    if (!value.sqlSetup?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sqlSetup'],
        message: 'SQL problems require sqlSetup',
      });
    }
    if (!value.starterCode?.sql?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['starterCode', 'sql'],
        message: 'SQL problems require starterCode.sql',
      });
    }
    if (!value.testCases?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['testCases'],
        message: 'SQL problems require testCases',
      });
    }
  }

  if (value.problemType === 'BACKEND' || value.problemType === 'FRONTEND') {
    if (!value.functionName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['functionName'],
        message: `${value.problemType} problems require functionName`,
      });
    }
    if (!value.testCases?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['testCases'],
        message: `${value.problemType} problems require testCases`,
      });
    }
    if (Object.keys(value.starterCode || {}).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['starterCode'],
        message: `${value.problemType} problems require starterCode`,
      });
    }
  }

  if (value.problemType === 'ALGORITHM') {
    const hasRealTests = !!value.testCases?.length;
    const hasLegacyHint = !!value.expectedOutput?.trim();
    if (!hasLegacyHint && !hasRealTests) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedOutput'],
        message: 'ALGORITHM problems require expectedOutput or testCases',
      });
    }
    if (hasRealTests && !value.functionName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['functionName'],
        message: 'ALGORITHM problems with testCases require functionName',
      });
    }
  }

  if (value.problemType === 'STDIO') {
    if (!value.testCases?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['testCases'],
        message: 'STDIO problems require testCases',
      });
    } else {
      const hasSample = value.testCases.some(tc => tc.visibility === 'SAMPLE');
      if (!hasSample) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['testCases'],
          message: 'At least one SAMPLE test case is required',
        });
      }
    }
    // `comparatorMode` has a service-level default of TRIMMED (applied in
    // problems.service.applyStdioDefaults before the row is inserted).
    // Requiring it at the schema layer would make short-form payloads
    // (like the P1-defaults test) fail before the service gets a chance
    // to fill in the default. Accept it as optional here; the service
    // guarantees a non-null value reaches the DB.
    if (!value.languageAllowlist?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['languageAllowlist'],
        message: 'STDIO problems require languageAllowlist with at least one language',
      });
    }
  }
}
