import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ElectrodeMap, LinkCard, SessionDiagram, SoundPairCard, resources, soundPairs } from './Guides';

describe('Guides', () => {
  it('labels sound pairs as planned packs rather than diagnoses', () => {
    const html = soundPairs.map((pair) => renderToStaticMarkup(<SoundPairCard pair={pair} onSelect={() => undefined} />)).join('');
    expect(html).toContain('ship');
    expect(html).toContain('/r/ vs /l/');
    expect((html.match(/Planned Pack/g) ?? []).length).toBe(soundPairs.length);
  });

  it('links resources to NeuroPawn docs in a new tab', () => {
    for (const resource of resources) {
      const html = renderToStaticMarkup(<LinkCard {...resource} />);
      expect(html).toContain('href="https://docs.neuropawn.tech/');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noreferrer"');
    }
  });

  it('draws timing windows from settings without inventing a waveform', () => {
    const html = renderToStaticMarkup(<SessionDiagram baselineMs={-200} windowMs={[250, 450]} epochEndMs={800} />);
    expect(html).toContain('P300 window of 250 to 450 ms');
    expect(html).toContain('Illustrative sequence');
    expect(html).not.toContain('<path');
    expect(html).not.toContain('erp-mean');
  });

  it('marks the midline electrode sites', () => {
    const html = renderToStaticMarkup(<ElectrodeMap />);
    for (const site of ['Fz', 'Cz', 'Pz']) expect(html).toContain(`>${site}<`);
  });
});
