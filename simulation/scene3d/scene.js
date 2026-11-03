/* Offline visual experiment: actual Lite6 link meshes, nominal FK/IK, pinhole
 * cameras, frozen image queue, point alignment lesson and separate evaluator.
 * No controller SDK, telemetry route, socket or real camera interface exists.
 */
import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {STLLoader} from './vendor/STLLoader.js';
import {createPlaybackScheduler} from './playback.js';
import {IMAGE, INTRINSICS, project, intersectPixelPlane, featureNoise, selectDelivered, pointDecision, createRecord} from './model.js';

const K=window.Lite6;
const $=id=>document.getElementById(id);
const setText=(id,value)=>{if($(id))$(id).textContent=value;};
const value=(id,fallback)=>{const n=Number($(id)?.value);return Number.isFinite(n)&&$(id)?n:fallback;};
const checked=(id,fallback=true)=>$(id)?$(id).checked:fallback;
const CONFIG=Object.freeze({units:'mm, seconds, pixels, degrees',planeZ:30.5,flangeZ:240,tipOffset:61,tolerance:3,cameraOffset:[75,20,18],cameraTiltTowardToolDeg:20,vfov:55,image:[640,360],captureHz:10,seed:17,kinematics:'nominal UFACTORY geometry; no live calibration'});
const state={time:0,phase:0,playing:false,preset:'clean',joints:[0,20,60,180,-40,180],frames:[],received:null,frozen:null,records:[],lastCapture:-1,lastRecord:-1,sequence:0,ready:false,trial:null,ikValid:true,schedulerTicks:0,runtimeError:null};
let playbackClock=null;
function syncPlayback(){playbackClock?.sync(state.playing,!document.hidden);}
let S,renderer,liveRenderer,refRenderer,receiveCanvas,receiveContext,mainCamera,eye,referenceCamera,orbit,links,camMount,frustum,refFrustum,truthMarker,estimateMarker,toolMarker,errorLine,target,distractor,occluder,cupTip,raycaster;
const targetPoint=()=>[value('target-x',300),value('target-y',0),CONFIG.planeZ];
const mat=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.65,metalness:.05,...extra});

function box(size,position,material,parent=S){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),material);mesh.position.set(...position);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function cylinderBetween(a,b,radius,material,parent=S){const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,delta.length(),12),material);mesh.position.copy(start.add(end).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());mesh.castShadow=true;parent.add(mesh);return mesh;}
function label(text,position,width=150){const canvas=document.createElement('canvas');canvas.width=768;canvas.height=100;const c=canvas.getContext('2d');c.fillStyle='rgba(13,26,36,.85)';c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle='#f5fafb';c.font='500 37px system-ui';c.textAlign='center';c.textBaseline='middle';c.fillText(text,384,50);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false}));sprite.position.set(...position);sprite.scale.set(width,width*100/768,1);sprite.layers.set(1);S.add(sprite);return sprite;}
function line(points,color=0x53c9a2,parent=S){const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color,transparent:true,opacity:.8}));parent.add(l);return l;}
function cross(color){const group=new THREE.Group(),material=new THREE.MeshBasicMaterial({color,depthTest:false});box([15,1.6,.4],[0,0,0],material,group);box([1.6,15,.4],[0,0,0],material,group);group.layers.set(1);group.children.forEach(x=>x.layers.set(1));S.add(group);return group;}
function makeRenderer(id,shadows=false){const host=$(id);if(!host)throw new Error('Missing 3D viewport #'+id);const r=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:id==='wrist-live-view'});r.setPixelRatio(checked('reduced-gpu')?1:Math.min(window.devicePixelRatio||1,1.5));r.outputColorSpace=THREE.SRGBColorSpace;r.toneMapping=THREE.ACESFilmicToneMapping;r.toneMappingExposure=1.15;if(shadows&&!checked('reduced-gpu')){r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFSoftShadowMap;}r.domElement.setAttribute('aria-label',id.replaceAll('-',' '));host.appendChild(r.domElement);return r;}
function planeViewCone(camera,color){
 const cone=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color,transparent:true,opacity:.45}));cone.layers.set(1);
 cone.update=()=>{camera.updateMatrixWorld(true);const origin=new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld),corners=[];for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]){const d=new THREE.Vector3(x,y,.5).unproject(camera).sub(origin).normalize();const t=d.z<-.00001?(CONFIG.planeZ-origin.z)/d.z:800;corners.push(origin.clone().addScaledVector(d,Math.max(1,Math.min(t,850))));}const points=[];for(let i=0;i<4;i++)points.push(origin,corners[i],corners[i],corners[(i+1)%4]);cone.geometry.dispose();cone.geometry=new THREE.BufferGeometry().setFromPoints(points);};return cone;
}

