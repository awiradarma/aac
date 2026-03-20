import typer
import yaml
import json
from pathlib import Path
from typing import Dict, Any

app = typer.Typer(help="Sovereign Architecture-as-Code Fabric Governance CLI")

def load_registry(filepath: str) -> Dict[str, Any]:
    with open(filepath, "r") as f:
        return json.load(f)

@app.command()
def validate(file: str, registry_file: str = "../registry/patterns.json"):
    """Validate an architecture.yaml file against the central pattern registry."""
    path = Path(file)
    if not path.exists():
        typer.secho(f"Error: {file} not found.", fg=typer.colors.RED)
        raise typer.Exit(1)
        
    with open(path, "r") as f:
        arch = yaml.safe_load(f)
        
    registry = load_registry(registry_file)
    patterns = {p["id"]: p for p in registry["patterns"]}
    
    errors = []
    
    # Trace deployment hierarchy to evaluate structural assertions
    deployment_nodes = arch.get("deployment", {}).get("nodes", [])
    container_deployments = {}
    
    def trace_deployments(node_list, path_context):
        for n in node_list:
            # Determine Node Layer from Registry
            pattern_ref = n.get("properties", {}).get("pattern_ref", "").split("@")[0]
            node_layer = "Unknown"
            if pattern_ref in patterns:
                node_layer = patterns[pattern_ref].get("layer", "Unknown")
            
            current_context = path_context + [{"layer": node_layer, "id": n.get("id"), "name": n.get("name")}]
            
            # Save deployment context for this specific node
            container_deployments[n.get("id")] = [current_context]
            
            for ci in n.get("containerInstances", []):
                cid = ci.get("containerId")
                if cid not in container_deployments:
                    container_deployments[cid] = []
                container_deployments[cid].append(current_context)
                
            if "nodes" in n:
                trace_deployments(n["nodes"], current_context)
                
    trace_deployments(deployment_nodes, [])

    # Evaluate nodes for rules (Containers AND Deployment Nodes)
    containers = arch.get("model", {}).get("containers", [])
    
    def flatten_deployment_nodes(node_list):
        flat = []
        for n in node_list:
            flat.append(n)
            if "nodes" in n:
                flat.extend(flatten_deployment_nodes(n["nodes"]))
        return flat
        
    all_nodes_to_check = containers + flatten_deployment_nodes(deployment_nodes)

    # Validate Explicit Deployment Hierarchies
    deployment_hierarchies = registry.get("deployment_hierarchies", [])
    if deployment_hierarchies:
        # Build all root-to-leaf paths
        leaf_nodes = [n for n in flatten_deployment_nodes(deployment_nodes) if not n.get("nodes")]
        
        paths = []
        for leaf in leaf_nodes:
            # We already have the full path context built in trace_deployments
            context = container_deployments.get(leaf.get("id"), [[]])[0]
            # Ignore containers, extract just the layers
            path = [node["layer"] for node in context if node["layer"] != "Container" and node["layer"] != "Unknown"]
            if len(path) > 1 and path not in paths:
                paths.append(path)

        for path in paths:
            is_valid = False
            for template in deployment_hierarchies:
                chain = template.get("valid_layer_chain", [])
                
                # Sub-sequence Check
                match_index = int(0)
                path_idx = int(0)
                while match_index < len(chain) and path_idx < len(path):
                    if chain[match_index] == path[path_idx]:
                        path_idx += 1
                    elif path_idx > 0:
                        break
                    match_index += 1
                    
                if path_idx == len(path):
                    is_valid = True
                    break
                    
            if not is_valid:
                errors.append(f"Hierarchy Violation: The deployment path {' -> '.join(path)} does not explicitly conform to any approved deployment hierarchy template.")

    for container in containers:
        props = container.get("properties", {})
        ref = props.get("pattern_ref")
        if not ref:
            continue
            
        pattern_id = ref.split("@")[0]
        if pattern_id not in patterns:
            continue
            
        pattern = patterns[pattern_id]
        allowed_hierarchies = pattern.get("deployment_constraints", {}).get("allowed_hierarchies", [])
        
        if allowed_hierarchies and deployment_hierarchies:
            context = container_deployments.get(container.get("id"), [[]])[0]
            path = [node["layer"] for node in context if node["layer"] != "Container" and node["layer"] != "Unknown"]
            
            if path:
                path_is_valid = False
                for expected_h_id in allowed_hierarchies:
                    template = next((h for h in deployment_hierarchies if h.get("id") == expected_h_id), None)
                    if template:
                        chain = template.get("valid_layer_chain", [])
                        match_index = int(0)
                        path_idx = int(0)
                        while match_index < len(chain) and path_idx < len(path):
                            if chain[match_index] == path[path_idx]:
                                path_idx += 1
                            elif path_idx > 0:
                                break
                            match_index += 1
                        
                        if path_idx == len(path):
                            path_is_valid = True
                            break
                
                if not path_is_valid:
                    errors.append(f"Hierarchy Violation: {pattern_id} ({container.get('name')}) failed deployment hierarchy check. Its path {' -> '.join(path)} does not conform to its allowed templates: {', '.join(allowed_hierarchies)}.")
                
    for container in all_nodes_to_check:
        props = container.get("properties", {})
        ref = props.get("pattern_ref")
        if not ref:
            # Deployment nodes (like explicit Regions/Datacenters) might not use patterns in naive parses, skip if none
            continue
            
        pattern_id = ref.split("@")[0]
        if pattern_id not in patterns:
            errors.append(f"Pattern '{pattern_id}' not found in registry.")
            continue
            
        pattern = patterns[pattern_id]
        
        # Check Rules
        rules = pattern.get("rules", [])
        for rule in rules:
            if "topology == 'active-active'" in rule.get("condition", ""):
                db_type = props.get("database_type")
                if props.get("topology") == "active-active":
                    if db_type:
                        allowed_dbs = rule.get("allowed_values", {}).get("database_type", [])
                        if db_type not in allowed_dbs:
                            errors.append(f"Violation: {pattern_id} requires database_type in {allowed_dbs} for active-active topology. Found: {db_type}")
                        
                    # Structural Topology Assertion Evaluation
                    if "structural_assertions" in rule:
                        deployments = container_deployments.get(container.get("id"), [])
                        regions = set()
                        dcs = set()
                        for dep_path in deployments:
                            for p_node in dep_path:
                                if p_node["layer"] == "Region":
                                    regions.add(p_node["id"])
                                if p_node["layer"] == "Datacenter":
                                    dcs.add(p_node["id"])
                                    
                        if len(regions) < 2:
                            errors.append(f"Structural Violation: {pattern_id} with active-active topology must be deployed to at least 2 distinct Regions. Found: {len(regions)}")
                        if len(dcs) < 2:
                            errors.append(f"Structural Violation: {pattern_id} with active-active topology must be deployed to at least 2 distinct Datacenters. Found: {len(dcs)}")
                else:
                    if db_type:
                        else_allowed_dbs = rule.get("else_allowed_values", {}).get("database_type", [])
                        if db_type not in else_allowed_dbs:
                            errors.append(f"Violation: {pattern_id} requires database_type in {else_allowed_dbs} for non active-active topology. Found: {db_type}")
            
            # Parent Assertions (e.g. Infrastructure Nodes must be in Datacenter)
            if "structural_assertions" in rule:
                for assertion in rule.get("structural_assertions", []):
                    if "parent.layer" in assertion:
                        expected_parent = assertion.split("==")[1].strip(" ')\"")
                        deployments = container_deployments.get(container.get("id"), [])
                        # For a deployment node itself, its parent is the second-to-last generic context item
                        is_valid = False
                        if deployments:
                            dep_path = deployments[0]
                            if len(dep_path) >= 2:
                                parent_layer = dep_path[-2]["layer"] # The parent node context
                                if parent_layer.lower() == expected_parent.lower():
                                    is_valid = True
                        if not is_valid:
                            errors.append(f"Structural Violation: {pattern_id} must have a parent of layer '{expected_parent}'. Context: {deployments}")

    if errors:
        typer.secho("\n⚠️ Architecture Governance Warning", fg=typer.colors.YELLOW, bold=True)
        for err in errors:
            typer.secho(f" - {err}", fg=typer.colors.RED)
        raise typer.Exit(1)
        
    typer.secho("✅ Validation passed. Architecture conforms to registry policies.", fg=typer.colors.GREEN)



if __name__ == "__main__":
    app()
