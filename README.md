# Sovereign Architecture-as-Code (AaC) Fabric

The Sovereign AaC Fabric is a next-generation architecture design and governance engine. It allows architects to define infrastructure and workloads using a modular, registry-driven catalog, while enforcing enterprise standards through explicit deployment hierarchies.

## Core Concepts

### 1. The Registry-Driven Design
The entire system is powered by a modular registry located in `registry-draft/`. This directory contains the definitions for all architectural components, separated into three primary categories:

*   **Widgets**: Atomic infrastructure building blocks (Regions, Datacenters, Clusters, Virtual Machines).
*   **Patterns**: Composite workloads that can automatically expand into multiple infrastructure components (e.g., an Internal API requiring a Load Balancer and a Cluster).
*   **Hierarchies**: The governance blueprints that define how regions, datacenters, and clusters can be legally nested.

---

## Authoring Guide

### A. Creating a New Widget
Widgets are the simplest units of infrastructure. To add a new one (e.g., `postgresql-instance`):

1.  Create a folder: `registry-draft/widgets/postgresql-instance/1.0.0/`.
2.  Create `postgresql-instance.yaml`:
```yaml
id: postgresql-instance
name: Enterprise PostgreSQL
version: 1.0.0
c4Level: Container
layer: Database
display_metadata:
  icon: Database    # Uses Lucide React icon names
  color: blue      # Options: blue, emerald, amber, purple, slate
  category: Storage
capabilities:
  - sql-storage
parameters:
  version:
    type: string
    default: "15"
```
3.  Add the reference to `registry-draft/widget-registry.yaml`.

### B. Creating a New Pattern (Macro Expansion)
Patterns allow you to define "opinionated" deployments. When a pattern is dragged to the canvas, it can automatically create and link multiple dependencies.

Example snippet for a Load Balanced API:
```yaml
macro_expansion:
  nodes:
    - id_suffix: cluster
      pattern_ref: openshift-cluster-v4@4.12.0
      c4Level: DeploymentNode
      layer: Cluster
      layout_hint: { x: 400, y: 0 }
      property_mappings:
        datacenter_id: parent.properties.dc_id # Inherit DC ID from the container
    - id_suffix: lb
      pattern_ref: local-load-balancer@2.0.0
      c4Level: InfrastructureNode
      layout_hint: { x: 0, y: 0 }
  edges:
    - source_suffix: lb
      target_suffix: cluster
  workload_target_suffix: cluster # Where the actual workload container will be placed
```

### C. Defining Valid Deployment Hierarchies
Hierarchies are defined in `registry-draft/hierarchy-registry.yaml`. They prevent architects from creating "illegal" structures (like putting a cluster directly into a region without a datacenter).

```yaml
hierarchies:
  - id: on-prem-ocp
    name: On-Prem OpenShift Standard
    valid_layer_chain:
      - Region
      - Datacenter
      - Cluster
      - Namespace
```

To enforce this for a pattern, add the requirement to the pattern's YAML:
```yaml
infrastructure_requirements:
  allowed_hierarchies:
    - on-prem-ocp
```

---

## Technical Architecture

*   **Frontend**: React + React Flow for the visual canvas.
*   **Validation Engine**: A custom Datalog-inspired validator (`ui/src/lib/validator.ts`) that verifies structural integrity against the registry.
*   **Registry Client**: Dynamically resolves and fetches YAML assets from the `registry-draft` public directory.

---

## Getting Started

1.  Navigate to the UI directory: `cd ui`
2.  Install dependencies: `npm install`
3.  Start the development server: `npm run dev`
4.  Open the fabric in your browser (usually `http://localhost:5173`)
