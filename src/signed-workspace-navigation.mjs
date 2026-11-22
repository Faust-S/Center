// Keep original T3 signed Kernel alive only within the SAME organization
// while the manager moves between results and D2 read-only context. A native
// owner is still the sole authority; this is navigation, not permission.
const MANAGER_READ_PAGES=new Set(['results','overview','context']);
export function retainSignedWorkspaceForPage(page,activeOrg,signedOrg){
  return typeof signedOrg==='string'&&signedOrg.length>0&&
    activeOrg===signedOrg&&MANAGER_READ_PAGES.has(page);
}
export function mayOpenSignedWorkspaceOnPage(page,activeOrg,targetOrg,signedOrg){
  if(typeof targetOrg!=='string'||!targetOrg||activeOrg!==targetOrg)return false;
  // New original T3 Workspace may only begin from the explicit Review panel.
  // An already signed child may be shown on Overview/Context read-only views.
  return page==='results'||(
    signedOrg===targetOrg&&MANAGER_READ_PAGES.has(page));
}
