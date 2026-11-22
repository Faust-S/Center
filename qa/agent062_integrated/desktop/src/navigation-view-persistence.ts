/** Serializes UI-only navigation preferences through the existing Core
 * settings owner. No browser cache, new store or Task authority is introduced.
 */
export type NavigationView={
 page:string;area_id:string;task_id:string;
 document_tab:'result'|'history'|'sources'|'plan';
};
type ViewReadback={persisted?:boolean;view?:NavigationView;
 views_by_area?:Record<string,NavigationView>;};
type ViewPort={
 command<T>(name:string,input:Record<string,unknown>,owner?:{kind:string;id:string}):Promise<T>;
 query<T>(name:string,params?:Record<string,unknown>):Promise<T>;
};

export function createNavigationViewPersistence(port:ViewPort){
 let queue:Promise<void>=Promise.resolve();
 let confirmed='';
 const save=(view:NavigationView,force=false):Promise<void>=>{
  const signature=JSON.stringify(view);
  const matches=(state:ViewReadback)=>state.persisted===true
   &&JSON.stringify(state.view)===signature
   &&JSON.stringify(state.views_by_area?.[view.area_id])===signature;
  const operation=queue.catch(()=>undefined).then(async()=>{
   if(!force&&confirmed===signature)return;
   try{
    const result=await port.command<ViewReadback>(
     'ui_preferences_update',{view},{kind:'ui_preferences',id:'desktop'});
    if(!matches(result))
     throw Error('ui_navigation_readback_failed');
   }catch(error){
    // A lost reply may follow a committed Core write. Read first; never
    // repeat a mutation merely because its acknowledgement was lost.
    let observed:ViewReadback;
    try{observed=await port.query<ViewReadback>('ui_preferences');}
    catch{throw error;}
    if(!matches(observed))
     throw error;
   }
   confirmed=signature;
  });
  queue=operation;
  return operation;
 };
 return {save};
}
