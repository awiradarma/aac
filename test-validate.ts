import { validateArchitecture } from './ui/src/lib/validator';
import * as fs from 'fs';

const patterns = JSON.parse(fs.readFileSync('./registry/patterns.json', 'utf8')).patterns;

const testAst = {
    model: {
        containers: [
            {
                id: "api1",
                properties: { pattern_ref: "internal-api-ocp@2.1.0", topology: "active-active", database_type: "yugabyte" }
            }
        ]
    },
    deployment: {
        nodes: [
            {
                id: "reg1", name: "Region 1",
                nodes: [
                    {
                        id: "dc1", name: "Datacenter 1", containerInstances: [{ id: "inst1", containerId: "api1" }]
                    }
                ]
            }
        ]
    }
};

const errors = validateArchitecture(testAst, patterns);
console.log("Validation Errors:", errors);
