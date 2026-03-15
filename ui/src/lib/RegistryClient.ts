import yaml from 'js-yaml';

/**
 * Interface representing the root index of a specific registry type (Widgets, Patterns, or Hierarchies).
 * This index points to all available architectures/versions in that registry.
 */
export interface RegistryIndex {
    registryName: string;
    version: string;
    patterns?: RegistryItem[];
    widgets?: RegistryItem[];
    hierarchies?: any[];
}

/**
 * Interface representing a specific pattern or widget item listed in the registry.
 */
export interface RegistryItem {
    id: string; // The unique identifier, e.g. "openshift-cluster-v4"
    name: string; // Human readable
    versions: string[]; // List of available semantic versions
    latest: string; // The recommended version to use
}

/**
 * Client for fetching and parsing YAML architecture definitions from a distributed registry.
 * This class handles both browser-based (HTTP fetch) and CLI-based (fs read) environments,
 * enabling dynamic remote resolution of Architecture-as-Code definitions.
 */
export class RegistryClient {
    private baseUrl: string;
    /** Basic in-memory caching to avoid redundant HTTP requests for the same YAML files */
    private cache: Map<string, any> = new Map();

    /**
     * @param baseUrl The root URI where the registry folders (`/patterns`, `/widgets`, etc) are located.
     */
    constructor(baseUrl: string) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    /** Fetches the root index of all base atomic components. */
    async getWidgetRegistry(): Promise<RegistryIndex> {
        return this.fetchYaml(`${this.baseUrl}/widget-registry.yaml`);
    }

    /** Fetches the root index of all composite macro-expansion architectures. */
    async getPatternRegistry(): Promise<RegistryIndex> {
        return this.fetchYaml(`${this.baseUrl}/pattern-registry.yaml`);
    }

    /** Fetches the structural constraints that define legal deployment stacking order (e.g., Datacenter -> Cluster -> Namespace). */
    async getHierarchyRegistry(): Promise<RegistryIndex> {
        return this.fetchYaml(`${this.baseUrl}/hierarchy-registry.yaml`);
    }

    /** Fetches the heuristics heuristics used to reverse-engineer and discover patterns in free-form brownfield architectures. */
    async getDetectorsRegistry(): Promise<any> {
        return this.fetchYaml(`${this.baseUrl}/detectors.yaml`);
    }

    /** Retrieves the specific YAML definition corresponding to a requested Widget version. */
    async getWidget(id: string, version: string): Promise<any> {
        const path = `${this.baseUrl}/widgets/${id}/${version}/${id}.yaml`;
        return this.fetchYaml(path);
    }

    /** Retrieves the specific YAML definition (including its macro_expansion logic) corresponding to a requested Pattern version. */
    async getPattern(id: string, version: string): Promise<any> {
        const path = `${this.baseUrl}/patterns/${id}/${version}/${id}.yaml`;
        return this.fetchYaml(path);
    }

    /**
     * Core fetching utility capable of seamlessly switching between `fetch` (for the React UI)
     * and `fs` (for the headless CLI validator) to retrieve and parse YAML assets safely.
     * @param url The absolute HTTP URL or local FS path to the YAML file.
     */
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
                this.cache.set(url, parsed); // Memoize
                return parsed;
            } else {
                // Bust browser cache during development with a timestamp
                const response = await fetch(`${url}?v=${Date.now()}`);
                if (!response.ok) {
                    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
                }
                const content = await response.text();
                const parsed = yaml.load(content);
                this.cache.set(url, parsed); // Memoize
                return parsed;
            }
        } catch (error) {
            console.error(`RegistryClient error fetching ${url}:`, error);
            throw error;
        }
    }
}
