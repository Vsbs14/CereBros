import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import App from './App';

describe('unconnected workspace',()=>{
 it('opens on a single landing panel that leads into setup',()=>{
  const html=renderToStaticMarkup(<App/>);
  for(const page of ['Home','Overview','Listening Practice','Live EEG','Learners','Sessions','How It Works','Settings']) expect(html).toContain(page);
  expect(html).toContain('Welcome to NeuroLingo');
  expect(html).toContain('Start Setup');
  expect(html).not.toContain('step-card');
  expect(html).not.toContain('pair-card');
  expect(html).toContain('EEG Not Connected');
  expect(html.match(/role="status"/g)).toHaveLength(1);
  expect(html).not.toContain('brain recognition accuracy');
 });
 it('shows live status facts, both charts, and recent sessions on the overview',()=>{
  const html=renderToStaticMarkup(<App initialPage="Overview"/>);
  for(const step of ['Set Up a Session','Choose a Learner','Pick a Sound Pair','Fit the Headset','Start Listening']) expect(html).toContain(step);
  for(const label of ['Backend','Acquisition Source','P300 Window','Timing','Uncalibrated']) expect(html).toContain(label);
  expect(html).toContain('No EEG Data Available');
  expect(html).toContain('No ERP Data Available');
  expect(html).toContain('Session History Unavailable');
 });
 it('keeps continuous EEG and averaged ERP distinct on the explainer page',()=>{
  const html=renderToStaticMarkup(<App initialPage="How It Works"/>);
  expect(html).toContain('How a Session Works');
  expect(html).toContain('Planned Pack');
  expect(html).toContain('Continuous EEG');
  expect(html).toContain('Averaged ERP');
  expect(html).toContain('NeuroPawn Resources');
  expect(html).not.toContain('erp-mean');
 });
 it('provides a keyboard skip link and scientific limitations',()=>{
  const html=renderToStaticMarkup(<App/>);
  expect(html).toContain('href="#main"');
  expect(html).toContain('aria-label="Main navigation"');
  expect(html).toContain('not proof of learning');
  expect(html).toContain('Physical output latency unknown');
 });
});