function buildEnvironment(){
 S=new THREE.Scene();S.background=new THREE.Color(0x10232d);S.fog=new THREE.Fog(0x10232d,1800,5000);
 S.add(new THREE.HemisphereLight(0xe7f5ff,0x5e6c62,2.2));const sun=new THREE.DirectionalLight(0xfff4de,2.5);sun.position.set(100,350,1100);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-850,right:850,top:850,bottom:-850,near:100,far:2500});sun.shadow.bias=-.0002;S.add(sun);
 const fill=new THREE.DirectionalLight(0x9bcfff,.9);fill.position.set(-700,-400,500);S.add(fill);
 box([1400,1000,32],[120,0,-16],mat(0xd1dadb));
 box([1410,1010,20],[120,0,-43],mat(0x263d47));
 for(const x of [-470,710])for(const y of [-390,390])box([45,45,650],[x,y,-375],mat(0x24343e));
 box([6000,6000,16],[0,0,-716],mat(0x263a42));
 const grid=new THREE.GridHelper(1200,24,0x748a90,0x9caeb2);grid.rotation.x=Math.PI/2;grid.position.set(150,0,.5);grid.material.transparent=true;grid.material.opacity=.23;S.add(grid);
 // Base plate defines the simulated B frame. All translations are millimetres.
 box([155,155,10],[0,0,-5],mat(0x17232b));for(const x of [-62,62])for(const y of [-62,62]){const bolt=new THREE.Mesh(new THREE.CylinderGeometry(5,5,3,12),mat(0x98a8ae));bolt.rotation.x=Math.PI/2;bolt.position.set(x,y,1.5);S.add(bolt);}
 const axes=new THREE.AxesHelper(100);axes.layers.set(1);axes.position.z=3;S.add(axes);label('B · robot base',[0,-110,35],120);
 // Known plane and measured-pattern stand-ins. Square spacing is illustrative.
 box([220,230,2],[300,0,1.5],mat(0xe8ece8));
 for(let i=0;i<8;i++)for(let j=0;j<6;j++)box([14,14,.4],[240+i*14,-120+j*14,3],mat((i+j)%2?0x27353c:0xf8faf6));
 label('Checked pattern · known plane',[340,-145,25],205);
 target=new THREE.Group();S.add(target);box([30,30,30],[0,0,15],mat(0x42b58c),target);const marker=new THREE.Mesh(new THREE.CircleGeometry(7,32),mat(0x132b22));marker.position.z=30.5;target.add(marker);const targetRing=new THREE.Mesh(new THREE.RingGeometry(8.5,10.5,40),new THREE.MeshBasicMaterial({color:0xe8fff4,side:THREE.DoubleSide}));targetRing.position.z=30.6;target.add(targetRing);
 distractor=new THREE.Group();S.add(distractor);box([30,30,30],[0,0,15],mat(0xc2a26d),distractor);const dmark=new THREE.Mesh(new THREE.CircleGeometry(7,32),mat(0x398568));dmark.position.z=30.5;distractor.add(dmark);distractor.position.set(350,45,0);
 label('Stationary target',[300,0,65],120);label('Distractor',[350,60,60],105);
 occluder=box([65,65,4],[300,0,76],mat(0x637a88));occluder.visible=false;
 // Virtual reference camera + tripod. This is ideal rendered reference, not measured metrology.
 const tripodMat=mat(0x25343c);for(const [dx,dy] of [[-55,-40],[55,-40],[0,55]])cylinderBetween([540,-330,410],[540+dx,-330+dy,0],5,tripodMat);box([70,45,50],[540,-330,440],mat(0x304a59));
 referenceCamera=new THREE.PerspectiveCamera(45,IMAGE.width/IMAGE.height,5,2500);referenceCamera.up.set(0,0,1);referenceCamera.position.set(540,-330,455);referenceCamera.lookAt(300,0,130);S.add(referenceCamera);
 const lens=new THREE.Mesh(new THREE.CylinderGeometry(12,12,20,24),mat(0x5eadd5));lens.position.set(520,-309,435);lens.quaternion.copy(referenceCamera.quaternion);lens.rotateX(Math.PI/2);S.add(lens);label('Independent reference · virtual',[540,-335,510],220);
 refFrustum=planeViewCone(referenceCamera,0x94b8e2);S.add(refFrustum);
 // Workstation, PoE/switch and physical-stop representations remain scenery.
 box([160,110,12],[-260,220,7],mat(0x223b4a));const screen=box([150,10,100],[-260,265,64],mat(0x1b2d38));screen.rotation.x=-.14;
 const display=document.createElement('canvas');display.width=512;display.height=300;const c=display.getContext('2d');c.fillStyle='#103845';c.fillRect(0,0,512,300);c.fillStyle='#7fe0bc';c.font='30px monospace';c.fillText('RESEARCH LOGGER',25,55);c.fillStyle='#e2f0ef';c.font='22px monospace';['exposure -> receipt','pose -> decision','reference -> labels'].forEach((s,i)=>c.fillText(s,25,115+i*48));const tex=new THREE.CanvasTexture(display);tex.colorSpace=THREE.SRGBColorSpace;const face=new THREE.Mesh(new THREE.PlaneGeometry(143,91),new THREE.MeshBasicMaterial({map:tex}));face.rotation.x=Math.PI/2;face.position.set(-260,258,64);S.add(face);label('Workstation + immutable log',[-260,285,150],220);
 box([100,65,25],[-260,-185,14],mat(0x284a52));for(let i=0;i<5;i++)box([10,3,6],[-290+i*15,-219,14],mat(0x85cbbb));label('Power / data · illustrative',[-260,-185,60],190);
 box([62,62,20],[-70,-240,12],mat(0xd6b941));const stop=new THREE.Mesh(new THREE.CylinderGeometry(19,21,16,32),mat(0xb73637));stop.rotation.x=Math.PI/2;stop.position.set(-70,-240,29);S.add(stop);label('Physical E-stop · scenery',[-70,-240,73],185);
 const cableMat=mat(0x243a44);cylinderBetween([-210,-185,15],[-100,-80,15],2,cableMat);cylinderBetween([-310,-185,15],[-320,190,15],2,cableMat);
 truthMarker=cross(0x5fe3ae);estimateMarker=cross(0xf5ad58);toolMarker=cross(0x9edfff);errorLine=line([[300,0,34],[300,0,34]],0xf5ad58);errorLine.layers.set(1);
 label('X / Y / Z in millimetres',[80,125,20],175);
}

