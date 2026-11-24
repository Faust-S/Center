// Native window geometry, in CSS pixels. Keep the original editor beside
// the inspector; the preferred width is never a second persistent layout.
export const INSPECTOR_MIN=270;
export const INSPECTOR_MAX=680;
export const MAIN_MIN=320;

/** @param {number} viewportWidth @param {boolean} navigationCollapsed */
export function inspectorLayout(viewportWidth,navigationCollapsed=false){
 const viewport=Math.max(0,Math.floor(viewportWidth));
 // style.css removes body padding at 700px; admin-v8.css removes the
 // window border at 650px. A native desktop window starts at 720px.
 const shellWidth=viewport-(viewport>700?24:0)-(viewport>650?2:0);
 const rail=viewport<=900?58:60;
 const sidebar=viewport<=900||navigationCollapsed?0:viewport<=1220?225:247;
 const available=Math.max(0,shellWidth-rail-sidebar-MAIN_MIN);
 const max=Math.min(INSPECTOR_MAX,Math.max(INSPECTOR_MIN,available));
 return {min:INSPECTOR_MIN,max,shellWidth,rail,sidebar,available};
}
/** @param {number} preferred @param {{min:number,max:number}} bounds */
export function clampInspectorWidth(preferred,bounds){
 const width=Number.isFinite(preferred)?Math.round(preferred):355;
 return Math.min(bounds.max,Math.max(bounds.min,width));
}
