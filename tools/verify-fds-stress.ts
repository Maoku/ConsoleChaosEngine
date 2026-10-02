import { RenderingAudioContext } from 'web-audio-engine';
import { writeFileSync } from 'node:fs';
import { createGenerationAudioService, HARDWARE_GENERATION_PROFILES, type GenerationId } from '../packages/engine/src/index';
import { JOURNEY_SCORES } from '../apps/console-chaos/src/audio/journey';
import { arrangeFor } from '../apps/console-chaos/src/audio/music';
function capture(rate: number) {
  const ctx = new RenderingAudioContext({sampleRate:rate,numberOfChannels:1,blockSize:128});
  const service = createGenerationAudioService(ctx,JOURNEY_SCORES[0]!);
  service.setGenerationProfile(HARDWARE_GENERATION_PROFILES.FC);
  service.setGen1Expansion!(true);service.setMix!(1,1,false);service.setVolume(1);
  service.playScore(arrangeFor(HARDWARE_GENERATION_PROFILES.FC,JOURNEY_SCORES[0]!));
  for(let step=0;step<1200;step++) {
    const t=step*0.025;
    if(step%80===0) {
      const gen:GenerationId=step%160===0?'FC':'SFC';
      service.setGenerationProfile(HARDWARE_GENERATION_PROFILES[gen]);
      service.useScore(arrangeFor(HARDWARE_GENERATION_PROFILES[gen],JOURNEY_SCORES[0]!));
      service.setGen1Expansion!(step%240!==0);
    }
    if(step%4===0)service.playOneShot({role:'fx',frequency:220+step%440,velocity:1,when:ctx.currentTime+0.01,durationSeconds:0.08});
    if(step===400)service.setMix!(0,1,false);
    if(step===480)service.setMix!(1,0,false);
    if(step===560)service.setMix!(1,1,true);
    if(step===640)service.setMix!(1,1,false);
    if(step===800)service.setPaused!(true);
    if(step===880)service.setPaused!(false);
    service.update();ctx.processTo(t+0.025);
  }
  const data:Float32Array=ctx.exportAsAudioData().channelData[0];
  let peak=0,hash=0x811c9dc5,mutePeak=0;
  for(let i=0;i<data.length;i++) {
    const x=data[i]!;if(!Number.isFinite(x))throw Error('nonfinite');
    peak=Math.max(peak,Math.abs(x));hash=Math.imul(hash^Math.round(x*32767),16777619);
    if(i/rate>14.5&&i/rate<15.5)mutePeak=Math.max(mutePeak,Math.abs(x));
  }
  if(peak>=1 || mutePeak>0.00001)throw Error(`Invalid mix: ${peak} ${mutePeak}`);
  return {rate,seconds:data.length/rate,peak,mutePeak,hash:hash>>>0};
}
const results=[44100,48000].map(rate=>{const a=capture(rate),b=capture(rate);if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Nondeterministic');return {...a,deterministic:true};});
console.log(results);if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(results,null,2));
