import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Sovereign Architecture Auto-Discovery & Validation GUI', () => {

    test('should organically load an architecture payload, toggle coordinate layouts, and strictly enforce visual clipping', async ({ page }) => {
        // 1. Navigate to the baseline React environment 
        await page.goto('/');

        // Ensure the main React Flow component binds exactly 
        const canvas = page.locator('.react-flow');
        await expect(canvas).toBeVisible();

        // 2. Headlessly simulate raw user system ingestion
        const filePath = path.resolve(process.cwd(), '../example/architecture.yaml');

        page.on('dialog', dialog => dialog.accept()); // Automatically dismiss the successfully loaded alert dialog!

        // Playwright strictly binds file payload arrays bypassing invisible label bounds
        const fileSelector = 'input[type="file"]';
        await page.setInputFiles(fileSelector, filePath);

        // 3. Await AST evaluation and DOM painting loops
        // The imported YAML defaults to "Main System Context" view which only contains the "Core Software System" boundary.
        await expect(page.locator('text="Core Software System"').first()).toBeVisible();

        // The deeply nested cluster should naturally be entirely mathmatically hidden on the Context view!
        await expect(page.locator('text="Primary OpenShift Cluster"').first()).not.toBeVisible();

        // 4. Force UX view shift directly isolating topological coordinates
        const viewDropdown = page.locator('select.bg-slate-800').locator('..').locator('select'); // Locate the native view selector
        await viewDropdown.selectOption({ label: 'Topology (Deployment)' });

        // Ensure React recursively remaps active layout grids
        const cluster = page.locator('text="Primary OpenShift Cluster"').first();
        await expect(cluster).toBeVisible();

        // Ensure the CQRS components safely hide within scoped nested boundaries by default
        await expect(page.locator('text="API Controller"').first()).not.toBeVisible();

        // 5. Test macro engine topology routing algorithms computationally natively
        const validateBtn = page.locator('button[title="Validate Design"]');
        await validateBtn.click();


        const passesCheck = page.locator('text=Architecture Valid!');
        await expect(passesCheck).toBeVisible();

        // Close the validation overlay
        await page.locator('button', { hasText: 'Close' }).click();

        await viewDropdown.selectOption({ label: 'API Container Instance - Components (Component)' });

        // The boundary mapping fix ensures this visually clips natively.
        await expect(page.locator('text="API Controller"').first()).toBeVisible();
        await expect(page.locator('text="Command Handler"').first()).toBeVisible();
    });

});
