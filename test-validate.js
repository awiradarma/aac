var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ui/src/lib/validator.ts
function validateArchitecture(arch, patterns2) {
  const errors2 = [];
  const containerMap = {};
  const cNodes = arch.model?.containers || [];
  cNodes.forEach((cn) => {
    containerMap[cn.id] = cn;
  });
  const dNodes = arch.deployment?.nodes || [];
  const flatDeployments = [];
  const parseTree = (nodes, parentType, parentId, regionId, datacenterId) => {
    nodes.forEach((dn) => {
      let currentRegion = regionId;
      let currentDc = datacenterId;
      let type = "Host";
      if (dn.name.toLowerCase().includes("region")) {
        type = "Region";
        currentRegion = dn.id;
      } else if (dn.name.toLowerCase().includes("datacenter")) {
        type = "Datacenter";
        currentDc = dn.id;
      }
      flatDeployments.push({ ...dn, type, parentType, parentId, regionId: currentRegion, datacenterId: currentDc });
      if (dn.containerInstances) {
        dn.containerInstances.forEach((ci) => {
          const cn = containerMap[ci.containerId];
          if (cn) {
            flatDeployments.push({
              ...cn,
              isInstance: true,
              instanceId: ci.id,
              type: "Container",
              parentType: type,
              parentId: dn.id,
              regionId: currentRegion,
              datacenterId: currentDc
            });
          }
        });
      }
      if (dn.nodes && dn.nodes.length > 0) {
        parseTree(dn.nodes, type, dn.id, currentRegion, currentDc);
      }
    });
  };
  parseTree(dNodes, null, null, null, null);
  flatDeployments.forEach((node) => {
    const props = node.properties || {};
    const patternId = props.pattern_ref?.split("@")[0];
    if (!patternId) return;
    const pattern = patterns2.find((p) => p.id === patternId);
    if (!pattern) return;
    pattern.rules?.forEach((rule) => {
      if (rule.condition?.includes("topology == 'active-active'")) {
        const dbType = props.database_type;
        if (props.topology === "active-active") {
          if (dbType && rule.allowed_values?.database_type) {
            const allowed = rule.allowed_values.database_type;
            if (!allowed.includes(dbType)) {
              errors2.push(`Violation: ${pattern.id} requires database_type in [${allowed.join(", ")}] for active-active. Found: ${dbType}`);
            }
          }
          if (rule.id === "multi-region-spanning-rule") {
            const sisters = flatDeployments.filter((n) => n.properties?.pattern_ref === props.pattern_ref);
            const myRegions = /* @__PURE__ */ new Set();
            const datacentersByRegion = {};
            sisters.forEach((sis) => {
              if (sis.regionId) myRegions.add(sis.regionId);
              if (sis.regionId && sis.datacenterId) {
                if (!datacentersByRegion[sis.regionId]) datacentersByRegion[sis.regionId] = /* @__PURE__ */ new Set();
                datacentersByRegion[sis.regionId].add(sis.datacenterId);
              }
            });
            if (myRegions.size < 2) {
              errors2.push(`Topology Violation: ${pattern.id} with active-active topology requires deployment across at least 2 distinct Regions. Found ${myRegions.size}.`);
            }
            Object.entries(datacentersByRegion).forEach(([rId, dcSet]) => {
              if (dcSet.size < 2) {
                errors2.push(`Topology Violation: ${pattern.id} with active-active topology requires at least 2 Datacenters per Region. Region ${rId} only has ${dcSet.size}.`);
              }
            });
          }
        } else {
          if (dbType && rule.else_allowed_values?.database_type) {
            const allowed = rule.else_allowed_values.database_type;
            if (!allowed.includes(dbType)) {
              errors2.push(`Violation: ${pattern.id} requires database_type in [${allowed.join(", ")}] for non active-active. Found: ${dbType}`);
            }
          }
        }
      }
      if (rule.structural_assertions) {
        rule.structural_assertions.forEach((assertion) => {
          if (assertion.includes("parent.type")) {
            const expectedParent = assertion.split("==")[1].replace(/['")]/g, "").trim();
            if (node.parentType?.toLowerCase() !== expectedParent.toLowerCase()) {
              errors2.push(`Boundary Violation: ${pattern.id} (${node.name}) must be placed inside a ${expectedParent} container! Found inside ${node.parentType || "root"}.`);
            }
          }
        });
      }
    });
  });
  return Array.from(new Set(errors2));
}

// test-validate.ts
var fs = __toESM(require("fs"));
var patterns = JSON.parse(fs.readFileSync("./registry/patterns.json", "utf8")).patterns;
var testAst = {
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
        id: "reg1",
        name: "Region 1",
        nodes: [
          {
            id: "dc1",
            name: "Datacenter 1",
            containerInstances: [{ id: "inst1", containerId: "api1" }]
          }
        ]
      }
    ]
  }
};
var errors = validateArchitecture(testAst, patterns);
console.log("Validation Errors:", errors);
