import {API_BASE_URL, fetchJson} from './api';
import type {EEGSample, ERPData, ERPPoint} from './Charts';

export type Source = 'hardware' | 'simulation';
export interface Student {id:string; name:string; target_language:string; native_language:string}
export interface Device {active_session_id?:string|null;source:Source|null; connected:boolean; error:string|null; sampling_rate:number|null; channel_labels:string[]; electrode_reference:string; last_sample_timestamp:number|null; signal_quality:string}
export interface AnalysisConfig {channel_indices:number[]|null; epoch_start_ms:number; epoch_end_ms:number; baseline_start_ms:number; baseline_end_ms:number; p300_start_ms:number; p300_end_ms:number; min_trials_per_condition?:number}
export interface Metric {channel_index:number; electrode:string; condition:string; window_mean_uv:number|null; mean_ci95_half_width_uv:number|null; peak_amplitude_uv:number|null; peak_latency_ms:number|null}
export interface Analysis {source:Source; channel_labels:string[]; time_ms:number[]; finalized:boolean; quality:string; config:AnalysisConfig; counts:{accepted:{standard:number;deviant:number};rejected:number;pending:number;presented:number}; waveforms:Record<string,{mean_uv:number[][];ci95_half_width_uv:number[][]|null}|null>; metrics:Metric[]; warnings:string[]; trial_quality:{trial_index:number;condition:string;status:string;reasons:string[]}[]}
export interface Trial {trial_index:number;condition:'standard'|'deviant'}
export interface Session {id:string; student_id:string; source:Source; status:'recording'|'completed'|'interrupted'; started_at:number; ended_at:number|null; channel_labels:string[]; warnings:string[]; request:{trials:number;interval_s:number;sound_pair_id:string;analysis:AnalysisConfig}; trial_plan:Trial[]; events:{trial_index:number;onset_timestamp:number;condition:string;canceled?:boolean}[]; analysis:Analysis|null}
export interface EEGMessage {type:'eeg';sequence:number;source:Source;sampling_rate:number;channel_labels:string[];timestamps:number[];samples:number[][];units:'microvolts'}
export interface Comparison {compatible:boolean;warnings:string[];sessions:{id:string;source:Source;quality:string;metrics:Metric[];counts:Analysis['counts']}[]}

export async function request<T>(path:string, body?:unknown, signal?:AbortSignal):Promise<T> {
  return fetchJson<T>(path, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}, {signal:signal ?? AbortSignal.timeout(40000)});
}
export const api = {
  device:()=>request<Device>('/api/device'),
  connect:(body:unknown)=>request<Device>('/api/device/connect',body),
  disconnect:()=>request<Device>('/api/device/disconnect',{}),
  students:()=>request<Student[]>('/api/students'),
  student:(name:string)=>request<Student>('/api/students',{name}),
  sessions:()=>request<Session[]>('/api/sessions'),
  session:(id:string)=>request<Session>(`/api/sessions/${id}`),
  start:(body:unknown)=>request<Session>('/api/sessions',body),
  analysis:(id:string)=>request<Analysis>(`/api/sessions/${id}/analysis`),
  marker:(id:string,body:unknown,signal?:AbortSignal)=>request(`/api/sessions/${id}/events`,body,signal),
  stop:(id:string,body:unknown={})=>request<Session>(`/api/sessions/${id}/stop`,body),
  clock:async(signal:AbortSignal)=>(await request<{server_timestamp:number}>('/api/clock',undefined,signal)).server_timestamp,
  compare:(ids:string[])=>request<Comparison>('/api/compare?'+new URLSearchParams(ids.map(id=>['session_ids',id]))),
};
export function websocketUrl():string {const url=new URL('/ws/eeg',API_BASE_URL);url.protocol=url.protocol==='https:'?'wss:':'ws:';return url.toString()}
export function downloadUrl(id:string,format:'export.csv'|'recording.npz'):string {return new URL(`/api/sessions/${id}/${format}`,API_BASE_URL).toString()}

export function eegSamples(batch:EEGMessage, origin:number):EEGSample[] {
  return batch.timestamps.map((t,i)=>({time_s:t-origin,channels:Object.fromEntries(batch.channel_labels.map((_,j)=>[`CH${j+1}`,batch.samples[i]?.[j] ?? null]))}));
}
export function erpData(result:Analysis|null,slot:number):ERPData|null {
  if(!result || !result.channel_labels[slot])return null;
  const points=(condition:string):ERPPoint[]=>result.time_ms.map((t,i)=>{
    const wave=result.waveforms[condition]; const mean=wave?.mean_uv[slot]?.[i] ?? null;const ci=wave?.ci95_half_width_uv?.[slot]?.[i];
    return {time_ms:t,mean_uv:mean,ci_low_uv:mean!==null&&ci!=null?mean-ci:null,ci_high_uv:mean!==null&&ci!=null?mean+ci:null};
  });
  const index=result.config.channel_indices?.[slot] ?? slot;
  const metric=result.metrics.find(m=>m.channel_index===index&&m.condition==='deviant');
  return {channel:result.channel_labels[slot],source:result.source,counts:{accepted:result.counts.accepted.standard+result.counts.accepted.deviant,rejected:result.counts.rejected,pending:result.counts.pending},standard:points('standard'),deviant:points('deviant'),difference:points('difference'),meanAmplitudeUv:metric?.window_mean_uv,peakAmplitudeUv:metric?.peak_amplitude_uv,peakLatencyMs:metric?.peak_latency_ms,provisional:!result.finalized};
}
