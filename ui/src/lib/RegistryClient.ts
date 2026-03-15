import yaml from 'js-yaml';

export interface RegistryIndex {
    registryName: string;
    version: string;
    patterns?: RegistryItem[];
    widgets?: RegistryItem[];
    hierarchies?: any[];
}

export interface RegistryItem {
    id: string;
    name: string;
    versions: string[];
    latest: string;
}

export class RegistryClient {
    private baseUrl: string;
    private cache: Map<string, any> = new Map();

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    async getWidgetRegistry(): Promise<RegistryIndex> {
        return this.fetchYaml(`${this.baseUrl}/widget-registry.yaml`);
    }

    async getPatternRegistry(): Promise<RegistryIndex> {
        return this.fetchYaml(`${this.baseUrl}/pattern-registry.yaml`);
    }

    async getHierarchyRegistry(): Promise<RegistryIndex> {
        return this.fetchYaml(`${this.baseUrl}/hierarchy-registry.yaml`);
    }

    async getDetectorsRegistry(): Promise<any> {
        return this.fetchYaml(`${this.baseUrl}/detectors.yaml`);
    }

    async getWidget(id: string, version: string): Promise<any> {
        const path = `${this.baseUrl}/widgets/${id}/${version}/${id}.yaml`;
        return this.fetchYaml(path);
    }

    async getPattern(id: string, version: string): Promise<any> {
        const path = `${this.baseUrl}/patterns/${id}/${version}/${id}.yaml`;
        return this.fetchYaml(path);
    }

    private async fetchYaml(url: string): Promise<any> {
        if (this.cache.has(url)) {
            return this.cache.get(url);
        }

        try {
            // For local development without a real HTTP server yet, we will try to read from fs if running in Node
            // If in browser, fetch it.
            if (typeof window === 'undefined') {
                // @ts-ignore
                const fs = await import('fs');
                // Assume baseUrl is a local path if we're in Node
                const localPath = url;
                const content = fs.readFileSync(localPath, 'utf8');
                const parsed = yaml.load(content);
                this.cache.set(url, parsed);
                return parsed;
            } else {
                const response = await fetch(`${url}?v=${Date.now()}`);
                if (!response.ok) {
                    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
                }
                const content = await response.text();
                const parsed = yaml.load(content);
                this.cache.set(url, parsed);
                return parsed;
            }
        } catch (error) {
            console.error(`RegistryClient error fetching ${url}:`, error);
            throw error;
        }
    }
}
