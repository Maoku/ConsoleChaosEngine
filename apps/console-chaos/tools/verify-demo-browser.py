"""Real Chromium/WebGL campaign checks. Requires Python Playwright and a running Vite server.
Usage: python tools/verify-demo-browser.py [http://127.0.0.1:5173]
Evidence is written under ignored Docs/measurements/four-stage-demo.
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5173'
OUT = Path(__file__).resolve().parents[1] / 'Docs/measurements/four-stage-demo'
OUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=[
        '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
    context = browser.new_context(viewport={'width':1280,'height':820})
    page = context.new_page()
    errors, failed, results = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('response', lambda r: failed.append(r.url) if r.status >= 400 and not r.url.endswith('/favicon.ico') else None)

    def setup():
        page.wait_for_function('window.__consoleChaos?.campaign')
        page.evaluate('''() => {
            const a=window.__consoleChaos; a.host.stop(); window.__time=performance.now();
            const render=a.renderer.render.bind(a.renderer);
            window.__lastFrame=null;
            const gl=document.querySelector('#screen').getContext('webgl2');
            window.__drawLast=null;
            a.renderer.render=(frame,profile,...rest) => {
                window.__lastFrame={generation:profile.id,affineSurfaces:frame.affineSurfaces.length,
                    visibleMeshes:frame.meshes.filter(m=>m.visible!==false).length,lights:frame.lights.length};
                window.__drawLast=()=>{render(frame,profile,...rest);gl.finish();};
                window.__drawLast();
            };
            window.__step=(count) => {for(let i=0;i<count;i++){window.__time+=1000/60+0.00001;a.host.frame(window.__time);}};
        }''')

    def step(count=1):
        page.evaluate('(count)=>window.__step(count)', count)

    def state():
        return page.evaluate('''() => {const a=window.__consoleChaos,s=a.session;return {
            stage:s.level.id,mode:a.campaign.mode,position:[...s.player.position],solved:[...s.solved],
            falls:s.checkpoints.respawnCount,generation:s.generation.generation,tick:s.tickIndex,
            frame:window.__lastFrame,checkpoint:s.snapshot().checkpointId};}''')

    def capture(name):
        page.evaluate('''() => {
            window.__step(1);
            window.__captureLoop=()=>{window.__drawLast();window.__captureId=requestAnimationFrame(window.__captureLoop);};
            window.__captureLoop();
        }''')
        page.screenshot(path=str(OUT / (name+'.png')), timeout=60000)
        page.evaluate('cancelAnimationFrame(window.__captureId)')

    def channel(key):
        page.keyboard.press(str(key)); step(24)
        assert state()['generation'] == ['FC','SFC','PS1','PS2'][key-1]

    def move(axis, target):
        current = state()
        delta = target-current['position'][axis]
        if abs(delta) < .08: return
        direction = 1 if delta > 0 else -1
        if axis == 0: key = ('ArrowUp' if direction > 0 else 'ArrowDown') if current['generation']=='PS2' else ('ArrowRight' if direction > 0 else 'ArrowLeft')
        else: key = ('ArrowRight' if direction > 0 else 'ArrowLeft') if current['generation']=='PS2' else ('ArrowDown' if direction > 0 else 'ArrowUp')
        page.keyboard.down(key)
        ticks = page.evaluate('''({axis,target,direction}) => {
            let ticks=0;
            while(window.__consoleChaos.campaign.mode==='playing' && (target-window.__consoleChaos.session.player.position[axis])*direction > .08 && ticks++<800) window.__step(1);
            return ticks;
        }''', {'axis':axis,'target':target,'direction':direction})
        page.keyboard.up(key); step(1)
        assert ticks < 800, (axis,target,state())

    def jump(target):
        assert page.evaluate('window.__consoleChaos.session.player.grounded')
        page.keyboard.down('Space'); page.keyboard.down('ArrowRight')
        page.evaluate('''(target)=>{let t=0;while(window.__consoleChaos.session.player.position[0]<target-.05&&t++<50)window.__step(1);}''',target)
        page.keyboard.up('ArrowRight');step(50)
        page.keyboard.up('Space');step(1)
        assert page.evaluate('window.__consoleChaos.session.player.grounded'), state()

    def next_stage():
        assert state()['mode'] == 'stageComplete', state()
        results.append(state()); capture(state()['stage']+'-clear');print(state()['stage']+' cleared',flush=True)
        page.get_by_role('button',name='次のステージへ',exact=True).click()
        page.wait_for_function("window.__consoleChaos.campaign.mode==='playing'")
        step(3)

    page.goto(BASE+'/?playtest=1',wait_until='networkidle');setup()
    before=state()['tick'];step(30);assert state()['tick']==before
    capture('title')
    page.get_by_role('button',name='最初から',exact=True).click()
    page.wait_for_function("window.__consoleChaos.campaign.mode==='playing'");step(3)
    move(0,22.5);capture('stage1-merged');channel(3);move(2,2.5);move(0,28.25)
    assert set(state()['solved'])=={'route','backside'}
    # Save and reload at a legitimate checkpoint, then continue without teleporting or granting achievements.
    page.keyboard.press('Escape');step(2)
    assert state()['mode']=='title'
    page.reload(wait_until='networkidle');setup()
    page.get_by_role('button',name='続きから',exact=True).click()
    page.wait_for_function("window.__consoleChaos.campaign.mode==='playing'");step(3)
    assert set(state()['solved'])=={'route','backside'}
    move(2,2.5);move(0,35.5);move(2,0);next_stage()

    move(0,9.25);capture('stage2-curtain')
    stones=page.evaluate("['lamp-0','lamp-1','lamp-2'].map(id=>window.__consoleChaos.session.bodies().get(id).position[0])")
    channel(2)
    for stone in stones: jump(stone-.75);move(0,stone+.5)
    jump(18.5);move(0,21);channel(1);move(0,30.85);channel(2);step(175);capture('stage2-affine');step(175)
    assert state()['frame']['affineSurfaces']>0
    channel(1);move(0,39.5);move(0,47);next_stage()

    move(0,5.75);channel(3);move(2,2.5);move(0,9);capture('stage3-seam');move(2,-.5)
    move(2,2.5);move(0,14);channel(1);move(0,30);channel(4);move(2,-2.5);capture('stage3-light')
    assert 'torch-light' in state()['solved']
    move(2,0);move(0,39);next_stage()

    move(0,22);move(0,27.85);channel(2);step(350);channel(1);move(0,37);move(0,41.75);channel(3)
    move(2,2.5);move(0,45);move(2,-.5);move(2,2.5);move(0,50);channel(1);move(0,60);channel(4);move(2,-2.5)
    assert len(state()['solved'])==4
    move(2,0);move(0,67)
    assert state()['mode']=='finished',state()
    results.append(state());capture('ending')
    assert all(result['falls']==0 for result in results),results
    assert not errors and not failed,(errors,failed)
    report={'routes':results,'pageErrors':errors,'failedRequests':failed,
        'saveReload':'checkpoint and both achieved outcomes restored',
        'input':'keyboard through GameHost; no player teleport or achievement injection',
        'timing':'fixed-step automated route; does not measure first-time human duration',
        'playtest':page.evaluate('window.__consoleChaos.demoPlaytest')}
    (OUT/'browser-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({'stages':len(results),'falls':sum(r['falls'] for r in results),'pageErrors':errors,'failedRequests':failed},ensure_ascii=False))
    browser.close()
