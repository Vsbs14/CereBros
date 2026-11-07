import {describe,it,expect} from 'vitest';
import {eegSamples,erpData,type Analysis,type EEGMessage} from './client';

describe('backend chart adapters',()=>{
  it('maps sample-major microvolts to stable physical channel IDs',()=>{
    const batch={timestamps:[100,100.008],samples:[[1,2],[3,4]],channel_labels:['Cz','Pz']} as EEGMessage;
    expect(eegSamples(batch,100)).toEqual([{time_s:0,channels:{CH1:1,CH2:2}},{time_s:expect.closeTo(.008),channels:{CH1:3,CH2:4}}]);
  });
  it('maps selected-channel ERP arrays and half-widths without inventing null metrics',()=>{
    const result={quality:'insufficient_data',warnings:[],trial_quality:[],channel_labels:['Pz'],source:'simulation',time_ms:[0,400],finalized:false,config:{channel_indices:[2],epoch_start_ms:-200,epoch_end_ms:800,baseline_start_ms:-200,baseline_end_ms:0,p300_start_ms:300,p300_end_ms:600},
      counts:{accepted:{standard:10,deviant:3},rejected:2,pending:1,presented:16},
      waveforms:{standard:null,deviant:{mean_uv:[[1,4]],ci95_half_width_uv:[[.5,1]]},difference:null},
      metrics:[{channel_index:2,electrode:'Pz',mean_ci95_half_width_uv:null,condition:'deviant',window_mean_uv:null,peak_amplitude_uv:null,peak_latency_ms:null}]} as Analysis;
    const data=erpData(result,0)!;
    expect(data.source).toBe('simulation');expect(data.provisional).toBe(true);
    expect(data.deviant[1]).toEqual({time_ms:400,mean_uv:4,ci_low_uv:3,ci_high_uv:5});
    expect(data.standard[0].mean_uv).toBeNull();expect(data.meanAmplitudeUv).toBeNull();
    expect(data.counts).toEqual({accepted:13,rejected:2,pending:1});
    expect(erpData(result,1)).toBeNull();
  });
});
