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
            # Determine Node Type
            name_lower = n.get("name", "").lower()
            node_type = "Region" if "region" in name_lower else "Datacenter" if "datacenter" in name_lower else "Host"
            current_context = path_context + [{"type": node_type, "id": n.get("id"), "name": n.get("name")}]
            
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
                                if p_node["type"] == "Region":
                                    regions.add(p_node["id"])
                                if p_node["type"] == "Datacenter":
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
                    if "parent.type" in assertion:
                        expected_parent = assertion.split("==")[1].strip(" ')\"")
                        deployments = container_deployments.get(container.get("id"), [])
                        # For a deployment node itself, its parent is the second-to-last generic context item
                        is_valid = False
                        if deployments:
                            dep_path = deployments[0]
                            if len(dep_path) >= 2:
                                parent_type = dep_path[-2]["type"] # The parent node context
                                if parent_type.lower() == expected_parent.lower():
                                    is_valid = True
                        if not is_valid:
                            errors.append(f"Structural Violation: {pattern_id} must have a parent of type '{expected_parent}'. Context: {deployments}")

    if errors:
        typer.secho("\n⚠️ Architecture Governance Warning", fg=typer.colors.YELLOW, bold=True)
        for err in errors:
            typer.secho(f" - {err}", fg=typer.colors.RED)
        raise typer.Exit(1)
        
    typer.secho("✅ Validation passed. Architecture conforms to registry policies.", fg=typer.colors.GREEN)

@app.command()
def render(file: str, outdir: str = "./crossplane_out", registry_file: str = "../registry/patterns.json"):
    """Render the architecture into Crossplane Compositions."""
    path = Path(file)
    if not path.exists():
        typer.secho(f"Error: {file} not found.", fg=typer.colors.RED)
        raise typer.Exit(1)

    with open(path, "r") as f:
        arch = yaml.safe_load(f)
        
    registry = load_registry(registry_file)
    patterns = {p["id"]: p for p in registry["patterns"]}
    
    outpath = Path(outdir)
    outpath.mkdir(exist_ok=True)
    
    claims = []
    
    def flatten_nodes(node_list):
        result = []
        for n in node_list:
            result.append(n)
            if "nodes" in n:
                result.extend(flatten_nodes(n["nodes"]))
        return result

    # Build XR claims for Nodes
    root_nodes = arch.get("deployment", {}).get("nodes", [])
    all_nodes = flatten_nodes(root_nodes)
    
    for node in all_nodes:
        props = node.get("properties", {})
        pattern_id = props.get("pattern_ref", "").split("@")[0]
        if pattern_id in patterns:
            mapping = patterns[pattern_id].get("crossplane_mapping")
            if mapping:
                claims.append({
                    "apiVersion": mapping.get("apiVersion"),
                    "kind": mapping.get("kind"),
                    "metadata": {"name": node.get("name")},
                    "spec": {"parameters": {k:v for k,v in props.items() if k != "pattern_ref" and k != "status"}}
                })
                
    # Build XR claims for Containers
    containers = arch.get("model", {}).get("containers", [])
    for container in containers:
        props = container.get("properties", {})
        pattern_id = props.get("pattern_ref", "").split("@")[0]
        if pattern_id in patterns:
            mapping = patterns[pattern_id].get("crossplane_mapping")
            if mapping:
                claims.append({
                    "apiVersion": mapping.get("apiVersion"),
                    "kind": mapping.get("kind"),
                    "metadata": {"name": container.get("name")},
                    "spec": {"parameters": {k:v for k,v in props.items() if k != "pattern_ref"}}
                })

    for i, claim in enumerate(claims):
        claim_file = outpath / f"{claim['metadata']['name'].lower()}-xr.yaml"
        with open(claim_file, "w") as f:
            yaml.dump(claim, f)
            
    typer.secho(f"✅ Rendered {len(claims)} Crossplane XR claims to {outdir}/", fg=typer.colors.GREEN)

if __name__ == "__main__":
    app()
