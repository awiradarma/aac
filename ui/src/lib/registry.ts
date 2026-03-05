import { ResolverEngine } from './ResolverEngine';
import type { Registry } from '../types';

let globalRegistry: Registry | null = null;
let resolverEngine: ResolverEngine | null = null;

export const initRegistry = async (baseUrl: string = '') => {
    resolverEngine = new ResolverEngine(baseUrl);
    globalRegistry = await resolverEngine.initialize();
    return globalRegistry;
};

export const getRegistry = (): Registry => {
    if (!globalRegistry) throw new Error("Registry not initialized");
    return globalRegistry;
};

export const getPatternsByLevel = (level: string) => {
    return getRegistry().patterns.filter(p => p.c4Level === level);
};

export const getPatternById = (id: string) => {
    return getRegistry().patterns.find(p => p.id === id);
};
