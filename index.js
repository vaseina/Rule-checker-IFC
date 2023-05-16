import {
  CameraProjections,
  IfcViewerAPI
} from 'web-ifc-viewer';
import { createSideMenuButton } from './utils/gui-creator';
import {
  IFCSPACE,
  IFCOPENINGELEMENT,
  IFCFURNISHINGELEMENT,
  IFCWALL,
  IFCWINDOW,
  IFCCURTAINWALL,
  IFCMEMBER,
  IFCPLATE,
  IFCBUILDINGSTOREY,
  IFCSLAB,
  IFCWALLSTANDARDCASE,

} from 'web-ifc';
import {
  MeshBasicMaterial,
  LineBasicMaterial,
  Color,
  Vector2,
  DepthTexture,
  WebGLRenderTarget,
  Material,
  BufferGeometry,
  BufferAttribute,
  Mesh
} from 'three';
import { ClippingEdges } from 'web-ifc-viewer/dist/components/display/clipping-planes/clipping-edges';
import Stats from 'stats.js/src/Stats';

const container = document.getElementById('viewer-container');
const viewer = new IfcViewerAPI({ container, backgroundColor: new Color(255, 255, 255) });
viewer.axes.setAxes();
viewer.grid.setGrid();
// viewer.shadowDropper.darkness = 1.5;

// Set up stats
const stats = new Stats();
stats.showPanel(2);
document.body.append(stats.dom);
stats.dom.style.right = '0px';
stats.dom.style.left = 'auto';
viewer.context.stats = stats;

viewer.context.ifcCamera.cameraControls

const manager = viewer.IFC.loader.ifcManager;

// viewer.IFC.loader.ifcManager.useWebWorkers(true, 'files/IFCWorker.js');
viewer.IFC.setWasmPath('files/');

viewer.IFC.loader.ifcManager.applyWebIfcConfig({
  USE_FAST_BOOLS: true,
  COORDINATE_TO_ORIGIN: true
});

viewer.context.renderer.postProduction.active = true;

// Setup loader
// const lineMaterial = new LineBasicMaterial({ color: 0x555555 });
// const baseMaterial = new MeshBasicMaterial({ color: 0xffffff, side: 2 });

let first = true;
let model;
let allPlans;

