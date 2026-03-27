# Sovereign Architecture-as-Code (AaC) Fabric

The Sovereign AaC Fabric is a next-generation architecture design and governance engine. It allows architects to define infrastructure and workloads using a modular, registry-driven catalog, while enforcing enterprise standards through explicit deployment hierarchies.

## Core Concepts

### 1. The Registry-Driven Design
The entire system is powered by a modular registry located in `registry/`. This directory contains the definitions for all architectural components, separated into three primary categories:

*   **Widgets**: Atomic infrastructure building blocks (Regions, Datacenters, Clusters, Virtual Machines).
*   **Patterns**: Composite workloads that can automatically expand into multiple infrastructure components (e.g., an Internal API requiring a Load Balancer and a Cluster).
*   **Hierarchies**: The governance blueprints that define how regions, datacenters, and clusters can be legally nested.

---

## Governance & Constraints

The AaC Fabric enforces architecture standards through a multi-layered constraint system defined in the YAML registry.

### 1. Structural Constraints (Hierarchies)
Defined in `registry/hierarchy-registry.yaml`, these define the "legal" stacking order of deployment layers.

```yaml
hierarchies:
  - id: on-prem-ocp
    name: On-Prem OpenShift Standard
    valid_layer_chain:
      - Region        # Layer 1 (Root)
      - Datacenter    # Layer 2
      - Cluster       # Layer 3
      - Namespace     # Layer 4
```

### 2. Infrastructure Constraints (Capabilities)
Patterns can declare specific requirements for the infrastructure they are dropped into.

*   **`allowed_hierarchies`**: Restricts a pattern to a specific set of hierarchy IDs.
*   **`host_capability`**: Rejects placement if the parent container does not provide the required tag.

```yaml
deployment_constraints:
  allowed_hierarchies: ["on-prem-ocp"]
  host_capability: ["openshift-cluster-v4"]
```

### 3. Internal Constraints (Parameters)
Widget parameters use a JSON-Schema inspired syntax to control user input.

*   **`const`**: Fixes a value (cannot be edited in the UI).
*   **`options`**: Provides a restricted dropdown selection.
*   **`type`**: Enforces data types (string, number, boolean).

```yaml
parameters:
  environment:
    type: string
    options: ["dev", "prod", "dr"]
  managed_by:
    type: string
    const: "central-it"
```

### 4. Sizing & Visual Constraints
Ensure consistent UI presentation and prevent illegal resizing of complex containers.

```yaml
default_width: 1200
default_height: 1000
min_width: 600      # Prevents resizing smaller than this
min_height: 400
```

### 5. Pattern Blueprints (Standardization)
When a complex pattern (Macro Expansion) defines specific `properties` for its nodes, these values become mandatory standards for that deployment. The validator will flag a **Standardization Violation** if a user drifts from these values.

```yaml
# In internal-api-ocp.yaml
composition:
  nodes:
    - id_suffix: lb
      widget_ref: local-load-balancer@2.0.0
      properties:
        provider: avi  # AVI is now mandatory for the LB in this specific pattern
```

### 6. Pattern Completeness (Existence & Repair)
Every node defined in a `composition` is considered mandatory for that pattern's architectural integrity. 

*   **Expansion ID Tracking**: The system uses `composition_id` to track all nodes belonging to a single pattern drop. If a required component (e.g., the `lb` or `cluster`) is deleted, the validator flags an **Architecture Gap** violation.
*   **Smart Adoption (Repair)**: You can repair an incomplete pattern in-place! If a mandatory node is missing (e.g., the Load Balancer), the validator will search its container for any manually added node of the same type and version. If found, it "adopts" that node and validates it against the pattern's **Standardization Blueprints** (e.g., if the pattern requires AVI, an adopted F5 load balancer will still trigger a violation until corrected).

### 7. Connectivity Assertions (Golden Paths)
The validator can enforce specific traffic flow patterns to prevent security bypasses. Using the `connectivity_assertions` rule, you can ensure that all paths reaching a destination must pass through specific waypoints.

```yaml
rules:
  - id: secure-ingress
    connectivity_assertions:
      - to: "id_suffix:cluster"
        must_pass_through: ["id_suffix:gw", "id_suffix:lb"]
```
If a user connects an external actor directly to the `cluster`, skipping the `gw` or `lb`, a **Connectivity Violation** will be flagged.

### 8. Brownfield Pattern Discovery & Auto-Detection
For documenting existing "brownfield" designs, the governance engine is capable of reverse-engineering patterns directly out of free-form diagrams.

