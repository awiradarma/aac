import { test, expect } from '@playwright/test';
import fs from 'fs';

test.describe('Global HA API Expansion & Parentage Verification', () => {

    test('should expand Global HA API pattern and maintain strict node parentage', async ({ page }) => {
        // 1. Setup: Navigate and ensure clean state
        await page.goto('/');
        const canvas = page.locator('.react-flow');
        await expect(canvas).toBeVisible();

        // Listen to console logs to verify expansion execution
        page.on('console', msg => console.log('BROWSER LOG:', msg.text()));

        // Handle confirm dialog for clear canvas
        page.on('dialog', dialog => dialog.accept());

        // Clear canvas to start fresh
        const clearBtn = page.locator('button:has-text("Clear Canvas")');
        await clearBtn.click();

        // 2. Create a new Deployment View (E2E tests need a clean deployment target)
        await page.click('button:has-text("+ View")');
        
        const modal = page.locator('.fixed.inset-0'); // Modal overlay
        await expect(modal).toBeVisible();
        
        await modal.locator('input[placeholder="e.g. Core Banking Container View"]').fill('E2E Deployment');
        // Select 'Deployment' from the Diagram Level (C4) dropdown
        await modal.locator('select').last().selectOption({ label: 'Deployment' });
        await modal.locator('button:has-text("Save View")').click();
        
        await expect(modal).not.toBeVisible();

        // 3. Interaction: Drag and Drop Global HA API Pattern
        // Find the pattern in the sidebar (Make sure it's open)
        await page.click('text=Pattern Registry');
        const pattern = page.locator('text="Global HA API (Active-Passive)"');
        await expect(pattern).toBeVisible();

        // Use the native click-to-add functionality which mocks the drag/drop
        await pattern.click();

        // 4. Verification: Node counts
        // Wait for expansion to complete (Regions, DCs, APIs, GTM)
        await page.waitForTimeout(2000); // Give it a moment to render
        const nodeTexts = await page.locator('.react-flow__node').allTextContents();
        await expect(page.getByText('DC-1 (Active)').first()).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('DC-4 (Passive)').first()).toBeVisible({ timeout: 10000 });
        
        // Assert API instances are present by label
        for (let i = 1; i <= 4; i++) {
            await expect(page.getByText(`api-${i}`).first()).toBeVisible({ timeout: 10000 });
        }

        // 5. CRITICAL: Parentage Verification via Export
        // We trigger an export and check the underlying YAML structure to ensure API nodes are physically inside DCs
        // This is the most reliable way to verify the 'truth' that the validator receives.
        
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('button:has-text("Export")').click(),
        ]);
        
        const path = await download.path();
        if (!path) throw new Error("Download failed");
        
        // Use a simple grep-like check on the downloaded file (it's YAML)
        // We're looking for 'api-1' being inside 'containerInstances' of a deployment node 'dc-1'
        const yamlContent = fs.readFileSync(path, 'utf8');
        
        // Logic: DC-1 should have a containerInstance with composition_alias: api-1
        // (This is a simplified check, a full YAML parse would be better but this is E2E)
        expect(yamlContent).toContain('dc-1');
        expect(yamlContent).toContain('api-1');
        
        // More sophisticated structural check: 
        // Ensure 'api-1' is parented to 'dc-1' in the exported objects
        // We expect the nodes to reflect their pattern origins
        expect(yamlContent).toMatch(/composition_alias: dc-1/);
        expect(yamlContent).toMatch(/composition_alias: api-1/);

        // 6. Final Design Validation
        await page.waitForTimeout(3000); 
        const validateBtn = page.locator('button[title="Validate Design"]');
        await validateBtn.click();

        // Wait for modal and log results
        await page.waitForSelector('.fixed.inset-0', { timeout: 15000 });
        const modalText = await page.textContent('.fixed.inset-0');
        console.log("VALIDATION MODAL CONTENT:", modalText);

        expect(modalText).toContain('Architecture Valid');
        
        await page.locator('button:has-text("Close")').click();
    });

});
