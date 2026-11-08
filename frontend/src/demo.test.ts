import {describe, expect, it} from 'vitest';
import {SignalSim, demoOptions, detectWordOnsets, pairCurve, type WordResponse} from './demo';

describe('presentation mode',()=>{
 it('is off unless ?demo is in the URL',()=>{
  expect(demoOptions('').enabled).toBe(false);
  expect(demoOptions('?demo').enabled).toBe(true);
  expect(demoOptions('?demo&round=2&auto=1.5')).toEqual({enabled:true,round:2,autoSeconds:1.5,step:'pick'});
  expect(demoOptions('?demo&step=pair-result').step).toBe('pair-result');
  expect(demoOptions('?demo&step=nope').step).toBe('pick');
 });
 it('dips about 400 ms after an unfamiliar word and stays near baseline after a familiar one',()=>{
  const mean=(sim:SignalSim,from:number,to:number)=>{const v=sim.values.filter((_,i)=>sim.times[i]>=from&&sim.times[i]<to);return v.reduce((a,b)=>a+b,0)/v.length};
  const after=(response:WordResponse)=>{const sim=new SignalSim();sim.settle();sim.advance(20);sim.mark('word',response);sim.advance(21);return mean(sim,20.32,20.52)};
  expect(after('unknown')).toBeLessThan(-12);
  expect(Math.abs(after('known'))).toBeLessThan(8);
  expect(after('different')-after('same')).toBeGreaterThan(6);
 });
 it('separates the two pair words after practice',()=>{
  const gap=(phase:'before'|'after')=>{const a=pairCurve('Word A',phase),b=pairCurve('Word B',phase);return Math.max(...a.map(([ms],i)=>ms>=300&&ms<=500?Math.abs(b[i][1]-a[i][1]):0))};
  expect(gap('before')).toBeLessThan(3);
  expect(gap('after')).toBeGreaterThan(8);
 });
 it('finds word onsets in a recording from the pauses between words',()=>{
  const rate=8000,starts=[0.3,1.1,1.9,2.6,3.5,4.2],data=new Float32Array(rate*5);
  for(const start of starts)for(let i=0;i<rate*0.35;i++)data[Math.round(start*rate)+i]=0.5*Math.sin(i*0.3);
  detectWordOnsets(data,rate,6).forEach((onset,i)=>expect(Math.abs(onset-starts[i])).toBeLessThan(0.02));
 });
 it('spaces onsets evenly when words run together',()=>{
  const rate=8000,data=new Float32Array(rate*3).map((_,i)=>i>rate&&i<rate*2.2?0.4*Math.sin(i*0.3):0);
  const onsets=detectWordOnsets(data,rate,6);
  expect(onsets).toHaveLength(6);
  expect(onsets[0]).toBeCloseTo(1,1);
  expect(onsets[5]).toBeLessThan(2.2);
 });
});
