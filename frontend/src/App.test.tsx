import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import App from './App';

describe('unconnected workspace',()=>{
 it('shows all core navigation and honest acquisition state',()=>{
  const html=renderToStaticMarkup(<App/>);
  for(const page of ['Dashboard','Sound Recognition','Live EEG','Students','Session History','Settings']) expect(html).toContain(page);
  expect(html).toContain('Not connected');
  expect(html).toContain('No student selected');
  expect(html).toContain('Physical output latency unknown');
  expect(html).toContain('No EEG data available');
  expect(html).not.toContain('brain recognition accuracy');
 });
 it('provides a keyboard skip link and scientific limitations',()=>{
  const html=renderToStaticMarkup(<App/>);
  expect(html).toContain('href="#main"');
  expect(html).toContain('aria-label="Main navigation"');
  expect(html).toContain('not proof of learning');
 });
});
