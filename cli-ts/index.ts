import fs from 'fs';
import yaml from 'js-yaml';
import { program } from 'commander';
import { validateArchitecture } from '../ui/src/lib/validator';
import { Pattern } from '../ui/src/types';

program
    .name('arch-cli')
    .description('Sovereign AaC Fabric Governance CLI')
    .version('1.0.0');

program
    .command('validate')
    .description('Validate an architecture.yaml file against the pattern registry constraints')
    .argument('<file>', 'Path to the architecture.yaml file')
    .action((file) => {
        try {
            const yamlContent = fs.readFileSync(file, 'utf8');
            const archObj: any = yaml.load(yamlContent);

            const registryContent = fs.readFileSync('../registry/patterns.json', 'utf8');
            const registry = JSON.parse(registryContent);
            const patterns: Pattern[] = registry.patterns;

            const errors = validateArchitecture(archObj, patterns);

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
