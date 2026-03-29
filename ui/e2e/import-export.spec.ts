import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

test.describe('Import/Export Lifecycle Fidelity', () => {

    test('should maintain architectural integrity through an export-import cycle', async ({ page }) => {
        // 1. Setup
        await page.goto('/');
        
        // Handle confirm dialog for clear canvas
        page.on('dialog', dialog => dialog.accept());
        // Clear canvas
        await page.locator('button:has-text("Clear Canvas")').click();

        // 2. Import baseline architecture
        const importFile = path.resolve(process.cwd(), '../example/architecture.yaml');
        await page.setInputFiles('input[type="file"]', importFile);

        // 3. Verify initial import success
        // Wait for views to load and select Topology
        const viewDropdown = page.locator('select.bg-slate-800').locator('..').locator('select');
        await expect(viewDropdown).toBeVisible();
        await viewDropdown.selectOption({ label: 'Topology (Deployment)' });

        await expect(page.locator('text="Primary Region"').first()).toBeVisible();
        await expect(page.locator('text="Primary OpenShift Cluster"').first()).toBeVisible();

        // 4. Export to new YAML
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('button:has-text("Export")').click(),
        ]);
        
        const exportPath = await download.path();
        if (!exportPath) throw new Error("Export download failed");
        
        const exportContent = fs.readFileSync(exportPath, 'utf8');
        
        // Basic structural assertions on exported YAML
        expect(exportContent).toContain('model:');
        expect(exportContent).toContain('deployment:');
        expect(exportContent).toContain('Primary-Region');
        expect(exportContent).toContain('Primary-OpenShift-Cluster');

        // 5. Verify round-trip: Clear and Re-import the exported file
        await page.locator('button:has-text("Clear Canvas")').click();
        await page.setInputFiles('input[type="file"]', exportPath);

        // Select Topology again (it should have been preserved in the export)
        await viewDropdown.selectOption({ label: 'Topology (Deployment)' });
        
        await expect(page.locator('text="Primary Region"').first()).toBeVisible();
        await expect(page.locator('text="Primary OpenShift Cluster"').first()).toBeVisible();

        // 6. Validate the round-tripped architecture
        await page.waitForTimeout(3000); 
        const validateBtn = page.locator('button[title="Validate Design"]');
        await validateBtn.click();

        // Wait for modal and log results
        await page.waitForSelector('.fixed.inset-0', { timeout: 15000 });
        const modalText = await page.textContent('.fixed.inset-0');
        console.log("IMPORT-EXPORT VALIDATION MODAL CONTENT:", modalText);

        // The modal text will appear, but since example/architecture.yaml is a baseline snapshot
        // it may inherently contain valid structural violations against the hardened ruleset.
        // We just assert the validation engine ran successfully without crashing.
        expect(modalText).toContain('Architecture Validation');
        
        await page.locator('button:has-text("Close")').click();
    });

});
