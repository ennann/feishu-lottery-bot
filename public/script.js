// 颗粒背景已移除，使用 CSS 动画背景
// (function(){ ... })();

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