async function buildRobot(){
 const loader=new STLLoader();const names=['link_base','link1','link2','link3','link4','link5','link6'];links=names.map(()=>{const group=new THREE.Group();group.matrixAutoUpdate=false;S.add(group);return group;});
 await Promise.all(names.map(async(name,i)=>{const geo=await loader.loadAsync('./meshes/'+name+'.stl');geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,mat(i===0?0x899aa4:0xe8edf0,{roughness:.38,metalness:.13}));mesh.scale.setScalar(1000);mesh.castShadow=true;mesh.receiveShadow=true;links[i].add(mesh);}));
 const geo=await loader.loadAsync('./meshes/vacuum_gripper_lite.stl');geo.computeVertexNormals();const gripper=new THREE.Mesh(geo,mat(0x354655));gripper.scale.setScalar(1000);gripper.castShadow=true;links[6].add(gripper);
 cupTip=new THREE.Mesh(new THREE.CylinderGeometry(9,9,2,30),mat(0x253e48));cupTip.rotation.x=Math.PI/2;cupTip.position.z=60;links[6].add(cupTip);
 // Orthonormal camera basis in flange coordinates. The illustrative camera
 // tilts20deg toward the tool so the target remains inside the camera image
 // during the short planar sweep. This is not a measured station extrinsic.
 const tilt=CONFIG.cameraTiltTowardToolDeg*Math.PI/180,c=Math.cos(tilt),s=Math.sin(tilt);
 camMount=new THREE.Group();camMount.position.set(...CONFIG.cameraOffset);const basis=new THREE.Matrix4().makeBasis(new THREE.Vector3(0,1,0),new THREE.Vector3(c,0,s),new THREE.Vector3(s,0,-c));camMount.quaternion.setFromRotationMatrix(basis);
 const body=box([96,36,28],[0,0,14],mat(0x25323c),camMount);body.castShadow=true;
 for(const x of [-31,0,31]){const ring=new THREE.Mesh(new THREE.CylinderGeometry(x===0?6:8,x===0?6:8,3,20),mat(0x45647a));ring.rotation.x=Math.PI/2;ring.position.set(x,0,-1);camMount.add(ring);const glass=new THREE.Mesh(new THREE.CircleGeometry(x===0?4:5,20),new THREE.MeshBasicMaterial({color:0x3b8aaf}));glass.rotation.y=Math.PI;glass.position.set(x,0,-2.6);camMount.add(glass);}
 links[6].add(camMount);cylinderBetween([15,0,10],CONFIG.cameraOffset,4,mat(0x6d7c86),links[6]);
 eye=new THREE.PerspectiveCamera(CONFIG.vfov,IMAGE.width/IMAGE.height,5,2500);camMount.add(eye);frustum=planeViewCone(eye,0x5fe3ca);S.add(frustum);raycaster=new THREE.Raycaster();
 label('Lite 6 · nominal articulated model',[0,0,500],210);
}

