import {invoke,isTauri} from '@tauri-apps/api/core';

/** One-use short-lived tickets never enter localStorage or a renewal URL. */
export async function exchangeDesktopTicket(ticket:unknown):Promise<void>{
 if(typeof ticket!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(ticket))
  throw Error('desktop_bootstrap_ticket_invalid');
 // WebView must not remain blank forever when an old Core accepts a socket
 // without completing the one-use ticket exchange. Recovery is explicit and
 // read-only; never retry this ticket or replay a Task command automatically.
 const controller=new AbortController();
 const limit=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch('/api/session/bootstrap',{
   method:'POST',credentials:'same-origin',mode:'same-origin',cache:'no-store',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({bootstrap_token:ticket}),
   signal:controller.signal,
  });
  if(!response.ok)throw Error('desktop_bootstrap_denied');
  const body:unknown=await response.json();
  if(!body||typeof body!=='object'||
     (body as Record<string,unknown>).authenticated!==true||
     (body as Record<string,unknown>).storage!=='HTTP_ONLY_COOKIE')
   throw Error('desktop_bootstrap_unconfirmed');
 }finally{clearTimeout(limit);}
}

/** Consume the one-use startup ticket before any asynchronous request.
 * Clearing the URL also allows the existing Tauri renewal command to verify
 * the exact /desktop/ window if this first exchange fails.
 */
export async function exchangeStartupDesktopTicket(fragment:string,clearUrl:()=>void):Promise<boolean>{
 // An absent ticket is not authentication, even when an old cookie exists.
 // The native recovery screen may request a new ticket explicitly.
 if(!fragment.startsWith('#iwxa_bootstrap='))return false;
 const ticket=fragment.slice('#iwxa_bootstrap='.length);
 clearUrl();
 await exchangeDesktopTicket(ticket);
 return true;
}

export async function renewDesktopSession():Promise<void>{
 if(!isTauri())throw Error('native_desktop_window_required');
 // The page supplies no executable, address, port or free-form command.
 const ticket=await invoke<string>('recover_desktop_session');
 await exchangeDesktopTicket(ticket);
}