The `registry/detectors.yaml` file maintains heuristic conditions that search for specific component aliases on the canvas. 

*   **Node Matches**: The discovery engine can fuzzy-match components based on their `c4Level`, `widget_ref` (widget type), or even flexible regex evaluation of the user's `name` string (e.g. `name_regex: "batch|job|cron|autosys"`).
*   **Relationship Conditions**: The discovery engine evaluates sub-graphs based on topological placement (`hosted_on` for hierarchical nesting) and connectivity (`connects_to` for drawn edges).
*   **Combinatorial Search**: The engine uses an advanced recursive backtracking algorithm to check all possible combinations of candidate nodes to see if they satisfy the rigorous connectivity constraints required for adoption.

If a pattern is discovered, the user is prompted to officially "Adopt" it, wherein the generic components get wrapped in official governance blueprints and are fully validated against the standard.

### 9. Structural Polymorphism (Class Inheritance)
The Governance Engine supports unlimited-depth class polymorphism natively out of the box. You can declare specialized widget types that inherently extend abstract base classes using the `base_type` parameter. 

```yaml
# registry/widgets/api-container/1.0.0/api-container.yaml
id: api-container
version: 1.0.0
base_type: executable
c4Level: Container
```

During **Pattern Discovery** or **Validation**, if a rule strictly demands an `executable` widget (e.g. within a Point-to-Point Messaging pattern constraint), the backtracking engine will recursively trace the lineage of any widget dropped on the canvas. If it finds a specialized `api-container` or `batch-container`, it dynamically climbs their `base_type` properties until it verifies they inherit from the generic `executable` base node. This mathematically ensures specialized variations are perfectly grandfathered into your governance guardrails without duplicating detector rules!

---

## Authoring Guide

### A. Creating a New Widget
Widgets are the simplest units of infrastructure. To add a new one (e.g., `postgresql-instance`):

1.  Create a folder: `registry/widgets/postgresql-instance/1.0.0/`.
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
3.  Add the reference to `registry/widget-registry.yaml`.

### B. Creating a New Pattern (Macro Expansion)
Patterns allow you to define "opinionated" deployments. When a pattern is dragged to the canvas, it can automatically create and link multiple dependencies.

```yaml
composition:
  nodes:
    - id_suffix: cluster
      widget_ref: openshift-cluster-v4@4.12.0
      c4Level: DeploymentNode
      layer: Cluster
      layout_hint: { x: 400, y: 0 }
      property_mappings:
        # Resolve 'datacenter_id' from the parent context
        datacenter_id: parent.properties.dc_id 
    - id_suffix: lb
      widget_ref: local-load-balancer@2.0.0
      c4Level: InfrastructureNode
      layout_hint: { x: 0, y: 0 }
  edges:
    - source_suffix: lb
      target_suffix: cluster
  workload_target_suffix: cluster # Where the actual workload container will land
```

---

## UI & Troubleshooting Improvements

Several recent capabilities have been added to improve architect experience and design troubleshooting:

*   **Design Overview Panel**: When no component is selected, the properties panel now displays a high-level summary of all "Known Patterns" (Patterns) currently active in the design.
*   **Pattern Memberships**: Selecting a component displays its connection to higher-level patterns. If a component is part of multiple expansions, it is clearly tagged with a **Shared Resource** badge.
*   **Enhanced Smart Adoption**: The validation engine's Smart Adoption logic now searches the entire flat deployment graph (across nested hierarchies) to find and repair orphaned required components, eliminating false positives in complex architectures.
*   **Mobile-Responsive Authoring**: Added a dynamic View Switcher and bottom floating action menu, allowing seamless switching and creation of complex architectural context models completely on mobile devices.
*   **Full C4 Export/Import Fidelity**: Generating architecture YAML files now faithfully preserves multi-view contexts, including native Software Systems, People, Containers, exact deployment instances, and their precise topological networking relationships upon re-import.
*   **Classic C4 Visualization**: Components adapt to recognizable C4 entity shapes, such as the standard Person (circle on rectangle) notation.
*   **View Isolation & Per-View Layouts**: Component positions are now natively tracked individually across separate diagram views (System Landscape vs Container vs Deployment), allowing unique structural organizations.
*   **Canvas Workflow**: Added a distinct **Clear Canvas** button, improved gridline visibility for alignment, and forced the properties action button on mobile screens to ensure the Design Overview is always accessible.

## Technical Architecture

