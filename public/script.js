// 轻量颗粒背景 + 交互
(function(){
  const canvas = document.getElementById('bg-canvas');
  const ctx = canvas.getContext('2d');
  let w, h, particles;

  function resize(){
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    init();
  }
  function init(){
    const count = Math.floor((w*h)/22000); // 根据屏幕面积自适应数量
    particles = new Array(count).fill(0).map(()=>({
      x: Math.random()*w,
      y: Math.random()*h,
      r: Math.random()*1.6 + .4,
      vx: (Math.random()-.5)*.15,
      vy: (Math.random()-.5)*.15,
      hue: 190 + Math.random()*40
    }));
  }
  function tick(){
    ctx.clearRect(0,0,w,h);
    particles.forEach(p=>{
      p.x += p.vx; p.y += p.vy;
      if(p.x<-20) p.x=w+20; if(p.x>w+20) p.x=-20; if(p.y<-20) p.y=h+20; if(p.y>h+20) p.y=-20;
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r*8);
      grd.addColorStop(0, `hsla(${p.hue}, 90%, 70%, .12)`);
      grd.addColorStop(1, 'transparent');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r*8, 0, Math.PI*2); ctx.fill();
    });
    requestAnimationFrame(tick);
  }
  window.addEventListener('resize', resize);
  resize(); tick();
})();

// 复制「开奖」指令
(function(){
  function bindCopy(id){
    const btn = document.getElementById(id);
    if(!btn) return;
    btn.addEventListener('click', async ()=>{
      try{
        await navigator.clipboard.writeText('开奖');
        btn.textContent = '已复制 ✅';
        setTimeout(()=>{ btn.textContent = '复制「开奖」'; }, 1600);
      }catch(e){ console.warn('复制失败', e); }
    });
  }
  bindCopy('copyBtn');
  bindCopy('copyBtn2');
})();

// 英雄图轻微视差
(function(){
  const img = document.getElementById('heroImg');
  if(!img) return;
  const max = 6; // 最大偏移像素
  function onMove(e){
    const rect = img.getBoundingClientRect();
    const cx = rect.left + rect.width/2;
    const cy = rect.top + rect.height/2;
    const dx = (e.clientX - cx)/rect.width; // -0.5 ~ 0.5
    const dy = (e.clientY - cy)/rect.height;
    img.style.transform = `translate(${dx*max}px, ${dy*max}px)`;
  }
  function reset(){ img.style.transform = 'translate(0,0)'; }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseleave', reset);
})();
