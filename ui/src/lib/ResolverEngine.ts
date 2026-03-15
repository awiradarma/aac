import { RegistryClient } from './RegistryClient';
import type { Pattern, Registry } from '../types';

export class ResolverEngine {
    private client: RegistryClient;
    private resolvedPatterns: Pattern[] = [];
    private resolvedHierarchies: any[] = [];
    private resolvedDetectors: any[] = [];
    private resolutionComplete = false;

    constructor(baseUrl: string) {
        this.client = new RegistryClient(baseUrl);
    }

    async initialize(): Promise<Registry> {
        if (this.resolutionComplete) {
            return {
                registryName: "Dynamic-Registry",
                version: "latest",
                patterns: this.resolvedPatterns,
                deployment_hierarchies: this.resolvedHierarchies,
                detectors: this.resolvedDetectors
            };
        }

        try {
            const [widgetIndex, patternIndex, hierarchyIndex, detectorsObj] = await Promise.all([
                this.client.getWidgetRegistry(),
                this.client.getPatternRegistry(),
                this.client.getHierarchyRegistry(),
                this.client.getDetectorsRegistry().catch(() => ({ detectors: [] }))
            ]);

            this.resolvedHierarchies = hierarchyIndex.hierarchies || [];
            this.resolvedDetectors = detectorsObj.detectors || [];

            const promises: Promise<Pattern>[] = [];

            // Fetch all versions of widgets
            if (widgetIndex.widgets) {
                for (const item of widgetIndex.widgets) {
                    for (const version of item.versions) {
                        promises.push(this.client.getWidget(item.id, version));
                    }
                }
            }

            // Fetch all versions of patterns
            if (patternIndex.patterns) {
                for (const item of patternIndex.patterns) {
                    for (const version of item.versions) {
                        promises.push(this.client.getPattern(item.id, version));
                    }
                }
            }

            const allAssets = await Promise.all(promises);
            this.resolvedPatterns = allAssets;
            this.resolutionComplete = true;

            return {
                registryName: "Dynamic-Registry",
                version: "latest",
                patterns: this.resolvedPatterns,
                deployment_hierarchies: this.resolvedHierarchies,
                detectors: this.resolvedDetectors
            };
        } catch (error) {
            console.error("ResolverEngine failed to initialize", error);
            throw error;
        }
    }

    getPatterns(): Pattern[] {
        return this.resolvedPatterns;
    }
}
