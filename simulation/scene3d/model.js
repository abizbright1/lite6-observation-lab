/* Pure synthetic camera pipeline. Distances mm, times seconds, image units pixels.
 * A projected virtual feature is a simulator oracle, not an image detector.
 * The online inverse receives only pixel/nominal camera pose and known plane.
 */
export const IMAGE = Object.freeze({width: 640, height: 360, vfov: 55});
export const INTRINSICS = Object.freeze({
  fx: IMAGE.height/(2*Math.tan(IMAGE.vfov*Math.PI/360)),
  fy: IMAGE.height/(2*Math.tan(IMAGE.vfov*Math.PI/360)),
  cx: IMAGE.width/2, cy: IMAGE.height/2,
});
export const add = (a,b) => a.map((x,i)=>x+b[i]);
export const sub = (a,b) => a.map((x,i)=>x-b[i]);
export const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0);
export function project(point, pose, intrinsics=INTRINSICS) {
  const delta=sub(point,pose.position), depth=-dot(delta,pose.back);
  if (!(depth>0)) return {visible:false,u:null,v:null,depth};
  const u=intrinsics.cx+intrinsics.fx*dot(delta,pose.right)/depth;
  const v=intrinsics.cy-intrinsics.fy*dot(delta,pose.up)/depth;
  return {visible:u>=0&&u<IMAGE.width&&v>=0&&v<IMAGE.height,u,v,depth};
}
export function intersectPixelPlane(pixel,pose,planeZ,intrinsics=INTRINSICS) {
  if (!pixel||!Number.isFinite(pixel.u)||!Number.isFinite(pixel.v))return null;
  const x=(pixel.u-intrinsics.cx)/intrinsics.fx,y=(intrinsics.cy-pixel.v)/intrinsics.fy;
  const dir=pose.right.map((v,i)=>x*v+y*pose.up[i]-pose.back[i]);
  if(Math.abs(dir[2])<1e-10)return null;
  const distance=(planeZ-pose.position[2])/dir[2];
  if(!(distance>0))return null;
  return add(pose.position,dir.map(x=>x*distance));
}
export function featureNoise(sequence,seed=17) {
  const noise=axis=>{let x=((sequence+1)*1664525+(seed+axis*101)*1013904223)>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;return ((x>>>0)/4294967295)*2-1;};
  return [noise(0),noise(1)];
}
export function selectDelivered(frames,time,delay) {
  for(let i=frames.length-1;i>=0;i--)if(frames[i].exposure_s+delay<=time+1e-8)return frames[i];
  return null;
}
export function pointDecision(estimate,tool,tolerance=3) {
  if(!estimate||!tool||!estimate.every(Number.isFinite)||!tool.every(Number.isFinite))return {approved:false,reason:'No usable observed feature',predicted_error_xy_mm:null};
  const error=[estimate[0]-tool[0],estimate[1]-tool[1]];
  return {approved:error.every(x=>Math.abs(x)<=tolerance),reason:error.every(x=>Math.abs(x)<=tolerance)?'Point alignment test passes':'Point alignment test fails',predicted_error_xy_mm:error};
}
export function createRecord(frame,time,estimate,tool,decision,evaluatorTarget) {
  return {
    observation:{sequence_id:frame?.sequence??null,exposure_reported_s:frame?.exposure_s??null,host_receipt_s:frame?.receipt_s??null,decision_s:time,pixel_u:frame?.feature?.u??null,pixel_v:frame?.feature?.v??null,feature_available:!!frame?.feature?.visible,camera_pose_used:'current nominal pose',known_plane_z_mm:30.5},
    decision:{...decision,estimated_target_mm:estimate,proposed_tool_mm:tool.slice(),synthetic_only:true},
    evaluator_only:{actual_target_mm:evaluatorTarget.slice(),true_error_xy_mm:[evaluatorTarget[0]-tool[0],evaluatorTarget[1]-tool[1]],false_approval:decision.approved&&[evaluatorTarget[0]-tool[0],evaluatorTarget[1]-tool[1]].some(x=>Math.abs(x)>3)},
  };
}
