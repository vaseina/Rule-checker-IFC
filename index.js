import {
  IfcViewerAPI,
} from 'web-ifc-viewer';
import { createSideMenuButton } from './utils/gui-creator';
import {
  IFCSPACE,
  IFCBUILDINGSTOREY,
  IFCBUILDING,
  IFCWINDOW,
  IFCWALL,
} from 'web-ifc';
import {
  MeshBasicMaterial,
  LineBasicMaterial,
  Color,
  BoxHelper,
  BufferGeometry,
  BufferAttribute,
  Mesh,
} from 'three';
import { ClippingEdges } from 'web-ifc-viewer/dist/components/display/clipping-planes/clipping-edges';
import Stats from 'stats.js/src/Stats';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer';
import {
  acceleratedRaycast, 
  computeBoundsTree, 
  disposeBoundsTree 
} from 'three-mesh-bvh';
import {
  IFCLoader
} from 'web-ifc-three/IFCLoader'

const container = document.getElementById('viewer-container');
const viewer = new IfcViewerAPI({ container, backgroundColor: new Color(255, 255, 255) });
viewer.axes.setAxes();
viewer.grid.setGrid();

// Set up stats
const stats = new Stats();
stats.showPanel(2);
document.body.append(stats.dom);
stats.dom.style.right = '0px';
stats.dom.style.left = 'auto';
viewer.context.stats = stats;

viewer.context.ifcCamera.cameraControls;

const manager = viewer.IFC.loader.ifcManager;

viewer.IFC.setWasmPath('files/');

viewer.IFC.loader.ifcManager.applyWebIfcConfig({
  USE_FAST_BOOLS: true,
  COORDINATE_TO_ORIGIN: true // important
});

viewer.context.renderer.postProduction.active = true;

// Setup loader

const ifcLoader = new IFCLoader();
ifcLoader.ifcManager.setupThreeMeshBVH(
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast
);

const scene = viewer.context.getScene();
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

  if (first) first = false
  else {
    ClippingEdges.forceStyleUpdate = true;
  };

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

    const currentPlan = viewer.plans.planLists[model.modelID][plan];
    
    const button = createSideMenuButton('./resources/plan-of-a-house-svgrepo-com.svg');
    button.setAttribute("title", `Go to the plan ${currentPlan.name}`);
    
    button.onclick = () => {
      viewer.plans.goTo(model.modelID, plan);
      viewer.edges.toggle('example-edges', true);
      toggleShadow(false);
    };
  };

  const button = createSideMenuButton('./resources/exit-logout-sign-out-svgrepo-com.svg');
  button.setAttribute("title", 'Exit floorplan');

  button.onclick = () => {
    viewer.plans.exitPlanView();
    viewer.edges.toggle('example-edges', false);
    toggleShadow(true);
  };
  
  // Building 

  const building = await logAllElements(IFCBUILDING);
  console.log(building);
  
  // Rregulations 
  
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

  // Building footprint

  // const wallIds = await viewer.IFC.loader.ifcManager.getAllItemsOfType(model.modelID, IFCWALL, false);
  // console.log(wallIds);
  // const subset = createSubset(wallIds);
  // function createSubset(id) {
  //   return viewer.IFC.loader.ifcManager.createSubset({
  //     modelID: model.modelID,
  //     scene: scene,
  //     ids: id,
  //     removePrevious: true,
  //     customID: "original",
  //     applyBVH: true
  //   });
  // };

  // const coordinates = [];
  // const alreadySaved = new Set();
  // const position = subset.geometry.attributes.position;
  // for(let index of subset.geometry.index.array) {
  //   if(!alreadySaved.has(index)){
  //     coordinates.push(position.getX(index));
  //     coordinates.push(position.getY(index));
  //     coordinates.push(position.getZ(index));
  //     alreadySaved.add(index);
  //   };
  // };
  // const vertices = Float32Array.from(coordinates); 
  // const newVertices = new BufferAttribute(vertices, 3);

  // const geometryToExport = new BufferGeometry();
  // geometryToExport.setAttribute('position', newVertices); 
  // const mesh = new Mesh(geometryToExport);
  
  // mesh.geometry.computeBoundingBox();
  // const helper = new BoxHelper(mesh, 0xff0000);
  // scene.add(helper);

  // you simply need to apply a transformation matrix 
  // to align it with its direction

  // viewer.IFC.loader.ifcManager.setupCoordinationMatrix(new Matrix4().setPosition(-this.globalShift.x, -this.globalShift.y, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));


  // const el = document.createElement('div');
  // el.innerHTML = 'hello world';
  // var obj = new CSS2DObject(el);
  // obj.position.set(subset.geometry.boundingBox.min.x, subset.geometry.boundingBox.max.y, subset.geometry.boundingBox.min.z);
  // subset.add(obj); 

  // model.visible = false;
 

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
  };
};