const loadIfc = async (event) => {

  const selectedFile = event.target.files[0];
  if (!selectedFile) return;

  const overlay = document.getElementById('loading-overlay');
  const progressText = document.getElementById('loading-progress');

  overlay.classList.remove('hidden');
  progressText.innerText = `Loading`;

  viewer.IFC.loader.ifcManager.setOnProgress((event) => {
    const percentage = Math.floor((event.loaded * 100) / event.total);
    progressText.innerText = `Loaded ${percentage}%`;
  });

  viewer.IFC.loader.ifcManager.parser.setupOptionalCategories({
    // [IFCSPACE]: false,
    // [IFCOPENINGELEMENT]: false
  });

  model = await viewer.IFC.loadIfc(selectedFile, false);
  // model.material.forEach(mat => mat.side = 2);

  if (first) first = false
  else {
    ClippingEdges.forceStyleUpdate = true;
  };

  // await createFill(model.modelID);
  // viewer.edges.create(`${model.modelID}`, model.modelID, lineMaterial, baseMaterial);

  await viewer.shadowDropper.renderShadow(model.modelID);

  overlay.classList.add('hidden');

  // For spatial tree

  const projectSpatialStructure = await viewer.IFC.getSpatialStructure(model.modelID);
  createTreeMenu(projectSpatialStructure);

  // For floor plans
	await viewer.plans.computeAllPlanViews(model.modelID);
  const lineMaterial = new LineBasicMaterial({ color: 'black' });
  const baseMaterial = new MeshBasicMaterial({
    polygonOffset: true,
    polygonOffsetFactor: 1, 
    polygonOffsetUnits: 1,
  });
	viewer.edges.create('example-edges', model.modelID, lineMaterial, baseMaterial);

  const containerForPlans = document.getElementById('side-menu-left');

  allPlans = viewer.plans.getAll(model.modelID);
  for(const plan of allPlans) {
    // const currentPlan = viewer.plans.planLists[model.modelID][plan];

    // const button = document.createElement('button');
    // containerForPlans.appendChild(button);
    // button.textContent = currentPlan.name;
    
    const button = createSideMenuButton('./resources/plan-of-a-house-svgrepo-com.svg');
    
    button.onclick = () => {
      viewer.plans.goTo(model.modelID, plan);
      viewer.edges.toggle('example-edges', true);
      toggleShadow(false);
    };
  };

  // const button = document.createElement('button');
  // containerForPlans.appendChild(button);
  // button.textContent = 'Exit';

  const button = createSideMenuButton('./resources/exit-svgrepo-com.svg');

  button.onclick = () => {
    viewer.plans.exitPlanView();
    viewer.edges.toggle('example-edges', false);
    toggleShadow(true);
  };

  // Add regulations 
  
  const jsonFile = './regulations/chek_regulation_prototype.vwip1.json';

  const zoneName = "Cava Giuliani";

  const response = await fetch(jsonFile);
  const regulations = await response.json();
  console.log(regulations);

  // Extract all height rules from regulations

  const onlyHeightRules = findInRegulations(regulations, "name", "maximum height");
  console.log(onlyHeightRules);
 
  const maxHeight = extractRules(onlyHeightRules, zoneName);
  console.log(maxHeight); 

  // Extract all volume rules from regulations

  const onlyVolumeRules = findInRegulations(regulations, "name", "maximum volume");
  console.log(onlyVolumeRules);

  const maxVolume = extractRules(onlyVolumeRules, zoneName);
  console.log(maxVolume); 

  // Building height

  const buildingStorey = await viewer.IFC.loader.ifcManager.getAllItemsOfType(model.modelID, IFCBUILDINGSTOREY);
  console.log(buildingStorey);

  const lastStoreyNumber = buildingStorey.length - 1;
  console.log(`The number of the last storey is ${lastStoreyNumber}`);

  const lastStorey = buildingStorey[lastStoreyNumber];
  const lastStoreyProperties = await viewer.IFC.loader.ifcManager.getItemProperties(model.modelID, lastStorey);
  console.log(lastStoreyProperties);
  let buildingHeight = lastStoreyProperties.Elevation.value;
  console.log(buildingHeight);

  // Building height checking

  if (buildingHeight < 1000) {
    heightComplianceChecking(buildingHeight, maxHeight);
  } else {
    buildingHeight /= 1000;
    heightComplianceChecking(buildingHeight, maxHeight);
  };

  // Building volume

  const allIfcSpaces = await logAllElements(IFCSPACE);
  console.log(allIfcSpaces);

  async function logAllElements(IFCType) {
    const elementsID = await viewer.IFC.loader.ifcManager.getAllItemsOfType(model.modelID, IFCType);
    let allElementsProperties = [];
  
    for (let i = 0; i < elementsID.length; i++) {
      const elementID = elementsID[i];
      const elementProperties = await viewer.IFC.loader.ifcManager.getPropertySets(0, elementID, true);
      allElementsProperties.push(elementProperties);
    };
  
    return allElementsProperties;
  };

  const allVolumeValues = findPropertiesInElement(allIfcSpaces, "VolumeValue");
  console.log(allVolumeValues);

  const buildingVolume = allVolumeValues.reduce((acc, value) => acc + value, 0);
  console.log(buildingVolume); 

  volumeComplianceChecking(buildingVolume, maxVolume);
 
  // Find all area values
  // const allAreaValues = findInElementProperties(allIfcSpaces, "AreaValue");
  // console.log(allAreaValues);


};

const inputElement = document.createElement('input');
inputElement.setAttribute('type', 'file');
inputElement.classList.add('hidden');
inputElement.addEventListener('change', loadIfc, false);

