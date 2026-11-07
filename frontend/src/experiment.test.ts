import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {api,type Session} from './client';
import {runExperiment} from './experiment';
import type {PreparedAudioAsset} from './audio';

const events=new EventTarget();
function context(){return {state:'running',get currentTime(){return performance.now()/1000},getOutputTimestamp:()=>({contextTime:performance.now()/1000,performanceTime:performance.now()}),destination:{},
  addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),
  createBufferSource:()=>({buffer:null,connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn()})} as unknown as AudioContext}
const asset=(id:string)=>({id,buffer:{duration:.1},kind:'synthetic-demo',displayName:id}) as PreparedAudioAsset;
const session={id:'session',trial_plan:[{trial_index:0,condition:'standard'},{trial_index:1,condition:'deviant'}],request:{interval_s:1.5,analysis:{epoch_end_ms:800}}} as Session;
beforeEach(()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});
  const doc=new EventTarget();vi.stubGlobal('document',{hidden:false,addEventListener:doc.addEventListener.bind(doc),removeEventListener:doc.removeEventListener.bind(doc)});
  vi.spyOn(api,'clock').mockImplementation(async()=>1000+performance.now()/1000);
  vi.spyOn(api,'marker').mockResolvedValue({});vi.spyOn(api,'stop').mockResolvedValue({status:'completed'} as Session);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers()});
describe('connected experiment runner',()=>{
  it('schedules ordered markers within the server horizon and retains the final tail',async()=>{
    const horizons:number[]=[];vi.mocked(api.marker).mockImplementation(async(_id,event)=>{horizons.push((event as {onset_timestamp:number}).onset_timestamp-(1000+performance.now()/1000));return {}});
    const progress=vi.fn();const marker=vi.fn();
    const promise=runExperiment({session,context:context(),standard:asset('a'),deviant:asset('b'),signal:new AbortController().signal,onProgress:progress,onMarker:marker});
    await vi.runAllTimersAsync();await promise;
    expect(horizons).toEqual([.75,.75]);expect(progress.mock.calls).toEqual([[1],[2]]);expect(marker).toHaveBeenCalledTimes(2);
    expect(performance.now()).toBeGreaterThanOrEqual(4200);
    expect(api.stop).toHaveBeenCalledWith('session');
    expect(vi.mocked(api.marker).mock.calls[0][1]).toMatchObject({trial_index:0,timing_method:'browser_estimate',timing_uncertainty_ms:null});
  });
  it('marks failed audio/marker delivery as interrupted and cancels its trial',async()=>{
    vi.mocked(api.marker).mockRejectedValue(new Error('Marker unavailable'));
    const promise=runExperiment({session,context:context(),standard:asset('a'),deviant:asset('b'),signal:new AbortController().signal,onProgress:vi.fn()});
    const caught=expect(promise).rejects.toThrow('Marker unavailable');await vi.runAllTimersAsync();await caught;
    expect(api.stop).toHaveBeenCalledWith('session',expect.objectContaining({interrupted:true,canceled_trial_indices:[0]}));
  });
});
