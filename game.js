(async()=>{
'use strict';
const {THREE,cloneSkinned,loadEmbeddedGLB}=Game3D;
const $=id=>document.getElementById(id), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const NAMES={scrap:'고철',wire:'전선',battery:'배터리',ammo:'탄약',medkit:'의료키트',core:'에너지 코어',chip:'AI 칩'};
const models={},events=[],playedClips=new Set(),instances=[],solids=[],structures=[],targets=[],mapRects=[],mapRoads=[],destructibles=[];
let patches=[],fxs=[],beams=[],anomalies=[],loot=[];
const required=Object.keys(window.__ASSETS__).filter(k=>window.__ASSETS__[k].mime==='model/gltf-binary');
let renderer,scene,camera,viewHands,handsMixer,handsActions={},handsAction=null,handBusy=0;
let state='start',overlay=null,selectedUpgrade=null,previousOverlay=null;
let previewRenderer,previewScene,previewCamera,previewRoot,previewMixer,previewRenderedFrames=0;
let flash=0,toastTimer=0,reloadTime=0,fireCooldown=0,holdTime=0,holdTarget=null,aimed=false,firing=false,drag=false;
let elapsed=0,missionTimer=0,lastTime=performance.now(),frameCount=0,normalReturns=0,forcedReturns=0,bestSummary='',windowDust=null,muzzle=null,muzzleTime=0;
let bag={},bank={},pending={},upgrades={craft:false,optic:false,reinforce:false},gun={damage:16,capacity:6,range:30};
let ammo=6,reserve=48;
let zoneGroup=null,currentZone=null,selectedZone='z1',cleared={},objective=null,pheno=null,bounds=null,eyeHeight=1.65,envSpeedMul=1,runSeed=97,anomalyId=0,resultGained=[],audio=null;
const p={x:0,z:6,yaw:0,pitch:-.035,hp:100,exposure:0,stamina:100};
const keys=new Set(),mapCtx=$('map').getContext('2d');
const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(Math.floor(n%60)).padStart(2,'0')}`;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const pick=(arr,rng)=>arr[Math.floor((rng||Math.random)()*arr.length)];
const log=(type,data={})=>{events.push({type,time:Math.round(elapsed*10)/10,...data});if(events.length>300)events.shift()};
function toast(text,seconds=3){$('toast').textContent=text;$('toast').classList.remove('hidden');toastTimer=seconds}
function describe(items){return Object.entries(items).filter(([,n])=>n>0).map(([k,n])=>`${NAMES[k]||k} <strong>${n}</strong>`).join(' · ')||'비어 있습니다'}
function add(target,key,n){target[key]=(target[key]||0)+n}
function showPanel(id){for(const panel of ['start','debrief','workshop','routemap','bagPanel','pause','catalog'])$(panel).classList.toggle('hidden',panel!==id);overlay=id;keys.clear();firing=false;drag=false;holdTime=0;document.exitPointerLock?.()}
function closePanels(){for(const panel of ['start','debrief','workshop','routemap','bagPanel','pause','catalog'])$(panel).classList.add('hidden');overlay=null;keys.clear();firing=false;holdTime=0}
function handClip(name,loop=false){const action=handsActions[name];if(!action)return;if(handsAction===action&&(loop||handBusy>0)&&!['FP_Fire','FP_Equip'].includes(name))return;handsAction?.fadeOut(.12);action.reset().setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);action.clampWhenFinished=!loop;action.fadeIn(.12).play();handsAction=action;handBusy=loop?0:2;playedClips.add(name)}
function sound(kind){if(!audio)return;const settings={shot:[95,.09,'sawtooth'],hit:[57,.11,'square'],pickup:[680,.16,'sine'],return:[310,.42,'sine'],craft:[880,.22,'triangle'],alert:[170,.23,'sine'],reload:[320,.07,'triangle'],thunder:[52,.5,'sawtooth'],anomaly:[130,.34,'triangle']};const [freq,duration,type]=settings[kind]||settings.pickup;const osc=audio.createOscillator(),gain=audio.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,audio.currentTime);osc.frequency.exponentialRampToValueAtTime(freq*.45,audio.currentTime+duration);gain.gain.setValueAtTime(kind==='shot'?.10:.05,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);osc.connect(gain).connect(audio.destination);osc.start();osc.stop(audio.currentTime+duration)}
function fail(error){console.error(error);$('errorMessage').textContent=String(error.message||error);$('errorPanel').classList.remove('hidden');$('loading').classList.add('hidden')}

const WALL_UNIT=2.0;
const ZONES={
z1:{id:'z1',name:'붕괴 도로',sub:'COLLAPSED ROAD',level:1,seed:1013,w:96,d:72,timeLimit:200,sky:'#26373a',ground:'#33443f',
 phenomenon:{key:'storm',name:'자기 폭풍',desc:'주기적으로 자기 폭풍이 몰아칩니다. 폭풍 중에는 시야가 조여오고 노출이 누적되며 물체형 이상체가 활성화됩니다.'},
 anomalyKinds:['crate_hopper','lens_watcher'],anomalyCount:5,
 objective:{kind:'generator',count:3,label:'발전기 복구'},
 loot:['scrap','wire','battery','ammo','medkit'],lockHint:''},
z2:{id:'z2',name:'독성 습지',sub:'TOXIC MARSH',level:2,seed:2039,w:88,d:64,timeLimit:210,sky:'#2a3b28',ground:'#3a4a35',
 phenomenon:{key:'tide',name:'독성 조수',desc:'독성 웅덩이가 고여 있고, 비가 내리면 웅덩이가 확장되며 오염이 빠르게 누적됩니다.'},
 anomalyKinds:['toxic_blob','wire_parasite','crate_hopper'],anomalyCount:6,
 objective:{kind:'nest',count:3,label:'오염 핵 파괴'},
 loot:['scrap','battery','medkit','ammo','wire'],lockHint:'붕괴 도로 클리어 시 개방'},
z3:{id:'z3',name:'자기 폭풍 지대',sub:'STATIC STORM',level:3,seed:3061,w:100,d:76,timeLimit:170,sky:'#1d2733',ground:'#333b47',
 phenomenon:{key:'emp',name:'전자기 펄스',desc:'펄스가 지도를 먹통으로 만들고 번개가 떨어집니다. 펄스 동안 이상체의 움직임이 빨라집니다.'},
 anomalyKinds:['shard_swarm','unstable_barrel','lens_watcher'],anomalyCount:7,
 objective:{kind:'beacon',count:3,label:'신호기 설치'},
 loot:['battery','wire','scrap','ammo','core'],lockHint:'붕괴 도로 클리어 시 개방'},
z4:{id:'z4',name:'뒤틀린 지대',sub:'WARPED GROUND',level:4,seed:4079,w:92,d:68,timeLimit:220,sky:'#2b2233',ground:'#3a3344',
 phenomenon:{key:'gravity',name:'중력 이상',desc:'중력이 주기적으로 흔들립니다. 이동 속도와 시야 높이가 변하고, 구조물이 뒤틀리며 잔해가 떨어집니다.'},
 anomalyKinds:['gravity_core','fold_ring','shard_swarm'],anomalyCount:7,
 objective:{kind:'vault',count:1,label:'봉인 코어 회수'},
 loot:['core','chip','scrap','battery','medkit'],lockHint:'독성 습지와 자기 폭풍 지대 클리어 시 개방'},
z5:{id:'z5',name:'심부 균열',sub:'DEEP FISSURE',level:5,seed:5099,w:84,d:64,timeLimit:260,sky:'#2b1d1d',ground:'#3b2c2c',
 phenomenon:{key:'rift',name:'균열 확산',desc:'모든 이상 현상이 뒤섞이고 이상체가 끊임없이 증식합니다. 감시자가 균열 중심을 지키고 있습니다.'},
 anomalyKinds:['shard_swarm','gravity_core','unstable_barrel'],anomalyCount:6,
 objective:{kind:'boss',count:1,label:'감시자 파괴'},
 loot:['core','chip','scrap','ammo','medkit'],lockHint:'뒤틀린 지대 클리어 시 개방'}
};
const ANOMALIES={
crate_hopper:{name:'폭주 상자',behavior:'hopper',hp:44,speed:2.0,aggro:11,attackRange:2.7,telegraph:.7,cooldown:1.8,damage:15,radius:.95,height:1.1,hover:0,reward:{scrap:1}},
lens_watcher:{name:'감시 렌즈',behavior:'watcher',hp:34,speed:1.5,aggro:14,attackRange:12,telegraph:1.0,cooldown:2.4,damage:14,radius:.85,height:1.6,hover:1.9,reward:{}},
wire_parasite:{name:'전선 기생체',behavior:'crawler',hp:30,speed:2.5,aggro:13,attackRange:2.4,telegraph:.55,cooldown:1.7,damage:13,radius:.75,height:.7,hover:0,reward:{wire:1}},
toxic_blob:{name:'독액 응어리',behavior:'blob',hp:52,speed:.9,aggro:8,attackRange:3.0,telegraph:.9,cooldown:2.4,damage:16,radius:1.1,height:.8,hover:0,reward:{battery:1}},
shard_swarm:{name:'부유 파편',behavior:'swarm',hp:58,speed:1.6,aggro:15,attackRange:2.2,telegraph:0,cooldown:.9,damage:7,radius:1.2,height:1.5,hover:1.4,reward:{scrap:2}},
unstable_barrel:{name:'불안정 기물',behavior:'barrel',hp:38,speed:1.1,aggro:9,attackRange:3.6,telegraph:2.0,cooldown:1,damage:38,radius:.9,height:1.2,hover:0,reward:{scrap:1}},
gravity_core:{name:'중력 핵',behavior:'gravity',hp:70,speed:.5,aggro:10,attackRange:5.2,telegraph:1.1,cooldown:2.8,damage:12,radius:1.0,height:1.6,hover:1.5,reward:{core:1}},
fold_ring:{name:'공간 접힘',behavior:'fold',hp:60,speed:0,aggro:3,attackRange:2.9,telegraph:.4,cooldown:6,damage:6,radius:1.3,height:1.6,hover:0,reward:{chip:1}},
overseer:{name:'감시자',behavior:'overseer',boss:true,hp:320,speed:1.0,aggro:22,attackRange:16,telegraph:1.2,cooldown:3.2,damage:22,radius:2.0,height:2.4,hover:1.6,reward:{core:2,chip:1}}
};
function isUnlocked(id){if(id==='z1')return true;if(id==='z2'||id==='z3')return!!cleared.z1;if(id==='z4')return!!(cleared.z2&&cleared.z3);if(id==='z5')return!!cleared.z4;return false}
function material(c,metal=0){return new THREE.MeshStandardMaterial({color:c,roughness:.86,metalness:metal})}
function setupPreview(){previewRenderer=new THREE.WebGLRenderer({canvas:$('workbenchPreview'),antialias:true});previewRenderer.setSize(250,160);previewRenderer.setPixelRatio(1);previewRenderer.outputColorSpace=THREE.SRGBColorSpace;previewScene=new THREE.Scene();previewScene.background=new THREE.Color('#1c3433');previewScene.add(new THREE.HemisphereLight(0xd2dfcc,0x29413b,2.3));const light=new THREE.DirectionalLight(0xf0c895,2.0);light.position.set(1,3,2);previewScene.add(light);previewCamera=new THREE.PerspectiveCamera(40,250/160,.01,20)}
function refreshPreview(name='FP_Idle'){if(previewRoot)previewScene.remove(previewRoot);previewRoot=cloneSkinned(models.hands.scene);previewScene.add(previewRoot);previewMixer=new THREE.AnimationMixer(previewRoot);const c=models.hands.animations.find(a=>a.name===name);if(c){const action=previewMixer.clipAction(c);action.setLoop(name==='FP_Idle'?THREE.LoopRepeat:THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();playedClips.add(name);previewMixer.update(.01)}for(const key of ['optic','barrel']){if(!(key==='optic'?upgrades.optic:upgrades.craft||upgrades.reinforce))continue;const o=cloneSkinned(models[key].scene);o.scale.setScalar(key==='optic'?.5:.6);o.position.set(.23,key==='optic'?.37:.30,key==='optic'?-.08:-.28);previewRoot.add(o);previewRoot.updateMatrixWorld(true);previewRoot.getObjectByName('weapon')?.attach(o)}const box=new THREE.Box3().setFromObject(previewRoot),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());previewCamera.position.copy(center).add(new THREE.Vector3(1.1,.95,1.4).multiplyScalar(Math.max(size.x,size.y,size.z)));previewCamera.lookAt(center);previewRenderer.render(previewScene,previewCamera)}
function proc(o){o.userData.proc=true;return o}
function glowMat(color,intensity=1.3){return new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:intensity,roughness:.35,metalness:.1})}
function cube(x,y,z,w,h,d,color){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material(color));o.position.set(x,y,z);proc(o);zoneGroup.add(o);return o}
function model(key,x,z,scale=1,y=0,rotation=0){const o=cloneSkinned(models[key].scene);o.position.set(x,y,z);o.scale.setScalar(scale);o.rotation.y=rotation;zoneGroup.add(o);instances.push({key,o});return o}
function label(text,x,y,z,color='#b9d1b3',scale=1){const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='#132a2cf0';ctx.fillRect(0,0,512,128);ctx.strokeStyle=color;ctx.lineWidth=4;ctx.strokeRect(4,4,504,120);ctx.fillStyle=color;ctx.font='bold 30px "Malgun Gothic",sans-serif';ctx.textAlign='center';ctx.fillText(text,256,76);const tex=new THREE.CanvasTexture(c),sp=proc(new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:true})));sp.position.set(x,y,z);sp.scale.set(4.8*scale,1.2*scale,1);zoneGroup.add(sp);return sp}
function beamLine(a,b,color,opacity,time=.08){const g=new THREE.BufferGeometry().setFromPoints([a,b]);const line=proc(new THREE.Line(g,new THREE.LineBasicMaterial({color,transparent:true,opacity})));zoneGroup.add(line);beams.push({line,time,life:time,baseOpacity:opacity});return line}
function spawnBurst(x,y,z,color,scale=1,life=.45){const m=proc(new THREE.Mesh(new THREE.SphereGeometry(scale,10,8),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.8})));m.position.set(x,y,z);zoneGroup.add(m);fxs.push({kind:'burst',mesh:m,time:life,life})}
function addPatch(x,z,r,rate,life,color=0x86c25f){const m=proc(new THREE.Mesh(new THREE.CircleGeometry(r,20),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.32,depthWrite:false})));m.rotation.x=-Math.PI/2;m.position.set(x,.06,z);zoneGroup.add(m);patches.push({x,z,r,rate,life,maxLife:life,mesh:m})}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
let occ=null,occW=0,occH=0;
function occInit(w,d){occW=Math.ceil(w/WALL_UNIT);occH=Math.ceil(d/WALL_UNIT);occ=new Uint8Array(occW*occH)}
function occMark(x,z,w,d,pad=1){if(!occ)return;const c=WALL_UNIT;const x0=Math.floor((x-w/2-pad-bounds.x0)/c),x1=Math.ceil((x+w/2+pad-bounds.x0)/c),z0=Math.floor((z-d/2-pad-bounds.z0)/c),z1=Math.ceil((z+d/2+pad-bounds.z0)/c);for(let i=Math.max(0,x0);i<Math.min(occW,x1);i++)for(let j=Math.max(0,z0);j<Math.min(occH,z1);j++)occ[j*occW+i]=1}
function occFree(x,z,w,d,pad=1){if(!occ)return true;const c=WALL_UNIT;const x0=Math.floor((x-w/2-pad-bounds.x0)/c),x1=Math.ceil((x+w/2+pad-bounds.x0)/c),z0=Math.floor((z-d/2-pad-bounds.z0)/c),z1=Math.ceil((z+d/2+pad-bounds.z0)/c);if(x0<0||z0<0||x1>occW||z1>occH)return false;for(let i=x0;i<x1;i++)for(let j=z0;j<z1;j++)if(occ[j*occW+i])return false;return true}
function addWall(x,z,alongX){const o=model('wall',x,z,.82,0,alongX?Math.PI/2:0);const s={x,z,w:alongX?WALL_UNIT:.7,d:alongX?.7:WALL_UNIT,ref:o};solids.push(s);structures.push(s);return o}
function wallRun(x1,z1,x2,z2,gap=null){const dx=x2-x1,dz=z2-z1,len=Math.hypot(dx,dz);if(len<.01)return;const n=Math.max(1,Math.round(len/WALL_UNIT)),alongX=Math.abs(dx)>=Math.abs(dz);for(let i=0;i<n;i++){const t=(i+.5)/n,x=x1+dx*t,z=z1+dz*t;if(gap&&Math.hypot(x-gap.x,z-gap.z)<gap.r)continue;addWall(x,z,alongX)}}
function findSpot(rng,minEntry,ring,spacing=14){const list=ring||[];let fallback=null;for(let t=0;t<400;t++){const x=bounds.x0+3+rng()*(bounds.x1-bounds.x0-6),z=bounds.z0+3+rng()*(bounds.z1-bounds.z0-6);if(Math.hypot(x,z-(bounds.z1-3))<minEntry)continue;if(list.some(s=>Math.hypot(s.x-x,s.z-z)<spacing))continue;if(occFree(x,z,7,7,1))return{x,z};if(!fallback)fallback={x,z}}return fallback||{x:0,z:0}}
function clonePart(key,scale,y=0,ry=0){const o=cloneSkinned(models[key].scene);o.scale.setScalar(scale);o.position.y=y;o.rotation.y=ry;return o}
function buildAnomalyObject(kind,g){
 let glow=null;
 if(kind==='crate_hopper'){g.add(clonePart('crate',2.3,.9));glow=proc(new THREE.Mesh(new THREE.IcosahedronGeometry(.28,0),glowMat(0xe8915a)));glow.position.y=1.5;g.add(glow)}
 else if(kind==='lens_watcher'){g.add(clonePart('ring',2.0,0,Math.PI/2));const o=clonePart('optic',1.6,1.9);g.add(o);glow=proc(new THREE.Mesh(new THREE.SphereGeometry(.3,10,8),glowMat(0xff9b7a)));glow.position.y=1.9;g.add(glow)}
 else if(kind==='wire_parasite'){g.add(clonePart('wire',2.6,.3));glow=proc(new THREE.Mesh(new THREE.SphereGeometry(.22,8,6),glowMat(0x9fd8ff)));glow.position.y=.6;g.add(glow)}
 else if(kind==='toxic_blob'){const p=clonePart('pool',2.0);p.scale.y*=.5;g.add(p);glow=proc(new THREE.Mesh(new THREE.SphereGeometry(.8,12,8),new THREE.MeshStandardMaterial({color:0x7fae57,emissive:0x5f9436,emissiveIntensity:.9,roughness:.5,transparent:true,opacity:.85})));glow.position.y=.55;g.add(glow)}
 else if(kind==='shard_swarm'){for(let i=0;i<7;i++){const s=proc(new THREE.Mesh(new THREE.TetrahedronGeometry(.3+i*.02),new THREE.MeshStandardMaterial({color:0x9aa8a0,metalness:.8,roughness:.35})));const a=i/7*Math.PI*2;s.position.set(Math.cos(a)*1.0,.7+Math.sin(i)*.3,Math.sin(a)*1.0);g.add(s)}glow=proc(new THREE.Mesh(new THREE.TetrahedronGeometry(.5),glowMat(0xbfe08f)));glow.position.y=.9;g.add(glow)}
 else if(kind==='unstable_barrel'){g.add(clonePart('barrel',2.4,1.0));glow=proc(new THREE.Mesh(new THREE.SphereGeometry(.35,10,8),glowMat(0xff6a4a,1.6)));glow.position.y=2.0;g.add(glow)}
 else if(kind==='gravity_core'){const c=clonePart('core',1.9,1.5);g.add(c);const t=proc(new THREE.Mesh(new THREE.TorusGeometry(1.2,.07,8,26),glowMat(0xb07fff)));t.rotation.x=Math.PI/2;t.position.y=1.5;g.add(t);glow=c}
 else if(kind==='fold_ring'){g.add(clonePart('ring',3.2,1.2,Math.PI/2));const disc=proc(new THREE.Mesh(new THREE.CircleGeometry(1.35,24),new THREE.MeshBasicMaterial({color:0xc9a8ff,transparent:true,opacity:.25,side:THREE.DoubleSide})));disc.position.y=1.2;g.add(disc);glow=disc}
 else if(kind==='overseer'){g.add(clonePart('ring',4.4,1.8,Math.PI/2));g.add(clonePart('core',2.4,1.8));for(let i=0;i<5;i++){const s=proc(new THREE.Mesh(new THREE.TetrahedronGeometry(.42),new THREE.MeshStandardMaterial({color:0xa8b5ac,metalness:.8,roughness:.3})));s.userData.orb={a:i/5*Math.PI*2};g.add(s)}glow=proc(new THREE.Mesh(new THREE.SphereGeometry(.5,12,10),glowMat(0xffb36a,1.8)));glow.position.y=1.8;g.add(glow)}
 return {glow};
}
function spawnAnomaly(kind,x,z){const def=ANOMALIES[kind];const g=new THREE.Group();g.position.set(x,0,z);const built=buildAnomalyObject(kind,g);zoneGroup.add(g);const e={id:kind+'_'+(anomalyId++),kind,def,x,z,hp:def.hp,maxHP:def.hp,mode:'idle',timer:0,cooldown:1.2,hitTimer:0,phase:Math.random()*6,dead:false,gone:false,deathT:.5,fuse:0,summon:6,trail:3,object:g,glow:built.glow};anomalies.push(e);return e}
function buildBase(){
 zoneGroup=new THREE.Group();scene.add(zoneGroup);
 bounds={x0:-26,x1:26,z0:-16,z1:16};
 scene.background.set('#26373a');scene.fog.color.set('#26373a');scene.fog.near=18;scene.fog.far=100;
 cube(0,-.14,0,56,.25,36,'#344446');
 wallRun(-26,-16,26,-16);wallRun(-26,16,26,16,{x:0,z:16,r:3});wallRun(-26,-16,-26,16);wallRun(26,-16,26,16);
 model('bench',0,-2,1.5);model('backpack',-.7,-2,.7,.95);model('goggles',-1.1,-2.2,.9,1.0);model('detector',.8,-2.1,.85,1.0);
 model('sign',5,-6,1.5);label('차고 · 안전 기지',5,3.2,-6,'#c5d6b3');label('작업대',0,2.4,-2,'#f0be71',.85);
 model('crate',-9,7,1.3);model('crate',-10.6,7,1.1);model('barrel',-8,9,2.0);model('pipe',9,-9,2.2);model('rubble',-15,-7,2.0);model('generator',15,9,1.6);
 const warm=new THREE.PointLight(0xf0be71,60,24);warm.position.set(0,4,-2);zoneGroup.add(warm);
 targets.push({id:'workbench',type:'workbench',x:0,z:-2,duration:.3});
 mapRects.push({x:0,z:-2,w:10,d:8,kind:'base'});
}
function buildLot(cx,cz,w,d,rng,zone){
 const roll=rng();const kind=roll<.4?'warehouse':roll<.62?'ruin':roll<.78?'yard':roll<.9?'outpost':'basin';
 if(kind==='warehouse'){
  wallRun(cx-w/2,cz-d/2,cx+w/2,cz-d/2);wallRun(cx-w/2,cz+d/2,cx+w/2,cz+d/2,{x:cx,z:cz+d/2,r:1.7});wallRun(cx-w/2,cz-d/2,cx-w/2,cz+d/2);wallRun(cx+w/2,cz-d/2,cx+w/2,cz+d/2);
  const n=2+Math.floor(rng()*3);
  for(let i=0;i<n;i++)model(rng()<.5?'crate':'barrel',cx-w/2+1.5+rng()*(w-3),cz-d/2+1.5+rng()*(d-3),1.1+rng()*.5);
  mapRects.push({x:cx,z:cz,w,d,kind:'building'});
 } else if(kind==='ruin'){
  const edges=[[cx-w/2,cz-d/2,cx+w/2,cz-d/2],[cx-w/2,cz+d/2,cx+w/2,cz+d/2],[cx-w/2,cz-d/2,cx-w/2,cz+d/2],[cx+w/2,cz-d/2,cx+w/2,cz+d/2]];
  for(const e of edges)if(rng()<.6)wallRun(e[0],e[1],e[2],e[3]);
  for(let i=0;i<3;i++)model('rubble',cx-w/4+rng()*w/2,cz-d/4+rng()*d/2,1.5+rng()*.8);
  mapRects.push({x:cx,z:cz,w,d,kind:'ruin'});
 } else if(kind==='yard'){
  const n=4+Math.floor(rng()*4),keys=['crate','rubble','pipe','barrel','wire'];
  for(let i=0;i<n;i++)model(pick(keys,rng),cx-w/2+1+rng()*(w-2),cz-d/2+1+rng()*(d-2),1.1+rng()*.8);
  mapRects.push({x:cx,z:cz,w,d,kind:'yard'});
 } else if(kind==='outpost'){
  wallRun(cx-3,cz-3,cx+3,cz-3);wallRun(cx-3,cz+3,cx+3,cz+3,{x:cx,z:cz+3,r:1.4});wallRun(cx-3,cz-3,cx-3,cz+3);wallRun(cx+3,cz-3,cx+3,cz+3);
  model('pipe',cx+2,cz-2,2.6);model('sign',cx-2,cz+1,1.2);model('crate',cx+1,cz+1,1.1);
  mapRects.push({x:cx,z:cz,w:7,d:7,kind:'building'});
 } else {
  model('pool',cx,cz,2.6+rng()*1.2);
  const rate=zone.phenomenon.key==='tide'?10:zone.id==='z5'?8:0;
  if(rate>0)addPatch(cx,cz,3.0,rate,-1);
  model('sign',cx+3,cz+2,1.1);model('pipe',cx-3,cz-1,2.0);
  mapRects.push({x:cx,z:cz,w:7,d:7,kind:'pool'});
 }
}
function buildNest(x,z,i){const g=new THREE.Group();g.position.set(x,0,z);const base=cloneSkinned(models.rubble.scene);base.scale.setScalar(2.0);g.add(base);const core=proc(new THREE.Mesh(new THREE.IcosahedronGeometry(.7,0),new THREE.MeshStandardMaterial({color:0x6f9c4f,emissive:0x7fce55,emissiveIntensity:1.2,roughness:.35})));core.position.y=1.0;g.add(core);zoneGroup.add(g);label('오염 핵',x,2.6,z,'#a8d47a',.85);destructibles.push({id:'nest'+i,kind:'nest',x,z,hp:65,maxHP:65,radius:1.5,height:1.5,object:g,core,dead:false});mapRects.push({x,z,w:3,d:3,kind:'objective'})}
function buildBeaconSite(x,z,i){const pad=proc(new THREE.Mesh(new THREE.CylinderGeometry(1.7,1.9,.22,18),new THREE.MeshStandardMaterial({color:0x3c5a4e,roughness:.9})));pad.position.set(x,.09,z);zoneGroup.add(pad);const ring=proc(new THREE.Mesh(new THREE.TorusGeometry(1.5,.07,8,24),new THREE.MeshStandardMaterial({color:0x94b6ae,emissive:0x4f7f70,emissiveIntensity:.6})));ring.rotation.x=-Math.PI/2;ring.position.set(x,.25,z);zoneGroup.add(ring);label('신호기 설치 지점',x,2.2,z,'#b9d1b3',.8);targets.push({id:'beacon'+i,type:'beacon',x,z,duration:2,used:false});mapRects.push({x,z,w:4,d:4,kind:'objective'})}
function installBeacon(t){const pole=proc(new THREE.Mesh(new THREE.BoxGeometry(.28,3.4,.28),new THREE.MeshStandardMaterial({color:0x9aa8a0,roughness:.5,metalness:.6})));pole.position.set(t.x,1.7,t.z);zoneGroup.add(pole);const lamp=proc(new THREE.Mesh(new THREE.SphereGeometry(.26,10,8),glowMat(0xf0be71,1.6)));lamp.position.set(t.x,3.5,t.z);zoneGroup.add(lamp);spawnBurst(t.x,3.4,t.z,0xf0be71,1.2,.5)}
function buildVault(x,z){model('ring',x,z,3.4,1.8,Math.PI/2);const core=cloneSkinned(models.core.scene);core.scale.setScalar(1.6);core.position.set(x,1.6,z);zoneGroup.add(core);label('봉인 코어',x,3.6,z,'#d7b6ff',.9);targets.push({id:'vault',type:'vault',x,z,duration:3,used:false});mapRects.push({x,z,w:5,d:5,kind:'objective'})}
function buildArena(x,z){for(let i=0;i<10;i++){const a=i/10*Math.PI*2,wx=x+Math.cos(a)*12,wz=z+Math.sin(a)*12,o=model('wall',wx,wz,1.6,0,a+Math.PI/2);solids.push({x:wx,z:wz,w:2.6,d:1.0,ref:o})}model('rubble',x+8,z-6,2.4);model('barrel',x-9,z+5,2.2);model('crate',x-6,z-8,1.6);label('감시자 둥지',x,4,z,'#e8a08a',1);mapRects.push({x,z,w:26,d:26,kind:'arena'})}
function buildExit(x,z){const pad=proc(new THREE.Mesh(new THREE.CylinderGeometry(2.0,2.2,.22,20),new THREE.MeshStandardMaterial({color:0x3c5a4e,roughness:.9})));pad.position.set(x,.09,z);zoneGroup.add(pad);const ring=proc(new THREE.Mesh(new THREE.TorusGeometry(1.7,.08,8,26),new THREE.MeshStandardMaterial({color:0x8fd4c2,emissive:0x4f8f7f,emissiveIntensity:.7})));ring.rotation.x=-Math.PI/2;ring.position.set(x,.28,z);zoneGroup.add(ring);label('추출 지점 · 안전 귀환',x,2.4,z,'#8fd4c2',.9);targets.push({id:'home',type:'home',x,z,duration:1.2});mapRects.push({x,z,w:5,d:5,kind:'exit'})}
function lootModel(type,x,z,id,items){const key=type==='ammo'?'ammo_model':type;const o=model(key,x,z,2.4,.42);const tag=label(Object.entries(items).map(([k,n])=>`${NAMES[k]} ${n}`).join(' · '),x,1.7,z,'#e3c188',.55);loot.push({id,x,z,items,object:o,tag,taken:false,duration:1.7,type:'loot'})}
function rollLoot(rng,zone){const items={};items[pick(zone.loot,rng)]=1+Math.floor(rng()*2);const b=rng();if(b<.45)items.ammo=6+Math.floor(rng()*10);if(b>.8)items[pick(zone.loot,rng)]=1;return items}
function buildZoneRun(zone){
 zoneGroup=new THREE.Group();scene.add(zoneGroup);
 bounds={x0:-zone.w/2+2,x1:zone.w/2-2,z0:-zone.d/2+2,z1:zone.d/2-2};
 occInit(zone.w,zone.d);
 scene.background.set(zone.sky);scene.fog.color.set(zone.sky);scene.fog.near=18;scene.fog.far=100;
 cube(0,-.16,0,zone.w,.3,zone.d,zone.ground);
 const rng=mulberry32(zone.seed^runSeed);runSeed=(runSeed*1664525+1013904223)>>>0;
 const entryZ=zone.d/2-5;
 wallRun(-zone.w/2+1,-zone.d/2+1,zone.w/2-1,-zone.d/2+1);
 wallRun(-zone.w/2+1,zone.d/2-1,zone.w/2-1,zone.d/2-1,{x:0,z:zone.d/2-1,r:3.4});
 wallRun(-zone.w/2+1,-zone.d/2+1,-zone.w/2+1,zone.d/2-1);
 wallRun(zone.w/2-1,-zone.d/2+1,zone.w/2-1,zone.d/2-1);
 const mainZ=Math.round(((rng()*2-1)*zone.d/4)/4)*4;
 mapRoads.push({x:0,z:mainZ,w:zone.w-4,d:6});occMark(0,mainZ,zone.w-4,6,0);
 const vx=[],vCount=2+Math.floor(rng()*2);
 for(let i=0;i<vCount;i++){const x=Math.round(((rng()*2-1)*(zone.w/2-14))/4)*4;vx.push(x);mapRoads.push({x,z:0,w:6,d:zone.d-6});occMark(x,0,6,zone.d-6,0)}
 for(let x=-zone.w/2+12;x<=zone.w/2-12;x+=12+Math.floor(rng()*5)){
  for(const side of [-1,1]){
   const w=8+Math.floor(rng()*7),d=7+Math.floor(rng()*6),cx=x+(rng()*3-1.5),cz=mainZ+side*(3+d/2+1+Math.floor(rng()*2));
   if(cz<zone.d/2-6&&cz>-zone.d/2+6&&occFree(cx,cz,w,d,1.5)){buildLot(cx,cz,w,d,rng,zone);occMark(cx,cz,w,d,1.5)}
  }
 }
 for(const x of vx){
  for(let z=-zone.d/2+12;z<=zone.d/2-12;z+=11+Math.floor(rng()*5)){
   for(const side of [-1,1]){
    const w=7+Math.floor(rng()*6),d=8+Math.floor(rng()*6),cx=x+side*(3+w/2+1+Math.floor(rng()*2)),cz=z+(rng()*3-1.5);
    if(cx<zone.w/2-6&&cx>-zone.w/2+6&&occFree(cx,cz,w,d,1.5)){buildLot(cx,cz,w,d,rng,zone);occMark(cx,cz,w,d,1.5)}
   }
  }
 }
 const treeCount=zone.id==='z1'?20:zone.id==='z2'?12:zone.id==='z4'?8:3;
 for(let i=0;i<treeCount;i++){const x=bounds.x0+2+rng()*(bounds.x1-bounds.x0-4),z=bounds.z0+2+rng()*(bounds.z1-bounds.z0-4);if(occFree(x,z,3,3,.5)){model('tree',x,z,1.1+rng()*.5);occMark(x,z,2,2,0)}}
 for(let i=0;i<10;i++){const x=bounds.x0+2+rng()*(bounds.x1-bounds.x0-4),z=bounds.z0+2+rng()*(bounds.z1-bounds.z0-4);if(occFree(x,z,3,3,.5)){model('rubble',x,z,1.6+rng()*.7);occMark(x,z,2,2,0)}}
 if(zone.phenomenon.key==='tide'){const pools=[];for(let i=0;i<3;i++){const s=findSpot(rng,12,pools,10);pools.push(s);model('pool',s.x,s.z,3.0);addPatch(s.x,s.z,3.4,10,-1);mapRects.push({x:s.x,z:s.z,w:8,d:8,kind:'pool'})}}
 objective={kind:zone.objective.kind,count:zone.objective.count,label:zone.objective.label,done:0};
 const spots=[];
 if(zone.objective.kind==='generator'){for(let i=0;i<zone.objective.count;i++){const s=findSpot(rng,18,spots,15);spots.push(s);model('generator',s.x,s.z,2.0);label('발전기 복구',s.x,3.0,s.z,'#b9cec0',.9);targets.push({id:'gen'+i,type:'generator',x:s.x,z:s.z,duration:2.5,used:false});solids.push({x:s.x,z:s.z,w:2.2,d:2.2,ref:null});mapRects.push({x:s.x,z:s.z,w:4,d:4,kind:'objective'})}}
 else if(zone.objective.kind==='nest'){for(let i=0;i<zone.objective.count;i++){const s=findSpot(rng,18,spots,15);spots.push(s);buildNest(s.x,s.z,i)}}
 else if(zone.objective.kind==='beacon'){for(let i=0;i<zone.objective.count;i++){const s=findSpot(rng,18,spots,15);spots.push(s);buildBeaconSite(s.x,s.z,i)}}
 else if(zone.objective.kind==='vault'){const s=findSpot(rng,22,spots,15);spots.push(s);buildVault(s.x,s.z);spawnAnomaly('fold_ring',clamp(s.x+5,bounds.x0+2,bounds.x1-2),clamp(s.z+4,bounds.z0+2,bounds.z1-2));spawnAnomaly('gravity_core',clamp(s.x-5,bounds.x0+2,bounds.x1-2),clamp(s.z-4,bounds.z0+2,bounds.z1-2))}
 else if(zone.objective.kind==='boss'){const s=findSpot(rng,20,spots,15);spots.push(s);buildArena(s.x,s.z);occMark(s.x,s.z,26,26,0);spawnAnomaly('overseer',s.x,s.z)}
 buildExit(0,entryZ);
 for(let i=0;i<8;i++){const s=findSpot(rng,9,spots,8);spots.push(s);lootModel(pick(zone.loot,rng),s.x,s.z,'cache_'+i,rollLoot(rng,zone))}
 for(let i=0;i<zone.anomalyCount;i++){const s=findSpot(rng,15,spots,10);spots.push(s);spawnAnomaly(pick(zone.anomalyKinds,rng),s.x,s.z)}
 pheno={t:0,phase:'calm',toxic:0,cause:'',rain:false,emp:false,gravity:1,strike:0,fall:12,shift:40,respawn:18,stormNotified:false,rainNotified:false};
 envSpeedMul=1;
}
function clearZoneGroup(){if(zoneGroup){scene.remove(zoneGroup);zoneGroup.traverse(o=>{if(o.userData.proc){if(o.geometry)o.geometry.dispose();if(o.material){if(o.material.map)o.material.map.dispose();o.material.dispose()}}});zoneGroup=null}for(const a of [anomalies,loot,destructibles,patches,fxs,beams,solids,structures,targets,mapRects,mapRoads,instances])a.length=0;holdTarget=null;holdTime=0}
function resetCampaign(){bag={};bank={};pending={};cleared={};normalReturns=0;forcedReturns=0;gun={damage:16,capacity:6,range:30};upgrades={craft:false,optic:false,reinforce:false};ammo=6;reserve=48;missionTimer=0;elapsed=0;events.length=0;bestSummary='';currentZone=null;objective=null;pheno=null;eyeHeight=1.65;envSpeedMul=1;runSeed=97;selectedZone='z1';state='base';for(const k of ['optic','barrel']){const o=viewHands.getObjectByName('added_'+k);if(o)o.parent.remove(o)}handClip('FP_Idle',true);clearZoneGroup();buildBase();p.x=0;p.z=6;p.yaw=0;p.pitch=-.035;p.hp=100;p.exposure=0;p.stamina=100;refreshHUD();log('campaign_reset')}
function departZone(id){const zone=ZONES[id];if(!zone||!isUnlocked(id))return;selectedZone=id;closePanels();clearZoneGroup();currentZone=zone;buildZoneRun(zone);state='explore';bag={};pending={};missionTimer=0;p.hp=100;p.exposure=0;p.stamina=100;p.x=0;p.z=zone.d/2-7.5;p.yaw=0;p.pitch=-.035;eyeHeight=1.65;ammo=gun.capacity;reserve=Math.max(reserve,36);reloadTime=0;holdTime=0;flash=0;handClip('FP_Equip');log('depart',{zone:id,objective:zone.objective.kind});toast(`${zone.name} 진입 · ${zone.objective.label} ${zone.objective.count}회 · 이상 현상: ${zone.phenomenon.name}`,5)}
function result(success,reason=''){
 const carried={...bag},kept={...bank};resultGained=[];
 const wasClear=!!pending.clear,zoneName=currentZone?currentZone.name:'존',objSnapshot=objective?{...objective}:null;
 if(success){for(const[k,n]of Object.entries(bag))add(bank,k,n);if(wasClear&&currentZone&&!cleared[currentZone.id]){const before=Object.keys(ZONES).filter(isUnlocked);cleared[currentZone.id]=true;resultGained=Object.keys(ZONES).filter(isUnlocked).filter(x=>!before.includes(x))}normalReturns++;sound('return');log('normal_return',{zone:currentZone?currentZone.id:null,recovered:carried,bank:{...bank},cleared:{...cleared},unlocked:resultGained})}
 else{forcedReturns++;sound('alert');log('forced_return',{zone:currentZone?currentZone.id:null,reason,lost:carried,keptBank:kept})}
 bag={};pending={};state='base';clearZoneGroup();buildBase();p.x=0;p.z=6;p.yaw=0;p.pitch=-.035;p.hp=100;p.exposure=0;reloadTime=0;ammo=gun.capacity;eyeHeight=1.65;handClip('FP_Idle',true);
 $('resultEyebrow').textContent=success?'SAFE RETURN / 정상 회수':'FORCED RETURN / 가방 손실';
 $('resultTitle').textContent=success?(wasClear?`${zoneName} 목표 완료 · 귀환 성공`:'가방을 지켜 돌아왔습니다'):`${reason} · 구조 신호로 강제 복귀`;
 const objLine=objSnapshot?`목표 ${objSnapshot.label} · ${objSnapshot.done}/${objSnapshot.count}${wasClear?' ✓':''}`:'';
 $('resultLog').innerHTML=success?`<b>이번에 안전하게 회수</b><br>${describe(carried)}<div class="spacer"></div><b>보관함</b><br>${describe(bank)}${objLine?`<div class="spacer"></div>${objLine}`:''}`:`<b style="color:var(--coral)">잃은 가방 품목</b><br>${describe(carried)}<div class="spacer"></div><b>유지된 보관함</b><br>${describe(bank)}<br>장착 무기 · 피해 ${gun.damage} / 탄창 ${gun.capacity} 유지`;
 $('resultFlags').innerHTML=Object.entries(ZONES).map(([id,z])=>{const done=cleared[id],open=isUnlocked(id);return `<span class="flag ${done?'done':open?'open':''}">${done?'✓':open?'●':'○'} ${z.name}</span>`}).join('');
 const unlockedLine=resultGained.length?`새로 개방된 존 <b>${resultGained.map(id=>ZONES[id].name).join(', ')}</b>. 경로 지도에서 확인하세요.`:'';
 $('resultHint').textContent=success?`${unlockedLine||'회수품으로 작업대를 재정비하고 다음 존 런을 준비하세요.'}`:`실패로 이번 가방만 잃었습니다. 장비와 보관함은 유지됩니다. ${unlockedLine}`;
 bestSummary=$('resultTitle').textContent;refreshHUD();showPanel('debrief');
}
const RECIPES={craft:{name:'회수 권총 Mk.II 제작',cost:{scrap:3,wire:1,battery:1},effect:'기본 피해 28 · 탄창 8 · 새 총구 외형'},optic:{name:'조준경 개조',cost:{scrap:2,battery:1},effect:'사거리 60m · 마우스 오른쪽/Alt 조준 시 확대'},reinforce:{name:'총구 강화',cost:{scrap:2,wire:2},effect:'피해 +8 · 물체형 이상체 대응'}};
function canPay(recipe){return Object.entries(recipe.cost).every(([k,n])=>(bank[k]||0)>=n)}
function workshop(){showPanel('workshop');refreshPreview();selectedUpgrade=null;$('upgradePreview').textContent='적용할 작업을 선택하세요.';updateWorkshop()}
function updateWorkshop(){
 $('bankList').innerHTML=`<b>안전 회수 보관함</b> ${describe(bank)}<br>현재 무기: 피해 ${gun.damage} · 탄창 ${gun.capacity} · 거리 ${gun.range}m`;
 for(const b of document.querySelectorAll('[data-upgrade]')){const key=b.dataset.upgrade;b.classList.toggle('selected',key===selectedUpgrade);b.disabled=upgrades[key]}
 const r=RECIPES[selectedUpgrade];$('applyUpgrade').disabled=!r||upgrades[selectedUpgrade]||!canPay(r);$('applyUpgrade').textContent=!r?'작업을 선택하세요':upgrades[selectedUpgrade]?'이미 적용했습니다':canPay(r)?'예상대로 적용':'회수 재료가 부족합니다';
 $('workshopHint').textContent=gun.damage>=24?'물체형 이상체와 감시자에 대응할 장비를 갖췄습니다. 경로 지도에서 다음 존을 선택하세요.':'먼저 붕괴 도로에서 부품을 수색해 정상 귀환하세요. 클리어하면 새 존이 개방됩니다.';
}
function applyUpgrade(){const key=selectedUpgrade,r=RECIPES[key];if(!r||upgrades[key]||!canPay(r))return;const before={...gun},beforeBank={...bank};for(const[k,n]of Object.entries(r.cost))bank[k]-=n;upgrades[key]=true;if(key==='craft'){gun.damage+=12;gun.capacity=8;attachUpgrade('barrel')}if(key==='optic'){gun.range=60;attachUpgrade('optic')}if(key==='reinforce'){gun.damage+=8;attachUpgrade('barrel')}ammo=gun.capacity;handClip('FP_Modify');sound('craft');refreshPreview('FP_Modify');log('upgrade_applied',{key,cost:{...r.cost},before,after:{...gun},beforeBank,afterBank:{...bank}});$('upgradePreview').innerHTML=`<b>${r.name} 적용 완료</b><br>${r.effect}<br>재료를 한 번 소모했습니다.`;updateWorkshop();refreshHUD()}
function attachUpgrade(key){const old=viewHands.getObjectByName('added_'+key);if(old)old.parent.remove(old);const o=cloneSkinned(models[key].scene);o.name='added_'+key;o.scale.setScalar(key==='optic'?.5:.60);o.position.set(.23,key==='optic'?.37:.30,key==='optic'?-.08:-.28);viewHands.add(o);viewHands.updateMatrixWorld(true);const weapon=viewHands.getObjectByName('weapon');if(weapon)weapon.attach(o);o.traverse(m=>{if(m.isMesh){m.material=m.material.clone();m.material.depthTest=false;m.material.depthWrite=false;m.renderOrder=41}})}
function routeMap(){showPanel('routemap');renderZones()}
function renderZones(){
 const list=$('zoneList');list.innerHTML='';
 for(const [id,zone] of Object.entries(ZONES)){
  const open=isUnlocked(id),done=!!cleared[id];
  const b=document.createElement('button');b.type='button';b.dataset.zone=id;
  b.className='zonecard'+(id===selectedZone?' selected':'')+(done?' cleared':'')+(open?'':' locked');
  b.disabled=!open;
  b.innerHTML=`<div class="zonehead"><b>${zone.name}</b><span class="chip ${done?'done':open?'open':'lock'}">${done?'클리어':open?'개방':'잠김'}</span></div><em>${zone.sub} · 위험도 ${zone.level} · 제한 ${Math.floor(zone.timeLimit/60)}분</em><p class="small">이상 현상 — ${zone.phenomenon.name}: ${zone.phenomenon.desc}</p><p class="small">목표: ${zone.objective.label}${zone.objective.count>1?` ×${zone.objective.count}`:''}${open?'':' · '+zone.lockHint}</p>`;
  b.onclick=()=>{selectedZone=id;renderZones()};
  list.appendChild(b);
 }
 const zone=ZONES[selectedZone],open=isUnlocked(selectedZone);
 $('zoneDetail').innerHTML=`<b>${zone.name}</b> (${zone.sub}) · 이상 현상 <b>${zone.phenomenon.name}</b><br>출현 이상체: ${zone.anomalyKinds.map(k=>ANOMALIES[k].name).join(' · ')}${zone.objective.kind==='boss'?' · 감시자':''}<br><span class="small">구조물과 배치는 런마다 새로 생성됩니다. 목표를 완수하고 추출 지점으로 귀환하세요.</span>`;
 $('zoneDepart').disabled=!open;$('zoneDepart').textContent=open?`${zone.name} 출발`:'잠긴 존';
}
function objectiveProgress(){if(!objective)return;objective.done=Math.min(objective.count,objective.done+1);log('objective_progress',{zone:currentZone?currentZone.id:null,done:objective.done,count:objective.count});if(objective.done>=objective.count&&!pending.clear){pending.clear=true;sound('craft');toast(`${currentZone.name} · ${objective.label} 완료 · 추출 지점으로 귀환하세요`,5)}else toast(`${objective.label} ${objective.done}/${objective.count}`,3);refreshHUD()}
function reload(){if(overlay||state!=='explore'||reloadTime||ammo>=gun.capacity||reserve<=0)return;reloadTime=1.6;handClip('FP_Reload');sound('reload');log('reload_start')}
function shoot(){
 if(overlay||state!=='explore'||fireCooldown||reloadTime)return;
 if(!ammo){toast('탄창이 비었습니다 · R로 장전',1);reload();return}
 ammo--;fireCooldown=.34;handClip('FP_Fire');sound('shot');
 const dir=camera.getWorldDirection(new THREE.Vector3()),origin=camera.getWorldPosition(new THREE.Vector3());
 let closest=null,closestD=Infinity,closestKind='';
 for(const e of anomalies){if(e.dead)continue;const c=new THREE.Vector3(e.x,(e.def.hover||0)+e.def.height/2,e.z),proj=c.clone().sub(origin).dot(dir);if(proj<0||proj>gun.range)continue;if(origin.clone().addScaledVector(dir,proj).distanceTo(c)<e.def.radius&&proj<closestD){closest=e;closestD=proj;closestKind='anomaly'}}
 for(const d of destructibles){if(d.dead)continue;const c=new THREE.Vector3(d.x,d.height/2,d.z),proj=c.clone().sub(origin).dot(dir);if(proj<0||proj>gun.range)continue;if(origin.clone().addScaledVector(dir,proj).distanceTo(c)<d.radius&&proj<closestD){closest=d;closestD=proj;closestKind='destructible'}}
 if(closest){const damage=gun.damage*(aimed?1.15:1);
  if(closestKind==='anomaly'){closest.hp=Math.max(0,closest.hp-damage);closest.hitTimer=.32;spawnBurst(closest.x,(closest.def.hover||0)+closest.def.height*.5,closest.z,0xcfe0b0,.5,.2);log('shot_hit',{kind:closest.kind,damage,hp:closest.hp});if(!closest.hp){if(closest.def.behavior==='barrel')explodeAt(closest.x,closest.z,2.8,22,'불안정 기물 폭발');killAnomaly(closest);toast(`${closest.def.name} 무력화`,1.4)}}
  else{closest.hp=Math.max(0,closest.hp-damage);log('shot_hit',{kind:'nest',damage,hp:closest.hp});if(!closest.hp)killDestructible(closest);else spawnBurst(closest.x,1,closest.z,0xa8d47a,.5,.2)}
 } else log('shot_miss');
 const end=origin.clone().addScaledVector(dir,closest?closestD:18);beamLine(origin.clone().add(new THREE.Vector3(0,-.12,0)),end,0xf0be71,.7);muzzleTime=.06;refreshHUD();
}
function damagePlayer(amount,cause){p.hp=Math.max(0,p.hp-amount);flash=.45;sound('hit');log('damage',{amount,cause,hp:p.hp});if(p.hp<=0)result(false,'체력 0');else toast(`${cause} · 체력 -${amount}`,1.5)}
function medkit(){if(state!=='explore'||overlay)return;if(!(bag.medkit>0)){toast('가방에 의료키트가 없습니다',1.5);return}if(p.hp>=100)return;bag.medkit--;p.hp=Math.min(100,p.hp+40);sound('pickup');toast('의료키트 사용 · 체력 +40',2);log('medkit_used')}
function explodeAt(x,z,radius,damage,cause,color=0xf0a05a){spawnBurst(x,.6,z,color,radius*.7,.5);sound('hit');if(dist(p,{x,z})<radius)damagePlayer(damage,cause)}
function killAnomaly(e,silent=false){if(e.dead)return;e.dead=true;e.deathT=.5;e.gone=false;spawnBurst(e.x,e.def.hover?e.def.hover:e.def.height*.6,e.z,e.def.boss?0xf0be71:0x9fd08a,e.def.boss?3.5:1.3,.5);if(!silent)sound('hit');if(e.def.behavior==='blob')addPatch(e.x,e.z,1.9,8,14);if(e.def.reward)for(const[k,n]of Object.entries(e.def.reward))add(bag,k,n);log('anomaly_killed',{kind:e.kind});if(e.def.boss){objective.done=objective.count;objectiveProgress()}}
function killDestructible(d){if(d.dead)return;d.dead=true;spawnBurst(d.x,1,d.z,0x9fd08a,2.2,.6);zoneGroup.remove(d.object);objectiveProgress()}
function eligible(t){if(t.type==='loot')return!t.taken&&state==='explore';if(t.type==='home')return state==='explore';if(t.type==='workbench')return state==='base';if(['generator','beacon','vault'].includes(t.type))return state==='explore'&&!t.used&&!pending.clear;return false}
function findTarget(){let best=null,score=Infinity;for(const t of [...loot,...targets]){if(!eligible(t))continue;const d=dist(p,t),lim=t.type==='home'?4.2:t.type==='workbench'?3.3:3.4;if(d>lim)continue;if(t.type!=='home'&&t.type!=='workbench'){const facing=((-Math.sin(p.yaw))*(t.x-p.x)+(-Math.cos(p.yaw))*(t.z-p.z))/Math.max(d,.001);if(facing<.1)continue}if(d<score){best=t;score=d}}return best}
function promptFor(t){if(t.type==='loot')return Object.entries(t.items).map(([k,n])=>NAMES[k]+' '+n).join(' · ')+' 회수';return ({home:'추출 지점 · 안전 귀환',workbench:'작업대 · 제작/개조/강화',generator:'발전기 가동',beacon:'신호기 설치',vault:'봉인 코어 추출'})[t.type]||t.type}
function interact(t){if(!t||!eligible(t))return;switch(t.type){case'loot':t.taken=true;t.object.visible=false;t.tag.visible=false;for(const[k,n]of Object.entries(t.items))add(bag,k,n);handClip('FP_Gather');sound('pickup');toast(`가방에 담았습니다 · ${Object.entries(t.items).map(([k,n])=>NAMES[k]+' '+n).join(' / ')} · 귀환 전 미확정`,3);log('loot',{id:t.id,items:t.items});break;case'home':result(true);break;case'workbench':workshop();break;case'generator':t.used=true;handClip('FP_ToolUse');sound('craft');objectiveProgress();break;case'beacon':t.used=true;installBeacon(t);handClip('FP_Interact');sound('pickup');objectiveProgress();break;case'vault':t.used=true;handClip('FP_Interact');add(bag,'core',1);sound('craft');objectiveProgress();break}holdTime=0;holdTarget=null;refreshHUD()}
function spawnLightning(){const a=Math.random()*Math.PI*2,r=4+Math.random()*9,x=clamp(p.x+Math.cos(a)*r,bounds.x0+1,bounds.x1-1),z=clamp(p.z+Math.sin(a)*r,bounds.z0+1,bounds.z1-1);beamLine(new THREE.Vector3(x,16,z),new THREE.Vector3(x,0,z),0xdfe9ff,.95,.3);spawnBurst(x,.8,z,0xcfe0ff,2.2,.3);sound('thunder');if(dist(p,{x,z})<2.6)damagePlayer(18,'낙뢰')}
function spawnDebris(){const a=Math.random()*Math.PI*2,r=5+Math.random()*7,x=clamp(p.x+Math.cos(a)*r,bounds.x0+2,bounds.x1-2),z=clamp(p.z+Math.sin(a)*r,bounds.z0+2,bounds.z1-2);const m=proc(new THREE.Mesh(new THREE.RingGeometry(.7,1.1,20),new THREE.MeshBasicMaterial({color:0xd0705a,transparent:true,opacity:.8,side:THREE.DoubleSide})));m.rotation.x=-Math.PI/2;m.position.set(x,.08,z);zoneGroup.add(m);fxs.push({kind:'debris',mesh:m,time:1.3,life:1.3,x,z})}
function shiftStructures(){const list=structures.filter(s=>s.ref);if(!list.length)return;toast('구조물이 뒤틀립니다 · 벽이 이동합니다',2);sound('alert');for(let i=0;i<3&&list.length;i++){const s=list[Math.floor(Math.random()*list.length)],nx=clamp(s.x+(Math.random()*2.4-1.2),bounds.x0+2,bounds.x1-2),nz=clamp(s.z+(Math.random()*2.4-1.2),bounds.z0+2,bounds.z1-2);s.x=nx;s.z=nz;s.ref.position.set(nx,s.ref.position.y,nz)}}
function spawnRiftAnomaly(){const kinds=currentZone.anomalyKinds;for(let t=0;t<30;t++){const x=bounds.x0+3+Math.random()*(bounds.x1-bounds.x0-6),z=bounds.z0+3+Math.random()*(bounds.z1-bounds.z0-6);if(dist(p,{x,z})<14)continue;if(!occFree(x,z,4,4,1))continue;spawnAnomaly(pick(kinds,Math.random),x,z);toast('균열에서 이상체가 증식합니다',2);return}}
function updatePhenomenon(dt){
 const ph=currentZone.phenomenon;pheno.t+=dt;
 let toxic=0,cause='',fogNear=18,fogFar=100,sky=currentZone.sky;envSpeedMul=1;pheno.phase='calm';pheno.emp=false;
 if(ph.key==='storm'){const c=pheno.t%42;
  if(c>32){pheno.phase='storm';const k=Math.min(1,(c-32)/3);fogNear=18-13*k;fogFar=100-72*k;toxic=2.0;cause='자기 폭풍 · 노출 누적 · 시야 제한';envSpeedMul=1.35;sky='#1d2b2e';if(!pheno.stormNotified){pheno.stormNotified=true;toast('자기 폭풍이 도착했습니다 · 시야가 조여옵니다',4)}}
  else if(c>26){pheno.phase='warning';const k=(c-26)/6;fogNear=18-6*k;fogFar=100-30*k;cause='자기 폭풍 접근 · 대비하세요';pheno.stormNotified=false}
 } else if(ph.key==='tide'){const c=pheno.t%50,rain=c>34;
  if(rain&&!pheno.rain){toast('독성 비가 시작됩니다 · 웅덩이가 확장됩니다',3);sound('alert')}
  pheno.rain=rain;
  if(rain){toxic=.65;cause='독성 비 · 노출 상승';fogNear=13;fogFar=64;sky='#2a3b28'}
  for(const pt of patches)if(pt.rate>0)pt.mesh.scale.setScalar(rain?1.35:1);
 } else if(ph.key==='emp'){const c=pheno.t%36;if(c>30){pheno.emp=true;toxic=.9;cause='전자기 펄스 · 지도 불능 · 낙뢰';envSpeedMul=1.5;fogNear=10;fogFar=46;sky='#141d2a';pheno.strike-=dt;if(pheno.strike<=0){pheno.strike=1.1+Math.random()*.8;spawnLightning()}}else pheno.strike=0}
 else if(ph.key==='gravity'){const g=.7+.7*(.5+.5*Math.sin(pheno.t*.35));pheno.gravity=g;eyeHeight=1.65*clamp(g,.72,1.3);if(g<.85)cause='중력 저하 · 이동이 빨라집니다';else if(g>1.2)cause='중력 상승 · 이동이 느려집니다';pheno.fall-=dt;if(pheno.fall<=0){pheno.fall=12;spawnDebris()}pheno.shift-=dt;if(pheno.shift<=0){pheno.shift=40;shiftStructures()}sky='#2b2233';fogNear=16;fogFar=88}
 else if(ph.key==='rift'){const c=pheno.t%24;toxic=1.0;cause='균열 확산 · 이상체 증식';if(c>18){pheno.emp=true;envSpeedMul=1.4;fogNear=9;fogFar=42;sky='#301c1c'}else{fogNear=14;fogFar=70;sky='#2b1d1d'}pheno.respawn-=dt;if(pheno.respawn<=0){pheno.respawn=22;if(anomalies.filter(a=>!a.dead).length<12)spawnRiftAnomaly()}}
 pheno.toxic=toxic;pheno.cause=cause;scene.background.set(sky);scene.fog.color.set(sky);scene.fog.near=fogNear;scene.fog.far=fogFar;
}
function tickTelegraph(e,dt,fire){if(e.mode!=='telegraph')return false;e.timer-=dt;if(e.timer<=0){e.mode='idle';e.cooldown=e.def.cooldown||2;fire()}return true}
function foldPlayer(e){let best=null;for(let t=0;t<24;t++){const a=Math.random()*Math.PI*2,r=8+Math.random()*4,x=clamp(p.x+Math.cos(a)*r,bounds.x0+2,bounds.x1-2),z=clamp(p.z+Math.sin(a)*r,bounds.z0+2,bounds.z1-2);if(canMove(x,z)){best={x,z};break}}if(best){p.x=best.x;p.z=best.z}p.yaw+=Math.random()*Math.PI*2;damagePlayer(6,'공간 접힘');spawnBurst(e.x,1.2,e.z,0xc9a8ff,2,.5);toast('공간이 접혔습니다 · 위치가 뒤바뀝니다',2);sound('alert')}
function updateAnomalies(dt){
 for(const e of anomalies){
  if(e.dead){if(!e.gone){e.deathT-=dt;e.object.rotation.y+=dt*5;const s=Math.max(.02,e.object.scale.x-dt*2.6);e.object.scale.setScalar(s);if(e.deathT<=0){zoneGroup.remove(e.object);e.gone=true}}continue}
  const def=e.def;e.cooldown=Math.max(0,e.cooldown-dt);if(e.hitTimer>0)e.hitTimer-=dt;e.phase+=dt;e.object.position.x=e.x;e.object.position.z=e.z;
  if(state!=='explore')continue;
  const d=dist(p,e),spd=def.speed*envSpeedMul;
  const face=()=>{e.object.rotation.y=Math.atan2(p.x-e.x,p.z-e.z)};
  const move=mul=>{if(d>1.6&&spd>0){const step=spd*mul*dt;e.x+=(p.x-e.x)/d*step;e.z+=(p.z-e.z)/d*step}};
  const hurt=(radius,cause)=>{if(dist(p,e)<radius)damagePlayer(def.damage,cause||def.name)};
  if(def.behavior==='hopper'){e.object.position.y=Math.abs(Math.sin(e.phase*3.4))*.5;
   if(tickTelegraph(e,dt,()=>{spawnBurst(e.x,.5,e.z,0xc98b52,1.4,.35);hurt(3.0)}))continue;
   if(d<def.aggro){move(1);face();if(d<def.attackRange&&e.cooldown<=0){e.mode='telegraph';e.timer=def.telegraph;sound('anomaly')}}}
  else if(def.behavior==='watcher'){e.object.position.y=def.hover+Math.sin(e.phase*1.4)*.15;e.object.rotation.y+=dt*.7;
   if(tickTelegraph(e,dt,()=>{beamLine(new THREE.Vector3(e.x,def.hover,e.z),new THREE.Vector3(p.x,1.2,p.z),0xff8a70,.85,.22);sound('shot');hurt(def.attackRange)}))continue;
   if(d<def.aggro){if(d<6){const step=spd*dt;e.x-=(p.x-e.x)/d*step;e.z-=(p.z-e.z)/d*step}else if(d>11)move(1);if(d<def.attackRange&&e.cooldown<=0){e.mode='telegraph';e.timer=def.telegraph;sound('anomaly')}}}
  else if(def.behavior==='crawler'){e.object.position.y=0;
   if(tickTelegraph(e,dt,()=>{spawnBurst(e.x,.5,e.z,0x9fd8ff,1.2,.3);hurt(2.6)}))continue;
   if(d<def.aggro){move(1);face();if(d<def.attackRange&&e.cooldown<=0){e.mode='telegraph';e.timer=def.telegraph;sound('anomaly')}}}
  else if(def.behavior==='blob'){e.object.position.y=Math.sin(e.phase*2)*.08;e.object.rotation.y+=dt*.3;
   e.trail-=dt;if(e.trail<=0&&d<def.aggro){e.trail=3.4;addPatch(e.x,e.z,1.5,8,16)}
   if(tickTelegraph(e,dt,()=>{hurt(3.2);spawnBurst(e.x,.6,e.z,0x8fce62,1.4,.4)}))continue;
   if(d<def.aggro){move(1);if(d<def.attackRange&&e.cooldown<=0){e.mode='telegraph';e.timer=def.telegraph}}}
  else if(def.behavior==='swarm'){e.object.position.y=def.hover+Math.sin(e.phase*2)*.25;e.object.rotation.y+=dt*1.2;
   if(d<def.aggro)move(1);
   if(d<def.attackRange&&e.cooldown<=0){e.cooldown=def.cooldown;damagePlayer(def.damage,def.name);spawnBurst(e.x,def.hover,e.z,0xbfe08f,1,.3)}}
  else if(def.behavior==='barrel'){e.object.position.y=0;face();
   if(e.mode==='fuse'){e.fuse-=dt;if(e.glow)e.glow.material.emissiveIntensity=.8+Math.abs(Math.sin(e.fuse*10))*1.8;if(e.fuse<=0){explodeAt(e.x,e.z,4.2,def.damage,'불안정 기물 폭발');killAnomaly(e,true)}continue}
   if(d<def.aggro){move(1);if(d<def.attackRange&&e.cooldown<=0){e.mode='fuse';e.fuse=def.telegraph;sound('anomaly');toast('불안정 기물이 부풀어 오릅니다 · 벗어나세요',1.4)}}}
  else if(def.behavior==='gravity'){e.object.position.y=def.hover+Math.sin(e.phase*1.1)*.2;e.object.rotation.y+=dt*.4;
   if(tickTelegraph(e,dt,()=>{hurt(def.attackRange);spawnBurst(e.x,def.hover,e.z,0xb07fff,1.5,.4)}))continue;
   if(d<def.aggro){move(.6);if(d<def.attackRange&&e.cooldown<=0){e.mode='telegraph';e.timer=def.telegraph;sound('anomaly')}}}
  else if(def.behavior==='fold'){e.object.position.y=Math.sin(e.phase*1.6)*.15;e.object.rotation.y+=dt*1.6;
   if(d<def.attackRange&&e.cooldown<=0){e.cooldown=def.cooldown;foldPlayer(e)}}
  else if(def.behavior==='overseer'){e.object.position.y=def.hover+Math.sin(e.phase*1.2)*.3;e.object.rotation.y+=dt*.5;
   for(const c of e.object.children)if(c.userData.orb){const a=c.userData.orb.a+e.phase*.7;c.position.set(Math.cos(a)*2.6,def.hover+Math.sin(a*2)*.4,Math.sin(a)*2.6)}
   e.summon-=dt;if(e.summon<=0){e.summon=13;if(anomalies.filter(x=>!x.dead).length<12){const a=Math.random()*Math.PI*2;spawnAnomaly('shard_swarm',clamp(e.x+Math.cos(a)*6,bounds.x0+2,bounds.x1-2),clamp(e.z+Math.sin(a)*6,bounds.z0+2,bounds.z1-2));toast('감시자가 파편을 불러냅니다',2)}}
   if(tickTelegraph(e,dt,()=>{beamLine(new THREE.Vector3(e.x,def.hover,e.z),new THREE.Vector3(p.x,1.2,p.z),0xffb36a,.9,.3);sound('shot');if(dist(p,e)<def.attackRange)damagePlayer(def.damage,'감시자 광선');if(dist(p,e)<7){damagePlayer(26,'감시자 충격파');spawnBurst(e.x,1,e.z,0xffb36a,4,.5)}}))continue;
   if(d<def.aggro&&d>6)move(.8);
   if(d<def.attackRange&&e.cooldown<=0){e.mode='telegraph';e.timer=def.telegraph;sound('anomaly')}}
 }
}
function canMove(x,z){if(!bounds)return false;if(x<bounds.x0||x>bounds.x1||z<bounds.z0||z>bounds.z1)return false;return !solids.some(o=>Math.abs(x-o.x)<o.w/2+.35&&Math.abs(z-o.z)<o.d/2+.35)}
function updatePlayer(dt){
 if(overlay)return;
 const turn=1.55*dt;if(keys.has('ArrowLeft'))p.yaw+=turn;if(keys.has('ArrowRight'))p.yaw-=turn;if(keys.has('ArrowUp'))p.pitch=clamp(p.pitch+.9*dt,-.9,.65);if(keys.has('ArrowDown'))p.pitch=clamp(p.pitch-.9*dt,-.9,.65);
 let forward=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),side=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);
 const moving=forward||side,sprint=keys.has('ShiftLeft')&&p.stamina>4&&moving;
 let speedMul=1;if(state==='explore'&&currentZone&&currentZone.phenomenon.key==='gravity')speedMul=clamp(2-(pheno?pheno.gravity:1),.7,1.35);
 const speed=(sprint?4.3:2.65)*speedMul*dt;
 if(sprint)p.stamina=Math.max(0,p.stamina-23*dt);else p.stamina=Math.min(100,p.stamina+14*dt);
 if(moving){let norm=Math.hypot(forward,side);forward/=norm;side/=norm;const dx=(-Math.sin(p.yaw)*forward+Math.cos(p.yaw)*side)*speed,dz=(-Math.cos(p.yaw)*forward-Math.sin(p.yaw)*side)*speed;if(canMove(p.x+dx,p.z))p.x+=dx;if(canMove(p.x,p.z+dz))p.z+=dz}
 if(state==='explore'){
  for(const e of anomalies){if(e.dead||e.def.behavior!=='gravity')continue;const d=dist(p,e);if(d<9&&d>.5){const pull=(1-d/9)*2.4*dt,ux=(e.x-p.x)/d,uz=(e.z-p.z)/d;if(canMove(p.x+ux*pull,p.z))p.x+=ux*pull;if(canMove(p.x,p.z+uz*pull))p.z+=uz*pull}}
  missionTimer+=dt;
  let toxic=pheno.toxic||0,cause=pheno.cause||'';
  for(const pt of patches)if(pt.rate>0&&dist(p,pt)<pt.r&&pt.rate>toxic){toxic=pt.rate;cause='독성 웅덩이 · 즉시 벗어나세요'}
  if(toxic>0)p.exposure=clamp(p.exposure+toxic*dt,0,100);else p.exposure=clamp(p.exposure-2.5*dt,0,100);
  if(p.exposure>=100){result(false,'장시간 오염 노출');return}
  if(missionTimer>=currentZone.timeLimit){result(false,'탐사 시간 초과');return}
  $('danger').textContent=cause;$('danger').classList.toggle('hidden',!cause);
 } else $('danger').classList.add('hidden');
 const target=findTarget();if(target!==holdTarget){holdTarget=target;holdTime=0}
 $('prompt').classList.toggle('hidden',!target);
 if(target){$('promptText').textContent=promptFor(target);if(keys.has('KeyE')){holdTime+=dt;handClip(target.type==='loot'?'FP_Gather':target.type==='generator'?'FP_ToolUse':'FP_Interact');if(holdTime>=target.duration)interact(target)}else holdTime=0;$('holdbar').style.width=clamp(holdTime/target.duration*100,0,100)+'%'}
 if(firing||keys.has('Space'))shoot();aimed=keys.has('AltLeft')||drag;camera.fov=upgrades.optic&&aimed?48:72;camera.updateProjectionMatrix();
}
function updatePatches(dt){for(const pt of patches)if(pt.life>0){pt.life-=dt;pt.mesh.material.opacity=Math.max(0,.32*pt.life/pt.maxLife);if(pt.life<=0){zoneGroup.remove(pt.mesh);pt.mesh.geometry.dispose();pt.mesh.material.dispose();pt.dead=true}}patches=patches.filter(pt=>!pt.dead)}
function updateFx(dt){
 for(const f of fxs){f.time-=dt;
  if(f.kind==='burst'){const k=1-Math.max(0,f.time)/f.life;f.mesh.scale.setScalar(1+k*1.8);f.mesh.material.opacity=.8*Math.max(0,1-k)}
  else if(f.kind==='debris'){f.mesh.material.opacity=.5+Math.abs(Math.sin(f.time*10))*.4;f.mesh.material.color.setHex(f.time<.4?0xff7a5a:0xd0705a)}
  if(f.time<=0){if(f.kind==='debris'){spawnBurst(f.x,1,f.z,0x8a6a55,1.5,.4);if(dist(p,{x:f.x,z:f.z})<2.2)damagePlayer(16,'붕괴 잔해')}zoneGroup.remove(f.mesh);f.mesh.geometry.dispose();f.mesh.material.dispose()}}
 fxs=fxs.filter(f=>f.time>0);
 for(const b of beams){b.time-=dt;if(b.line.material)b.line.material.opacity=b.baseOpacity*Math.max(0,b.time/b.life);if(b.time<=0){zoneGroup.remove(b.line);b.line.geometry.dispose();b.line.material.dispose()}}
 beams=beams.filter(b=>b.time>0);
}
function baseMissionHTML(){const done=Object.keys(ZONES).filter(z=>cleared[z]).map(z=>ZONES[z].name),open=Object.keys(ZONES).filter(isUnlocked).map(z=>ZONES[z].name);return `${done.length?`클리어 ${done.join(' · ')}`:'아직 클리어한 존이 없습니다'}<br><span class="small">개방 존: ${open.join(' · ')} · 경로 지도에서 출발하세요</span>`}
function exploreMissionHTML(){const o=objective;return `<b>${currentZone.name}</b> · ${o.label} ${o.done}/${o.count}${o.done>=o.count?' ✓':''}${pending.clear?' · 추출 지점으로':''}<br><span class="small">이상 현상 — ${currentZone.phenomenon.name}: ${currentZone.phenomenon.desc}</span>`}
function refreshHUD(){
 $('health').textContent=Math.ceil(p.hp);$('healthbar').style.width=p.hp+'%';$('exposure').textContent=Math.floor(p.exposure)+'%';$('exposurebar').style.width=p.exposure+'%';$('staminabar').style.width=p.stamina+'%';
 $('clock').textContent=state==='explore'?`${clock(missionTimer)} / ${clock(currentZone.timeLimit)}`:'--:-- / --:--';
 $('magazine').textContent=reloadTime>0?'…':ammo;$('reserve').textContent=reserve;
 $('weaponLabel').textContent=`${upgrades.craft?'회수 권총 Mk.II':'회수 권총'} · 피해 ${gun.damage}${upgrades.optic?' · 조준경':''}${upgrades.reinforce?' · 총구 강화':''}`;
 $('cargoList').innerHTML=describe(bag);
 $('locationLabel').textContent=state==='explore'?`${currentZone.name} · ${currentZone.phenomenon.name}${pheno&&pheno.phase==='storm'?' · 폭풍':pheno&&pheno.emp?' · 펄스':''}`:'차고 · 안전 기지';
 $('mission').innerHTML=state==='explore'?exploreMissionHTML():baseMissionHTML();
 const home=targets.find(t=>t.type==='home');
 if(home){const h=dist(p,home);$('homeDistance').textContent=Math.round(h)+' m';const hy=Math.atan2(-(home.x-p.x),-(home.z-p.z));$('homeArrow').style.transform=`rotate(${(p.yaw-hy)*180/Math.PI}deg)`}else{$('homeDistance').textContent='기지';$('homeArrow').style.transform='rotate(0deg)'}
 const seen=anomalies.filter(e=>!e.dead&&dist(p,e)<20).sort((a,b)=>dist(p,a)-dist(p,b))[0];
 $('enemyHUD').classList.toggle('hidden',!seen||state!=='explore');
 if(seen){$('enemyName').textContent=`${seen.def.name} · ${Math.ceil(seen.hp)} / ${seen.maxHP}`;$('enemyHP').style.width=seen.hp/seen.maxHP*100+'%'}
 drawMap();
}
function drawMap(){
 const c=mapCtx;c.clearRect(0,0,330,196);c.fillStyle='#0e2226';c.fillRect(0,0,330,196);
 if(state!=='explore'){c.strokeStyle='#5d8278';c.strokeRect(95,45,140,100);c.fillStyle='#233d40';c.fillRect(120,60,40,70);c.fillStyle='#f0be71';c.fillRect(160,85,8,8);c.fillStyle='#e4ece5';c.beginPath();c.arc(100,140,4,0,Math.PI*2);c.fill();c.font='13px sans-serif';c.fillStyle='#94b6ae';c.fillText('BASE / 차고',20,20);c.fillText('작업대',165,82);return}
 const W=currentZone.w,D=currentZone.d,pad=13,sc=Math.min((330-pad*2)/W,(196-pad*2)/D),ox=165-W*sc/2,oz=98-D*sc/2,mx=x=>ox+(x+W/2)*sc,mz=z=>oz+(z+D/2)*sc;
 if(pheno&&pheno.emp){c.fillStyle='#3a1414aa';c.fillRect(0,0,330,196);c.fillStyle='#e87f68';for(let i=0;i<24;i++)c.fillRect(Math.random()*330,Math.random()*196,6,2);c.font='14px sans-serif';c.fillStyle='#ffc0a8';c.fillText('신호 손실 — 전자기 간섭',95,100);return}
 c.fillStyle='#182e31';c.fillRect(mx(-W/2),mz(-D/2),W*sc,D*sc);
 c.fillStyle='#233d40';for(const r of mapRoads)c.fillRect(mx(r.x-r.w/2),mz(r.z-r.d/2),r.w*sc,r.d*sc);
 for(const b of mapRects){c.strokeStyle=b.kind==='building'?'#6d948a':b.kind==='arena'?'#a8645a':'#3e5a52';c.lineWidth=1;c.strokeRect(mx(b.x-b.w/2),mz(b.z-b.d/2),b.w*sc,b.d*sc)}
 c.fillStyle='#7fbf5f66';for(const pt of patches)if(pt.rate>0){c.beginPath();c.arc(mx(pt.x),mz(pt.z),Math.max(2,pt.r*sc),0,Math.PI*2);c.fill()}
 c.fillStyle='#f0be71';for(const l of loot)if(!l.taken)c.fillRect(mx(l.x)-2,mz(l.z)-2,4,4);
 for(const t of targets){if(t.type==='home'){c.fillStyle='#8fd4c2';c.fillRect(mx(t.x)-3,mz(t.z)-3,6,6);continue}if(t.type!=='generator'&&t.type!=='beacon'&&t.type!=='vault')continue;c.fillStyle=t.used?'#4f6b60':'#f0be71';c.beginPath();c.moveTo(mx(t.x),mz(t.z)-3);c.lineTo(mx(t.x)+3,mz(t.z));c.lineTo(mx(t.x),mz(t.z)+3);c.lineTo(mx(t.x)-3,mz(t.z));c.closePath();c.fill()}
 c.fillStyle='#a8d47a';for(const d of destructibles)if(!d.dead){c.beginPath();c.arc(mx(d.x),mz(d.z),3,0,Math.PI*2);c.fill()}
 c.fillStyle='#e87f68';for(const e of anomalies)if(!e.dead){c.beginPath();c.arc(mx(e.x),mz(e.z),e.def.boss?5:3,0,Math.PI*2);c.fill()}
 c.fillStyle='#e4ece5';c.beginPath();c.arc(mx(p.x),mz(p.z),3.5,0,Math.PI*2);c.fill();c.strokeStyle='#e4ece5';c.beginPath();c.moveTo(mx(p.x),mz(p.z));c.lineTo(mx(p.x)-Math.sin(p.yaw)*11,mz(p.z)-Math.cos(p.yaw)*11);c.stroke();
 c.font='12px sans-serif';c.fillStyle='#94b6ae';c.fillText('N ↑',292,15);c.fillText(currentZone.sub,8,15);
}
function frame(){
 const now=performance.now(),dt=Math.min((now-lastTime)/1000,.05);lastTime=now;requestAnimationFrame(frame);frameCount++;
 if(!overlay){elapsed+=dt;
  if(state==='explore'){updatePhenomenon(dt);updatePlayer(dt);if(state==='explore')updateAnomalies(dt);updateFx(dt);updatePatches(dt)}else{updatePlayer(dt);updateFx(dt)}
  handsMixer?.update(dt);if(handBusy>0){handBusy-=dt;if(handBusy<=0)handClip('FP_Idle',true)}
  fireCooldown=Math.max(0,fireCooldown-dt);
  if(reloadTime>0){reloadTime-=dt;if(reloadTime<=0){reloadTime=0;const n=Math.min(gun.capacity-ammo,reserve);ammo+=n;reserve-=n;log('reload_complete',{ammo,reserve})}}
  if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)$('toast').classList.add('hidden')}
  muzzleTime=Math.max(0,muzzleTime-dt);if(muzzle)muzzle.visible=muzzleTime>0;flash=Math.max(0,flash-dt);$('damageVignette').style.opacity=Math.min(flash*2,.8);
  const probeVisible=handsAction===handsActions.FP_ToolUse||handsAction===handsActions.FP_Modify;viewHands.traverse(o=>{if(o.isMesh&&/^Repair[ _]probe/.test(o.name))o.visible=probeVisible});
  if(windowDust)windowDust.rotation.y+=dt*(pheno&&pheno.phase==='storm'?.25:.03);
 }
 camera.position.set(p.x,eyeHeight+(keys.has('KeyW')&&!overlay?Math.sin(elapsed*9)*.018:0),p.z);camera.rotation.set(p.pitch,p.yaw,0,'YXZ');
 viewHands.visible=state!=='start';refreshHUD();renderer.render(scene,camera);
 if(overlay==='workshop'&&previewMixer){previewMixer.update(dt);previewRenderer.render(previewScene,previewCamera);previewRenderedFrames++}
}
(async function boot(){
try{
 renderer=new THREE.WebGLRenderer({canvas:$('world'),antialias:true,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;
 scene=new THREE.Scene();scene.background=new THREE.Color('#26373a');scene.fog=new THREE.Fog('#26373a',18,100);
 camera=new THREE.PerspectiveCamera(72,innerWidth/innerHeight,.04,180);scene.add(camera);
 scene.add(new THREE.HemisphereLight(0xc4e0d5,0x25343c,2.1));const sun=new THREE.DirectionalLight(0xf9d4a1,2.4);sun.position.set(-20,35,-15);scene.add(sun);
 let i=0;for(const key of required){models[key]=await loadEmbeddedGLB(window.__ASSETS__,key);$('loading').textContent=`3D 자산 준비 ${++i}/${required.length}`}
 const cover=window.__ASSETS__.cover;if(cover)$('start').style.setProperty('--cover',`url(data:${cover.mime};base64,${cover.base64})`);
 viewHands=cloneSkinned(models.hands.scene);camera.add(viewHands);viewHands.position.set(-.02,-.25,-.85);viewHands.scale.setScalar(.65);
 viewHands.traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.material.depthTest=false;o.material.depthWrite=false;o.renderOrder=40;o.frustumCulled=false}});
 handsMixer=new THREE.AnimationMixer(viewHands);for(const clip of models.hands.animations)handsActions[clip.name]=handsMixer.clipAction(clip);handClip('FP_Idle',true);
 setupPreview();resetCampaign();state='start';showPanel('start');
 muzzle=new THREE.Mesh(new THREE.SphereGeometry(.035,6,4),new THREE.MeshBasicMaterial({color:0xffd59a,depthTest:false}));muzzle.position.set(.16,-.22,-.92);muzzle.renderOrder=42;muzzle.visible=false;camera.add(muzzle);
 const particles=new Float32Array(300*3);for(let k=0;k<300;k++){particles[k*3]=(Math.random()-.5)*100;particles[k*3+1]=Math.random()*14+1;particles[k*3+2]=(Math.random()-.5)*36}const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.BufferAttribute(particles,3));windowDust=new THREE.Points(geom,new THREE.PointsMaterial({size:.07,color:0xb4b6a0,transparent:true,opacity:.20}));scene.add(windowDust);
 $('loading').classList.add('hidden');$('startButton').disabled=false;$('startButton').textContent='차고에서 시작한다';
}catch(error){fail(error);return}
requestAnimationFrame(frame);
$('startButton').onclick=()=>{try{audio=new (window.AudioContext||window.webkitAudioContext)();audio.resume()}catch{}closePanels();$('hud').classList.remove('hidden');state='base';toast('차고에 도착했습니다 · 경로 지도에서 첫 존을 선택하세요',5);workshop();log('game_started')};
$('departButton').onclick=routeMap;$('workshopButton').onclick=workshop;$('resumeBaseButton').onclick=()=>closePanels();$('closeWorkshop').onclick=()=>closePanels();$('closeRouteMap').onclick=()=>closePanels();$('zoneDepart').onclick=()=>departZone(selectedZone);
$('applyUpgrade').onclick=applyUpgrade;for(const b of document.querySelectorAll('[data-upgrade]'))b.onclick=()=>{selectedUpgrade=b.dataset.upgrade;const r=RECIPES[selectedUpgrade];$('upgradePreview').innerHTML=`<b>${r.name} 예상</b><br>${r.effect}<br>소모 예정: ${describe(r.cost)}<br><span class="small">현재 재료는 아직 소모하지 않았습니다.</span>`;log('upgrade_preview',{key:selectedUpgrade,bank:{...bank}});updateWorkshop()};
$('resumeButton').onclick=()=>closePanels();$('restartButton').onclick=()=>{resetCampaign();closePanels();workshop();log('restart_clicked')};$('closeBag').onclick=()=>closePanels();$('catalogButton').onclick=()=>{previousOverlay=overlay;showPanel('catalog')};$('closeCatalog').onclick=()=>showPanel(previousOverlay||'start');
document.addEventListener('keydown',e=>{if(['Space','Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','AltLeft'].includes(e.code))e.preventDefault();if(e.repeat){keys.add(e.code);return}if(e.code==='Escape'&&state!=='start'){overlay?closePanels():showPanel('pause');return}if(e.code==='Tab'&&!['start','workshop','debrief','routemap'].includes(overlay)){if(overlay==='bagPanel')closePanels();else{$('bagContents').innerHTML=describe(bag);$('storedContents').innerHTML=describe(bank);showPanel('bagPanel')}return}keys.add(e.code);if(e.code==='KeyR')reload();if(e.code==='KeyQ')medkit()});document.addEventListener('keyup',e=>keys.delete(e.code));
$('world').addEventListener('mousedown',e=>{if(overlay)return;if(e.button===0){firing=true;shoot()}if(e.button===2)drag=true});document.addEventListener('mouseup',()=>{firing=false;drag=false});document.addEventListener('mousemove',e=>{if(overlay)return;if(document.pointerLockElement===renderer.domElement||drag){p.yaw-=e.movementX*.003;p.pitch=clamp(p.pitch-e.movementY*.002,-.9,.65)}});$('world').addEventListener('dblclick',()=>{if(!overlay)renderer.domElement.requestPointerLock?.()});$('world').addEventListener('contextmenu',e=>e.preventDefault());window.addEventListener('blur',()=>{keys.clear();firing=false;drag=false});window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()});
window.__deadZoneQA={getSnapshot:()=>JSON.parse(JSON.stringify({ready:true,protocol:location.protocol,state,overlay,selectedZone,zone:currentZone?currentZone.id:null,cleared,unlocked:Object.keys(ZONES).filter(isUnlocked),position:p,bag,bank,pending,objective:objective?{...objective}:null,gun,upgrades,ammo,reserve,missionTimer,normalReturns,forcedReturns,anomalies:anomalies.map(({id,kind,x,z,hp,maxHP,mode,dead})=>({id,kind,x,z,hp,maxHP,mode,dead})),destructibles:destructibles.map(({id,kind,x,z,hp,dead})=>({id,kind,x,z,hp,dead})),loot:loot.filter(x=>!x.taken).map(({id,x,z,items})=>({id,x,z,items})),targets:targets.map(({id,type,x,z,used})=>({id,type,x,z,used:!!used})),solids:solids.length,events,playedClips:[...playedClips],requiredModels:required,frameCount,previewRenderedFrames})),clearRun:()=>{if(state!=='explore'||!objective)return false;objective.done=objective.count;pending.clear=true;result(true);return true},failRun:()=>{if(state!=='explore')return false;result(false,'QA 강제 복귀');return true},teleport:(x,z,yaw=0)=>{p.x=x;p.z=z;p.yaw=yaw;p.pitch=-.035;camera.position.set(x,eyeHeight,z);camera.rotation.set(p.pitch,p.yaw,0,'YXZ');camera.updateMatrixWorld(true);return true},interactNearest:()=>{const t=findTarget();if(!t)return null;interact(t);return t.type},setPhenoTime:t=>{if(pheno)pheno.t=t;return true},step:(n=1,dt=.05)=>{for(let i=0;i<n;i++){if(!overlay){if(state==='explore'){updatePhenomenon(dt);updatePlayer(dt);updateAnomalies(dt);updateFx(dt);updatePatches(dt)}else updatePlayer(dt);fireCooldown=Math.max(0,fireCooldown-dt);if(reloadTime>0){reloadTime-=dt;if(reloadTime<=0){reloadTime=0;const c=Math.min(gun.capacity-ammo,reserve);ammo+=c;reserve-=c}}}}return true},ruleCases:(caseName)=>{if(caseName==='zones')return Object.fromEntries(Object.entries(ZONES).map(([k,v])=>[k,{name:v.name,phenomenon:v.phenomenon.key,objective:v.objective.kind,count:v.objective.count}]));if(caseName==='costs')return Object.fromEntries(Object.entries(RECIPES).map(([k,v])=>[k,{cost:v.cost,effect:v.effect}]));return {failureLoss:'all expedition bag',bankKept:true,equipmentKept:true,exposureLimit:100,firstClearUnlocks:['z2','z3'],perZoneTimeLimit:true}}};
})();
})();
