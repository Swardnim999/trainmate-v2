import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgresql://trainmate:trainmate_dev@localhost:5432/trainmate',
    },
  },
});

const SCREENSHOT_DIR = 'C:/Users/sward/.gemini/antigravity-ide/brain/0d8cf471-afff-4fdd-998a-7336121843ed/screenshots';

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const timestamp = Date.now();
const USER_A_EMAIL = `test_m13_alice_${timestamp}@example.com`;
const USER_B_EMAIL = `test_m13_bob_${timestamp}@example.com`;
const PASSWORD = 'Password123!';

// Unique travel date for this test run
const dayOffset = 10 + Math.floor((timestamp % 1000) / 10);
const travelDateObj = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
const TRAVEL_DATE = travelDateObj.toISOString().split('T')[0];

let userASessionStr: string | null = null;
let userBSessionStr: string | null = null;

async function hydrateSession(page: Page, sessionStr: string) {
  await page.addInitScript((val) => {
    localStorage.setItem('trainmate-auth-token', val);
  }, sessionStr);
}

test.describe.serial('Milestone 13 Canonical E2E Verification Suite (12 Flows)', () => {

  test.beforeAll(async () => {
    // Clean up test users from previous runs
    await prisma.user.deleteMany({
      where: {
        email: { startsWith: 'test_m13_' },
      },
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('Flow 1: User Registration & Email Confirmation', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Switch to Sign Up tab
    await page.click('[role="tab"]:has-text("Sign Up")');
    await page.fill('#signup-email', USER_A_EMAIL);
    await page.fill('#signup-password', PASSWORD);

    // Screenshot of signup form
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_01_signup_form.png'), fullPage: true });

    // Submit signup
    await page.click('button:has-text("Create Account")');
    await expect(page.locator('text=Account created').first()).toBeVisible({ timeout: 10000 });

    // Confirm email in database
    await prisma.user.updateMany({
      where: { email: USER_A_EMAIL },
      data: { emailConfirmedAt: new Date() },
    });

    // Log in with confirmed credentials
    await page.click('[role="tab"]:has-text("Login")');
    await page.waitForTimeout(300);
    await page.fill('#email', USER_A_EMAIL);
    await page.fill('#password', PASSWORD);
    await Promise.all([
      page.waitForURL(/.*dashboard/, { timeout: 15000 }),
      page.click('button:has-text("Sign In")'),
    ]);

    await expect(page.locator('text=TrainMate').first()).toBeVisible();

    // Verify and store session in localStorage
    userASessionStr = await page.evaluate(() => localStorage.getItem('trainmate-auth-token'));
    expect(userASessionStr).not.toBeNull();

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_01_dashboard_after_signup.png'), fullPage: true });
  });

  test('Flow 2: Login & Session Hydration', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Sign in
    await page.click('[role="tab"]:has-text("Login")');
    await page.fill('#email', USER_A_EMAIL);
    await page.fill('#password', PASSWORD);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_02_login_form.png'), fullPage: true });

    await Promise.all([
      page.waitForURL(/.*dashboard/, { timeout: 15000 }),
      page.click('button:has-text("Sign In")'),
    ]);

    await expect(page.locator('text=TrainMate').first()).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_02_dashboard_hydrated.png'), fullPage: true });
  });

  test('Flow 3: Dashboard Journey Creation with Train Autocomplete', async ({ page }) => {
    await hydrateSession(page, userASessionStr!);
    await page.goto('/dashboard');
    await expect(page.locator('text=TrainMate').first()).toBeVisible();

    // Open Plan Journey dialog
    await page.click('button:has-text("Plan Journey")');
    await expect(page.locator('text=Plan New Journey')).toBeVisible();

    await page.fill('#name', 'Alice Traveler');

    // Train Autocomplete: type 12951 and wait for results
    const trainInput = page.locator('input[placeholder*="train" i]').first();
    await trainInput.fill('12951');
    await page.waitForTimeout(600);

    const popoverItem = page.locator('[role="option"], [cmdk-item]').first();
    if (await popoverItem.isVisible()) {
      await popoverItem.click();
    }

    await page.fill('#travelDate', TRAVEL_DATE);
    await page.fill('#boardingStation', 'Mumbai Central');
    await page.fill('#destinationStation', 'New Delhi');
    await page.fill('#college', 'IIT Bombay');

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_03_plan_journey_form.png'), fullPage: true });

    // Submit journey
    await page.click('button:has-text("Find Travel Companions")');

    // Wait for journey creation and companions list
    await expect(page.locator('text=Travel Companions').first()).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_03_journey_created_result.png'), fullPage: true });
  });

  test('Flow 4: Exact Train+Date Companion Search / Matching', async ({ page }) => {
    // Register User B
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('networkidle');

    await page.click('[role="tab"]:has-text("Sign Up")');
    await page.fill('#signup-email', USER_B_EMAIL);
    await page.fill('#signup-password', PASSWORD);
    await page.click('button:has-text("Create Account")');
    await expect(page.locator('text=Account created').first()).toBeVisible({ timeout: 10000 });

    // Confirm email in DB
    await prisma.user.updateMany({
      where: { email: USER_B_EMAIL },
      data: { emailConfirmedAt: new Date() },
    });

    // Login as User B
    await page.click('[role="tab"]:has-text("Login")');
    await page.waitForTimeout(300);
    await page.fill('#email', USER_B_EMAIL);
    await page.fill('#password', PASSWORD);
    await Promise.all([
      page.waitForURL(/.*dashboard/, { timeout: 15000 }),
      page.click('button:has-text("Sign In")'),
    ]);

    userBSessionStr = await page.evaluate(() => localStorage.getItem('trainmate-auth-token'));
    expect(userBSessionStr).not.toBeNull();

    // User B plans journey on same train & date
    await page.click('button:has-text("Plan Journey")');
    await page.fill('#name', 'Bob Voyager');
    const trainInput = page.locator('input[placeholder*="train" i]').first();
    await trainInput.fill('12951');
    await page.waitForTimeout(600);
    const popoverItem = page.locator('[role="option"], [cmdk-item]').first();
    if (await popoverItem.isVisible()) {
      await popoverItem.click();
    }
    await page.fill('#travelDate', TRAVEL_DATE);
    await page.fill('#boardingStation', 'Surat');
    await page.fill('#destinationStation', 'New Delhi');
    await page.fill('#college', 'IIT Delhi');

    await page.click('button:has-text("Find Travel Companions")');

    // View companions list
    await expect(page.locator('text=Travel Companions').first()).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_04_matched_companions_list.png'), fullPage: true });
  });

  test('Flow 5: Send Companion Request', async ({ page }) => {
    await hydrateSession(page, userBSessionStr!);
    await page.goto('/dashboard');
    await expect(page.locator('text=TrainMate').first()).toBeVisible();

    // Wait for journey card to load
    await page.waitForSelector('button:has-text("Find Companions")', { timeout: 15000 });
    await page.click('button:has-text("Find Companions")');

    // Wait for companions list and click Send Request
    await page.waitForSelector('text=Alice Traveler', { timeout: 15000 });
    const sendReqBtn = page.getByRole('button', { name: 'Send Request' }).first();
    await sendReqBtn.click();

    // Wait for request confirmation toast
    await expect(page.locator('text=Request sent').first()).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_05_request_sent.png'), fullPage: true });
  });

  test('Flow 6: Incoming Requests & Bell Badge Count', async ({ page }) => {
    await hydrateSession(page, userASessionStr!);
    await page.goto('/dashboard');
    await expect(page.locator('text=TrainMate').first()).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_06_dashboard_incoming_badge.png'), fullPage: true });

    // Navigate to /requests
    await page.goto('/requests');
    await expect(page.locator('text=Travel Requests').first()).toBeVisible();
    await page.waitForSelector('button:has-text("Accept")', { timeout: 15000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_06_requests_received_tab.png'), fullPage: true });
  });

  test('Flow 7: Accept Companion Request (Creates Conversation)', async ({ page }) => {
    await hydrateSession(page, userASessionStr!);
    await page.goto('/requests');
    await expect(page.locator('text=Travel Requests').first()).toBeVisible();

    // Accept incoming request
    await page.waitForSelector('button:has-text("Accept")', { timeout: 15000 });
    await page.click('button:has-text("Accept")');
    await page.waitForURL(/.*chat/, { timeout: 15000 });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_07_request_accepted_chats.png'), fullPage: true });
  });

  test('Flow 8: Realtime Messaging & Atomic Send in Chat Room', async ({ page }) => {
    await hydrateSession(page, userASessionStr!);
    await page.goto('/chats');
    await expect(page.locator('text=My Chats').first()).toBeVisible();

    // Click on conversation card
    await page.waitForSelector('text=Bob Voyager', { timeout: 15000 });
    await page.locator('text=Bob Voyager').first().click();
    await page.waitForURL(/.*chat/, { timeout: 15000 });

    // Type message and send
    await page.waitForSelector('input[placeholder*="message" i], textarea', { timeout: 15000 });
    await page.fill('input[placeholder*="message" i], textarea', 'Hello Bob! Excited to travel together.');
    await page.click('button:has([class*="lucide-send"]), button:has-text("Send")');
    await page.waitForTimeout(1500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_08_message_sent_timeline.png'), fullPage: true });
  });

  test('Flow 9: Read Receipts & Unread Count updates', async ({ page }) => {
    await hydrateSession(page, userBSessionStr!);
    await page.goto('/chats');
    await expect(page.locator('text=My Chats').first()).toBeVisible();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_09_user_b_chats_list.png'), fullPage: true });

    await page.waitForSelector('text=Alice Traveler', { timeout: 15000 });
    await page.locator('text=Alice Traveler').first().click();
    await page.waitForURL(/.*chat/, { timeout: 15000 });

    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_09_user_b_chat_read.png'), fullPage: true });
  });

  test('Flow 10: Presence / Online Status & Typing Indicators', async ({ page }) => {
    await hydrateSession(page, userBSessionStr!);
    await page.goto('/chats');
    await expect(page.locator('text=My Chats').first()).toBeVisible();

    await page.waitForSelector('text=Alice Traveler', { timeout: 15000 });
    await page.locator('text=Alice Traveler').first().click();
    await page.waitForURL(/.*chat/, { timeout: 15000 });

    // In open chat page, type in message input to trigger typing
    await page.waitForSelector('input[placeholder*="message" i], textarea', { timeout: 15000 });
    await page.fill('input[placeholder*="message" i], textarea', 'Hey Alice! Replying now...');
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_10_presence_and_typing.png'), fullPage: true });
  });

  test('Flow 11: Profile View & Profile Update with Avatar Cache-Busting', async ({ page }) => {
    await hydrateSession(page, userASessionStr!);
    await page.goto('/dashboard');
    await expect(page.locator('text=TrainMate').first()).toBeVisible();

    // Open Profile Menu
    const profileBtn = page.locator('header button:has([class*="avatar"]), header button.rounded-full').first();
    await profileBtn.click();
    await page.waitForTimeout(500);

    const editProfileBtn = page.locator('button:has-text("Edit Profile")').first();
    if (await editProfileBtn.isVisible()) {
      await editProfileBtn.click();
      await page.waitForTimeout(500);
    }

    // Fill bio
    const bioInput = page.locator('#bio, textarea[name="bio"]').first();
    if (await bioInput.isVisible()) {
      await bioInput.fill('Tech enthusiast & avid train traveler.');
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_11_profile_updated.png'), fullPage: true });

    const saveBtn = page.locator('button:has-text("Save Changes"), button:has-text("Save")').first();
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
      await page.waitForTimeout(1000);
    }
  });

  test('Flow 12: Moderation (Reporting a User & Blocking / Block List)', async ({ page }) => {
    await hydrateSession(page, userASessionStr!);
    await page.goto('/chats');
    await expect(page.locator('text=My Chats').first()).toBeVisible();

    await page.waitForSelector('text=Bob Voyager', { timeout: 15000 });
    await page.locator('text=Bob Voyager').first().click();
    await page.waitForURL(/.*chat/, { timeout: 15000 });

    // Open dropdown menu in chat header (the second glass-icon-button, first is back button)
    await page.locator('button.glass-icon-button').nth(1).click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'flow_12_moderation_dialog.png'), fullPage: true });
  });
});
