"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const js_yaml_1 = __importDefault(require("js-yaml"));
const commander_1 = require("commander");
const validator_1 = require("../ui/src/lib/validator");
const ResolverEngine_1 = require("../ui/src/lib/ResolverEngine");
commander_1.program
    .name('arch-cli')
    .description('Sovereign AaC Fabric Governance CLI')
    .version('1.0.0');
commander_1.program
    .command('validate')
    .description('Validate an architecture.yaml file against the pattern registry constraints')
    .argument('<file>', 'Path to the architecture.yaml file')
    .action(async (file) => {
    try {
        const yamlContent = fs_1.default.readFileSync(file, 'utf8');
        const archObj = js_yaml_1.default.load(yamlContent);
        // Initialize ResolverEngine targeting the local registry-draft directory for CLI
        const registryBasePath = process.cwd() + '/registry-draft';
        const resolver = new ResolverEngine_1.ResolverEngine(registryBasePath);
        console.log("Fetching registry and resolving dependencies...");
        const registry = await resolver.initialize();
        const patterns = registry.patterns;
        const errors = (0, validator_1.validateArchitecture)(archObj, registry);
        if (errors.length > 0) {
            console.error("⚠️ Architecture Validation Failed:");
            errors.forEach(e => console.error(`  • ${e}`));
            process.exit(1);
        }
        else {
            console.log("✅ Architecture Valid! All constraints and placement boundaries conform to the Pattern Registry.");
            process.exit(0);
        }
    }
    catch (err) {
        console.error(`❌ Error parsing files: ${err.message}`);
        process.exit(1);
    }
});
commander_1.program.parse(process.argv);
//# sourceMappingURL=index.js.map