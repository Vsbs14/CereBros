import {api, type Session, type Trial} from './client';
import {scheduleOrderedPlan, syncBestClock, type PlaybackHandle, type PreparedAudioAsset} from './audio';

function sleep(ms:number,signal:AbortSignal):Promise<void> {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(signal.reason);return}
    const abort=()=>{clearTimeout(timer);reject(signal.reason)};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},Math.max(0,ms));
    signal.addEventListener('abort',abort,{once:true});
  });
}
export interface RunOptions {session:Session;context:AudioContext;standard:PreparedAudioAsset;deviant:PreparedAudioAsset;signal:AbortSignal;onProgress:(count:number)=>void;onMarker?:(trial:Trial,onset:number)=>void}
/** Schedule one trial at a time inside the server's two-second marker horizon. */
export async function runExperiment({session,context,standard,deviant,signal,onProgress,onMarker}:RunOptions):Promise<Session> {
  const trialLedger=new Set<string>(),markerLedger=new Set<string>();
  const assets=new Map([[standard.id,standard],[deviant.id,deviant]]);
  let playback:PlaybackHandle|undefined;
  let currentTrial:number|undefined;
  let pendingMarker:Promise<unknown>|undefined;
  const abortAudio=()=>playback?.abort();
  signal.addEventListener('abort',abortAudio,{once:true});
  try {
    let sync=await syncBestClock({fetchServerTime:api.clock,signal});
    const first=performance.now()/1000+sync.serverOffsetSeconds+1.2;
    for(const trial of session.trial_plan){
      currentTrial=trial.trial_index;
      if(performance.now()-sync.sampledAtPerformanceMs>30000)sync=await syncBestClock({fetchServerTime:api.clock,signal});
      const onset=first+trial.trial_index*session.request.interval_s;
      const now=()=>performance.now()/1000+sync.serverOffsetSeconds;
      await sleep((onset-now()-.75)*1000,signal);
      if(document.hidden||context.state!=='running')throw new Error('Audio or visible tab was lost');
      let audioError:Error|undefined;
      playback=scheduleOrderedPlan({context,sync,assets,trialLedger,markerLedger,
        plan:[{kind:'stimulus',id:String(trial.trial_index),markerId:String(trial.trial_index),atServerSeconds:onset,assetId:(trial.condition==='standard'?standard:deviant).id,durationSeconds:(trial.condition==='standard'?standard:deviant).buffer.duration}],
        sendMarker:marker=>{
          pendingMarker=api.marker(session.id,{trial_index:trial.trial_index,onset_timestamp:marker.scheduledServerSeconds,timing_method:'browser_estimate',timing_uncertainty_ms:null},signal);
          return pendingMarker.then(()=>{onMarker?.(trial,onset)});
        },
        onAbort:reason=>{audioError=new Error(`Playback stopped: ${reason}`)},
      });
      await pendingMarker;
      await sleep((onset+Math.max(standard.buffer.duration,deviant.buffer.duration)-now())*1000,signal);
      if(audioError||playback.aborted)throw audioError??new Error('Playback interrupted');
      playback.dispose();playback=undefined;
      onProgress(trial.trial_index+1);
      currentTrial=undefined;
    }
    const finalOnset=first+(session.trial_plan.length-1)*session.request.interval_s;
    await sleep((finalOnset+session.request.analysis.epoch_end_ms/1000+.7-(performance.now()/1000+sync.serverOffsetSeconds))*1000,signal);
    return await api.stop(session.id);
  }catch(error){
    playback?.abort();
    // Let an ambiguous in-flight marker settle before marking the session interrupted.
    await pendingMarker?.catch(()=>undefined);
    await api.stop(session.id,{interrupted:true,reason:String(error).slice(0,300),canceled_trial_indices:currentTrial===undefined?[]:[currentTrial]});
    throw error;
  }finally{
    signal.removeEventListener('abort',abortAudio);playback?.dispose();
  }
}
