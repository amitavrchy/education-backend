import { imageFromDataUrl } from '../../src/integrations/ai-service/ai-service.client.js';

describe('AI service client', () => {
  it('turns image data URLs into AI image inputs and ignores anything else', () => {
    expect(imageFromDataUrl('data:image/png;base64,iVBORw0KGgo=')).toEqual({
      media_type: 'image/png',
      data: 'iVBORw0KGgo=',
    });
    expect(imageFromDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(imageFromDataUrl('https://example.com/x.png')).toBeNull();
  });
});
