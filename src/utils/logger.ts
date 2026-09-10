import { LoggerService } from '@nestjs/common';
import { config } from '@utils/config';
import * as winston from 'winston';

/**
 * Keys whose values are never written to a log, at any nesting depth.
 *
 * `code-style.md` forbids logging subscription secrets, API keys, full auth
 * headers and complete event payloads. Relying on every call site to
 * remember that is how secrets end up in log aggregators, so the redaction
 * is mechanical and lives here.
 */
const REDACTED_KEYS: ReadonlySet<string> = new Set([
  'secret',
  'secrets',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'api_key',
  'x-api-key',
  'authorization',
  'cookie',
  'signature',
  'hmac',
  // Event bodies are tenant data and can be large. Log the id and type.
  'payload',
  'body',
]);

const REDACTED = '[REDACTED]';
/** Cheap cycle and runaway-depth guard; logs are not a serialisation format. */
const MAX_REDACT_DEPTH = 6;

function redact(value: unknown, depth = 0): unknown {
  if (depth >= MAX_REDACT_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { message: value.message, stack: value.stack };

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : redact(item, depth + 1);
  }
  return out;
}

/**
 * Console-only, on purpose.
 *
 * The app runs in a container, so stdout *is* the log sink — Docker, the CI
 * runner and any aggregator already collect it. The reference codebase
 * writes a rotating file inside the container instead, which means logs die
 * with the container and two replicas fight over one file.
 *
 * Format follows the environment: structured JSON in production so a log
 * pipeline can index the fields, human-readable lines in development.
 */
const isProduction = config.nodeEnv === 'production';

/**
 * ANSI codes written by hand rather than through chalk.
 *
 * Colour is worth about eight lines; it is not worth two dependencies
 * (`chalk` and `pretty-error`, which is what the reference codebase pulls in
 * for the same effect).
 */
const ANSI = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
} as const;

const LEVEL_COLOR: Record<string, string> = {
  error: ANSI.red,
  warn: ANSI.yellow,
  info: ANSI.green,
  debug: ANSI.blue,
  verbose: ANSI.magenta,
};

function paint(text: string, color: string): string {
  // Skip empty strings: wrapping one still emits the escape pair, which shows
  // up as stray bytes in any tool that reads the log as text.
  if (!config.log.color || text === '') return text;
  return `${color}${text}${ANSI.reset}`;
}

const humanFormat = winston.format.printf((info) => {
  const { level, message, timestamp, context, stack, ...rest } = info;
  const meta = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
  const trace = typeof stack === 'string' ? `\n${stack}` : '';
  const label = typeof context === 'string' ? context : '-';
  const when = typeof timestamp === 'string' ? timestamp : new Date().toISOString();
  const text = typeof message === 'string' ? message : JSON.stringify(message);
  const color = LEVEL_COLOR[level] ?? ANSI.green;

  // Pad BEFORE colouring. Escape codes are characters too, so padding a
  // string that already contains them throws the columns out by nine.
  const paddedLevel = level.toUpperCase().padEnd(5);

  return (
    `${paint(when, ANSI.dim)} ` +
    `${paint(paddedLevel, color)} ` +
    `${paint(`[${label}]`, ANSI.cyan)} ` +
    `${paint(text, color)}${meta}${paint(trace, ANSI.dim)}`
  );
});

const rootLogger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    isProduction ? winston.format.json() : humanFormat,
  ),
  transports: [
    new winston.transports.Console({
      // Test runs deliberately trigger failures; printing every one of them
      // buries the assertion output that actually matters.
      silent: config.nodeEnv === 'test',
    }),
  ],
  // Let the process decide what to do with a crash; a logger swallowing the
  // exception it is reporting is worse than no logger.
  exitOnError: false,
});

/**
 * One instance per class, carrying that class's name as the log context:
 *
 *   private readonly logger = new LogService(CreateSubscriptionUseCase.name);
 *
 * Also satisfies Nest's `LoggerService`, so `app.useLogger(new LogService('Nest'))`
 * routes framework output through the same formatter.
 */
export class LogService implements LoggerService {
  constructor(private readonly context: string) {}

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('verbose', message, optionalParams);
  }

  /**
   * Accepts an `Error`, an `AppError`, or a plain string. `AppError` does not
   * extend `Error`, so its stack arrives as `cause` rather than `stack` —
   * both are handled below.
   */
  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  private write(level: string, message: unknown, optionalParams: unknown[]): void {
    // Nest appends the context as a trailing string argument when this class
    // is used as the framework logger; an explicit context wins over ours.
    const last = optionalParams.at(-1);
    const nestContext = typeof last === 'string' ? last : undefined;
    // Nest calls error(message, stack, context) and passes null for the stack
    // when there is none. Keeping it would print `{"meta":[null]}` on every
    // framework error line.
    const meta = optionalParams.filter(
      (param) => param !== nestContext && param !== null && param !== undefined,
    );

    const { text, stack } = describe(message);

    rootLogger.log({
      level,
      message: text,
      context: nestContext ?? this.context,
      ...(stack ? { stack } : {}),
      ...(meta.length > 0 ? { meta: redact(meta) } : {}),
    });
  }
}

function describe(message: unknown): { text: string; stack?: string } {
  if (typeof message === 'string') return { text: message };
  if (message instanceof Error) {
    // Errors here are usually wrappers ('Transaction failed...') whose cause
    // holds the driver error — the half worth reading. Walk the chain.
    const stacks = [message.stack ?? message.message];
    let cause: unknown = message.cause;
    while (cause instanceof Error) {
      stacks.push(`caused by: ${cause.stack ?? cause.message}`);
      cause = cause.cause;
    }
    if (cause !== undefined) stacks.push(`caused by: ${safeText(cause)}`);
    return { text: message.message, stack: stacks.join('\n') };
  }
  if (message && typeof message === 'object') {
    return { text: JSON.stringify(redact(message)) };
  }
  return { text: safeText(message) };
}

/** Stringifies anything without risking '[object Object]' or a throw. */
function safeText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
    return `${String(value)}`;
  }
  try {
    return JSON.stringify(value) ?? '[unserialisable]';
  } catch {
    return '[unserialisable]';
  }
}
