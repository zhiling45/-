(() => {
  'use strict';

  // ====== 配置 ======
  const GRID = 20;
  const BASE_STEP = 140;
  const MIN_STEP = 60;
  const SPEED_UP_EVERY = 5;
  const SPEED_DELTA = 6;
  const STORAGE_KEY = 'snakeHighScore';

  // DOM
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const overlayText = document.getElementById('overlayText');
  const scoreEl = document.getElementById('score');
  const highScoreEl = document.getElementById('highScore');
  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnRestart = document.getElementById('btnRestart');
  const toggleSfx = document.getElementById('toggleSfx');
  const toggleBgm = document.getElementById('toggleBgm');
  const dpad = document.getElementById('dpad');
  const btnMobilePause = document.getElementById('btnMobilePause');

  // DPR
  function resizeCanvas() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resizeCanvas, { passive: true });
  resizeCanvas();

  // ====== 状态 ======
  let snake, direction, nextDirection, food, score, highScore, stepMs;
  let state = 'ready'; // 'ready' | 'running' | 'paused' | 'over'
  let rafId = 0, lastTs = 0, acc = 0;

  highScore = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10) || 0;
  highScoreEl.textContent = highScore;

  // ====== 声音（同前版） ======
  const Sound = (() => {
    let ctx = null;
    let sfxEnabled = true;
    let bgmEnabled = false;
    let bgmTimer = null;
    function ensureContext(){ if(!ctx){ ctx = new (window.AudioContext||window.webkitAudioContext)(); } if(ctx.state==='suspended') ctx.resume(); }
    function beep(freq=440,dur=.08,type='square',gain=.06){
      if(!sfxEnabled) return; ensureContext();
      const osc=ctx.createOscillator(), g=ctx.createGain(); osc.type=type; osc.frequency.value=freq; g.gain.value=0;
      osc.connect(g).connect(ctx.destination); const now=ctx.currentTime;
      g.gain.linearRampToValueAtTime(gain, now+0.01); g.gain.exponentialRampToValueAtTime(0.0001, now+dur);
      osc.start(now); osc.stop(now+dur+0.02);
    }
    function eat(){ beep(660,0.06,'square',0.08); setTimeout(()=>beep(880,0.06,'square',0.07),65); }
    function over(){ beep(300,0.14,'sawtooth',0.09); setTimeout(()=>beep(180,0.16,'sawtooth',0.09),120); }
    const melody=[392,440,523.25,659.25];
    function startBgm(){ if(!bgmEnabled||bgmTimer) return; ensureContext(); let i=0; bgmTimer=setInterval(()=>{ beep(melody[i%melody.length],.22,'triangle',.03); i++; },260); }
    function stopBgm(){ if(bgmTimer){ clearInterval(bgmTimer); bgmTimer=null; } }
    return { setSfx:v=>sfxEnabled=!!v, setBgm:v=>{ bgmEnabled=!!v; bgmEnabled?startBgm():stopBgm(); }, eat, over, startBgm, stopBgm, ensureContext };
  })();
  toggleSfx.addEventListener('change', e => Sound.setSfx(e.target.checked));
  toggleBgm.addEventListener('change', e => { Sound.setBgm(e.target.checked); if(e.target.checked) Sound.ensureContext(); });

  // ====== 工具 ======
  const randInt = n => Math.floor(Math.random()*n);
  const eq = (a,b) => a.x===b.x && a.y===b.y;
  function updateSpeed(){ const inc=Math.floor(score / SPEED_UP_EVERY); stepMs=Math.max(MIN_STEP, BASE_STEP - inc*SPEED_DELTA); }
  function isOnSnake(pos, ignoreTail=false){ const len=snake.length-(ignoreTail?1:0); for(let i=0;i<len;i++) if(eq(snake[i],pos)) return true; return false; }
  function spawnFood(){ let p; do{ p={x:randInt(GRID), y:randInt(GRID)} } while(isOnSnake(p,false)); return p; }

  // ====== 初始化 ======
  function resetGame(){
    snake=[ {x:Math.floor(GRID/2),y:Math.floor(GRID/2)},
            {x:Math.floor(GRID/2)-1,y:Math.floor(GRID/2)},
            {x:Math.floor(GRID/2)-2,y:Math.floor(GRID/2)} ];
    direction={x:1,y:0}; nextDirection={x:1,y:0};
    food=spawnFood(); score=0; updateSpeed(); scoreEl.textContent=score;
    overlayText.textContent='点击「开始」开始游戏'; showOverlay(true);
    state='ready'; lastTs=0; acc=0; draw();
  }
  function showOverlay(show,text){ if(typeof text==='string') overlayText.textContent=text; overlay.classList.toggle('hidden', !show); }

  // ====== 主循环 ======
  function startGame(){
    if(state==='running') return;
    if(state==='over') resetGame();
    state='running'; showOverlay(false); lastTs=0; acc=0;
    Sound.ensureContext(); if(toggleBgm.checked) Sound.startBgm();
    cancelAnimationFrame(rafId); rafId=requestAnimationFrame(loop); updateButtons();
  }
  function pauseGame(){
    if(state!=='running' && state!=='paused') return;
    if(state==='running'){ state='paused'; showOverlay(true,'已暂停'); Sound.stopBgm(); }
    else{ state='running'; showOverlay(false); if(toggleBgm.checked) Sound.startBgm(); lastTs=0; acc=0; rafId=requestAnimationFrame(loop); }
    updateButtons();
  }
  function restartGame(){ Sound.stopBgm(); resetGame(); startGame(); }
  function loop(ts){
    if(state!=='running') return;
    if(!lastTs) lastTs=ts; const delta=ts-lastTs; lastTs=ts; acc+=delta;
    while(acc>=stepMs){ step(); acc-=stepMs; }
    draw(); rafId=requestAnimationFrame(loop);
  }
  function step(){
    direction=nextDirection;
    const head=snake[0], next={x:head.x+direction.x, y:head.y+direction.y};
    if(next.x<0||next.x>=GRID||next.y<0||next.y>=GRID) return gameOver();
    const willEat=eq(next,food);
    if(isOnSnake(next, !willEat)) return gameOver();
    snake.unshift(next);
    if(willEat){ score+=1; scoreEl.textContent=score; if(score>highScore){ highScore=score; localStorage.setItem(STORAGE_KEY,String(highScore)); highScoreEl.textContent=highScore; } updateSpeed(); food=spawnFood(); if(toggleSfx.checked) Sound.eat(); }
    else snake.pop();
  }
  function gameOver(){ state='over'; Sound.stopBgm(); if(toggleSfx.checked) Sound.over(); showOverlay(true,'游戏结束'); updateButtons(); }

  // ====== 绘制 ======
  function draw(){
    const w=canvas.clientWidth, h=canvas.clientHeight;
    ctx.clearRect(0,0,w,h); drawGrid(w,h);
    const cell=Math.min(w/GRID, h/GRID), pad=Math.max(1,Math.floor(cell*0.12)), radius=Math.floor(cell*0.25);
    drawRoundedRect(food.x*cell+pad, food.y*cell+pad, cell-pad*2, cell-pad*2, radius, getFoodGradient(food.x*cell,food.y*cell,cell,cell));
    for(let i=snake.length-1;i>=0;i--){
      const s=snake[i], isHead=i===0, color=isHead?getHeadGradient(s.x*cell,s.y*cell,cell,cell):getSnakeGradient(s.x*cell,s.y*cell,cell,cell);
      drawRoundedRect(s.x*cell+pad, s.y*cell+pad, cell-pad*2, cell-pad*2, isHead?radius:Math.floor(radius*.8), color);
    }
  }
  function drawGrid(w,h){ ctx.save(); ctx.globalAlpha=.08; ctx.strokeStyle='#ffffff'; ctx.lineWidth=1;
    const cell=Math.min(w/GRID,h/GRID);
    for(let i=1;i<GRID;i++){ const x=Math.floor(i*cell)+.5, y=Math.floor(i*cell)+.5;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
    } ctx.restore();
  }
  function drawRoundedRect(x,y,w,h,r,fill){ ctx.save(); ctx.fillStyle=fill; ctx.beginPath();
    const rr=Math.min(r,w/2,h/2); ctx.moveTo(x+rr,y);
    ctx.arcTo(x+w,y, x+w,y+h, rr); ctx.arcTo(x+w,y+h, x,y+h, rr);
    ctx.arcTo(x,y+h, x,y, rr); ctx.arcTo(x,y, x+w,y, rr); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function getSnakeGradient(x,y,w,h){ const g=ctx.createLinearGradient(x,y,x+w,y+h); g.addColorStop(0,'#22c55e'); g.addColorStop(1,'#16a34a'); return g; }
  function getHeadGradient(x,y,w,h){ const g=ctx.createLinearGradient(x,y,x+w,y+h); g.addColorStop(0,'#34d399'); g.addColorStop(1,'#059669'); return g; }
  function getFoodGradient(x,y,w,h){ const g=ctx.createLinearGradient(x,y,x+w,y+h); g.addColorStop(0,'#fb7185'); g.addColorStop(1,'#f43f5e'); return g; }

  // ====== 控制 ======
  function setDirection(dx,dy){ if(dx===-direction.x && dy===-direction.y) return; nextDirection={x:dx,y:dy}; }
  // 键盘
  window.addEventListener('keydown', (e)=>{
    const k=e.key.toLowerCase();
    if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)||['w','a','s','d'].includes(k)) e.preventDefault();
    if(k==='arrowup'||k==='w') setDirection(0,-1);
    else if(k==='arrowdown'||k==='s') setDirection(0,1);
    else if(k==='arrowleft'||k==='a') setDirection(-1,0);
    else if(k==='arrowright'||k==='d') setDirection(1,0);
    else if(k===' ') pauseGame();
  }, { passive:false });

  // 触控滑动 + 轻点
  let touchStart=null;
  canvas.addEventListener('touchstart', e=>{
    if(state==='ready'||state==='over'){ startGame(); return; }
    if(e.touches.length===1) touchStart={x:e.touches[0].clientX, y:e.touches[0].clientY};
  }, { passive:true });
  canvas.addEventListener('touchmove', e=>{
    if(!touchStart) return;
    const dx=e.touches[0].clientX-touchStart.x, dy=e.touches[0].clientY-touchStart.y, th=24;
    if(Math.abs(dx)>Math.abs(dy) && Math.abs(dx)>th){ setDirection(dx>0?1:-1,0); touchStart=null; }
    else if(Math.abs(dy)>th){ setDirection(0, dy>0?1:-1); touchStart=null; }
  }, { passive:true });
  canvas.addEventListener('touchend', ()=>{
    if(touchStart){ if(state==='running') pauseGame(); else if(state==='paused') pauseGame(); else startGame(); }
    touchStart=null;
  });

  // —— 虚拟方向键：点击/长按均可快速多次改变方向（每次点击只改变一次方向）——
  dpad.addEventListener('click', e=>{
    const btn=e.target.closest('.pad'); if(!btn) return;
    if(btn.id==='btnMobilePause'){ if(state==='ready'||state==='over') startGame(); else pauseGame(); navigator.vibrate?.(10); return; }
    const dx=parseInt(btn.getAttribute('data-dx'),10), dy=parseInt(btn.getAttribute('data-dy'),10);
    if(Number.isFinite(dx) && Number.isFinite(dy)){ setDirection(dx,dy); navigator.vibrate?.(8); if(state==='ready') startGame(); }
  });

  // 标签页切换 => 自动暂停
  document.addEventListener('visibilitychange', ()=>{ if(document.hidden && state==='running') pauseGame(); });

  function updateButtons(){
    btnStart.disabled=(state==='running');
    btnPause.disabled=(state==='ready'||state==='over');
    btnRestart.disabled=(state==='ready');
    btnPause.textContent=(state==='paused')?'继续':'暂停';
  }

  resetGame(); updateButtons();
})();
