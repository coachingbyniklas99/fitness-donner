(function(){
  function dotsFor(track){
    var d=track.nextElementSibling;
    if(!d||!d.classList.contains('slider-dots')){
      d=document.createElement('div');d.className='slider-dots';d.setAttribute('aria-hidden','true');
      track.parentNode.insertBefore(d,track.nextSibling);
    }
    return d;
  }
  function init(track){
    if(track.dataset.sliderInit) return; track.dataset.sliderInit='1';
    var d=dotsFor(track), items=[].slice.call(track.children).filter(function(e){return e.nodeType===1});
    var wrap=track.closest('.slider');
    var prev=wrap?wrap.querySelector('.slider-nav.prev'):null, next=wrap?wrap.querySelector('.slider-nav.next'):null;
    function scrollable(){return track.scrollWidth>track.clientWidth+4;}
    function cur(){var x=track.scrollLeft+track.clientWidth*0.35,b=0;items.forEach(function(c,i){if(c.offsetLeft-track.offsetLeft<=x)b=i;});return b;}
    function sync(){
      var c=cur();
      [].slice.call(d.children).forEach(function(el,i){el.setAttribute('aria-current',i===c?'true':'false');});
      if(prev) prev.disabled=track.scrollLeft<=4;
      if(next) next.disabled=track.scrollLeft+track.clientWidth>=track.scrollWidth-4;
    }
    function build(){
      d.innerHTML='';
      if(!scrollable()) return;
      items.forEach(function(c,i){
        var b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Ansicht '+(i+1));
        b.addEventListener('click',function(){track.scrollTo({left:c.offsetLeft-track.offsetLeft,behavior:'smooth'});});
        d.appendChild(b);
      });
      sync();
    }
    function step(dir){track.scrollBy({left:dir*(track.clientWidth*0.9),behavior:'smooth'});}
    if(prev) prev.addEventListener('click',function(){step(-1);});
    if(next) next.addEventListener('click',function(){step(1);});
    track.addEventListener('scroll',function(){window.clearTimeout(track._s);track._s=window.setTimeout(sync,80);});
    track.addEventListener('keydown',function(e){
      if(e.key==='ArrowRight'){e.preventDefault();step(1);} if(e.key==='ArrowLeft'){e.preventDefault();step(-1);}
    });
    window.addEventListener('resize',function(){window.clearTimeout(track._r);track._r=window.setTimeout(build,150);});
    build();
  }
  function run(){[].slice.call(document.querySelectorAll('.m-slide,.rev-slider')).forEach(init);}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',run); else run();
})();
