/** Keyboard navigation for the four existing Task Result tabs.
 * UI-only: never reads Core, changes task selection or executes an action.
 */
export type TaskResultTab='result'|'history'|'plan'|'sources';
const tabs:readonly TaskResultTab[]=['result','history','plan','sources'];
export function nextTaskResultTab(current:TaskResultTab,key:string):TaskResultTab|null{
 const index=tabs.indexOf(current);
 if(index<0)return null;
 if(key==='Home')return tabs[0];
 if(key==='End')return tabs[tabs.length-1];
 if(key==='ArrowRight'||key==='ArrowDown')return tabs[(index+1)%tabs.length];
 if(key==='ArrowLeft'||key==='ArrowUp')return tabs[(index-1+tabs.length)%tabs.length];
 return null;
}
