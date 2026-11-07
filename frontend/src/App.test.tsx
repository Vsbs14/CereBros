import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import App from './App';

const pages=['Home','How It Works','Dashboard','Sound Recognition','Live EEG','Students','Session History','Settings'] as const;

describe('unconnected workspace',()=>{
 it('opens on a single welcome panel that leads into setup',()=>{
  const html=renderToStaticMarkup(<App/>);
  for(const page of pages) expect(html).toContain(page);
  expect(html).toContain('Welcome to NeuroLingo');
  expect(html).toContain('Start Setup');
  expect(html).not.toContain('step-card');
  expect(html).toContain('EEG Not Connected');
  expect(html.match(/role="status"/g)).toHaveLength(1);
 });
 it('shows all core navigation and honest acquisition state on the dashboard',()=>{
  const html=renderToStaticMarkup(<App initialPage="Dashboard"/>);
  for(const step of ['Set Up a Session','Choose a Student','Connect a Source','Check the Signal','Start Listening']) expect(html).toContain(step);
  expect(html).toContain('Not Connected');
  expect(html).toContain('No Student Selected');
  expect(html).toContain('Physical output latency unknown');
  expect(html).toContain('No EEG Data Available');
  expect(html).toContain('No ERP Data Available');
  expect(html).not.toContain('brain recognition accuracy');
 });
 it('keeps continuous EEG and averaged ERP distinct on the explainer page',()=>{
  const html=renderToStaticMarkup(<App initialPage="How It Works"/>);
  expect(html).toContain('How a Session Works');
  expect(html).toContain('Planned Pack');
  expect(html).toContain('NeuroPawn Resources');
  expect(html).not.toContain('erp-mean');
 });
 it('offers a labelled light/dark theme toggle',()=>{
  const html=renderToStaticMarkup(<App/>);
  expect(html).toMatch(/aria-label="Switch to (Dark|Light) Mode"/);
 });
 it('never mentions ESL on any page',()=>{
  for(const page of pages) expect(renderToStaticMarkup(<App initialPage={page}/>)).not.toMatch(/\bESL\b/);
 });
 it('provides a keyboard skip link and scientific limitations',()=>{
  const html=renderToStaticMarkup(<App initialPage="Dashboard"/>);
  expect(html).toContain('href="#main"');
  expect(html).toContain('aria-label="Main navigation"');
  expect(html).toContain('not proof of learning');
 });
});
