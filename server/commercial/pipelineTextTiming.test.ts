import {it,expect}from'vitest';import{trimSilentEnds}from'./pipelineTextTiming';
it('trims hallucinated subtitle tails to confirmed silence without stretching words',()=>{
 const cues:any=[{id:'a',startMs:168100,endMs:174900,es:'texto',en:'text'}];
 expect(trimSilentEnds(cues,[{startMs:170800,endMs:180000}])[0].endMs).toBe(170800);
 expect(cues[0].endMs).toBe(174900);
 expect(()=>trimSilentEnds([{...cues[0],startMs:171000}],[{startMs:170800,endMs:180000}])).toThrow();
});
