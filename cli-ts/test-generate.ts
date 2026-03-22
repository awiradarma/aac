import fs from 'fs';
import yaml from 'js-yaml';
import { validateArchitecture } from '../ui/src/lib/validator';
import { ResolverEngine } from '../ui/src/lib/ResolverEngine';

async function run() {
    const rawYaml = fs.readFileSync('../example/multi_region.yaml', 'utf8');
    const arch = yaml.load(rawYaml);
    console.log("Mock AST loaded.", Object.keys(arch));
}
run();
