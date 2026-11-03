'use strict';
(() => {
  const units = {'motion-speed':' mm/s','delay-ms':' ms','bias-mm':' mm','noise-px':' px','target-x':' mm','target-y':' mm'};
  function labels(){for(const [id,unit] of Object.entries(units)){const el=document.getElementById(id),out=document.getElementById(id+'-value');if(el&&out)out.textContent=Number(el.value)+unit;}}
  document.querySelectorAll('input[type="range"]').forEach(el=>el.addEventListener('input',labels));
  document.getElementById('preset').addEventListener('change',()=>setTimeout(labels,0));
  document.getElementById('preset').addEventListener('scene:preset',labels);
  window.addEventListener('sim-control-update',labels);
  const status=document.getElementById('load-status');
  const statusStyle=()=>status.classList.toggle('ready',status.textContent.startsWith('3D scene ready'));
  new MutationObserver(statusStyle).observe(status,{childList:true,subtree:true,characterData:true});
  statusStyle();
  labels();
})();
