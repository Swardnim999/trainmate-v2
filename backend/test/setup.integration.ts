import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';

/**
 * Vitest global setup for database-backed integration tests (Sprint 2B M5).
 *
 * Boots the disposable Postgres testdb service (docker compose --profile test),
 * runs migrations, and provides a PrismaClient bound to that test database.
 * Each test gets a fresh database via transaction rollback (fast) or full truncate (rare).
 *
 * If Docker is not available, integration tests are skipped gracefully.
 */

let prisma: PrismaClient;

const TEST_DB_URL = 'postgresql://trainmate:trainmate_test@localhost:5433/trainmate_test';

function checkDockerAvailable(): boolean {
  try {
    execSync('docker version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function startTestDb(): void {
  // Start the testdb container if not already running
  try {
    execSync('docker compose --profile test up -d testdb', {
      cwd: process.cwd(),
      stdio: 'pipe',
      timeout: 30_000,
    });
  } catch {
    // May already be running; continue
  }

  // Wait for healthcheck to pass (max 30s)
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    try {
      execSync('docker compose exec -T testdb pg_isready -U trainmate -d trainmate_test', {
        cwd: process.cwd(),
        stdio: 'pipe',
        timeout: 5000,
      });
      return;
    } catch {
      // Not ready yet
    }
    // Wait a bit
  }
  throw new Error('testdb failed to become healthy within 30s');
}

function runMigrations(): void {
  execSync('npx prisma migrate deploy', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: 'pipe',
    timeout: 60_000,
  });
}

