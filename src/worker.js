// CACAO NOTE | Cloudflare Worker + D1. No plaintext letters or MK2 are sent here.
const MAX_CHUNKS = 80;
const MAX_CHUNK_CHARS = 102400;
const headers = {
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'x-frame-options':'DENY'
};
const now = () => Math.floor(Date.now()/1000);
const json = (o,status=200) => new Response(JSON.stringify(o),{status,headers});
const bad = (message,status=400) => json({ok:false,error:message},status);
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const random = (len=24) => b64url(crypto.getRandomValues(new Uint8Array(len)));
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const constantMatch=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let v=0;for(let i=0;i<a.length;i++)v|=a.charCodeAt(i)^b.charCodeAt(i);return v===0};
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newMK1=(length=6)=>{const r=crypto.getRandomValues(new Uint8Array(length));return [...r].map(v=>alphabet[v%alphabet.length]).join('')};
const norm=m=>String(m||'').replace(/-/g,'').toUpperCase();
const body = async req=>{const len=Number(req.headers.get('content-length')||0);if(len>180000)return null;try {return await req.json()}catch{return null}};
const validId=id=>/^[\w-]{16,35}$/.test(id);
const isAdmin=async(req,env)=>{const given=req.headers.get('x-admin-key')||'';return !!(env.ADMIN_TOKEN&&given.length>=24&&constantMatch(await digest(given),await digest(env.ADMIN_TOKEN)))};
const mk1Auth=async(gift,mk1,env)=>{
 if(gift.blocked_until>now())return {ok:false,error:'Mã tạm khóa do nhập sai nhiều lần. Vui lòng thử sau.',status:429};
 const h=await digest(gift.mk1_salt+':'+norm(mk1));
 if(!constantMatch(h,gift.mk1_hash)){
   const fails=gift.fail_count+1;
   await env.DB.prepare('UPDATE gifts SET fail_count=?, blocked_until=? WHERE id=?').bind(fails%8, fails%8===0?now()+900:0,gift.id).run();
   return {ok:false,error:'Mật khẩu 1 chưa đúng.',status:401};
 }
 await env.DB.prepare('UPDATE gifts SET fail_count=0, blocked_until=0 WHERE id=?').bind(gift.id).run();
 return {ok:true};
};
const validToken=async (env,giftId,token,table,col)=>{
 if(!token||!/^[-_\w]{35,100}$/.test(token))return false;
 const hashed=await digest(token);
 if(table==='gifts'){
   const row=await env.DB.prepare('SELECT upload_hash,upload_expires,status FROM gifts WHERE id=?').bind(giftId).first();
   return !!(row&&row.status==='draft'&&row.upload_expires>now()&&constantMatch(row.upload_hash||'',hashed));
 }
 const session=await env.DB.prepare('SELECT token_hash FROM read_sessions WHERE token_hash=? AND gift_id=? AND expires>?').bind(hashed,giftId,now()).first();
 return !!session;
};
async function route(req,env,url){
 const path=url.pathname; const method=req.method;
 if(path==='/api/health')return json({ok:true,service:'CACAO NOTE',mode:'online'});
 if(path==='/api/admin/create'&&method==='POST'){
   if(!await isAdmin(req,env))return bad('Không có quyền quản trị.',403);
   const data=await body(req);const count=Number(data?.count);
   const mk1Length=data?.mk1Length===undefined?6:Number(data.mk1Length);
   if(!Number.isInteger(count)||count<1||count>40)return bad('Chọn từ 1 đến 40 sản phẩm.');
   if(!Number.isInteger(mk1Length)||mk1Length<4||mk1Length>12)return bad('Độ dài MK1 phải từ 4 đến 12 ký tự.');
   const out=[];
   for(let i=0;i<count;i++){
     const id=random(16),mk1=newMK1(mk1Length),salt=random(12),hash=await digest(salt+':'+norm(mk1));
     await env.DB.prepare('INSERT INTO gifts (id,mk1_salt,mk1_hash,created_at) VALUES (?,?,?,?)').bind(id,salt,hash,now()).run();
     out.push({id,mk1,url:`${url.origin}/s/${id}`});
   }
   return json({ok:true,products:out,warning:'MK1 chỉ trả về một lần. Hãy tải CSV và giữ kín trước khi giao sản phẩm.'});
 }
 if(path==='/api/admin/list'&&method==='GET'){
   if(!await isAdmin(req,env))return bad('Không có quyền quản trị.',403);
   const r=await env.DB.prepare('SELECT id,status,created_at,locked_at FROM gifts ORDER BY created_at DESC LIMIT 150').all();
   return json({ok:true,products:r.results});
 }
 const product=path.match(/^\/api\/products\/([\w-]{16,35})(?:\/(start|upload|finalize|access|chunks))?$/);
 if(!product)return bad('Không có địa chỉ này.',404);
 const id=product[1],operation=product[2]||'';
 if(!validId(id))return bad('Đường dẫn sản phẩm không hợp lệ.',404);
 const gift=await env.DB.prepare('SELECT * FROM gifts WHERE id=?').bind(id).first();
 if(!gift)return bad('Không tìm thấy thỏi son này.',404);
 if(!operation&&method==='GET')return json({ok:true,status:gift.status,createdAt:gift.created_at,lockedAt:gift.locked_at});
 if(operation==='start'&&method==='POST'){
   const data=await body(req);if(!data)return bad('Dữ liệu không hợp lệ.');
   const check=await mk1Auth(gift,data.mk1,env);if(!check.ok)return bad(check.error,check.status);
   if(gift.status==='locked')return bad('Lời nhắn đã được khóa, không thể viết đè.',409);
   if(gift.status==='draft'&&gift.upload_expires>now())return bad('Thỏi son đang có phiên tạo lời nhắn. Thử lại sau khoảng 20 phút nếu bị gián đoạn.',409);
   const token=random(32),hash=await digest(token);
   const changed=await env.DB.prepare("UPDATE gifts SET status='draft',upload_hash=?,upload_expires=? WHERE id=? AND (status='new' OR (status='draft' AND upload_expires<=?))").bind(hash,now()+1200,id,now()).run();
   if(changed.meta?.changes!==1)return bad('Không thể giữ quyền tạo lời nhắn lúc này.',409);
   await env.DB.prepare('DELETE FROM gift_chunks WHERE gift_id=?').bind(id).run();
   return json({ok:true,uploadToken:token,expiresIn:1200});
 }
 if(operation==='upload'&&method==='POST'){
   const d=await body(req);
   if(!d||!Number.isInteger(d.index)||d.index<0||d.index>=MAX_CHUNKS||typeof d.data!=='string'||d.data.length>MAX_CHUNK_CHARS||d.data.length<1||!/^[A-Za-z0-9+/=]+$/.test(d.data))return bad('Mảnh dữ liệu không hợp lệ.');
   if(!await validToken(env,id,d.uploadToken,'gifts'))return bad('Phiên tạo đã hết hạn hoặc không hợp lệ.',403);
   await env.DB.prepare('INSERT INTO gift_chunks (gift_id,idx,data) VALUES (?,?,?) ON CONFLICT(gift_id,idx) DO UPDATE SET data=excluded.data').bind(id,d.index,d.data).run();
   return json({ok:true,index:d.index});
 }
 if(operation==='finalize'&&method==='POST'){
   const d=await body(req);
   if(!d||!Number.isInteger(d.count)||d.count<1||d.count>MAX_CHUNKS||typeof d.salt!=='string'||typeof d.iv!=='string'||!/^[A-Za-z0-9+/=]{16,100}$/.test(d.salt)||!/^[A-Za-z0-9+/=]{12,70}$/.test(d.iv))return bad('Thông tin khóa không hợp lệ.');
   if(!await validToken(env,id,d.uploadToken,'gifts'))return bad('Phiên tạo không hợp lệ.',403);
   const check=await env.DB.prepare('SELECT COUNT(*) AS n, MIN(idx) AS lo, MAX(idx) AS hi FROM gift_chunks WHERE gift_id=?').bind(id).first();
   if(check.n!==d.count||check.lo!==0||check.hi!==d.count-1)return bad('Dữ liệu chưa được tải lên đầy đủ.',409);
   const changed=await env.DB.prepare("UPDATE gifts SET status='locked',upload_hash=NULL,upload_expires=NULL,salt=?,iv=?,chunk_count=?,locked_at=? WHERE id=? AND status='draft' AND upload_hash=?").bind(d.salt,d.iv,d.count,now(),id,await digest(d.uploadToken)).run();
   if(changed.meta?.changes!==1)return bad('Không thể khóa lời nhắn.',409);
   return json({ok:true,status:'locked'});
 }
 if(operation==='access'&&method==='POST'){
   const d=await body(req);if(!d)return bad('Dữ liệu không hợp lệ.');
   const check=await mk1Auth(gift,d.mk1,env);if(!check.ok)return bad(check.error,check.status);
   if(gift.status!=='locked')return bad('Chưa có lời nhắn được khóa.',409);
   const accessToken=random(32);
   await env.DB.prepare('INSERT INTO read_sessions(token_hash,gift_id,expires) VALUES (?,?,?)').bind(await digest(accessToken),id,now()+900).run();
   return json({ok:true,accessToken,salt:gift.salt,iv:gift.iv,count:gift.chunk_count,expiresIn:900});
 }
 if(operation==='chunks'&&method==='GET'){
   const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
   if(gift.status!=='locked'||!await validToken(env,id,token,'read'))return bad('Cần nhập lại MK1 để xem nội dung.',403);
   const start=Number(url.searchParams.get('from')),count=Number(url.searchParams.get('count'));
   if(!Number.isInteger(start)||start<0||!Number.isInteger(count)||count<1||count>8||start+count>gift.chunk_count)return bad('Phạm vi không hợp lệ.');
   const r=await env.DB.prepare('SELECT idx,data FROM gift_chunks WHERE gift_id=? AND idx>=? AND idx<? ORDER BY idx').bind(id,start,start+count).all();
   if(r.results.length!==count)return bad('Dữ liệu bị thiếu. Vui lòng liên hệ người quản lý.',500);
   return json({ok:true,chunks:r.results.map(x=>x.data)});
 }
 return bad('Phương thức không được hỗ trợ.',405);
}
export default {
  async fetch(req,env){
    const url=new URL(req.url);
    try{
      if(req.method==='OPTIONS')return new Response(null,{status:405});
      if(url.pathname.startsWith('/api/')){
        if(!env.DB)return bad('Chưa kết nối cơ sở dữ liệu.',503);
        return await route(req,env,url);
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return bad('Không được phép.',405);
      let response;
      if(/^\/s\/[\w-]+$/.test(url.pathname)||url.pathname==='/admin'||url.pathname==='/demo'||url.pathname==='/privacy'){
        const asset=new URL('/',url.origin);
        response=await env.ASSETS.fetch(new Request(asset.toString(),req));
      }else response=await env.ASSETS.fetch(req);
      const h=new Headers(response.headers);
      h.set('x-content-type-options','nosniff');h.set('referrer-policy','no-referrer');
      h.set('x-frame-options','DENY');
      h.set('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});
    }catch(err){console.error('CACAO NOTE API failure',err);return bad('Máy chủ tạm gặp lỗi, vui lòng thử lại.',500)}
  }
};
