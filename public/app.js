// CACAO NOTE – Browser-side encrypted letters, image memories and audio notes.
// MK2 never leaves the browser. This educational project has not undergone independent security review.
const $ = s => document.querySelector(s);
const root=$('#app-root');
const te=new TextEncoder(),td=new TextDecoder();
const isDemo = location.protocol==='file:' || location.pathname==='/demo' || new URLSearchParams(location.search).has('demo');
const routeGift = location.pathname.match(/^\/s\/([\w-]{16,35})$/);
const productId = isDemo ? 'DEMO-CACAO-NOTE' : routeGift?.[1];
const MK1_DEMO = 'CACAO-2026';
const PART=102400,MAX_PARTS=80;
// Some mobile in-app browsers disable file:// localStorage; preview falls back to session memory.
const demoMemory=new Map();
const demoStore={getItem(k){try{return localStorage.getItem(k)??demoMemory.get(k)??null}catch{return demoMemory.get(k)??null}},setItem(k,v){demoMemory.set(k,v);try{localStorage.setItem(k,v)}catch{}},removeItem(k){demoMemory.delete(k);try{localStorage.removeItem(k)}catch{}}};
let currentImages=[], currentAudio=null, recordedBlob=null, recorder=null,recordTimer=null;
const toast = message=>{const t=$('#toast');t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),4500)};
const escapeHtml = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const b64 = bytes => {let str='';for(let i=0;i<bytes.length;i+=24000)str+=String.fromCharCode(...bytes.subarray(i,i+24000));return btoa(str)};
const ub64 = str => Uint8Array.from(atob(str),c=>c.charCodeAt(0));
const derivation=async(password,salt)=>{const key=await crypto.subtle.importKey('raw',te.encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:400000,hash:'SHA-256'},key,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])};
const encrypt=async(data,password)=>{const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const key=await derivation(password,salt);const content=te.encode(JSON.stringify(data));if(content.length>5_500_000)throw Error('Tổng dung lượng lời nhắn và tệp đính kèm quá lớn. Vui lòng chọn âm thanh ngắn hơn.');const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,content));return {salt:b64(salt),iv:b64(iv),chunks:(b64(cipher).match(new RegExp('.{1,'+PART+'}','g'))||[])};};
const decrypt=async(chunks,meta,password)=>{const key=await derivation(password,ub64(meta.salt));const buf=ub64(chunks.join(''));const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:ub64(meta.iv)},key,buf);return JSON.parse(td.decode(plain))};
const normalize = s=>String(s??'').toUpperCase().replace(/-/g,'').trim();
async function request(path,method='GET',payload=null,token=null){
 if(isDemo)return demoRequest(path,method,payload,token);
 const headers={'accept':'application/json'};
 if(payload!==null)headers['content-type']='application/json';
 if(token)headers.authorization='Bearer '+token;
 const res=await fetch(path,{method,headers,body:payload===null?undefined:JSON.stringify(payload),cache:'no-store'});
 let data;try{data=await res.json()}catch{throw Error('Không đọc được phản hồi từ máy chủ.')}if(!res.ok)throw Error(data.error||'Thao tác thất bại.');return data;
}
// Demo only; stored in localStorage of THIS browser, never shared across devices.
async function demoRequest(path,method,payload){
 const store=JSON.parse(demoStore.getItem('cn-demo-v2')||'{"status":"new"}');
 if(method==='GET'&&!path.includes('/chunks'))return {ok:true,status:store.status};
 if(path.endsWith('/start')){if(normalize(payload?.mk1)!==normalize(MK1_DEMO))throw Error('MK1 chưa đúng. Mã demo là CACAO-2026.');if(store.status==='locked')throw Error('Demo đã khóa. Hãy đặt lại demo để thử lại.');demoStore.setItem('cn-demo-v2',JSON.stringify({...store,status:'draft'}));return {ok:true,uploadToken:'DEMO'};}
 if(path.endsWith('/upload')){const s=JSON.parse(demoStore.getItem('cn-demo-v2')||'{}');s.chunks??=[];s.chunks[payload.index]=payload.data;demoStore.setItem('cn-demo-v2',JSON.stringify(s));return {ok:true};}
 if(path.endsWith('/finalize')){const s=JSON.parse(demoStore.getItem('cn-demo-v2')||'{}');if((s.chunks||[]).length!==payload.count)throw Error('Thiếu dữ liệu demo');s.salt=payload.salt;s.iv=payload.iv;s.status='locked';demoStore.setItem('cn-demo-v2',JSON.stringify(s));return {ok:true,status:'locked'};}
 if(path.endsWith('/access')){if(normalize(payload?.mk1)!==normalize(MK1_DEMO))throw Error('MK1 chưa đúng.');if(store.status!=='locked')throw Error('Chưa có lời nhắn.');return {ok:true,accessToken:'DEMO',salt:store.salt,iv:store.iv,count:store.chunks.length};}
 if(path.includes('/chunks')){const u=new URL(path,'https://demo.local');const from=Number(u.searchParams.get('from')),count=Number(u.searchParams.get('count'));return {ok:true,chunks:store.chunks.slice(from,from+count)};}
 throw Error('Thao tác demo không tồn tại.');
}
const giftApi= suffix => `/api/products/${productId}${suffix}`;
function setHeader(title,desc){$('#app-section-title').innerHTML=title;$('#app-section-desc').textContent=desc;}
function put(html){root.innerHTML=html;root.querySelectorAll('[data-scroll]').forEach(el=>el.addEventListener('click',()=>document.querySelector('#gift-app').scrollIntoView({behavior:'smooth'})))}
function buttonLoading(btn,on,label='Đang xử lý...'){if(btn){btn.disabled=on;if(on){btn.dataset.label=btn.textContent;btn.textContent=label}else btn.textContent=btn.dataset.label||'Tiếp tục'}}
function appError(err){const e=root.querySelector('.form-error');if(e){e.textContent=err.message||String(err)}else toast(err.message||String(err));}
function demoBanner(){return isDemo?`<div class="demo-banner"><strong>BẢN THỬ TRÊN THIẾT BỊ NÀY.</strong> Dùng MK1 <b>${MK1_DEMO}</b>. Lời nhắn chỉ lưu trong trình duyệt hiện tại, không chia sẻ giữa các thiết bị. <button id="reset-demo" class="text-btn" type="button">Đặt lại</button></div>`:''}
function attachDemoReset(){if(isDemo)$('#reset-demo')?.addEventListener('click',()=>{if(confirm('Xóa dữ liệu demo trên thiết bị này?')){demoStore.removeItem('cn-demo-v2');location.reload()}})}
function home(){setHeader('Một lời nhắn <em>đang chờ</em>','Hãy trải nghiệm gửi lời nhắn, ảnh và nhạc. Mỗi thỏi son thật sẽ có một QR riêng.');put(`<div class="app-badge">EXPERIENCE CACAO NOTE</div><h3>Bạn có một điều<br/><em>muốn nói?</em></h3><p>Trải nghiệm tạo món quà riêng tư với ba bước: mở mã, viết lời nhắn, khóa bằng mật khẩu tự chọn.</p><a class="primary-btn" href="/demo">Dùng thử ngay <span>↗</span></a><p class="util-hint">Bản thử chỉ lưu trên thiết bị này và có thể đặt lại.</p>`)}
function startScreen(status){
 setHeader('Mở một <em>điều bí mật</em>','Mã QR trên mỗi thỏi son dẫn tới không gian riêng của món quà đó.');
 let locked=status==='locked',draft=status==='draft';
 put(`${demoBanner()}<div class="app-badge">${locked?'A NOTE IS WAITING':draft?'A NOTE IN PROGRESS':'LET YOUR WORDS STAY'}</div><h3>${locked?'Một món quà <em>đã được khóa.</em>':draft?'Lời nhắn đang <em>được chuẩn bị.</em>':'Bắt đầu với <em>một lời nhắn.</em>'}</h3><p>${locked?'Nhập mật khẩu 1 được ghi trên thỏi son. Sau đó nhập mật khẩu 2 do người tặng cung cấp để mở món quà.':draft?'Thỏi son đang được sử dụng để tạo lời nhắn. Nếu phiên tạo bị gián đoạn, hãy quay lại sau khoảng 20 phút.':'Quét mã QR và nhập mật khẩu 1 đi kèm sản phẩm để mở không gian gửi lời nhắn của bạn.'}</p>${draft?'':`<form id="mk1-form"><div class="field"><label for="mk1">Mật khẩu 1 · MK1</label><input id="mk1" placeholder="Nhập MK1 trên thỏi son" autocomplete="off" required maxlength="35"/><small>MK1 có sẵn trên thỏi son. MK2 sẽ do người mua tự tạo.</small></div><div class="form-error" role="alert"></div><button class="primary-btn" type="submit">${locked?'Tiếp tục mở quà':'Bắt đầu viết lời nhắn'} <span>→</span></button></form>`}`);
 attachDemoReset();
 $('#mk1-form')?.addEventListener('submit',async e=>{
   e.preventDefault();const b=e.currentTarget.querySelector('button');const mk1=$('#mk1').value.trim();buttonLoading(b,true);
   try{
     if(locked){const info=await request(giftApi('/access'),'POST',{mk1});await renderUnlock(info);}
     else{const info=await request(giftApi('/start'),'POST',{mk1});renderComposer(info.uploadToken);}
   }catch(err){appError(err);buttonLoading(b,false)}
 });
}
function setChooseTheme(name){document.querySelectorAll('.theme-choice').forEach(e=>e.classList.toggle('active',e.dataset.theme===name))}
function renderComposer(uploadToken){
 currentImages=[];currentAudio=null;recordedBlob=null;let theme='classic';
 put(`${demoBanner()}<div class="app-toolbar"><span class="app-badge">COMPOSE YOUR NOTE</span><span class="soft-tag">Bước 2/3</span></div><h3>Viết điều bạn <em>chưa nói.</em></h3><p>Lời nhắn, ảnh và âm thanh sẽ được bảo vệ bằng mật khẩu 2 do chính bạn đặt.</p>
 <form id="compose-form"><div class="input-row"><div class="field"><label for="recipient">Gửi đến</label><input id="recipient" maxlength="65" required placeholder="Tên người nhận"/></div><div class="field"><label for="sender">Từ</label><input id="sender" maxlength="65" required placeholder="Tên / biệt danh"/></div></div>
 <div class="field"><label for="message">Lời nhắn của bạn</label><textarea id="message" maxlength="2200" required placeholder="Có một điều mình muốn nói với bạn..." rows="5"></textarea><small>Tối đa 2.200 ký tự, chỉ người có đủ mật khẩu mới xem được.</small></div>
 <div class="field"><span>Chọn phong cách thiệp</span><div class="theme-list"><button type="button" class="theme-choice active" data-theme="classic">Kem cacao</button><button type="button" class="theme-choice" data-theme="rose">Hồng dịu</button><button type="button" class="theme-choice" data-theme="night">Đêm lặng</button></div></div>
 <div class="upload-field"><label for="photo-files">Hình ảnh <small>Tối đa 3 ảnh</small></label><input id="photo-files" type="file" accept="image/jpeg,image/png,image/webp" multiple/><p>Ảnh được thu nhỏ để tải nhanh trên điện thoại. Không chọn ảnh chứa thông tin nhạy cảm.</p><div class="thumbs" id="thumbs"></div></div>
 <div class="upload-field"><label for="audio-file">Nhạc hoặc lời nhắn bằng giọng nói <small>1 tệp, tối đa 2 MB</small></label><input id="audio-file" type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/webm,audio/aac,.mp3,.m4a,.ogg,.webm,.aac"/><p>Tệp nhạc bạn có quyền sử dụng, hoặc ghi âm ngắn ngay tại đây.</p><div class="record-row"><button id="record-btn" class="secondary-btn" type="button">● Ghi âm 30 giây</button><span id="record-info" class="rec-state"></span></div></div>
 <div class="field"><label for="mk2">Tự tạo mật khẩu 2 · MK2</label><input id="mk2" type="password" autocomplete="new-password" minlength="12" maxlength="128" required placeholder="Tối thiểu 12 ký tự"/><small>Không dùng mật khẩu ngắn, ngày sinh hoặc tên dễ đoán. Người bán không biết MK2.</small></div>
 <div class="field"><label for="mk2-confirm">Nhập lại mật khẩu 2</label><input id="mk2-confirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required placeholder="Nhập lại để xác nhận"/></div>
 <label class="checkbox-row"><input id="acknowledge" type="checkbox" required/><span>Mình đã lưu MK2 ở nơi an toàn. Mình hiểu rằng sau khi khóa sẽ không thể sửa lời nhắn và nếu quên MK2 sẽ không thể mở lại.</span></label>
 <div class="form-error" role="alert"></div><button class="primary-btn" id="save-btn" type="submit">Mã hóa & khóa món quà <span>↗</span></button><div class="progress" id="saving-progress" hidden><div style="width:0%"></div></div><p id="saving-text" class="util-hint"></p></form>`);
 attachDemoReset();
 root.querySelectorAll('.theme-choice').forEach(b=>b.addEventListener('click',()=>{theme=b.dataset.theme;setChooseTheme(theme)}));
 $('#photo-files').addEventListener('change',()=>{
    const files=[...$('#photo-files').files];
    if(files.length>3){toast('Bạn chỉ được chọn tối đa 3 ảnh.');$('#photo-files').value='';currentImages=[];return;}
    currentImages=files;const thumbs=$('#thumbs');thumbs.innerHTML='';
    files.forEach(f=>{const img=document.createElement('img');img.alt='Xem trước ảnh';img.src=URL.createObjectURL(f);img.onload=()=>URL.revokeObjectURL(img.src);thumbs.append(img)});
 });
 $('#audio-file').addEventListener('change',()=>{currentAudio=$('#audio-file').files?.[0]||null;recordedBlob=null;$('#record-info').textContent=currentAudio?`Đã chọn: ${currentAudio.name}`:'';});
 $('#record-btn').addEventListener('click',recordClick);
 $('#compose-form').addEventListener('submit',async e=>{
   e.preventDefault();if(recorder?.state==='recording'){appError(Error('Vui lòng dừng ghi âm trước.'));return;}
   const password=$('#mk2').value;
   if(password.length<12||password!==$('#mk2-confirm').value){appError(Error('MK2 phải dài tối thiểu 12 ký tự và hai lần nhập phải giống nhau.'));return;}
   if(!$('#acknowledge').checked){appError(Error('Hãy xác nhận đã lưu MK2.'));return;}
   const btn=$('#save-btn');buttonLoading(btn,true,'Đang chuẩn bị...');$('#saving-progress').hidden=false;
   const progress=(pct,message)=>{$('#saving-progress>div').style.width=pct+'%';$('#saving-text').textContent=message};
   try{
     progress(8,'Đang tối ưu hình ảnh...');const images=[];
     for(const file of currentImages){if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.');images.push(await optimizeImage(file));}
     let audio=null;const file=recordedBlob||currentAudio;
     if(file){if(file.size>2_100_000)throw Error('Tệp nhạc vượt quá 2 MB. Hãy chọn đoạn ngắn hơn.');if(!['audio/mpeg','audio/mp4','audio/x-m4a','audio/ogg','audio/webm','audio/aac'].includes(file.type))throw Error('Định dạng nhạc chưa được hỗ trợ. Hãy chọn MP3, M4A, OGG hoặc WebM.');audio={name:file.name||'Ghi âm của bạn',type:file.type,data:await dataUrl(file)};}
     progress(30,'Đang mã hóa lời nhắn, ảnh và âm thanh trên thiết bị...');
     const item={recipient:$('#recipient').value.trim(),sender:$('#sender').value.trim(),message:$('#message').value.trim(),theme,images,audio,createdAt:new Date().toISOString()};
     const enc=await encrypt(item,password);
     if(enc.chunks.length>MAX_PARTS)throw Error('Tổng tệp đính kèm quá lớn. Hãy dùng ảnh hoặc nhạc ngắn hơn.');
     progress(45,`Đang lưu ${enc.chunks.length} phần mã hóa...`);
     for(let i=0;i<enc.chunks.length;i++){
       await request(giftApi('/upload'),'POST',{uploadToken,index:i,data:enc.chunks[i]});
       if(i%3===0||i===enc.chunks.length-1)progress(45+Math.floor(50*(i+1)/enc.chunks.length),`Đã lưu ${i+1}/${enc.chunks.length} phần`);
     }
     await request(giftApi('/finalize'),'POST',{uploadToken,count:enc.chunks.length,salt:enc.salt,iv:enc.iv});
     $('#mk2').value='';$('#mk2-confirm').value='';progress(100,'Hoàn tất.');renderLockedSuccess();
   }catch(err){appError(err);buttonLoading(btn,false);$('#saving-text').textContent='Lưu không thành công. Kiểm tra kết nối hoặc thử lại khi phiên tạo còn hiệu lực.';}
 });
}
async function recordClick(){
 const button=$('#record-btn');const label=$('#record-info');
 if(recorder?.state==='recording'){recorder.stop();clearTimeout(recordTimer);return;}
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('Trình duyệt này không hỗ trợ ghi âm trực tiếp. Hãy tải tệp âm thanh lên.');return;}
 let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true})}catch{toast('Chưa cấp quyền micro. Bạn vẫn có thể tải file âm thanh lên.');return}
 const type=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t))||'';
 let parts=[];recorder=new MediaRecorder(stream,type?{mimeType:type}:undefined);
 recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};
 recorder.onstop=()=>{clearTimeout(recordTimer);stream.getTracks().forEach(t=>t.stop());const mime=recorder.mimeType.split(';')[0];recordedBlob=new File(parts,'loi-nhan-ghi-am.'+(mime.includes('mp4')?'m4a':'webm'),{type:mime});currentAudio=null;$('#audio-file').value='';label.textContent=`Đã ghi âm ${Math.round(recordedBlob.size/1024)} KB`;button.textContent='● Ghi âm lại';};
 recorder.start();label.textContent='Đang ghi âm... (tối đa 30 giây)';button.textContent='■ Dừng ghi âm';recordTimer=setTimeout(()=>{if(recorder?.state==='recording')recorder.stop()},30000);
}
function dataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('Không đọc được tệp.'));r.readAsDataURL(blob)})}
async function optimizeImage(file){
 if(file.size>12_000_000)throw Error('Ảnh gốc quá lớn (giới hạn 12 MB mỗi ảnh).');
 const img=await createImageBitmap(file);
 let factor=Math.min(1,1300/Math.max(img.width,img.height));let blob;
 for(let step=0;step<4;step++){
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*factor));canvas.height=Math.max(1,Math.round(img.height*factor));
   canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
   blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',step===0?.76:.68));
   if(blob.size<=600_000)break;factor*=.75;
 }
 img.close?.();if(!blob||blob.size>650_000)throw Error('Không thể nén ảnh. Hãy chọn ảnh khác.');return {type:'image/jpeg',data:await dataUrl(blob)};
}
function renderLockedSuccess(){
 put(`${demoBanner()}<div class="success-icon">♡</div><div class="app-badge">MESSAGE SEALED</div><h3>Điều muốn nói đã <em>được cất giữ.</em></h3><p>Món quà đã được khóa. Để mở, người nhận cần QR trên son, MK1 in trên sản phẩm và MK2 bạn tự đặt.</p><div class="notice"><strong>Quan trọng:</strong> Hãy gửi riêng MK2 cho người nhận khi bạn muốn họ mở quà. Ngay cả người quản lý website cũng không có MK2 để khôi phục.</div><button type="button" class="primary-btn" id="reopen">Thử mở món quà <span>→</span></button>`);
 attachDemoReset();$('#reopen').addEventListener('click',()=>startScreen('locked'));
}
async function renderUnlock(info){
 put(`${demoBanner()}<div class="app-badge">A PRIVATE GIFT FOR YOU</div><h3>Chỉ một <em>bước nữa thôi.</em></h3><p>MK1 đã chính xác. Nhập mật khẩu 2 do người gửi cung cấp. Nội dung chỉ được giải mã trên thiết bị này.</p><form id="mk2-open-form"><div class="field"><label for="mk2-open">Mật khẩu 2 · MK2</label><input type="password" id="mk2-open" required minlength="12" autocomplete="off" placeholder="Nhập MK2 riêng tư"/><small>Nếu không có MK2, người bán không thể mở hoặc khôi phục lời nhắn.</small></div><div class="form-error" role="alert"></div><button type="submit" class="primary-btn">Mở món quà <span>♡</span></button></form>`);
 attachDemoReset();
 $('#mk2-open-form').addEventListener('submit',async e=>{
   e.preventDefault();const b=e.currentTarget.querySelector('button'),pass=$('#mk2-open').value;buttonLoading(b,true,'Đang mở món quà...');
   try{
     const chunks=[];for(let i=0;i<info.count;i+=8){const res=await request(giftApi(`/chunks?from=${i}&count=${Math.min(8,info.count-i)}`),'GET',null,info.accessToken);chunks.push(...res.chunks)}
     const item=await decrypt(chunks,info,pass);$('#mk2-open').value='';renderLetter(item);
   }catch(e){appError(Error('Không mở được lời nhắn. Kiểm tra MK2 hoặc thử lại nếu kết nối bị gián đoạn.'));buttonLoading(b,false)}
 });
}
function renderLetter(item){
 const theme=['classic','rose','night'].includes(item.theme)?item.theme:'classic';
 const images=(Array.isArray(item.images)?item.images:[]).slice(0,3).filter(x=>x.type==='image/jpeg'&&typeof x.data==='string'&&x.data.startsWith('data:image/jpeg;base64,')).map(x=>`<img src="${x.data}" alt="Ảnh kỷ niệm" loading="lazy"/>`).join('');
 let audio='';if(item.audio&&['audio/mpeg','audio/mp4','audio/x-m4a','audio/ogg','audio/webm','audio/aac'].includes(item.audio.type)&&item.audio.data?.startsWith('data:audio/'))audio=`<audio controls preload="none" src="${item.audio.data}"></audio><p class="audio-help">Bấm nút phát để nghe âm thanh kèm món quà.</p>`;
 setHeader('Một lời nhắn <em>dành riêng cho bạn</em>','Có những điều đáng được lưu giữ, để một ngày nào đó đọc lại và mỉm cười.');
 put(`<div class="app-badge">A LETTER, JUST FOR YOU</div><h3>Gửi đến <em>${escapeHtml(item.recipient)}</em></h3><div class="letter" data-theme="${theme}"><div class="letter-head"><span>CACAO NOTE · PRIVATE LETTER</span><span>♡</span></div><h4>Dear ${escapeHtml(item.recipient)},</h4><p>${escapeHtml(item.message)}</p>${images?`<div class="gallery">${images}</div>`:''}${audio}<div class="letter-foot">With love, ${escapeHtml(item.sender)} ♡</div></div><p class="util-hint">Lời nhắn chỉ hiển thị trong phiên mở này. Khi tải lại trang, bạn sẽ cần nhập lại cả hai mật khẩu.</p><button class="secondary-btn" type="button" id="close-letter">Đóng lời nhắn</button>`);
 $('#close-letter').addEventListener('click',()=>{document.querySelectorAll('audio').forEach(a=>a.pause());startScreen('locked')});
}
async function gift(){
 put('<div class="loading-line">Đang kiểm tra không gian quà tặng...</div>');
 try{const state=await request(giftApi(''));startScreen(state.status)}catch(e){put(`<div class="app-badge">GIFT NOT FOUND</div><h3>Chưa tìm thấy <em>món quà.</em></h3><p>${escapeHtml(e.message)}. Kiểm tra lại mã QR hoặc liên hệ người tặng.</p><a class="primary-btn" href="/demo">Thử bản demo <span>↗</span></a>`)}
}
function privacy(){setHeader('Quyền riêng tư <em>là quan trọng</em>','Một món quà có ý nghĩa cần được bảo vệ ngay từ lúc tạo ra.');put(`<div class="app-badge">OUR PRIVACY PROMISE</div><h3>Giữ kín những <em>điều riêng tư.</em></h3><div class="privacy-text"><h4>Những gì được lưu</h4><p>Dữ liệu mã hóa của lời nhắn, ảnh, âm thanh và thông tin cần thiết để vận hành mã QR. Website không yêu cầu email, số điện thoại hay địa chỉ của người gửi và người nhận.</p><h4>Hai mật khẩu hoạt động ra sao?</h4><p>MK1 được in trên son và kiểm tra tại máy chủ. MK2 do người mua tự tạo, dùng để mã hóa nội dung trên thiết bị, không gửi lên máy chủ. Vì MK1 được in trên vỏ, tính riêng tư chủ yếu phụ thuộc MK2.</p><h4>Những giới hạn cần biết</h4><p>Người vận hành dịch vụ có thể ngừng website, xóa dữ liệu hoặc sửa mã website. Đây là dự án thử nghiệm chưa được kiểm toán bảo mật và không có cam kết lưu trữ vĩnh viễn. Đừng gửi dữ liệu cực kỳ nhạy cảm. Nếu quên MK2, không thể mở nội dung cũ.</p><h4>Việc xóa dữ liệu</h4><p>Phiên bản hiện tại chưa hỗ trợ người dùng tự xóa lời nhắn đã khóa. Trước khi sử dụng với khách hàng thật, cần có chính sách giữ và xóa dữ liệu, phương thức liên hệ và cơ chế sao lưu phù hợp.</p></div>`)}
function admin(){
 setHeader('Quản trị <em>CACAO NOTE</em>','Tạo mã QR, MK1 riêng cho từng thỏi son và in nhãn.');
 put(`<div class="app-badge">PRODUCT MANAGEMENT</div><h3>Gửi đi <em>những món quà.</em></h3><p>Chỉ người quản trị được phép tạo mã sản phẩm. Mật khẩu MK1 chỉ hiển thị một lần sau khi tạo.</p><div class="notice">Bản xem thử trên máy không có máy chủ; tính năng này chỉ hoạt động sau khi triển khai lên Cloudflare.</div><form id="admin-form"><div class="field"><label for="admin-key">Mã quản trị</label><input type="password" id="admin-key" placeholder="Mã quản trị bạn đã cài đặt" autocomplete="off" required/></div><div class="field"><label for="admin-count">Số thỏi son cần tạo</label><input type="number" id="admin-count" min="1" max="40" value="8" required/></div><div class="form-error" role="alert"></div><div class="admin-tools"><button class="primary-btn" type="submit">Tạo mã QR & MK1 <span>↗</span></button><button type="button" class="secondary-btn" id="admin-list-btn">Xem trạng thái</button></div></form><div id="admin-results"></div>`);
 $('#admin-form').addEventListener('submit',async e=>{
   e.preventDefault();const btn=e.submitter;buttonLoading(btn,true);
   try{const response=await fetch('/api/admin/create',{method:'POST',headers:{'content-type':'application/json','x-admin-key':$('#admin-key').value},body:JSON.stringify({count:Number($('#admin-count').value)})});const result=await response.json();if(!response.ok)throw Error(result.error||'Không tạo được sản phẩm.');adminResults(result.products);toast('Đã tạo '+result.products.length+' mã riêng. Tải CSV ngay!');}catch(e){appError(e)}finally{buttonLoading(btn,false)}
 });
 $('#admin-list-btn').addEventListener('click',async()=>{try{const response=await fetch('/api/admin/list',{headers:{'x-admin-key':$('#admin-key').value}});const data=await response.json();if(!response.ok)throw Error(data.error||'Không lấy được danh sách');$('#admin-results').innerHTML='<p class="util-hint">Trạng thái:</p>'+data.products.map(x=>`<p class="code-tag">${escapeHtml(x.id)} · ${escapeHtml(x.status)}</p>`).join('')}catch(e){appError(e)}});
}
function adminResults(products){
 const results=$('#admin-results');results.innerHTML=`<div class="notice warning"><b>LƯU NGAY:</b> MK1 chỉ được cung cấp tại thời điểm tạo. QR chỉ sử dụng được sau khi trang web online và không nên đổi tên miền.</div><div class="admin-tools no-print"><button type="button" id="download-csv" class="secondary-btn">↓ Tải bảng mã CSV</button><button type="button" id="print-qr" class="secondary-btn">▦ In nhãn QR</button></div><table class="admin-table"><thead><tr><th>STT</th><th>QR riêng</th><th>MK1 trên son</th><th>Địa chỉ</th></tr></thead><tbody>${products.map((p,i)=>`<tr><td>${i+1}</td><td><div class="qr-svg" id="qr-${i}"></div></td><td class="mk1">${escapeHtml(p.mk1)}</td><td><div style="max-width:210px;word-break:break-all">${escapeHtml(p.url)}</div></td></tr>`).join('')}</tbody></table>`;
 products.forEach((p,i)=>{try{$(`#qr-${i}`).innerHTML=window.generateQR(p.url)}catch(e){$(`#qr-${i}`).textContent='Lỗi tạo QR: '+e.message}});
 $('#download-csv').addEventListener('click',()=>{const rows=[['STT','Ma QR (URL)','MK1'],...products.map((x,i)=>[String(i+1),x.url,x.mk1])];const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='cacao-note-qr-mk1.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)});
 $('#print-qr').addEventListener('click',()=>window.print());
}
(async function(){
 if(location.pathname==='/privacy'){privacy();return}
 if(location.pathname==='/admin'){admin();return}
 if(productId){await gift();return}
 home();
})();