function getCameraPose(camera){camera.updateMatrixWorld(true);const e=camera.matrixWorld.elements;return {position:[e[12],e[13],e[14]],right:[e[0],e[1],e[2]],up:[e[4],e[5],e[6]],back:[e[8],e[9],e[10]]};}
function updateRobot(position){
 const requested=[position[0],position[1],position[2],180,0,0];
 const solution=K.ik(requested,state.joints,[0,0,0,0,0,0],45);const actual=K.fk(solution.joints);const orientationOkay=Math.abs(Math.abs(actual[3])-180)<1&&Math.abs(actual[4])<1&&Math.abs(actual[5])<1;
 state.ikValid=solution.ok&&solution.joints.every(Number.isFinite)&&K.limitViolation(solution.joints)===-1&&orientationOkay;
 if(state.ikValid)state.joints=solution.joints;else{state.playing=false;setText('model-status','IK unavailable: simulation paused; last valid pose retained.');}
 const frames=K.linkFrames(state.joints);frames.forEach((m,i)=>{links[i].matrix.set(...m);links[i].matrixWorldNeedsUpdate=true;});S.updateMatrixWorld(true);
 return K.fk(state.joints,[0,0,CONFIG.tipOffset,0,0,0]);
}

function resize(){
 for(const [r,id,camera] of [[renderer,'overview-view',mainCamera],[liveRenderer,'wrist-live-view',eye],[refRenderer,'reference-view',referenceCamera]]){
  if(!r)continue;const host=$(id),w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight||w*9/16);if(id==='overview-view'){r.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}else{r.setPixelRatio(1);r.setSize(IMAGE.width,IMAGE.height,false);}
 }
}
function render(cameraViews=true){
 if(!state.ready)return;frustum.visible=checked('show-frustum');refFrustum.visible=checked('show-reference');truthMarker.visible=checked('show-truth');estimateMarker.visible=checked('show-truth')&&!!state.lastEstimate;toolMarker.visible=checked('show-truth');errorLine.visible=checked('show-truth')&&!!state.lastEstimate;
 frustum.update();refFrustum.update();orbit.update();renderer.render(S,mainCamera);if(cameraViews){liveRenderer.render(S,eye);refRenderer.render(S,referenceCamera);}
}
function visibleFeature(point,pose){
 const projected=project(point,pose);if(!projected.visible)return projected;
 if(occluder.visible){const origin=new THREE.Vector3(...pose.position),delta=new THREE.Vector3(...point).sub(origin);raycaster.set(origin,delta.clone().normalize());const hits=raycaster.intersectObject(occluder,false);if(hits.some(h=>h.distance<delta.length()-1e-6))return {...projected,visible:false,occluded:true};}
 return projected;
}
function capture(){
 const pose=getCameraPose(eye),actual=targetPoint(),selected=state.preset==='association'?[350,45,CONFIG.planeZ]:actual;
 const feature=visibleFeature(selected,pose),noise=featureNoise(state.sequence,CONFIG.seed);if(feature.visible){feature.u+=noise[0]*value('noise-px',0);feature.v+=noise[1]*value('noise-px',0);feature.visible=feature.u>=0&&feature.u<IMAGE.width&&feature.v>=0&&feature.v<IMAGE.height;}
 const image=document.createElement('canvas');image.width=IMAGE.width;image.height=IMAGE.height;image.getContext('2d').drawImage(liveRenderer.domElement,0,0,IMAGE.width,IMAGE.height);
 const frame={sequence:state.sequence++,exposure_s:state.time,receipt_s:state.time+value('delay-ms',0)/1000,feature,image,evaluator_only:{capture_camera_pose:pose,actual_target_mm:actual,actual_feature_target_mm:selected,actual_fault_preset:state.preset}};
 state.frames.push(frame);if(state.frames.length>35)state.frames.shift();state.lastCapture=state.time;
}
function processReceived(tool){
 const delay=value('delay-ms',0)/1000;let frame=selectDelivered(state.frames,state.time,delay);
 if(state.preset==='freeze'){if(!state.frozen&&frame)state.frozen=frame;frame=state.frozen;}
 state.received=frame;const pose=getCameraPose(eye),nominal={...pose,position:pose.position.slice()};nominal.position[0]+=value('bias-mm',0);
 const estimate=frame?.feature?.visible?intersectPixelPlane(frame.feature,nominal,CONFIG.planeZ):null;
 const decision=pointDecision(estimate,tool,CONFIG.tolerance),truth=targetPoint();
 truthMarker.position.set(truth[0],truth[1],31.7);toolMarker.position.set(tool[0],tool[1],32.5);estimateMarker.visible=!!estimate&&checked('show-truth');
 if(estimate){estimateMarker.position.set(estimate[0],estimate[1],33.3);errorLine.geometry.dispose();errorLine.geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...truth),new THREE.Vector3(estimate[0],estimate[1],31)]);}
 drawReceived(frame,decision);
 const record=createRecord(frame,state.time,estimate,tool,decision,truth);record.observation.nominal_camera_pose_used=nominal;record.observation.intrinsics={...INTRINSICS};record.observation.coordinate_frame='robot base B';record.observation.configuration_epoch=0;
 record.evaluator_only={...record.evaluator_only,capture_camera_pose:frame?.evaluator_only?.capture_camera_pose??null,actual_feature_target_mm:frame?.evaluator_only?.actual_feature_target_mm??null,actual_fault_preset:state.preset,configured_delay_s:delay,extrinsic_mapping_bias_x_mm:value('bias-mm',0),noise_amplitude_px:value('noise-px',0)};
 if(state.time-state.lastRecord>=.099999||state.lastRecord<0){state.records.push(record);if(state.records.length>6000)state.records.shift();state.lastRecord=state.time;}
 state.lastEstimate=estimate;state.lastDecision=decision;
 setText('clock-value',state.time.toFixed(2)+' s');setText('exposure-value',frame?frame.exposure_s.toFixed(2)+' s':'Waiting');setText('age-value',frame?Math.round((state.time-frame.exposure_s)*1000)+' ms':'No delivered frame');
 setText('pixel-value',frame?.feature?.visible?frame.feature.u.toFixed(1)+', '+frame.feature.v.toFixed(1)+' px':'Unavailable');
 const trueError=Math.hypot(truth[0]-tool[0],truth[1]-tool[1]);setText('error-value',trueError.toFixed(1)+' mm radial · truth');
 setText('decision-value',decision.approved?'POINT TEST PASSES':'POINT TEST WITHHOLDS');
 if($('decision-value'))$('decision-value').dataset.state=decision.approved?'approve':'abstain';
 setText('joint-values',state.joints.map((q,i)=>'J'+(i+1)+' '+q.toFixed(1)+'°').join(' · '));setText('log-count',state.records.length+' synthetic records');
 setText('pipeline-message',!frame?'No exposure has reached the receiver yet.':!frame.feature.visible?'Target feature is outside the image or occluded: no usable detection.':state.preset==='freeze'?'Frozen captured image repeats. Exposure time stays old; receipt does not create a new exposure.':state.preset==='association'?'The virtual detector selected the distractor. Its incorrect correspondence is evaluator-only truth.':state.preset==='bias'?'The inverse uses a biased camera-to-base mapping. Images themselves are unchanged.':delay>0?'Received image is an actual queued snapshot. Current camera pose is used by the simple point estimator.':'Current rendered feature is inverted through the current nominal camera pose.');
 if(record.evaluator_only.false_approval)setText('model-status','Evaluator: false point approval. The actual target is outside ±3 mm on an axis.');else if(state.ikValid)setText('model-status','Simulation only · nominal geometry · point estimator, no uncertainty certificate');
 return decision;
}
function drawReceived(frame,decision){
 const c=receiveContext;c.fillStyle='#12252e';c.fillRect(0,0,IMAGE.width,IMAGE.height);
 if(!frame){c.fillStyle='#d4e4e8';c.font='20px system-ui';c.textAlign='center';c.fillText('Waiting for a delivered exposure',320,180);return;}
 c.drawImage(frame.image,0,0);if(frame.feature.visible){const {u,v}=frame.feature;c.strokeStyle='#f8b357';c.lineWidth=2;c.strokeRect(u-13,v-13,26,26);c.beginPath();c.moveTo(u-20,v);c.lineTo(u+20,v);c.moveTo(u,v-20);c.lineTo(u,v+20);c.stroke();}
 c.fillStyle='rgba(7,22,30,.82)';c.fillRect(0,0,IMAGE.width,33);c.fillStyle='#eaf7f5';c.font='16px ui-monospace, monospace';c.textAlign='left';c.fillText('EXPOSURE '+frame.exposure_s.toFixed(2)+' s   FRAME '+frame.sequence+'   AGE '+Math.round((state.time-frame.exposure_s)*1000)+' ms',12,23);
 c.fillStyle='rgba(7,22,30,.82)';c.fillRect(0,329,IMAGE.width,31);c.fillStyle=frame.feature.visible?'#f8c278':'#ffb3a6';c.fillText(frame.feature.visible?'Projected synthetic feature · not a real detector':'No usable feature · occluded / out of view',12,350);
}