const handleKeyDown = async (event) => {
  if (event.code === 'Delete') {
    viewer.clipper.deletePlane();
    viewer.dimensions.delete();
  };
  if (event.code === 'Escape') {
    viewer.IFC.selector.unHighlightIfcItems();
  };
  if (event.code === 'KeyC') {
    viewer.context.ifcCamera.toggleProjection();
  };
  if (event.code === 'KeyD') {
    viewer.IFC.removeIfcModel(0);
  };
};

window.onmousemove = () => viewer.IFC.selector.prePickIfcItem();
window.onkeydown = handleKeyDown;
window.ondblclick = async () => {

  if (viewer.clipper.active) {
    viewer.clipper.createPlane();
  } else {
    const result = await viewer.IFC.selector.highlightIfcItem();
    if (!result) return;
    const { modelID, id } = result;
    const props = await viewer.IFC.getProperties(modelID, id, true, false);
    console.log(props);
    createPropertiesMenu(props);

    // const newProps = await viewer.IFC.loader.ifcManager.getPropertySets(model.modelID, id, true);
    // console.log(newProps);
    // createPropertiesMenu(newProps);
    
  };
};

//Setup UI
const loadButton = createSideMenuButton('./resources/section-plane-down.svg');
loadButton.addEventListener('click', () => {
  loadButton.blur();
  inputElement.click();
});
loadButton.classList.add('load');

// const sectionButton = createSideMenuButton('./resources/section-plane-down.svg');
// sectionButton.addEventListener('click', () => {
//   sectionButton.blur();
//   viewer.clipper.toggle();
// });

// const dropBoxButton = createSideMenuButton('./resources/dropbox-icon.svg');
// dropBoxButton.addEventListener('click', () => {
//   dropBoxButton.blur();
//   viewer.dropbox.loadDropboxIfc();
// });

// Tree view
const toggler = document.getElementsByClassName("caret");
for (let i = 0; i < toggler.length; i++) {
    toggler[i].onclick = () => {
        toggler[i].parentElement.querySelector(".nested").classList.toggle("active");
        toggler[i].classList.toggle("caret-down");
    }
};

// FUNCTIONS

// Functions for rules/regulations
function heightComplianceChecking(buildingHeight, maxHeight) {
  if (buildingHeight < maxHeight) {
    const message = `The height validation has passed. The height of the building is ${buildingHeight} m. The maximum height is ${maxHeight} m`;
    console.log(message);
  } else {
    const message = `The height validation did not pass. The height of the building is ${buildingHeight} m. The maximum height is ${maxHeight} m`;
    console.log(message);
  };
};

function volumeComplianceChecking(buildingVolume, maxVolume) {
  if (buildingVolume < maxVolume) {
    const message = `The volume validation has passed. The volume of the building is ${buildingVolume} m3. The maximum volume is ${maxVolume} m3`;
    console.log(message);
  } else {
    const message = `The volume validation did not pass. The volume of the building is ${buildingVolume} m3. The maximum volume is ${maxVolume} m3`;
    console.log(message);
  };
};

function findInRegulations(regulations, key, value) {
  let results = [];

  function search(object) {
    for (let property in object) {
      if (object.hasOwnProperty(property)) {
        if (typeof object[property] === "object") {
          search(object[property]);
        } else if (property === key && object[property] === value) {
          results.push(object);
        };
      };
    };
  };

  if (Array.isArray(regulations)) {
    for (let i = 0; i < regulations.length; i++) {
      search(regulations[i]);
    };
  } else {
    search(regulations);
  };

  return results;
};

function extractRules(data, zone) {
  for (const obj of data) {
    if (obj.zone === zone) {
      const code = obj.python_code;
      const regex = /<= (\d+(?:\.\d+)?)/;
      const match = code.match(regex);
    
      if (match) {
        return parseFloat(match[1]);
      };
    };
  };
  
  return null; 
};

