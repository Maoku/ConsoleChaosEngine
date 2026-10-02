/** npm exec tsx tools/render-fds-preview.ts [output-directory] [racing-score-path] */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RenderingAudioContext } from 'web-audio-engine';
import { createGenerationAudioService, HARDWARE_GENERATION_PROFILES, scoreLengthTicks, secondsPerTick, type Score } from '../packages/engine/src/index';
import { JOURNEY_SCORES } from '../apps/console-chaos/src/audio/journey';
import { arrangeFor } from '../apps/console-chaos/src/audio/music';
const output = resolve(process.argv[2] ?? 'artifacts/fds-preview');
mkdirSync(output,{recursive:true});
const scores: Array<[string,Score]> = JOURNEY_SCORES.map((s,i)=>[`puzzle-stage${i+1}`,arrangeFor(HARDWARE_GENERATION_PROFILES.FC,s)]);
if(process.argv[3]) { const race=await import(pathToFileURL(resolve(process.argv[3])).href); scores.push(['racing',race.arrangementFor('FC')]); }
const report=[];
for(const [name,score] of scores) for(const fds of [false,true]) {
  const rate=48000;
  const ctx=new RenderingAudioContext({sampleRate:rate,numberOfChannels:1,blockSize:128});
  const service=createGenerationAudioService(ctx,score);
  service.setGenerationProfile(HARDWARE_GENERATION_PROFILES.FC);
  service.setGen1Expansion!(fds);
  service.setMix!(1,1,false);
  service.setVolume(1);
  service.playScore(score);
  const duration=scoreLengthTicks(score)*secondsPerTick(score)+2;
  for(let t=0;t<duration;t+=0.025) { service.update(); ctx.processTo(t+0.025); }
  const data:Float32Array=ctx.exportAsAudioData().channelData[0];
  let peak=0,sum=0,delta=0;
  for(let i=0;i<data.length;i++) {const x=data[i]!;if(!Number.isFinite(x)) throw Error('Nonfinite PCM');peak=Math.max(peak,Math.abs(x));sum+=x*x;if(i)delta=Math.max(delta,Math.abs(x-data[i-1]!));}
  if(peak>=1) throw Error(`Clipping: ${name}: ${peak}`);
  const wav=Buffer.alloc(44+data.length*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(data.length*2,40);
  for(let i=0;i<data.length;i++)wav.writeInt16LE(Math.round(data[i]!*32767),44+i*2);
  const file=`${name}-${fds?'fds':'apu'}.wav`;writeFileSync(resolve(output,file),wav);
  report.push({file,seconds:data.length/rate,peak,rms:Math.sqrt(sum/data.length),maxSampleDelta:delta});
  console.log(report.at(-1));
}
writeFileSync(resolve(output,'pcm-report.json'),JSON.stringify(report,null,2));
