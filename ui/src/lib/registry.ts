import { ResolverEngine } from './ResolverEngine';
import type { Registry } from '../types';

/** Singleton instance containing the completely resolved catalog of rules, widgets, and patterns */
let globalRegistry: Registry | null = null;
let resolverEngine: ResolverEngine | null = null;

/**
 * Initializes the global architecture registry by pulling down the index and 
 * resolving all nested version paths. Must be called before accessing any patterns.
 * @param baseUrl URL pointing to the `registry-draft` directory.
 */
export const initRegistry = async (baseUrl: string = '') => {
    resolverEngine = new ResolverEngine(baseUrl);
    globalRegistry = await resolverEngine.initialize();
    return globalRegistry;
};

/**
 * Synchronous accessor for the registry. Throws an error if used before `initRegistry`.
 */
export const getRegistry = (): Registry => {
    if (!globalRegistry) throw new Error("Registry not initialized");
    return globalRegistry;
};

/**
 * Filters the registry to return only components that match the given C4 semantic level.
 * @param level e.g. "SoftwareSystem", "Container", or "DeploymentNode"
 */
export const getPatternsByLevel = (level: string) => {
    return getRegistry().patterns.filter(p => p.c4Level === level);
};

/** Finds any pattern/widget with a matching ID, usually returns the first loaded version */
export const getPatternById = (id: string) => {
    return getRegistry().patterns.find(p => p.id === id);
};

/** Finds an explicit pattern given its ID and SemVer */
export const getPatternByIdAndVersion = (id: string, version: string) => {
    return getRegistry().patterns.find(p => p.id === id && p.version === version);
};