function findPropertiesInElement(regulations, key) {
  let results = [];

  function search(object) {
    for (let property in object) {
      if (object.hasOwnProperty(property)) {
        if (property === key ) {
          results.push(object[property].value);
        } else if (typeof object[property] === "object") {
          search(object[property]);
        };
        
        // if (property === key) {
        //   const value = object[property].value;
        //   if (!results.includes(value)) {
        //     results.push(value);
        //   };
        // } else if (typeof object[property] === "object") {
        //   search(object[property]);
        // };

        // if (typeof object[property] === "object") {
        //   search(object[property]);
        // } else if (property === key && object[property].value.value.includes(`Gross`)) {
        //   results.push(object[property].value.value);
        // };
      };
    };
  };

  if (Array.isArray(regulations)) {
    for (let i = 0; i < regulations.length; i++) {
      search(regulations[i]);
    }
  } else {
    search(regulations);
  };

  return results;
};

// Spatial tree menu functions
function createTreeMenu(ifcProject) {
  const root = document.getElementById("tree-root");
  removeAllChildren(root);
  const ifcProjectNode = createNestedChild(root, ifcProject);
  ifcProject.children.forEach(child => {
      constructTreeMenuNode(ifcProjectNode, child);
  })
};

function nodeToString(node) {
  return `${node.type} - ${node.expressID}`
};

function constructTreeMenuNode(parent, node) {
  const children = node.children;
  if (children.length === 0) {
      createSimpleChild(parent, node);
      return;
  };
  const nodeElement = createNestedChild(parent, node);
  children.forEach(child => {
      constructTreeMenuNode(nodeElement, child);
  })
};

function createNestedChild(parent, node) {
  const content = nodeToString(node);
  const root = document.createElement('li');
  createTitle(root, content);
  const childrenContainer = document.createElement('ul');
  childrenContainer.classList.add("nested");
  root.appendChild(childrenContainer);
  parent.appendChild(root);
  return childrenContainer;
};

function createTitle(parent, content) {
  const title = document.createElement("span");
  title.classList.add("caret");
  title.onclick = () => {
    title.parentElement.querySelector(".nested").classList.toggle("active");
    title.classList.toggle("caret-down");
  };
  title.textContent = content;
  parent.appendChild(title);
};

function createSimpleChild(parent, node) {
  const content = nodeToString(node);
  const childNode = document.createElement('li');
  childNode.classList.add('leaf-node');
  childNode.textContent = content;
  parent.appendChild(childNode);

  childNode.onmouseenter = () => {
      viewer.IFC.selector.prepickIfcItemsByID(0, [node.expressID]);
  };
  childNode.onclick = async () => {
      viewer.IFC.selector.pickIfcItemsByID(0, [node.expressID]);
  };
};

// Functions for selection
const propsGUI = document.getElementById('ifc-property-menu-root');

function createPropertiesMenu(properties) {
  // console.log(properties);

  removeAllChildren(propsGUI);

  delete properties.psets;
  delete properties.mats;
  delete properties.type;

  for(let key in properties) {
    createPropertyEntry(key, properties[key]);
  };
};

function createPropertyEntry(key, value) {
  const propContainer = document.createElement("div");
  propContainer.classList.add("ifc-property-item");

  if(value === null || value === undefined) value = "undefined";
  else if(value.value) value = value.value;

  const keyElement = document.createElement("div");
  keyElement.textContent = key;
  propContainer.appendChild(keyElement);

  const valueElement = document.createElement("div");
  valueElement.classList.add("ifc-property-value");
  valueElement.textContent = value;
  propContainer.appendChild(valueElement);

  propsGUI.appendChild(propContainer);
};

function removeAllChildren(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  };
};

//Tooltip
// tippy('.ifc-tree-menu', {
//   content: "I'm a Tippy tooltip!",
// });

function toggleShadow(active) {
  const shadows = Object.values(viewer.shadowDropper.shadows);
  for(let shadow of shadows) {
    shadow.root.visible = active;
  };
};
