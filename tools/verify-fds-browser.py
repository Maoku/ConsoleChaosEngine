import json
from pathlib import Path
from playwright.sync_api import sync_playwright
import sys
out=Path(sys.argv[1] if len(sys.argv)>1 else 'artifacts/fds-preview'); out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=document-user-activation-required'])
 results=[]
 for name,port,key,api in [('puzzle',5173,'chaos.audio.v1','window.__consoleChaos'),('racing',5174,'chaos.racing.audio.v1','window.racing')]:
  page=b.new_page(viewport={'width':1280,'height':850});errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script('''window.__liveVoices=0; for(const cls of [OscillatorNode,AudioBufferSourceNode]) {const start=cls.prototype.start;cls.prototype.start=function(...args){window.__liveVoices++;this.addEventListener('ended',()=>window.__liveVoices--,{once:true});return start.apply(this,args);};} window.__contexts=[]; const Original=window.AudioContext; window.AudioContext=class extends Original { constructor(...a) {super(...a);window.__contexts.push(this);this.suspend();} };''')
  page.goto(f'http://127.0.0.1:{port}/');page.wait_for_function(f'{api}?.host');
  before=page.evaluate('window.__contexts.map(c=>c.state)')
  assert before==['suspended'], before
  page.get_by_text('音声設定',exact=True).click()
  page.get_by_label('第1世代の音源').select_option('fds')
  page.get_by_label('BGM音量').fill('0.37')
  page.get_by_label('効果音音量').fill('0.61')
  page.get_by_text('全音声ミュート',exact=False).click()
  assert page.evaluate(f'JSON.parse(localStorage.getItem("{key}")).silent')
  page.get_by_text('全音声ミュート',exact=False).click()
  for i in range(12):
   page.get_by_label('第1世代の音源').select_option('apu' if i%2 else 'fds')
   page.evaluate(f"{api}.host.context.generation.request('{['FC','SFC','PS1','PS2'][i%4]}')")
   page.wait_for_timeout(300)
  page.get_by_label('第1世代の音源').select_option('fds')
  checks=page.evaluate(f"""() => {{const a={api}.host.context.audio;const gen={api}.host.context.generation;
    for(let i=0;i<8;i++)gen.advance(1000); gen.request('FC'); for(let i=0;i<8;i++)gen.advance(1000);
    const fc=a.currentSourceKey;gen.request('SFC'); for(let i=0;i<8;i++)gen.advance(1000);
    const sfc=a.currentSourceKey;const tick=a.engine.clock.tickAt(a.currentTime);
    a.setPaused(true,'test');const stopped=!a.engine.clock.playing;a.setPaused(false,'test');
    return {{fc,sfc,stopped,resumed:a.engine.clock.playing,tick}};}}""")
  assert checks['fc']=='psg-fds' and checks['sfc']=='brr' and checks['stopped'] and checks['resumed'], checks
  page.screenshot(path=str(out/f'{name}-audio-settings.png'))
  page.evaluate(f"{api}.host.context.audio.setPaused(true,'leak-check')")
  page.wait_for_timeout(400)
  remaining=page.evaluate('window.__liveVoices')
  assert remaining==0, remaining
  page.evaluate(f"{api}.host.context.audio.setPaused(false,'leak-check')")
  saved=page.evaluate(f'JSON.parse(localStorage.getItem("{key}"))')
  page.reload();page.wait_for_function(f'{api}?.host');page.get_by_text('音声設定',exact=True).click()
  assert page.get_by_label('第1世代の音源').input_value()=='fds'
  assert page.get_by_label('BGM音量').input_value()=='0.37'
  page.get_by_label('第1世代の音源').select_option('fds')
  after=page.evaluate('window.__contexts.map(c=>c.state)')
  assert 'running' in after
  if name=='racing':
   page.locator('summary').click();page.keyboard.press('Enter');page.wait_for_timeout(200);page.keyboard.press('Enter');page.wait_for_timeout(200);page.keyboard.press('Escape');page.wait_for_timeout(200);page.keyboard.press('Escape');page.keyboard.press('Backspace')
  else:
   page.evaluate('window.__consoleChaos.campaign.startNew()');page.wait_for_timeout(300)
  results.append(dict(game=name,checks=checks,liveVoicesAfterStop=remaining,suspendedContextSimulated=True,errors=errors,beforeGesture=before,afterGesture=after,saved=saved))
  page.close()
 b.close()
 (out/'browser-report.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
 print(json.dumps(results,ensure_ascii=False,indent=2))
