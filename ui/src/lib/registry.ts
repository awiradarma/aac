import registryData from '../../../registry/patterns.json';
import type { Registry } from '../types';

export const registry = registryData as unknown as Registry;

export const getPatternsByLevel = (level: string) => {
    return registry.patterns.filter(p => p.c4Level === level);
};

export const getPatternById = (id: string) => {
    return registry.patterns.find(p => p.id === id);
};