*   **Frontend**: React + React Flow for the visual canvas.
*   **Design Tokens**: Custom CSS in `ui/src/index.css` manages "high-visibility" resizers and ports.
*   **Relationship Layer**: All edges are elevated to `zIndex: 5000` to prevent occlusion by large containers.
*   **Validation Engine**: A custom Datalog-inspired validator (`ui/src/lib/validator.ts`) verifies structural integrity, parameter constraints, and pattern standardization.
*   **Ancestry Tracking**: Every node preserves its origin via `origin_pattern` and `composition_alias`, ensuring governance is maintained even after design exports.
*   **Registry Client**: Dynamically resolves and fetches YAML assets from the `registry` public directory.

---

## Getting Started

1.  Navigate to the UI directory: `cd ui`
2.  Install dependencies: `npm install`
3.  Start the development server: `npm run dev`
4.  Open the fabric in your browser (usually `http://localhost:5173`)

---

## Roadmap & Next Steps

To move toward a production-grade governance engine, the following capabilities are planned:

### 1. Stability & Versioning
*   [ ] **Registry Immutability**: Implementing a strict enforcement that published pattern versions (e.g., `v2.1.0`) are never modified. All changes must go through a new SemVer folder.
*   [ ] **Schema Evolution**: Developing a migration path for designs when a Major (breaking) change occurs in a pattern.

### 2. Architectural Unit Testing (AUT)
*   [ ] **Gold Samples**: Maintaining a library of "Perfect Designs" for every pattern that must always pass validation.
*   [ ] **Poison Samples**: Maintaining a library of "Illegal Designs" (e.g., direct-bypass connection samples) to ensure the validator catches security breaches.
*   [ ] **Headless Validation CLI**: A Node.js runner to execute the validation engine in CI/CD against these samples.

### 3. Advanced Governance & Modeling
*   [ ] **True Model Roll-up (Export & Validator Integration)**: Formally integrating implied relationships into the Structurizr YAML export and the `validator.ts` engine so they are mathematically verified, not just visually suggested.
*   [ ] **Rollup Line Validation**: Evaluate pattern validation logic to ensure that a connection from a nested component (inside a container) reaching out to a target (like a message queue) mathematically counts as a valid connection emerging from the parent container itself.
*   [ ] **Active-Active Topology Checks**: Expanding the validator to enforce multi-region and multi-datacenter quorum rules.
*   [ ] **Component Capability Mapping**: Automatically suggesting compatible persistence or security layers based on a workload's declared requirements.
*   [x] **Cascading Scoped Deletions**: Enforcing strict lifecycle management so that deleting a generic host deletes all of its nested containers, components, and diagrams with proper user confirmation warnings.

### 4. Diagram Lifecycle & Visual Boundaries
*   [ ] **Cross-View Entity Availability (Inventory Sidebar)**: Allow instances created in contextual views (like Containers) to be available in a workspace inventory for placement onto Deployment nodes in other views.
*   [ ] **Rule-Based Diagram Filtering**: Enable advanced visibility control based on Node Tags, Widget Types, Label Regex, or Property values, allowing architects to showcase different aspects of a system (e.g., Security-only view vs Data-flow view) within the same Software System scope.
*   [ ] **Deployment vs Container Instantiation Rules**: Formally define what can be created directly on the Deployment Diagram versus the Container Diagram to ensure model synchronization.
*   [ ] **Nested Component Boundaries**: Extend the React Flow rendering engine to visualize a Container's parent Software System as an outer translucent bounding box natively within a Component Diagram.
*   [ ] **Diagram Drill-downs**: Interactive navigation transitions between abstraction levels (e.g., double-clicking a System to open its Container diagram).
*   [ ] **Automated Layouting**: Integrating Dagre/ELK to automatically organize elements on systemic data flow diagrams.

### 5. Enterprise Integration & Extensibility
*   [ ] **Component-to-Infrastructure Binding**: Providing a visual and programmatic way to natively map logical Containers/Components to specific physical Infrastructure Nodes (e.g., binding a Docker container to a specific AWS EC2 instance).
*   [ ] **Sub-graph (Modular) Exports**: Allowing architects to export only a specific system scope or diagram view to YAML rather than the entire global landscape.
*   [ ] **Auto-Documentation Generation**: Generating living Markdown documentation—including visualized diagrams—directly from pattern and widget definitions in the registry.
*   [ ] **Cross-Workspace (Federated) Relationships**: Enabling an architecture in one domain to reference software systems or infrastructure modeled in separate repository workspaces.
*   [ ] **Collaborative State Sync**: Supporting real-time multi-user editing for architectural drafting sessions.
*   [ ] **GitOps / VCS Integration**: Natively storing, diffing, and pulling architecture designs directly from a Git repository to align with modern "Architecture-as-Code" principles.
