import fs from 'fs';
import yaml from 'js-yaml';
import { program } from 'commander';
import { validateArchitecture } from '../ui/src/lib/validator';
import { ResolverEngine } from '../ui/src/lib/ResolverEngine';
import type { Pattern } from '../ui/src/types';

/**
 * Headless CLI integration for the Sovereign Architecture-as-Code Fabric.
 * Uses the exact same `validateArchitecture` engine as the React frontend, allowing 
 * architecture definitions to be validated in CI/CD pipelines before provisioning.
 */
program
    .name('arch-cli')
    .description('Sovereign AaC Fabric Governance CLI')
    .version('1.0.0');

program
    .command('validate')
    .description('Validate an architecture.yaml file against the pattern registry constraints')
    .argument('<file>', 'Path to the architecture.yaml file')
    .action(async (file) => {
        try {
            const yamlContent = fs.readFileSync(file, 'utf8');
            const archObj: any = yaml.load(yamlContent);

            // Initialize ResolverEngine targeting the local registry directory for CLI
            const registryBasePath = __dirname + '/../registry';
            const resolver = new ResolverEngine(registryBasePath);

            console.log("Fetching registry and resolving dependencies...");
            const registry = await resolver.initialize();
            const patterns: Pattern[] = registry.patterns;

            const errors = validateArchitecture(archObj, registry);

            if (errors.length > 0) {
                console.error("⚠️ Architecture Validation Failed:");
                errors.forEach(e => console.error(`  • ${e}`));
                process.exit(1);
            } else {
                console.log("✅ Architecture Valid! All constraints and placement boundaries conform to the Pattern Registry.");
                process.exit(0);
            }
        } catch (err: any) {
            console.error(`❌ Error parsing files: ${err.message}`);
            process.exit(1);
        }
    });

program.parse(process.argv);
