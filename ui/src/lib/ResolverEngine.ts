import { RegistryClient } from './RegistryClient';
import type { Pattern, Registry } from '../types';

export class ResolverEngine {
    private client: RegistryClient;
    private resolvedPatterns: Pattern[] = [];
    private resolutionComplete = false;

    constructor(baseUrl: string) {
        this.client = new RegistryClient(baseUrl);
    }

    async initialize(): Promise<Registry> {
        if (this.resolutionComplete) {
            return {
                registryName: "Dynamic-Registry",
                version: "latest",
                patterns: this.resolvedPatterns
            };
        }

        try {
            const [widgetIndex, patternIndex] = await Promise.all([
                this.client.getWidgetRegistry(),
                this.client.getPatternRegistry()
            ]);

            const promises: Promise<Pattern>[] = [];

            // Fetch all latest widgets
            if (widgetIndex.widgets) {
                for (const item of widgetIndex.widgets) {
                    promises.push(this.client.getWidget(item.id, item.latest));
                }
            }

            // Fetch all latest patterns
            if (patternIndex.patterns) {
                for (const item of patternIndex.patterns) {
                    promises.push(this.client.getPattern(item.id, item.latest));
                }
            }

            const allAssets = await Promise.all(promises);
            this.resolvedPatterns = allAssets;
            this.resolutionComplete = true;

            return {
                registryName: "Dynamic-Registry",
                version: "latest",
                patterns: this.resolvedPatterns
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