function sampleScene(){
 const p=targetPoint();target.position.set(p[0],p[1],0);occluder.position.set(p[0],p[1],76);occluder.visible=state.preset==='occlusion';
 let pos=[300+35*Math.sin(state.phase),18*Math.sin(state.phase*.65),CONFIG.flangeZ];
 if(state.trial){const tr=state.trial,elapsed=state.time-tr.start;
  const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
  if(elapsed<1){pos=tr.from.slice();setText('phase-label','Trial · settle and capture');}
  else if(elapsed<3){const t=ease((elapsed-1)/2);pos=tr.from.map((v,i)=>v+(tr.goal[i]-v)*t);setText('phase-label','Trial · align from the observed feature');}
  else if(elapsed<4){pos=tr.goal.slice();setText('phase-label','Trial · observe and check alignment');if(elapsed>3.8)tr.allowDescent=!!state.lastDecision?.approved;}
  else if(elapsed<6){pos=tr.goal.slice();if(tr.allowDescent)pos[2]+=((CONFIG.planeZ+CONFIG.tipOffset)-CONFIG.flangeZ)*ease((elapsed-4)/2);setText('phase-label',tr.allowDescent?'Trial · illustrative vertical approach (no contact model)':'Trial · approach withheld by point test');}
  else if(elapsed<8){pos=tr.goal.slice();if(tr.allowDescent)pos[2]=(CONFIG.planeZ+CONFIG.tipOffset)+(CONFIG.flangeZ-CONFIG.planeZ-CONFIG.tipOffset)*ease((elapsed-6)/2);setText('phase-label','Trial · return to observation height');}
  else{pos=tr.goal.slice();state.playing=false;state.trial=null;state.hold=pos;setText('phase-label','Trial complete · synthetic kinematics only');}
 }else if(state.hold){pos=state.hold.slice();}else setText('phase-label',state.playing?'Planar observation sweep · no contact':'Paused · planar observation setup');
 const tool=updateRobot(pos),captureDue=state.time-state.lastCapture>=.099999||state.lastCapture<0;render(captureDue);if(captureDue)capture();processReceived(tool);if($('play-toggle'))$('play-toggle').textContent=state.playing?'Pause simulation':'Run simulation';syncPlayback();
}
function advance(dt){if(!state.ready)return;state.time+=dt;state.phase+=value('motion-speed',35)/35*dt;sampleScene();}
function reset(keepPreset=true){state.playing=false;state.time=0;state.phase=0;state.frames=[];state.received=null;state.frozen=null;state.records=[];state.sequence=0;state.lastCapture=-1;state.lastRecord=-1;state.lastEstimate=null;state.lastDecision=null;state.trial=null;state.hold=null;state.joints=[0,20,60,180,-40,180];if(!keepPreset)state.preset='clean';if(state.ready)sampleScene();}
function setPreset(preset){state.preset=preset;if($('preset'))$('preset').value=preset;
 for(const [id,val] of [['delay-ms',preset==='delay'?650:0],['bias-mm',preset==='bias'?8:0],['noise-px',0],['motion-speed',35]])if($(id))$(id).value=val;
 reset();if($('preset'))$('preset').dispatchEvent(new CustomEvent('scene:preset'));
}
function startTrial(){if(!state.ready)return;const current=K.fk(state.joints);const est=state.lastEstimate;const goal=est?[est[0],est[1],CONFIG.flangeZ]:current.slice(0,3);state.trial={start:state.time,from:current.slice(0,3),goal,allowDescent:false};state.hold=null;state.playing=true;sampleScene();}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function reportRuntimeError(error){state.playing=false;syncPlayback();state.runtimeError=error?.message||String(error);setText('load-status','Simulation paused after a runtime error: '+state.runtimeError);setText('model-status','Runtime error · '+state.runtimeError);if($('load-status'))$('load-status').setAttribute('role','alert');if($('play-toggle'))$('play-toggle').textContent='Run simulation';console.error(error);}
function exportJSON(){const payload={synthetic_only:true,source:'Lite6 visual observation lab v1',configuration:CONFIG,controls:{preset:state.preset,delay_ms:value('delay-ms',0),bias_mm:value('bias-mm',0),noise_px:value('noise-px',0),motion_speed_mm_s:value('motion-speed',35)},records:state.records.map(({observation,decision})=>({observation,decision})),evaluator_only:state.records.map((r,i)=>({record_index:i,...r.evaluator_only}))};download('lite6_visual_experiment.json',JSON.stringify(payload,null,2),'application/json');}
function exportCSV(){const headers=['record_index','frame_id','exposure_reported_s','host_receipt_s','decision_s','pixel_u','pixel_v','feature_available','estimated_x_mm','estimated_y_mm','tool_x_mm','tool_y_mm','point_approved'];let rows=[headers.join(',')];state.records.forEach((r,i)=>{const o=r.observation,d=r.decision;rows.push([i,o.sequence_id,o.exposure_reported_s,o.host_receipt_s,o.decision_s,o.pixel_u,o.pixel_v,o.feature_available,d.estimated_target_mm?.[0]??'',d.estimated_target_mm?.[1]??'',d.proposed_tool_mm[0],d.proposed_tool_mm[1],d.approved].join(','));});download('lite6_visual_observations.csv',rows.join('\n')+'\n','text/csv');}
function exportImage(){if(!state.received)return;receiveCanvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='synthetic_received_frame_'+state.received.sequence+'_exposure_'+state.received.exposure_s.toFixed(3)+'s.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');}
function bind(){
 $('play-toggle')?.addEventListener('click',()=>{state.playing=!state.playing;if(state.playing)state.hold=null;sampleScene();});$('reset-scene')?.addEventListener('click',()=>reset());$('step-frame')?.addEventListener('click',()=>{state.playing=false;advance(.1);});$('preset')?.addEventListener('change',()=>setPreset($('preset').value));$('trial-cycle')?.addEventListener('click',startTrial);
 for(const id of ['target-x','target-y','delay-ms','bias-mm','noise-px'])$(id)?.addEventListener('input',()=>{const wasPlaying=state.playing;reset();state.playing=wasPlaying;syncPlayback();});
 for(const id of ['show-frustum','show-reference','show-truth'])$(id)?.addEventListener('change',()=>sampleScene());
 $('reduced-gpu')?.addEventListener('change',()=>{renderer.setPixelRatio(checked('reduced-gpu')?1:Math.min(window.devicePixelRatio||1,1.5));renderer.shadowMap.enabled=!checked('reduced-gpu');resize();render();});
 $('export-json')?.addEventListener('click',exportJSON);$('export-csv')?.addEventListener('click',exportCSV);$('export-image')?.addEventListener('click',exportImage);
 $('camera-home')?.addEventListener('click',()=>{mainCamera.position.set(1000,850,700);orbit.target.set(140,0,180);orbit.update();render();});$('camera-top')?.addEventListener('click',()=>{mainCamera.position.set(250,.1,1250);orbit.target.set(200,0,0);orbit.update();render();});
 window.addEventListener('resize',()=>{resize();render();});const observer=new ResizeObserver(()=>{resize();render();});for(const id of ['overview-view','wrist-live-view','reference-view'])observer.observe($(id));
}

