import { test, expect } from '@playwright/test';
import { signIn, CREDS_MISSING, createDraft } from './helpers';

/** A valid 1x1 PNG, so the server sees a real picture. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/**
 * A campaign with a picture: pick or drop it on the new-campaign form, see it, get the reason when a file is refused
 * (MP4, too big, not a picture), create the draft, and see the picture on the campaign page. Nothing is started or sent.
 */
test.describe('campaign picture', () => {
  test.skip(CREDS_MISSING, 'set TEST_EMAIL / TEST_PASSWORD in .env');

  test('add a picture to a campaign, with clear reasons when a file is refused', async ({ page }) => {
    test.setTimeout(60_000);
    await signIn(page);
    await page.goto('/broadcast/new');
    test.skip(await page.getByText('Link a WhatsApp number first').isVisible(), 'a campaign needs a linked number');
    const file = page.getByLabel('Picture or GIF', { exact: true });

    // Refused with the reason, before anything is uploaded.
    await file.setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('x') });
    await expect(page.getByText('MP4 videos are not supported yet. Use a picture or a GIF.')).toBeVisible();
    await file.setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 10) });
    await expect(page.getByText(/The limit is 5 MB/)).toBeVisible();
    await file.setInputFiles({ name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await expect(page.getByText('That file type is not supported. Use a JPG, PNG, WebP or GIF.')).toBeVisible();

    // A real picture uploads and shows its preview; it can be removed and chosen again.
    await file.setInputFiles({ name: 'offer.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByAltText('Attached picture')).toBeVisible();
    await expect(page.getByText(/offer.png/)).toBeVisible();
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByAltText('Attached picture')).toHaveCount(0);
    await file.setInputFiles({ name: 'offer.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByAltText('Attached picture')).toBeVisible();

    // Create the draft: the campaign page shows the picture and says it is sent with the message as the caption.
    const stamp = String(Date.now());
    await page.locator('#nc-nm').fill(`E2E picture ${stamp}`);
    await page.locator('#nc-body').fill('Hi {{name}}, a picture offer.');
    await page.getByRole('button', { name: 'A tag', exact: true }).click();
    await page.locator('#nc-aq').click();
    await page.getByRole('option').first().click();
    await page.locator('.nc-opt').first().click();
    await createDraft(page);
    await expect(page).toHaveURL(/\/broadcast\/[0-9a-f-]{36}/);
    await expect(page.getByRole('region', { name: 'Picture' })).toContainText('offer.png');
    await expect(page.getByAltText('The picture sent with this campaign')).toBeVisible();
  });
});
