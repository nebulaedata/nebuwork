import { expect, it, vi } from 'vitest';
import { loadGalleryMedia } from './mediaQueue.js';

it('bounds thumbnail reads and discards requests aborted while queued',async()=>{
  let active=0,maximum=0;const release=[];const work=vi.fn(()=>new Promise(resolve=>{maximum=Math.max(maximum,++active);release.push(()=>{active--;resolve('ok');});}));
  const aborts=Array.from({length:12},()=>new AbortController());const results=aborts.map(a=>loadGalleryMedia(work,a.signal).catch(e=>e.name));
  await Promise.resolve();expect(work).toHaveBeenCalledTimes(4);aborts.slice(4).forEach(a=>a.abort());release.splice(0).forEach(fn=>fn());
  expect(await Promise.all(results)).toEqual(['ok','ok','ok','ok',...Array(8).fill('AbortError')]);expect(maximum).toBe(4);
});