async function init(){
 try{
  if(!K)throw new Error('Nominal kinematics.js was not loaded.');setText('load-status','Loading nominal Lite 6 link meshes…');
  buildEnvironment();renderer=makeRenderer('overview-view',true);liveRenderer=makeRenderer('wrist-live-view');refRenderer=makeRenderer('reference-view');
  receiveCanvas=document.createElement('canvas');receiveCanvas.width=IMAGE.width;receiveCanvas.height=IMAGE.height;receiveCanvas.setAttribute('aria-label','Historically captured wrist-camera image after simulated delivery');$('wrist-received-view').appendChild(receiveCanvas);receiveContext=receiveCanvas.getContext('2d');
  mainCamera=new THREE.PerspectiveCamera(42,1,5,10000);mainCamera.up.set(0,0,1);mainCamera.position.set(1000,850,700);mainCamera.layers.enable(1);orbit=new OrbitControls(mainCamera,renderer.domElement);orbit.target.set(140,0,180);orbit.enableDamping=false;orbit.minDistance=350;orbit.maxDistance=3000;orbit.maxPolarAngle=Math.PI*.48;
  await buildRobot();state.ready=true;resize();bind();setPreset($('preset')?.value||'clean');setText('load-status','3D scene ready · eight Lite 6 / tool meshes loaded');
  window.Lite6Experiment={stateSnapshot:()=>({ready:state.ready,time:state.time,playing:state.playing,preset:state.preset,joints:state.joints.slice(),ik_valid:state.ikValid,frames:state.frames.length,records:state.records.length,received_exposure_s:state.received?.exposure_s??null,received_sequence:state.received?.sequence??null,last_record:state.records.at(-1),configuration:CONFIG,scheduler_ticks:state.schedulerTicks,runtime_error:state.runtimeError,playback_timer_active:playbackClock?.active??false,reduced_gpu:checked('reduced-gpu')}),step:()=>{state.playing=false;advance(.1);},reset:()=>reset(),setPreset,startTrial};
  // Explicit fixed logical time; no continuously running paused render loop.
  window.addEventListener('error',event=>{if(event.error||event.message)reportRuntimeError(event.error||event.message);});
  window.addEventListener('unhandledrejection',event=>reportRuntimeError(event.reason));
  playbackClock=createPlaybackScheduler(dt=>{state.schedulerTicks++;advance(dt);},{onError:reportRuntimeError});
  orbit.addEventListener('change',()=>{if(state.ready&&!document.hidden)renderer.render(S,mainCamera);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){state.playing=false;syncPlayback();setText('play-toggle','Run simulation');setText('phase-label','Paused · tab hidden');}});
  window.addEventListener('pagehide',()=>playbackClock.stop());
  syncPlayback();
 }catch(error){console.error(error);setText('load-status','3D load failed: '+error.message+'. Start the supplied local static server and use a WebGL-enabled browser.');setText('model-status','No hardware connection exists.');if($('load-status'))$('load-status').setAttribute('role','alert');}
}
init();
