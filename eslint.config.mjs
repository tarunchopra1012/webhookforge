import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/interface-name-prefix': 'off',
      // Kept on everywhere except controllers — see the override below.
      '@typescript-eslint/only-throw-error': 'error',
    },
  },
  {
    // AppError deliberately does not extend Error: it is a domain outcome
    // that travels by `throw` at exactly one boundary, so that a stray
    // `catch (e) { if (e instanceof Error) }` elsewhere cannot mistake a
    // business result for a crash.
    //
    // The Controller is that boundary and the only layer allowed to throw
    // one, so the exemption is scoped to controllers rather than switched off
    // project-wide. A `throw` anywhere else is still an error — which is
    // exactly the layer rule the architecture doc states.
    //
    // The rule's `allow` option matches exact type names, so it cannot be
    // used here: it would mean listing every AppError subclass by hand.
    files: ['**/*.controller.ts', '**/*.e2e-spec.ts'],
    rules: {
      '@typescript-eslint/only-throw-error': 'off',
    },
  },
  {
    // Nest's INestApplication.getHttpServer() and supertest's response body
    // are untyped by design — the unsafe-* checks add noise here without
    // catching real bugs.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
);
