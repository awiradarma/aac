import fs from 'fs';
import yaml from 'js-yaml';
import { validateArchitecture } from '../ui/src/lib/validator';
import { ResolverEngine } from '../ui/src/lib/ResolverEngine';

async function run() {
    const content = fs.readFileSync('../example/multi_region.yaml', 'utf8');
    const ast: any = yaml.load(content);
    
    // Simulate UI deletion: Remove relationship edge ONLY
    ast.model.relationships = ast.model.relationships.filter((r: any) => 
        r.destinationId !== 'batch-container-batch-container-instance'
    );
    
    // DO NOT REMOVE BATCH CONTAINER FROM CONTAINERS, simulating UI resurrecting it.
    
    const resolver = new ResolverEngine(__dirname + '/../registry');
    const registry = await resolver.initialize();
    const errors = validateArchitecture(ast, registry);
    console.log("ERRORS:", errors);
}
run();