export function stopTestDb(): void {
  try {
    execSync('docker compose --profile test down -v', {
      cwd: process.cwd(),
      stdio: 'pipe',
      timeout: 30_000,
    });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Truncates all auth tables in FK-safe order. Used for full reset between test files.
 */
async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "conversations", "requests", "unverified_trains", "journeys", "trains", "profiles", "user_reports", "blocked_users", "email_verifications", "refresh_tokens", "users" RESTART IDENTITY CASCADE;
  `);
}

/**
 * Cleans up after each test by rolling back or truncating.
 * Uses transaction rollback for speed; falls back to truncate if needed.
 */
async function cleanup(): Promise<void> {
  // Rollback any open transaction
  try {
    await prisma.$executeRawUnsafe('ROLLBACK');
  } catch {
    // No transaction to roll back
  }
  // Full truncate for test isolation
  await truncateAll();
}

export const canRunIntegration = checkDockerAvailable();

if (!canRunIntegration) {
  console.warn('[integration] Docker not available — skipping integration tests');
}

beforeAll(async () => {
  if (!canRunIntegration) {
    return;
  }

  // Start test database
  startTestDb();

  // Create Prisma client pointing to test database
  prisma = new PrismaClient({
    datasources: { db: { url: TEST_DB_URL } },
    log: ['error', 'warn'],
  });

  // Run migrations
  runMigrations();

  // Make prisma available globally for tests
  globalThis.__TEST_PRISMA__ = prisma;
}, 60_000);

afterAll(async () => {
  if (!canRunIntegration) {
    return;
  }

  // Clean up
  await prisma?.$disconnect();
});

beforeEach(async () => {
  if (!canRunIntegration) {
    return;
  }
  // Ensure clean state before each test
  await cleanup();
  vi.resetAllMocks();
});

afterEach(async () => {
  // No-op; beforeEach handles cleanup
});

/**
 * Helper to get the test Prisma client.
 * Tests should import this instead of creating their own.
 */
export function getTestPrisma(): PrismaClient {
  if (!globalThis.__TEST_PRISMA__) {
    throw new Error('Test Prisma client not initialized. Did setup run?');
  }
  return globalThis.__TEST_PRISMA__;
}

import type { EmailSender } from '../src/utils/emails.ts';

/**
 * Creates a real AuthService wired to the test database.
 * Use this for integration tests that need the full service layer.
 */
export async function createTestAuthService(
  customEmailSender?: EmailSender,
): Promise<import('../src/services/auth.service.ts').AuthService> {
  const { AuthService } = await import('../src/services/auth.service.ts');
  const { UserRepository } = await import('../src/repositories/users.repo.ts');
  const { RefreshTokenRepository } = await import('../src/repositories/refresh-tokens.repo.ts');
  const { EmailVerificationRepository } =
    await import('../src/repositories/email-verifications.repo.ts');
  const { BcryptPasswordHasher } = await import('../src/utils/passwords.ts');
  const { tokenOps } = await import('../src/utils/tokens.ts');
  const { JwtService } = await import('../src/utils/jwt.ts');
  const { ConsoleEmailSender } = await import('../src/utils/emails.ts');
  const { InMemoryLoginLockout } = await import('../src/services/login-lockout.ts');
  const { env } = await import('../src/config/env.ts');
  const { ACCESS_TOKEN_TTL_SECONDS } = await import('../src/config/constants.ts');

  const testPrisma = getTestPrisma();

  return new AuthService({
    db: testPrisma,
    users: new UserRepository(testPrisma),
    refreshTokens: new RefreshTokenRepository(testPrisma),
    emailVerifications: new EmailVerificationRepository(testPrisma),
    passwords: new BcryptPasswordHasher(),
    tokens: tokenOps,
    jwt: new JwtService(env.JWT_SECRET),
    emails:
      customEmailSender ??
      new ConsoleEmailSender({
        apiPublicOrigin: env.API_PUBLIC_ORIGIN,
        printLinks: false,
      }),
    lockout: new InMemoryLoginLockout(),
    accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    redirectOrigins: env.AUTH_ALLOWED_REDIRECT_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    defaultRedirectOrigin: env.CORS_ORIGIN,
    now: () => new Date(),
  });
}

/**
 * Creates a real ModerationService wired to the test database.
 */
export async function createTestModerationService(): Promise<
  import('../src/services/moderation.service.ts').ModerationService
> {
  const { ModerationService } = await import('../src/services/moderation.service.ts');
  const { BlockedUserRepository } = await import('../src/repositories/blocked-users.repo.ts');
  const { UserReportRepository } = await import('../src/repositories/user-reports.repo.ts');
  const { UserRepository } = await import('../src/repositories/users.repo.ts');
  const { AccessService } = await import('../src/services/access.service.ts');

  const testPrisma = getTestPrisma();
  const blockedUsers = new BlockedUserRepository(testPrisma);
  const userReports = new UserReportRepository(testPrisma);
  const users = new UserRepository(testPrisma);
  const access = new AccessService({ blockedUsers });

  return new ModerationService({
    blockedUsers,
    userReports,
    users,
    access,
  });
}

/**
 * Creates a real AccessService wired to the test database.
 */
export async function createTestAccessService(): Promise<
  import('../src/services/access.service.ts').AccessService
> {
  const { AccessService } = await import('../src/services/access.service.ts');
  const { BlockedUserRepository } = await import('../src/repositories/blocked-users.repo.ts');

  const testPrisma = getTestPrisma();
  return new AccessService({
    blockedUsers: new BlockedUserRepository(testPrisma),
    db: testPrisma,
  });
}

/**
 * Creates a real ProfileService wired to the test database.
 */
export async function createTestProfileService(
  accessService?: import('../src/services/access.service.ts').AccessService,
): Promise<import('../src/services/profile.service.ts').ProfileService> {
  const { ProfileService } = await import('../src/services/profile.service.ts');
  const { ProfileRepository } = await import('../src/repositories/profiles.repo.ts');
  const { UserRepository } = await import('../src/repositories/users.repo.ts');
  const { AccessService } = await import('../src/services/access.service.ts');
  const { BlockedUserRepository } = await import('../src/repositories/blocked-users.repo.ts');

  const testPrisma = getTestPrisma();
  const profiles = new ProfileRepository(testPrisma);
  const users = new UserRepository(testPrisma);
  const access =
    accessService ??
    new AccessService({
      blockedUsers: new BlockedUserRepository(testPrisma),
      db: testPrisma,
    });

  return new ProfileService({
    profiles,
    users,
    access,
  });
}

/**
 * Creates a real JourneyService wired to the test database.
 */
export async function createTestJourneyService(
  accessService?: import('../src/services/access.service.ts').AccessService,
): Promise<import('../src/services/journey.service.ts').JourneyService> {
  const { JourneyService } = await import('../src/services/journey.service.ts');
  const { JourneyRepository } = await import('../src/repositories/journeys.repo.ts');
  const { TrainRepository } = await import('../src/repositories/trains.repo.ts');
  const { UnverifiedTrainRepository } =
    await import('../src/repositories/unverified-trains.repo.ts');
  const { ProfileRepository } = await import('../src/repositories/profiles.repo.ts');
  const { AccessService } = await import('../src/services/access.service.ts');
  const { BlockedUserRepository } = await import('../src/repositories/blocked-users.repo.ts');

  const testPrisma = getTestPrisma();
  const journeys = new JourneyRepository(testPrisma);
  const trains = new TrainRepository(testPrisma);
  const unverifiedTrains = new UnverifiedTrainRepository(testPrisma);
  const profiles = new ProfileRepository(testPrisma);
  const access =
    accessService ??
    new AccessService({
      blockedUsers: new BlockedUserRepository(testPrisma),
      db: testPrisma,
    });

  return new JourneyService({
    journeys,
    trains,
    unverifiedTrains,
    profiles,
    access,
    db: testPrisma,
  });
}

/**
 * Creates a real TrainService wired to the test database.
 */
export async function createTestTrainService(): Promise<
  import('../src/services/train.service.ts').TrainService
> {
  const { TrainService } = await import('../src/services/train.service.ts');
  const { TrainRepository } = await import('../src/repositories/trains.repo.ts');
  const { UnverifiedTrainRepository } =
    await import('../src/repositories/unverified-trains.repo.ts');

  const testPrisma = getTestPrisma();
  return new TrainService({
    trainRepo: new TrainRepository(testPrisma),
    unverifiedRepo: new UnverifiedTrainRepository(testPrisma),
  });
}

/**
 * Creates a real RequestService wired to the test database.
 */
export async function createTestRequestService(
  accessService?: import('../src/services/access.service.ts').AccessService,
): Promise<import('../src/services/request.service.ts').RequestService> {
  const { RequestService } = await import('../src/services/request.service.ts');
  const { RequestRepository } = await import('../src/repositories/requests.repo.ts');
  const { AccessService } = await import('../src/services/access.service.ts');
  const { BlockedUserRepository } = await import('../src/repositories/blocked-users.repo.ts');

  const testPrisma = getTestPrisma();
  const requests = new RequestRepository(testPrisma);
  const access =
    accessService ??
    new AccessService({
      blockedUsers: new BlockedUserRepository(testPrisma),
      db: testPrisma,
    });

  return new RequestService({
    requests,
    access,
    db: testPrisma,
  });
}

/**
 * Creates a real ConversationService wired to the test database.
 */
export async function createTestConversationService(
  accessService?: import('../src/services/access.service.ts').AccessService,
): Promise<import('../src/services/conversation.service.ts').ConversationService> {
  const { ConversationService } = await import('../src/services/conversation.service.ts');
  const { ConversationRepository } = await import('../src/repositories/conversations.repo.ts');
  const { ProfileRepository } = await import('../src/repositories/profiles.repo.ts');
  const { AccessService } = await import('../src/services/access.service.ts');
  const { BlockedUserRepository } = await import('../src/repositories/blocked-users.repo.ts');

  const testPrisma = getTestPrisma();
  const conversations = new ConversationRepository(testPrisma);
  const profiles = new ProfileRepository(testPrisma);
  const access =
    accessService ??
    new AccessService({
      blockedUsers: new BlockedUserRepository(testPrisma),
      db: testPrisma,
    });

  return new ConversationService({
    conversations,
    profiles,
    access,
    db: testPrisma,
  });
}

// Type augmentation for globalThis
declare global {
  var __TEST_PRISMA__: PrismaClient | undefined;
}

export {};
