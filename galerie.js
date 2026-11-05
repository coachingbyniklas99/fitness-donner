/* Bildergalerie: Tipp auf ein Studio-Foto oeffnet es gross (Wischen/Pfeile = naechstes Bild, Esc oder Kreuz = schliessen) */
(function(){
  var track=document.getElementById('sglT');
  if(!track||!window.addEventListener) return;
  var imgs=[].slice.call(track.querySelectorAll('.sgl-s img'));
  if(!imgs.length) return;

  var css=document.createElement('style');
  css.textContent=
    '.sgl-s img{cursor:zoom-in}'+
    '.lb{position:fixed;inset:0;z-index:300;display:none;align-items:center;justify-content:center;background:rgba(10,11,14,.98);touch-action:pan-y}'+
    '.lb.on{display:flex}'+
    '.lb-fig{margin:0;max-width:min(1400px,94vw);max-height:92vh;display:flex;flex-direction:column;align-items:center;gap:12px}'+
    '.lb-fig img{display:block;max-width:100%;max-height:80vh;object-fit:contain;box-shadow:0 20px 60px rgba(0,0,0,.6)}'+
    '.lb-cap{color:#C9CBD0;font-size:14px;line-height:1.45;text-align:center;padding:0 16px}'+
    '.lb-btn{position:absolute;appearance:none;border:1px solid rgba(236,233,226,.35);background:rgba(21,23,28,.7);color:#ECE9E2;width:48px;height:48px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1}'+
    '.lb-btn:hover{background:#EFB92E;border-color:#EFB92E;color:#15171C}'+
    '.lb-x{top:16px;right:16px}.lb-p{left:14px;top:50%;margin-top:-24px}.lb-n{right:14px;top:50%;margin-top:-24px}'+
    '.lb-c{position:absolute;left:0;right:0;top:22px;text-align:center;color:#9AA0AB;font-size:13px;letter-spacing:.12em}'+
    '@media(max-width:700px){.lb-p,.lb-n{top:auto;bottom:22px;margin:0}.lb-p{left:16px}.lb-n{right:16px}.lb-fig img{max-height:74vh}}';
  document.head.appendChild(css);

  var lb=document.createElement('div');
  lb.className='lb';lb.setAttribute('role','dialog');lb.setAttribute('aria-modal','true');lb.setAttribute('aria-label','Bild gross');
  lb.innerHTML='<div class="lb-c"></div><figure class="lb-fig"><img alt=""><figcaption class="lb-cap"></figcaption></figure>'+
    '<button type="button" class="lb-btn lb-x" aria-label="Schlie&szlig;en">&#10005;</button>'+
    '<button type="button" class="lb-btn lb-p" aria-label="Vorheriges Bild">&#8249;</button>'+
    '<button type="button" class="lb-btn lb-n" aria-label="N&auml;chstes Bild">&#8250;</button>';
  document.body.appendChild(lb);
  var im=lb.querySelector('.lb-fig img'),cap=lb.querySelector('.lb-cap'),cnt=lb.querySelector('.lb-c'),cur=0,last=null;

  function show(i){
    cur=(i+imgs.length)%imgs.length;
    var src=imgs[cur];
    im.src=src.currentSrc||src.src;im.alt=src.alt||'';
    var fc=src.parentNode.querySelector('figcaption');
    cap.textContent=fc?fc.textContent:'';
    cnt.textContent=(cur+1)+' / '+imgs.length;
  }
  function open(i){last=document.activeElement;show(i);lb.classList.add('on');document.documentElement.style.overflow='hidden';lb.querySelector('.lb-x').focus();}
  function close(){lb.classList.remove('on');document.documentElement.style.overflow='';if(last&&last.focus)last.focus();}

  imgs.forEach(function(el,i){
    el.setAttribute('tabindex','0');el.setAttribute('role','button');
    el.setAttribute('aria-label',(el.alt||'Bild')+' - gross ansehen');
    el.addEventListener('click',function(){open(i);});
    el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();open(i);}});
  });
  lb.querySelector('.lb-x').addEventListener('click',close);
  lb.querySelector('.lb-p').addEventListener('click',function(){show(cur-1);});
  lb.querySelector('.lb-n').addEventListener('click',function(){show(cur+1);});
  lb.addEventListener('click',function(e){if(e.target===lb)close();});
  document.addEventListener('keydown',function(e){
    if(!lb.classList.contains('on'))return;
    if(e.key==='Escape')close();
    else if(e.key==='ArrowRight')show(cur+1);
    else if(e.key==='ArrowLeft')show(cur-1);
  });
  var sx=null,sy=null;
  lb.addEventListener('touchstart',function(e){sx=e.touches[0].clientX;sy=e.touches[0].clientY;},{passive:true});
  lb.addEventListener('touchend',function(e){
    if(sx===null)return;var dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;sx=null;
    if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy))show(cur+(dx<0?1:-1));
  },{passive:true});
})();
