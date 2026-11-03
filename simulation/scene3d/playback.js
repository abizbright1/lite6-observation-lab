/* Run a fixed logical clock only while explicitly playing in a visible tab. */
export function createPlaybackScheduler(step,{onError=()=>{},interval=globalThis.setInterval.bind(globalThis),cancel=globalThis.clearInterval.bind(globalThis)}={}) {
  let timer=null;
  function stop(){if(timer!==null){cancel(timer);timer=null;}}
  function sync(playing,visible=true){
    if(!playing||!visible){stop();return;}
    if(timer!==null)return;
    timer=interval(()=>{try{step(1/30);}catch(error){stop();onError(error);}},1000/30);
  }
  return {sync,stop,get active(){return timer!==null;}};
}