//Setup UI
const loadButton = createSideMenuButton('./resources/section-plane-down.svg');
loadButton.setAttribute("title", 'Load IFC model');
loadButton.addEventListener('click', () => {
  loadButton.blur();
  inputElement.click();
});
loadButton.classList.add('load');

// Tree view
const toggler = document.getElementsByClassName("caret");
for (let i = 0; i < toggler.length; i++) {
    toggler[i].onclick = () => {
        toggler[i].parentElement.querySelector(".nested").classList.toggle("active");
        toggler[i].classList.toggle("caret-down");
    };
};

// FUNCTIONS

// Functions for rules/regulations
function heightComplianceChecking(buildingHeight, maxHeight) {
  if (buildingHeight < maxHeight) {
    const message = `The height validation has passed! The height of the building is ${Math.ceil(buildingHeight * 10) / 10} m. The maximum height is ${maxHeight} m`;
    console.log(message);
    createValidationMessages(message);
  } else {
    const message = `The height validation did not pass! The height of the building is ${Math.ceil(buildingHeight * 100) / 100} m. The maximum height is ${maxHeight} m`;
    console.log(message);
    createValidationMessages(message);
  };
};

function volumeComplianceChecking(buildingVolume, maxVolume) {
  if (buildingVolume === 0) {
    const message = `The volume is not specified and is equal to 0. Please add IfcSpace to your model. The maximum volume is ${maxVolume} m3`;
    console.log(message);
    createValidationMessages(message);
  } else if (buildingVolume < maxVolume) {
    const message = `The volume validation has passed! The volume of the building is ${Math.ceil(buildingVolume * 100) / 100} m3. The maximum volume is ${maxVolume} m3`;
    console.log(message);
    createValidationMessages(message);
  } else {
    const message = `The volume validation did not pass! The volume of the building is ${Math.ceil(buildingVolume * 100) / 100} m3. The maximum volume is ${maxVolume} m3`;
    console.log(message);
    createValidationMessages(message);
  };
};

function createValidationMessages(value) {
  const validationContainer = document.getElementById('ifc-rule-checker');
  const validationMessages = document.createElement("div");
  validationMessages.classList.add("validation-message");

  const validationText = document.createElement("div");
  validationText.classList.add("validation-text");
  const validationIcon = document.createElement("div");
  validationIcon.classList.add("validation-icon");
  
  if (value === null || value === undefined) value = "undefined";
  else if (value.value) value = value.value;
  validationText.textContent = value;

  if (value.includes("has passed")) {
    validationIcon.innerHTML = '<img src="./resources/gui-check-yes-svgrepo-com.svg">';
  } else {
    validationIcon.innerHTML = '<img src="./resources/gui-check-no-svgrepo-com.svg">';
  };

  validationMessages.appendChild(validationIcon);
  validationMessages.appendChild(validationText);
  validationContainer.appendChild(validationMessages);
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

function toggleShadow(active) {
  const shadows = Object.values(viewer.shadowDropper.shadows);
  for(let shadow of shadows) {
    shadow.root.visible = active;
  };
};
