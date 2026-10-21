import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING } from './helpers';

/** A valid 1x1 PNG, so the server sees a real picture. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/**
 * A campaign with a picture: pick or drop it on the new-campaign form, see it, get the reason when a file is refused
 * (MP4, too big, not a picture), create the draft, and see the picture on the campaign page. Nothing is started or sent.
 */
test.describe('campaign picture', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('add a picture to a campaign, with clear reasons when a file is refused', async ({ page }) => {
    await signIn(page);
    await page.goto('/broadcast/new');
    test.skip(await page.getByText('Link a WhatsApp number first').isVisible(), 'a campaign needs a linked number');
    const file = page.getByLabel('Picture or GIF', { exact: true });

    // Refused with the reason, before anything is uploaded.
    await file.setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('x') });
    await expect(page.getByText('MP4 videos are not supported yet. Use a picture or a GIF.')).toBeVisible();
    await file.setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 10) });
    await expect(page.getByText(/The most is 5 MB/)).toBeVisible();
    await file.setInputFiles({ name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await expect(page.getByText('That file type is not supported. Use a JPG, PNG, WebP or GIF.')).toBeVisible();

    // A real picture uploads and shows its preview; it can be removed and chosen again.
    await file.setInputFiles({ name: 'offer.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByAltText('Preview of the picture')).toBeVisible();
    await expect(page.getByText('offer.png', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByAltText('Preview of the picture')).toHaveCount(0);
    await page.getByRole('button', { name: 'Use one I uploaded before' }).click();
    await page.getByRole('button', { name: /offer\.png/ }).first().click();
    await expect(page.getByAltText('Preview of the picture')).toBeVisible();

    // Create the draft: the campaign page shows the picture and says it is sent with the message as the caption.
    const stamp = String(Date.now());
    await page.locator('input[name="name"]').fill(`E2E picture ${stamp}`);
    await page.locator('textarea[name="body"]').fill('Hi {{name}}, a picture offer.');
    await page.locator('select[name="senderIdentityId"]').selectOption({ index: 1 });
    await page.locator('select[name="fromTagId"]').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/broadcast\/[0-9a-f-]{36}/);
    await expect(page.getByRole('region', { name: 'Picture' })).toContainText('offer.png');
    await expect(page.getByAltText('The picture sent with this campaign')).toBeVisible();
  });
});
