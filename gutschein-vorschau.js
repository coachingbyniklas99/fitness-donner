/* Gutschein: Vorschau "So packt die beschenkte Person den Gutschein aus".
   - Knopf unter der Gutschein-Vorschau; öffnet ein Fenster mit der echten Auspack-Seite im Demo-Modus.
   - Name, Betrag, Absender, Nachricht und Design kommen live aus dem Formular.
   - Es wird nichts gespeichert oder verschickt. Ohne dieses Skript bleibt alles wie bisher. */
(function () {
  var note = document.querySelector('.gs-v-note');
  if (!note) return;
  var $ = function (id) { return document.getElementById(id); };

  var css = document.createElement('style');
  css.textContent =
    '.gs-pv-btn{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;margin-top:14px;padding:14px 18px;background:transparent;color:#F5D061;border:1.5px solid #EFB92E;font:600 15px/1.2 inherit;font-family:inherit;cursor:pointer;transition:background .2s,color .2s}' +
    '.gs-pv-btn:hover,.gs-pv-btn:focus-visible{background:#EFB92E;color:#15171C;outline:none}' +
    '.gs-pv-btn svg{width:20px;height:20px;flex:0 0 auto}' +
    '.gs-pv-sub{position:relative;z-index:1;margin-top:8px;text-align:center;font-size:13px;color:#9A9FA8}' +
    '.gs-pv{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(8,9,12,.82)}' +
    '.gs-pv.on{display:flex}' +
    '.gs-pv-box{position:relative;display:flex;flex-direction:column;width:min(460px,100%);height:min(860px,100%);background:#15171C;border:1px solid #3A3F4A;box-shadow:0 24px 80px rgba(0,0,0,.6)}' +
    '.gs-pv-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px 12px 18px;border-bottom:1px solid #2E323B;color:#ECE9E2;font:600 14px/1.3 inherit;font-family:inherit}' +
    '.gs-pv-bar small{display:block;font-weight:400;color:#9A9FA8;font-size:12.5px}' +
    '.gs-pv-x{flex:0 0 auto;width:40px;height:40px;background:#262A33;color:#ECE9E2;border:0;font-size:22px;line-height:1;cursor:pointer}' +
    '.gs-pv-x:hover,.gs-pv-x:focus-visible{background:#EFB92E;color:#15171C;outline:none}' +
    '.gs-pv-box iframe{flex:1 1 auto;width:100%;border:0;background:#15171C}' +
    '@media(max-width:600px){.gs-pv{padding:0}.gs-pv-box{width:100%;height:100%;border:0}}';
  document.head.appendChild(css);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gs-pv-btn';
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="9" width="18" height="12" rx="1"/><path d="M12 9v12M3 13h18"/><path d="M12 9C9 9 7 7.5 7 6a2 2 0 0 1 3.5-1.3L12 6.5l1.5-1.8A2 2 0 0 1 17 6c0 1.5-2 3-5 3Z"/></svg><span id="gsPvLbl">So packt Lisa den Gutschein aus</span>';
  var sub = document.createElement('p');
  sub.className = 'gs-pv-sub';
  sub.textContent = 'Eine Vorschau, so sieht die beschenkte Person es beim Öffnen.';
  note.parentNode.insertBefore(btn, note.nextSibling);
  btn.parentNode.insertBefore(sub, btn.nextSibling);

  function first(s) { return String(s || '').trim().split(/\s+/)[0] || ''; }
  function label() {
    var rn = first($('recipientName') && $('recipientName').value);
    $('gsPvLbl').textContent = rn ? 'So packt ' + rn + ' den Gutschein aus' : 'So packt die beschenkte Person aus';
  }
  ['recipientName'].forEach(function (id) { var el = $(id); if (el) el.addEventListener('input', label); });
  label();

  var box = null, frame = null;
  function build() {
    box = document.createElement('div');
    box.className = 'gs-pv';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Vorschau: Gutschein auspacken');
    box.innerHTML = '<div class="gs-pv-box"><div class="gs-pv-bar"><div>Vorschau: Auspacken<small>So sieht es aus, wenn der Gutschein geöffnet wird.</small></div><button type="button" class="gs-pv-x" aria-label="Vorschau schließen">&times;</button></div><iframe title="Vorschau: Gutschein auspacken"></iframe></div>';
    document.body.appendChild(box);
    frame = box.querySelector('iframe');
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    box.querySelector('.gs-pv-x').addEventListener('click', close);
    /* Esc soll auch gehen, wenn der Fokus im Vorschau-Fenster liegt (gleiche Domain) */
    frame.addEventListener('load', function () { try { frame.contentWindow.addEventListener('keydown', onKey); } catch (e) {} });
  }
  function url() {
    var d = window.fdDesign ? window.fdDesign() : '';
    var design = d === 'nik' || d === 'xmas' ? d : 'std';
    var amt = ($('vValue') && $('vValue').textContent || '').trim();
    var buyer = first($('buyerName') && $('buyerName').value);
    var p = new URLSearchParams();
    p.set('demo', design);
    p.set('embed', '1');
    if (/\d/.test(amt)) p.set('amt', amt);
    var to = ($('recipientName') && $('recipientName').value || '').trim();
    if (to) p.set('to', to);
    if (buyer) p.set('from', buyer);
    var m = ($('message') && $('message').value || '').trim();
    if (m) p.set('msg', m);
    return 'auspacken.html?' + p.toString();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function open() {
    if (!box) build();
    frame.src = url();   /* jedes Öffnen lädt frisch: das Auspacken beginnt von vorn */
    box.classList.add('on');
    document.documentElement.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    box.querySelector('.gs-pv-x').focus();
  }
  function close() {
    if (!box) return;
    box.classList.remove('on');
    frame.src = 'about:blank';
    document.documentElement.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    btn.focus();
  }
  btn.addEventListener('click', open);
})();
